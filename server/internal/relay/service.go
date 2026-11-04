package relay

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/billing"
	"github.com/sucheng1101/infinity-canvas/server/internal/costpricing"
	"github.com/sucheng1101/infinity-canvas/server/internal/generation"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/userchannel"
	"gorm.io/gorm"
)

var (
	ErrTaskNotFound     = errors.New("generation task not found")
	ErrRouteUnavailable = errors.New("generation route unavailable")
	ErrUnsupported      = errors.New("generation capability is unsupported")
	ErrUpstream         = errors.New("upstream generation failed")
	ErrResponseTooLarge = errors.New("upstream response is too large")
)

// maxUpstreamResponseBytes caps a single upstream response body at 32MB, which
// covers base64 payloads of large images while keeping one response bounded.
const maxUpstreamResponseBytes int64 = 32 << 20

const (
	// upstreamAttempts is the total number of tries, so 2 means one retry.
	upstreamAttempts   = 2
	upstreamRetryDelay = 500 * time.Millisecond
)

func retryableUpstreamStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= http.StatusInternalServerError
}

type Service struct {
	DB           *gorm.DB
	Generation   *generation.Service
	Client       *http.Client
	UserChannels *userchannel.Service
	runsMu       sync.Mutex
	runs         map[string]context.CancelFunc
}

type ExecuteMeta struct {
	RequestID       string
	IP              string
	RequestType     string
	ReasoningEffort string
}

type route struct {
	model        model.ModelRoute
	channel      model.UpstreamChannel
	channelModel model.UpstreamChannelModel
	key          model.UpstreamChannelKey
}

// Execute runs one queued task through the administrator-selected upstream route.
// The upstream API key is only read inside this service and is never serialized.
func (s *Service) Execute(ctx context.Context, userID uint, taskID string, metadata ...ExecuteMeta) (generation.View, error) {
	if userID == 0 || strings.TrimSpace(taskID) == "" {
		return generation.View{}, ErrTaskNotFound
	}
	var task model.GenerationTask
	if err := s.DB.Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return generation.View{}, ErrTaskNotFound
		}
		return generation.View{}, err
	}
	if task.Status == model.GenerationTaskSucceeded || task.Status == model.GenerationTaskFailed || task.Status == model.GenerationTaskCancelled {
		return toTaskView(task)
	}
	runCtx, cancel := context.WithCancel(ctx)
	if !s.registerRun(task.ID, cancel) {
		if reloadErr := s.DB.First(&task, "id = ?", task.ID).Error; reloadErr != nil {
			return generation.View{}, reloadErr
		}
		return toTaskView(task)
	}
	defer s.unregisterRun(task.ID)
	if err := s.Generation.Start(task.ID); err != nil {
		// Another request may already own execution. Return the current state rather
		// than sending the same upstream request twice.
		if reloadErr := s.DB.First(&task, "id = ?", task.ID).Error; reloadErr != nil {
			return generation.View{}, err
		}
		if task.Status == model.GenerationTaskRunning {
			return toTaskView(task)
		}
		return generation.View{}, err
	}
	meta := ExecuteMeta{RequestType: "generation"}
	if len(metadata) > 0 {
		meta = metadata[0]
		if strings.TrimSpace(meta.RequestType) == "" {
			meta.RequestType = "generation"
		}
	}
	usageID := s.beginUsage(task, meta)
	failWithLog := func(code string, cause error) (generation.View, error) {
		if errors.Is(cause, context.Canceled) {
			if cancelled, cancelErr := s.Generation.Cancel(task.UserID, task.ID); cancelErr == nil {
				s.finishUsage(usageID, model.UsageLogFailed, task, 0, "TASK_CANCELLED", cause, nil, 0)
				return cancelled, cause
			}
			if current, readErr := s.Generation.Get(task.UserID, task.ID); readErr == nil && current.Status == model.GenerationTaskCancelled {
				s.finishUsage(usageID, model.UsageLogFailed, task, 0, "TASK_CANCELLED", cause, nil, 0)
				return current, cause
			}
		}
		view, failure := s.fail(task.ID, code, cause)
		s.finishUsage(usageID, model.UsageLogFailed, task, 0, code, cause, nil, 0)
		return view, failure
	}

	selected, err := s.findTaskRoute(task)
	if err != nil {
		return failWithLog("ROUTE_UNAVAILABLE", err)
	}
	s.updateUsageRoute(usageID, selected)
	body, err := buildRequestBody(task, selected.model)
	if err != nil {
		return failWithLog("TASK_PAYLOAD_INVALID", err)
	}
	path, err := endpointPath(task.Capability, selected.model, selected.channel)
	if err != nil {
		return failWithLog("CAPABILITY_UNSUPPORTED", err)
	}
	requestURL := joinURL(selected.channel.BaseURL, path)
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	// One retry for transport errors, 429 and 5xx keeps a flaky upstream from
	// turning into a user-visible failure, without hiding a real outage.
	var response *http.Response
	for attempt := 1; ; attempt++ {
		attemptReq, reqErr := http.NewRequestWithContext(runCtx, http.MethodPost, requestURL, strings.NewReader(body))
		if reqErr != nil {
			return failWithLog("UPSTREAM_REQUEST_INVALID", reqErr)
		}
		attemptReq.Header.Set("Content-Type", "application/json")
		attemptReq.Header.Set("Authorization", "Bearer "+selected.key.APIKey)
		applyHeaders(attemptReq, selected.channel.SettingsJSON, selected.model.SettingsJSON)
		response, err = client.Do(attemptReq)
		retryable := err == nil && retryableUpstreamStatus(response.StatusCode)
		if err != nil {
			retryable = !errors.Is(err, context.Canceled)
		}
		if !retryable || attempt >= upstreamAttempts {
			break
		}
		if response != nil {
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			response = nil
		}
		select {
		case <-runCtx.Done():
			return failWithLog("UPSTREAM_REQUEST_FAILED", runCtx.Err())
		case <-time.After(upstreamRetryDelay):
		}
	}
	if err != nil {
		return failWithLog("UPSTREAM_REQUEST_FAILED", err)
	}
	defer response.Body.Close()
	// Bound the read so a single oversized upstream body cannot exhaust memory.
	data, readErr := io.ReadAll(io.LimitReader(response.Body, maxUpstreamResponseBytes+1))
	if readErr != nil {
		return failWithLog("UPSTREAM_RESPONSE_FAILED", readErr)
	}
	if int64(len(data)) > maxUpstreamResponseBytes {
		return failWithLog("UPSTREAM_RESPONSE_TOO_LARGE", ErrResponseTooLarge)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return failWithLog("UPSTREAM_HTTP_ERROR", fmt.Errorf("upstream returned HTTP %d: %s", response.StatusCode, compact(string(data))))
	}
	output, err := decodeResponse(data, response.Header.Get("Content-Type"))
	if err != nil {
		return failWithLog("UPSTREAM_RESPONSE_INVALID", err)
	}
	inputTokens, outputTokens, cachedTokens, totalTokens := usageTokens(output)
	view, err := s.Generation.Complete(task.ID, output, task.ReservedAmount)
	if err != nil {
		return failWithLog("TASK_SETTLEMENT_FAILED", err)
	}
	s.finishUsage(usageID, model.UsageLogSuccess, task, view.SettledAmount, "", nil, output, inputTokens+outputTokens+cachedTokens)
	_ = s.DB.Model(&model.UsageLog{}).Where("id = ?", usageID).Updates(map[string]any{"input_tokens": inputTokens, "output_tokens": outputTokens, "cached_tokens": cachedTokens, "total_tokens": totalTokens})
	return view, nil
}

// Cancel interrupts an in-flight upstream request. The persisted task state is
// still changed by the HTTP handler through Generation.Cancel, so queued tasks
// and tasks that have already completed use the same state machine.
func (s *Service) Cancel(taskID string) bool {
	s.runsMu.Lock()
	cancel, ok := s.runs[taskID]
	if ok {
		delete(s.runs, taskID)
	}
	s.runsMu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (s *Service) registerRun(taskID string, cancel context.CancelFunc) bool {
	s.runsMu.Lock()
	if s.runs == nil {
		s.runs = map[string]context.CancelFunc{}
	}
	if _, exists := s.runs[taskID]; exists {
		s.runsMu.Unlock()
		return false
	}
	s.runs[taskID] = cancel
	s.runsMu.Unlock()
	return true
}

func (s *Service) unregisterRun(taskID string) {
	s.runsMu.Lock()
	delete(s.runs, taskID)
	s.runsMu.Unlock()
}

func (s *Service) fail(taskID, code string, cause error) (generation.View, error) {
	message := compact(cause.Error())
	view, err := s.Generation.Fail(taskID, code, message)
	if err != nil {
		return generation.View{}, err
	}
	return view, cause
}

func (s *Service) beginUsage(task model.GenerationTask, meta ExecuteMeta) uint {
	item := model.UsageLog{
		TaskID: task.ID, RequestID: strings.TrimSpace(meta.RequestID), UserID: task.UserID,
		PublishedModelID: task.PublishedModelID, Capability: task.Capability,
		RequestType: meta.RequestType, ReasoningEffort: meta.ReasoningEffort,
		RequestedQuality: requestedImageQuality(task),
		BillingUnit:      billingUnit(task.Capability),
		Status:           model.UsageLogRunning, IP: strings.TrimSpace(meta.IP), StartedAt: time.Now().UTC(),
		RequestSummaryJSON: summarizeTask(task),
	}
	var published model.PublishedModel
	if s.DB.First(&published, task.PublishedModelID).Error == nil {
		item.PublishedModel = published.DisplayName
	}
	if s.DB.Create(&item).Error != nil {
		return 0
	}
	return item.ID
}

func (s *Service) updateUsageRoute(id uint, selected route) {
	if id == 0 {
		return
	}
	_ = s.DB.Model(&model.UsageLog{}).Where("id = ?", id).Updates(map[string]any{
		"channel_id": selected.channel.ID, "channel_name": selected.channel.Name,
		"provider": selected.channel.Provider, "upstream_model": selected.model.UpstreamModel,
	})
}

func (s *Service) finishUsage(id uint, status string, task model.GenerationTask, charged int64, code string, cause error, response map[string]any, totalTokens int64) {
	if id == 0 {
		return
	}
	var item model.UsageLog
	if s.DB.First(&item, id).Error != nil {
		return
	}
	now := time.Now().UTC()
	units := billedUnits(task, totalTokens)
	updates := map[string]any{"status": status, "completed_at": now, "duration_ms": now.Sub(item.StartedAt).Milliseconds(), "charged_quota": charged, "cost_quota": int64(0), "profit_quota": charged, "revenue_total": charged, "profit_total": charged, "total_tokens": totalTokens, "billed_units": units}
	var cost model.ModelCostPricing
	if item.ChannelID > 0 && item.UpstreamModel != "" && s.DB.Where("published_model_id = ? AND channel_id = ? AND upstream_model = ? AND status = ?", task.PublishedModelID, item.ChannelID, item.UpstreamModel, "active").First(&cost).Error == nil {
		parameters := map[string]any{}
		_ = json.Unmarshal([]byte(task.ParametersJSON), &parameters)
		costPerUnit := costpricing.UnitPrice(cost, parameters)
		costQuota := int64(units * float64(costPerUnit))
		updates["cost_quota"] = costQuota
		updates["profit_quota"] = charged - costQuota
		updates["cost_pricing_id"] = cost.ID
		updates["cost_per_unit"] = costPerUnit
		updates["sell_per_unit"] = cost.SellPerUnit
		updates["cost_total"] = costQuota
		updates["profit_total"] = charged - costQuota
	}
	if code != "" {
		updates["error_code"] = code
	}
	if cause != nil {
		updates["error_message"] = compact(cause.Error())
	}
	if response != nil {
		updates["response_summary_json"] = summarizeResponse(response)
		if strings.ToLower(strings.TrimSpace(task.Capability)) == "image" {
			if quality := actualImageQuality(response); quality != "" {
				updates["actual_quality"] = quality
			}
		}
	}
	_ = s.DB.Model(&model.UsageLog{}).Where("id = ?", id).Updates(updates)
}

func billingUnit(capability string) string {
	return billing.UnitForCapability(capability)
}

func billedUnits(task model.GenerationTask, totalTokens int64) float64 {
	var parameters map[string]any
	_ = json.Unmarshal([]byte(task.ParametersJSON), &parameters)
	imageCount := numberValue(parameters["count"])
	if imageCount <= 0 {
		imageCount = 1
	}
	units := billing.Units(task.Capability, imageCount, numberValue(parameters["durationSeconds"]), float64(totalTokens))
	if units == 0 && billing.UnitForCapability(task.Capability) == "request" {
		// Unknown capabilities still bill one request, as usage logs always did.
		return 1
	}
	return units
}

func numberValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return 0
	}
}

func summarizeTask(task model.GenerationTask) string {
	var payload map[string]any
	_ = json.Unmarshal([]byte(task.PayloadJSON), &payload)
	var parameters map[string]any
	_ = json.Unmarshal([]byte(task.ParametersJSON), &parameters)
	return encodeSummary(map[string]any{"payloadKeys": mapKeys(payload), "parameterKeys": mapKeys(parameters), "payloadBytes": len(task.PayloadJSON)})
}

func requestedImageQuality(task model.GenerationTask) string {
	if strings.ToLower(strings.TrimSpace(task.Capability)) != "image" {
		return ""
	}
	for _, raw := range []string{task.ParametersJSON, task.PayloadJSON} {
		var value map[string]any
		if json.Unmarshal([]byte(raw), &value) != nil {
			continue
		}
		if quality := qualityValue(value, "quality"); quality != "" {
			return quality
		}
	}
	return ""
}

func actualImageQuality(response map[string]any) string {
	if response == nil {
		return ""
	}
	for _, key := range []string{"actual_quality", "actualQuality", "output_quality", "outputQuality", "quality"} {
		if quality := qualityValue(response, key); quality != "" {
			return quality
		}
	}
	for _, key := range []string{"data", "images", "output", "result"} {
		if nested, ok := response[key].([]any); ok {
			for _, value := range nested {
				if item, ok := value.(map[string]any); ok {
					if quality := actualImageQuality(item); quality != "" {
						return quality
					}
				}
			}
		}
		if nested, ok := response[key].(map[string]any); ok {
			if quality := actualImageQuality(nested); quality != "" {
				return quality
			}
		}
	}
	return ""
}

func qualityValue(value map[string]any, key string) string {
	quality, ok := value[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(quality)
}

func summarizeResponse(response map[string]any) string {
	keys := mapKeys(response)
	input, output, cached, total := usageTokens(response)
	return encodeSummary(map[string]any{"keys": keys, "inputTokens": input, "outputTokens": output, "cachedTokens": cached, "totalTokens": total})
}

func encodeSummary(value map[string]any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func mapKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	return keys
}

func usageTokens(response map[string]any) (int64, int64, int64, int64) {
	usage, _ := response["usage"].(map[string]any)
	read := func(key string) int64 {
		value, ok := usage[key]
		if !ok {
			return 0
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int64:
			return typed
		case int:
			return int64(typed)
		default:
			return 0
		}
	}
	input, output, total := read("prompt_tokens"), read("completion_tokens"), read("total_tokens")
	cached := read("cached_tokens")
	if cached == 0 {
		if details, ok := usage["prompt_tokens_details"].(map[string]any); ok {
			if value, ok := details["cached_tokens"].(float64); ok {
				cached = int64(value)
			}
		}
	}
	if total == 0 {
		total = input + output
	}
	return input, output, cached, total
}

func (s *Service) findRoute(publishedModelID uint) (route, error) {
	var routes []model.ModelRoute
	if err := s.DB.Where("published_model_id = ? AND status = ?", publishedModelID, model.ModelRouteActive).Order("priority ASC").Order("id ASC").Find(&routes).Error; err != nil {
		return route{}, err
	}
	if len(routes) == 0 {
		return route{}, ErrRouteUnavailable
	}
	available := make([]route, 0, len(routes))
	priority := 0
	for _, candidate := range routes {
		var item route
		item.model = candidate
		if err := s.DB.Where("id = ? AND status = ?", candidate.ChannelID, model.UpstreamChannelActive).First(&item.channel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return route{}, err
		}
		if err := s.DB.Where("channel_id = ? AND name = ? AND status = ? AND channel_key_id IS NOT NULL", candidate.ChannelID, candidate.UpstreamModel, model.ChannelModelActive).First(&item.channelModel).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return route{}, err
		}
		if err := s.DB.Where("id = ? AND channel_id = ?", *item.channelModel.ChannelKeyID, candidate.ChannelID).First(&item.key).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return route{}, err
		}
		if strings.TrimSpace(item.key.APIKey) != "" {
			if len(available) == 0 {
				priority = candidate.Priority
			}
			if candidate.Priority != priority {
				break
			}
			available = append(available, item)
		}
	}
	if len(available) == 0 {
		return route{}, ErrRouteUnavailable
	}
	total := 0
	for _, item := range available {
		weight := item.model.Weight
		if weight <= 0 {
			weight = 100
		}
		total += weight
	}
	if total <= 0 {
		return available[0], nil
	}
	pointValue, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(total)))
	if err != nil {
		return available[0], nil
	}
	point := int(pointValue.Int64())
	for _, item := range available {
		weight := item.model.Weight
		if weight <= 0 {
			weight = 100
		}
		if point < weight {
			return item, nil
		}
		point -= weight
	}
	return available[len(available)-1], nil
}

func (s *Service) findTaskRoute(task model.GenerationTask) (route, error) {
	if task.UserChannelID == nil || s.UserChannels == nil {
		return s.findRoute(task.PublishedModelID)
	}
	custom, err := s.UserChannels.Resolve(task.UserID, *task.UserChannelID, task.UserChannelModel, task.Capability)
	if err != nil {
		return route{}, ErrRouteUnavailable
	}
	return route{
		model:   model.ModelRoute{PublishedModelID: task.PublishedModelID, UpstreamModel: custom.Model},
		channel: model.UpstreamChannel{ID: *task.UserChannelID, Name: custom.Name, Provider: custom.Provider, BaseURL: custom.BaseURL, Status: model.UpstreamChannelActive},
		key:     model.UpstreamChannelKey{APIKey: custom.APIKey},
	}, nil
}

func buildRequestBody(task model.GenerationTask, selected model.ModelRoute) (string, error) {
	payload := map[string]any{}
	if strings.TrimSpace(task.PayloadJSON) != "" {
		if err := json.Unmarshal([]byte(task.PayloadJSON), &payload); err != nil {
			return "", err
		}
	}
	if _, exists := payload["model"]; !exists || strings.TrimSpace(fmt.Sprint(payload["model"])) == "" {
		payload["model"] = selected.UpstreamModel
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func endpointPath(capability string, route model.ModelRoute, channel model.UpstreamChannel) (string, error) {
	for _, settingsJSON := range []string{route.SettingsJSON, channel.SettingsJSON} {
		settings := map[string]any{}
		if strings.TrimSpace(settingsJSON) != "" {
			if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
				return "", err
			}
		}
		if value, ok := settings["path"].(string); ok && strings.TrimSpace(value) != "" {
			return value, nil
		}
	}
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "text":
		return "/v1/chat/completions", nil
	case "image":
		return "/v1/images/generations", nil
	case "video":
		return "/v1/videos", nil
	case "audio":
		return "/v1/audio/speech", nil
	default:
		return "", ErrUnsupported
	}
}

func applyHeaders(request *http.Request, channelSettingsJSON, routeSettingsJSON string) {
	for _, payload := range []string{channelSettingsJSON, routeSettingsJSON} {
		settings := map[string]any{}
		if json.Unmarshal([]byte(payload), &settings) != nil {
			continue
		}
		headers, ok := settings["headers"].(map[string]any)
		if !ok {
			continue
		}
		for key, value := range headers {
			if key == "Authorization" || key == "Content-Type" {
				continue
			}
			if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
				request.Header.Set(key, text)
			}
		}
	}
}

func decodeResponse(data []byte, contentType string) (map[string]any, error) {
	result := map[string]any{}
	if len(data) == 0 {
		return result, nil
	}
	if strings.Contains(strings.ToLower(contentType), "json") || json.Unmarshal(data, &result) == nil {
		if err := json.Unmarshal(data, &result); err != nil {
			return nil, err
		}
		return result, nil
	}
	if len(data) > 384*1024 {
		return nil, ErrResponseTooLarge
	}
	result["contentType"] = contentType
	result["dataBase64"] = base64.StdEncoding.EncodeToString(data)
	return result, nil
}

func joinURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	if strings.HasSuffix(base, "/v1") && strings.HasPrefix(path, "/v1/") {
		path = strings.TrimPrefix(path, "/v1")
	}
	return base + path
}

func compact(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 1000 {
		return value[:1000]
	}
	return value
}

func toTaskView(task model.GenerationTask) (generation.View, error) {
	view := generation.View{ID: task.ID, QuoteID: task.QuoteID, ModelID: task.PublishedModelID, Capability: task.Capability, Status: task.Status, ReservedAmount: task.ReservedAmount, SettledAmount: task.SettledAmount, ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage, StartedAt: task.StartedAt, CompletedAt: task.CompletedAt, CreatedAt: task.CreatedAt}
	if strings.TrimSpace(task.OutputJSON) != "" {
		if err := json.Unmarshal([]byte(task.OutputJSON), &view.Output); err != nil {
			return generation.View{}, err
		}
	}
	return view, nil
}

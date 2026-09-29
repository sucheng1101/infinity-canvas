package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/generation"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrTaskNotFound      = errors.New("generation task not found")
	ErrRouteUnavailable  = errors.New("generation route unavailable")
	ErrUnsupported       = errors.New("generation capability is unsupported")
	ErrUpstream          = errors.New("upstream generation failed")
	ErrResponseTooLarge  = errors.New("upstream response is too large")
)

type Service struct {
	DB         *gorm.DB
	Generation *generation.Service
	Client     *http.Client
}

type route struct {
	model  model.ModelRoute
	channel model.UpstreamChannel
}

// Execute runs one queued task through the administrator-selected upstream route.
// The upstream API key is only read inside this service and is never serialized.
func (s *Service) Execute(ctx context.Context, userID uint, taskID string) (generation.View, error) {
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

	selected, err := s.findRoute(task.PublishedModelID)
	if err != nil {
		return s.fail(task.ID, "ROUTE_UNAVAILABLE", err)
	}
	body, err := buildRequestBody(task, selected.model)
	if err != nil {
		return s.fail(task.ID, "TASK_PAYLOAD_INVALID", err)
	}
	path, err := endpointPath(task.Capability, selected.model, selected.channel)
	if err != nil {
		return s.fail(task.ID, "CAPABILITY_UNSUPPORTED", err)
	}
	requestURL := joinURL(selected.channel.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(body))
	if err != nil {
		return s.fail(task.ID, "UPSTREAM_REQUEST_INVALID", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+selected.channel.APIKey)
	applyHeaders(req, selected.channel.SettingsJSON, selected.model.SettingsJSON)
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(req)
	if err != nil {
		return s.fail(task.ID, "UPSTREAM_REQUEST_FAILED", err)
	}
	defer response.Body.Close()
	data, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return s.fail(task.ID, "UPSTREAM_RESPONSE_FAILED", readErr)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return s.fail(task.ID, "UPSTREAM_HTTP_ERROR", fmt.Errorf("upstream returned HTTP %d: %s", response.StatusCode, compact(string(data))))
	}
	output, err := decodeResponse(data, response.Header.Get("Content-Type"))
	if err != nil {
		return s.fail(task.ID, "UPSTREAM_RESPONSE_INVALID", err)
	}
	return s.Generation.Complete(task.ID, output, task.ReservedAmount)
}

func (s *Service) fail(taskID, code string, cause error) (generation.View, error) {
	message := compact(cause.Error())
	view, err := s.Generation.Fail(taskID, code, message)
	if err != nil {
		return generation.View{}, err
	}
	return view, cause
}

func (s *Service) findRoute(publishedModelID uint) (route, error) {
	var item route
	if err := s.DB.Where("published_model_id = ? AND status = ?", publishedModelID, model.ModelRouteActive).Order("priority ASC").Order("id ASC").First(&item.model).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return route{}, ErrRouteUnavailable
		}
		return route{}, err
	}
	if err := s.DB.Where("id = ? AND status = ?", item.model.ChannelID, model.UpstreamChannelActive).First(&item.channel).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return route{}, ErrRouteUnavailable
		}
		return route{}, err
	}
	return item, nil
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

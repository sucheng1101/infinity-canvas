package channelcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrInvalidChannel    = errors.New("invalid upstream channel")
	ErrChannelNotFound   = errors.New("upstream channel not found")
	ErrInvalidRoute      = errors.New("invalid model route")
	ErrRouteNotFound     = errors.New("model route not found")
	ErrPublishedNotFound = errors.New("published model not found")
	ErrModelFetch        = errors.New("upstream models fetch failed")
)

type Service struct {
	DB     *gorm.DB
	Client *http.Client
}

type ChannelModelInput struct {
	Name       string `json:"name"`
	Capability string `json:"capability"`
	Script     string `json:"script"`
	Status     string `json:"status"`
}

type ChannelModelAPIKeyInput struct {
	ID     uint     `json:"id"`
	Name   string   `json:"name"`
	APIKey string   `json:"apiKey"`
	Models []string `json:"models"`
}

type ChannelInput struct {
	Name         string                    `json:"name"`
	Provider     string                    `json:"provider"`
	BaseURL      string                    `json:"baseUrl"`
	ModelAPIKeys []ChannelModelAPIKeyInput `json:"modelApiKeys"`
	Models       []ChannelModelInput       `json:"models"`
	Settings     map[string]any            `json:"settings"`
	Status       string                    `json:"status"`
	SortOrder    int                       `json:"sortOrder"`
}

type AdminChannelModel struct {
	ID         uint   `json:"id"`
	Name       string `json:"name"`
	Capability string `json:"capability"`
	Script     string `json:"script,omitempty"`
	Status     string `json:"status"`
}

type AdminChannelModelAPIKey struct {
	ID           uint     `json:"id"`
	Name         string   `json:"name"`
	APIKeySet    bool     `json:"apiKeySet"`
	APIKeyMasked string   `json:"apiKeyMasked,omitempty"`
	Models       []string `json:"models"`
}

type AdminChannel struct {
	ID           uint                      `json:"id"`
	Name         string                    `json:"name"`
	Provider     string                    `json:"provider"`
	BaseURL      string                    `json:"baseUrl"`
	APIKeySet    bool                      `json:"apiKeySet"`
	APIKeyMasked string                    `json:"apiKeyMasked,omitempty"`
	ModelAPIKeys []AdminChannelModelAPIKey `json:"modelApiKeys"`
	Models       []AdminChannelModel       `json:"models"`
	Settings     map[string]any            `json:"settings"`
	Status       string                    `json:"status"`
	SortOrder    int                       `json:"sortOrder"`
}

type FetchModelsInput struct {
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	KeyID   uint   `json:"keyId"`
}

type RouteInput struct {
	PublishedModelID uint           `json:"publishedModelId"`
	ChannelID        uint           `json:"channelId"`
	UpstreamModel    string         `json:"upstreamModel"`
	Priority         int            `json:"priority"`
	Weight           int            `json:"weight"`
	Status           string         `json:"status"`
	Settings         map[string]any `json:"settings"`
}

type AdminRoute struct {
	ID               uint           `json:"id"`
	PublishedModelID uint           `json:"publishedModelId"`
	PublishedModel   string         `json:"publishedModel"`
	ChannelID        uint           `json:"channelId"`
	ChannelName      string         `json:"channelName"`
	Provider         string         `json:"provider"`
	UpstreamModel    string         `json:"upstreamModel"`
	Priority         int            `json:"priority"`
	Weight           int            `json:"weight"`
	WeightPercent    float64        `json:"weightPercent"`
	Available        bool           `json:"available"`
	Status           string         `json:"status"`
	Settings         map[string]any `json:"settings"`
}

func (s *Service) ListChannels(includeHidden bool) ([]AdminChannel, error) {
	query := s.DB.Order("sort_order ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.UpstreamChannelActive)
	}
	var rows []model.UpstreamChannel
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]AdminChannel, 0, len(rows))
	for _, row := range rows {
		item, err := s.toAdminChannel(row)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) CreateChannel(input ChannelInput) (AdminChannel, error) {
	row, err := fromChannelInput(input)
	if err != nil {
		return AdminChannel{}, err
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return replaceChannelDetails(tx, row.ID, input.ModelAPIKeys, input.Models)
	})
	if err != nil {
		return AdminChannel{}, err
	}
	return s.toAdminChannel(row)
}

func (s *Service) UpdateChannel(id uint, input ChannelInput) (AdminChannel, error) {
	var existing model.UpstreamChannel
	if err := s.DB.First(&existing, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AdminChannel{}, ErrChannelNotFound
		}
		return AdminChannel{}, err
	}
	row, err := fromChannelInput(input)
	if err != nil {
		return AdminChannel{}, err
	}
	if !strings.EqualFold(strings.TrimRight(existing.BaseURL, "/"), row.BaseURL) {
		for _, key := range input.ModelAPIKeys {
			if key.ID != 0 && strings.TrimSpace(key.APIKey) == "" {
				return AdminChannel{}, ErrInvalidChannel
			}
		}
	}
	row.ID = id
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&existing).Updates(map[string]any{
			"name": row.Name, "provider": row.Provider, "base_url": row.BaseURL,
			"api_key": "", "settings_json": row.SettingsJSON, "status": row.Status,
			"sort_order": row.SortOrder,
		}).Error; err != nil {
			return err
		}
		return replaceChannelDetails(tx, id, input.ModelAPIKeys, input.Models)
	})
	if err != nil {
		return AdminChannel{}, err
	}
	row.CreatedAt = existing.CreatedAt
	return s.toAdminChannel(row)
}

func (s *Service) HideChannel(id uint) error {
	result := s.DB.Model(&model.UpstreamChannel{}).Where("id = ?", id).Update("status", model.UpstreamChannelHidden)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrChannelNotFound
	}
	return nil
}

func (s *Service) FetchModels(ctx context.Context, input FetchModelsInput) ([]string, error) {
	baseURL, err := normalizeBaseURL(input.BaseURL)
	if err != nil {
		return nil, ErrInvalidChannel
	}
	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" && input.KeyID != 0 {
		var key model.UpstreamChannelKey
		if err := s.DB.First(&key, input.KeyID).Error; err != nil {
			return nil, ErrModelFetch
		}
		var channel model.UpstreamChannel
		if err := s.DB.Select("base_url").First(&channel, key.ChannelID).Error; err != nil || !strings.EqualFold(strings.TrimRight(channel.BaseURL, "/"), baseURL) {
			return nil, ErrInvalidChannel
		}
		apiKey = key.APIKey
	}
	if apiKey == "" {
		return nil, ErrInvalidChannel
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, joinURL(baseURL, "/v1/models"), nil)
	if err != nil {
		return nil, ErrModelFetch
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrModelFetch, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%w: upstream returned HTTP %d", ErrModelFetch, response.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrModelFetch, err)
	}
	seen := map[string]bool{}
	items := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		name := strings.TrimSpace(item.ID)
		if name != "" && !seen[name] {
			seen[name] = true
			items = append(items, name)
		}
	}
	sort.Strings(items)
	return items, nil
}

func (s *Service) ListRoutes(includeHidden bool) ([]AdminRoute, error) {
	query := s.DB.Order("priority ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.ModelRouteActive)
	}
	var rows []model.ModelRoute
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]AdminRoute, 0, len(rows))
	totals := map[struct {
		modelID  uint
		priority int
	}]int{}
	availableByID := make(map[uint]bool, len(rows))
	for _, row := range rows {
		available, err := s.routeAvailable(row)
		if err != nil {
			return nil, err
		}
		availableByID[row.ID] = available
		if available && row.Status == model.ModelRouteActive {
			weight := row.Weight
			if weight <= 0 {
				weight = 100
			}
			totals[struct {
				modelID  uint
				priority int
			}{row.PublishedModelID, row.Priority}] += weight
		}
	}
	for _, row := range rows {
		item, err := s.toAdminRoute(row)
		if err != nil {
			return nil, err
		}
		item.Available = availableByID[row.ID] && row.Status == model.ModelRouteActive
		if total := totals[struct {
			modelID  uint
			priority int
		}{row.PublishedModelID, row.Priority}]; total > 0 && item.Available {
			weight := row.Weight
			if weight <= 0 {
				weight = 100
			}
			item.WeightPercent = float64(weight) * 100 / float64(total)
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) CreateRoute(input RouteInput) (AdminRoute, error) {
	row, err := s.fromRouteInput(input)
	if err != nil {
		return AdminRoute{}, err
	}
	if err := s.DB.Create(&row).Error; err != nil {
		return AdminRoute{}, err
	}
	return s.toAdminRoute(row)
}

func (s *Service) UpdateRoute(id uint, input RouteInput) (AdminRoute, error) {
	var existing model.ModelRoute
	if err := s.DB.First(&existing, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AdminRoute{}, ErrRouteNotFound
		}
		return AdminRoute{}, err
	}
	row, err := s.fromRouteInput(input)
	if err != nil {
		return AdminRoute{}, err
	}
	row.ID = id
	if err := s.DB.Model(&existing).Updates(map[string]any{
		"published_model_id": row.PublishedModelID, "channel_id": row.ChannelID,
		"upstream_model": row.UpstreamModel, "priority": row.Priority,
		"weight": row.Weight, "status": row.Status, "settings_json": row.SettingsJSON,
	}).Error; err != nil {
		return AdminRoute{}, err
	}
	row.CreatedAt = existing.CreatedAt
	return s.toAdminRoute(row)
}

func (s *Service) HideRoute(id uint) error {
	result := s.DB.Model(&model.ModelRoute{}).Where("id = ?", id).Update("status", model.ModelRouteHidden)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrRouteNotFound
	}
	return nil
}

func fromChannelInput(input ChannelInput) (model.UpstreamChannel, error) {
	name := strings.TrimSpace(input.Name)
	provider := strings.TrimSpace(input.Provider)
	baseURL, err := normalizeBaseURL(input.BaseURL)
	if name == "" || len(name) > 128 || provider == "" || len(provider) > 64 || err != nil {
		return model.UpstreamChannel{}, ErrInvalidChannel
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = model.UpstreamChannelActive
	}
	if status != model.UpstreamChannelActive && status != model.UpstreamChannelHidden {
		return model.UpstreamChannel{}, ErrInvalidChannel
	}
	settings, err := marshalSettings(input.Settings)
	if err != nil {
		return model.UpstreamChannel{}, ErrInvalidChannel
	}
	return model.UpstreamChannel{Name: name, Provider: provider, BaseURL: baseURL, APIKey: "", SettingsJSON: settings, Status: status, SortOrder: input.SortOrder}, nil
}

func replaceChannelDetails(tx *gorm.DB, channelID uint, keyInputs []ChannelModelAPIKeyInput, modelInputs []ChannelModelInput) error {
	var existingModels []model.UpstreamChannelModel
	if err := tx.Where("channel_id = ?", channelID).Find(&existingModels).Error; err != nil {
		return err
	}
	statusByName := make(map[string]string, len(existingModels))
	for _, item := range existingModels {
		statusByName[item.Name] = item.Status
	}
	var existingKeys []model.UpstreamChannelKey
	if err := tx.Where("channel_id = ?", channelID).Find(&existingKeys).Error; err != nil {
		return err
	}
	existingByID := make(map[uint]model.UpstreamChannelKey, len(existingKeys))
	for _, key := range existingKeys {
		existingByID[key.ID] = key
	}

	models := make([]model.UpstreamChannelModel, 0, len(modelInputs))
	modelNames := make(map[string]bool, len(modelInputs))
	for index, input := range modelInputs {
		name := strings.TrimSpace(input.Name)
		capability := strings.ToLower(strings.TrimSpace(input.Capability))
		if name == "" || len(name) > 128 || modelNames[name] || !validCapability(capability) {
			return ErrInvalidChannel
		}
		status := strings.TrimSpace(input.Status)
		if status == "" {
			status = statusByName[name]
		}
		if status == "" {
			status = model.ChannelModelActive
		}
		if status != model.ChannelModelActive && status != model.ChannelModelHidden {
			return ErrInvalidChannel
		}
		modelNames[name] = true
		models = append(models, model.UpstreamChannelModel{ChannelID: channelID, Name: name, Capability: capability, Script: strings.TrimSpace(input.Script), Status: status, SortOrder: index})
	}

	type preparedKey struct {
		row    model.UpstreamChannelKey
		models []string
	}
	keys := make([]preparedKey, 0, len(keyInputs))
	usedIDs := map[uint]bool{}
	usedSecrets := map[string]bool{}
	assignedModels := map[string]bool{}
	for index, input := range keyInputs {
		name := strings.TrimSpace(input.Name)
		if name == "" || len(name) > 128 || usedIDs[input.ID] {
			return ErrInvalidChannel
		}
		secret := strings.TrimSpace(input.APIKey)
		if input.ID != 0 {
			existing, ok := existingByID[input.ID]
			if !ok {
				return ErrInvalidChannel
			}
			usedIDs[input.ID] = true
			if secret == "" {
				secret = existing.APIKey
			}
		}
		if secret == "" || usedSecrets[secret] {
			return ErrInvalidChannel
		}
		usedSecrets[secret] = true
		bound := make([]string, 0, len(input.Models))
		for _, value := range input.Models {
			modelName := strings.TrimSpace(value)
			if !modelNames[modelName] || assignedModels[modelName] {
				return ErrInvalidChannel
			}
			assignedModels[modelName] = true
			bound = append(bound, modelName)
		}
		keys = append(keys, preparedKey{row: model.UpstreamChannelKey{ID: input.ID, ChannelID: channelID, Name: name, APIKey: secret, SortOrder: index}, models: bound})
	}

	if err := tx.Where("channel_id = ?", channelID).Delete(&model.UpstreamChannelModel{}).Error; err != nil {
		return err
	}
	keptIDs := make([]uint, 0, len(keys))
	modelKeyIDs := map[string]uint{}
	for index := range keys {
		key := &keys[index].row
		if key.ID == 0 {
			if err := tx.Create(key).Error; err != nil {
				return err
			}
		} else if err := tx.Model(&model.UpstreamChannelKey{}).Where("id = ? AND channel_id = ?", key.ID, channelID).Updates(map[string]any{"name": key.Name, "api_key": key.APIKey, "sort_order": key.SortOrder}).Error; err != nil {
			return err
		}
		keptIDs = append(keptIDs, key.ID)
		for _, name := range keys[index].models {
			modelKeyIDs[name] = key.ID
		}
	}
	deleteKeys := tx.Where("channel_id = ?", channelID)
	if len(keptIDs) > 0 {
		deleteKeys = deleteKeys.Where("id NOT IN ?", keptIDs)
	}
	if err := deleteKeys.Delete(&model.UpstreamChannelKey{}).Error; err != nil {
		return err
	}
	for index := range models {
		if keyID, ok := modelKeyIDs[models[index].Name]; ok {
			models[index].ChannelKeyID = &keyID
		}
	}
	if len(models) > 0 {
		return tx.Create(&models).Error
	}
	return nil
}

func (s *Service) fromRouteInput(input RouteInput) (model.ModelRoute, error) {
	upstreamModel := strings.TrimSpace(input.UpstreamModel)
	if input.PublishedModelID == 0 || input.ChannelID == 0 || input.Priority < 0 || upstreamModel == "" || len(upstreamModel) > 128 {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	var published model.PublishedModel
	if err := s.DB.Select("id, capability").First(&published, input.PublishedModelID).Error; err != nil {
		return model.ModelRoute{}, ErrPublishedNotFound
	}
	var channel model.UpstreamChannel
	if err := s.DB.Select("id").First(&channel, input.ChannelID).Error; err != nil {
		return model.ModelRoute{}, ErrChannelNotFound
	}
	var channelModel model.UpstreamChannelModel
	if err := s.DB.Where("channel_id = ? AND name = ? AND status = ? AND channel_key_id IS NOT NULL", input.ChannelID, upstreamModel, model.ChannelModelActive).First(&channelModel).Error; err != nil || channelModel.Capability != published.Capability {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = model.ModelRouteActive
	}
	if status != model.ModelRouteActive && status != model.ModelRouteHidden {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	settings, err := marshalSettings(input.Settings)
	if err != nil {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	weight := input.Weight
	if weight == 0 {
		weight = 100
	}
	if weight < 1 {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	return model.ModelRoute{PublishedModelID: input.PublishedModelID, ChannelID: input.ChannelID, UpstreamModel: upstreamModel, Priority: input.Priority, Weight: weight, Status: status, SettingsJSON: settings}, nil
}

func (s *Service) routeAvailable(row model.ModelRoute) (bool, error) {
	var channel model.UpstreamChannel
	if err := s.DB.Where("id = ? AND status = ?", row.ChannelID, model.UpstreamChannelActive).First(&channel).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	var channelModel model.UpstreamChannelModel
	if err := s.DB.Where("channel_id = ? AND name = ? AND status = ? AND channel_key_id IS NOT NULL", row.ChannelID, row.UpstreamModel, model.ChannelModelActive).First(&channelModel).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	var key model.UpstreamChannelKey
	if err := s.DB.Where("id = ? AND channel_id = ? AND api_key <> ''", *channelModel.ChannelKeyID, row.ChannelID).First(&key).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *Service) toAdminChannel(row model.UpstreamChannel) (AdminChannel, error) {
	settings, err := unmarshalSettings(row.SettingsJSON)
	if err != nil {
		return AdminChannel{}, err
	}
	var keys []model.UpstreamChannelKey
	if err := s.DB.Where("channel_id = ?", row.ID).Order("sort_order ASC").Order("id ASC").Find(&keys).Error; err != nil {
		return AdminChannel{}, err
	}
	var models []model.UpstreamChannelModel
	if err := s.DB.Where("channel_id = ?", row.ID).Order("sort_order ASC").Order("id ASC").Find(&models).Error; err != nil {
		return AdminChannel{}, err
	}
	modelsByKey := map[uint][]string{}
	adminModels := make([]AdminChannelModel, 0, len(models))
	for _, item := range models {
		adminModels = append(adminModels, AdminChannelModel{ID: item.ID, Name: item.Name, Capability: item.Capability, Script: item.Script, Status: item.Status})
		if item.ChannelKeyID != nil {
			modelsByKey[*item.ChannelKeyID] = append(modelsByKey[*item.ChannelKeyID], item.Name)
		}
	}
	adminKeys := make([]AdminChannelModelAPIKey, 0, len(keys))
	for _, key := range keys {
		adminKeys = append(adminKeys, AdminChannelModelAPIKey{ID: key.ID, Name: key.Name, APIKeySet: key.APIKey != "", APIKeyMasked: maskSecret(key.APIKey), Models: modelsByKey[key.ID]})
	}
	masked := ""
	if len(adminKeys) > 0 {
		masked = "******"
	}
	return AdminChannel{ID: row.ID, Name: row.Name, Provider: row.Provider, BaseURL: row.BaseURL, APIKeySet: len(adminKeys) > 0, APIKeyMasked: masked, ModelAPIKeys: adminKeys, Models: adminModels, Settings: settings, Status: row.Status, SortOrder: row.SortOrder}, nil
}

func (s *Service) toAdminRoute(row model.ModelRoute) (AdminRoute, error) {
	var published model.PublishedModel
	if err := s.DB.Select("id, display_name").First(&published, row.PublishedModelID).Error; err != nil {
		return AdminRoute{}, err
	}
	var channel model.UpstreamChannel
	if err := s.DB.Select("id, name, provider").First(&channel, row.ChannelID).Error; err != nil {
		return AdminRoute{}, err
	}
	settings, err := unmarshalSettings(row.SettingsJSON)
	if err != nil {
		return AdminRoute{}, err
	}
	return AdminRoute{ID: row.ID, PublishedModelID: row.PublishedModelID, PublishedModel: published.DisplayName, ChannelID: row.ChannelID, ChannelName: channel.Name, Provider: channel.Provider, UpstreamModel: row.UpstreamModel, Priority: row.Priority, Weight: row.Weight, Status: row.Status, Settings: settings}, nil
}

func normalizeBaseURL(value string) (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(value), "/")
	parsed, err := url.Parse(baseURL)
	if baseURL == "" || err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", ErrInvalidChannel
	}
	return baseURL, nil
}

func validCapability(value string) bool {
	switch value {
	case "image", "video", "text", "audio":
		return true
	default:
		return false
	}
}

func joinURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	if strings.HasSuffix(base, "/v1") && strings.HasPrefix(path, "/v1/") {
		path = strings.TrimPrefix(path, "/v1")
	}
	return base + path
}

func marshalSettings(value map[string]any) (string, error) {
	if value == nil {
		value = map[string]any{}
	}
	payload, err := json.Marshal(value)
	return string(payload), err
}

func unmarshalSettings(payload string) (map[string]any, error) {
	result := map[string]any{}
	if strings.TrimSpace(payload) == "" {
		return result, nil
	}
	if err := json.Unmarshal([]byte(payload), &result); err != nil {
		return nil, err
	}
	return result, nil
}

func maskSecret(value string) string {
	if value == "" {
		return ""
	}
	return "******"
}

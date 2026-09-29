package channelcatalog

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrInvalidChannel   = errors.New("invalid upstream channel")
	ErrChannelNotFound  = errors.New("upstream channel not found")
	ErrInvalidRoute     = errors.New("invalid model route")
	ErrRouteNotFound    = errors.New("model route not found")
	ErrPublishedNotFound = errors.New("published model not found")
)

type Service struct {
	DB *gorm.DB
}

type ChannelInput struct {
	Name        string         `json:"name"`
	Provider    string         `json:"provider"`
	BaseURL     string         `json:"baseUrl"`
	APIKey      string         `json:"apiKey"`
	Settings    map[string]any `json:"settings"`
	Status      string         `json:"status"`
	SortOrder   int            `json:"sortOrder"`
}

type AdminChannel struct {
	ID             uint           `json:"id"`
	Name           string         `json:"name"`
	Provider       string         `json:"provider"`
	BaseURL        string         `json:"baseUrl"`
	APIKeySet      bool           `json:"apiKeySet"`
	APIKeyMasked   string         `json:"apiKeyMasked,omitempty"`
	Settings       map[string]any `json:"settings"`
	Status         string         `json:"status"`
	SortOrder      int            `json:"sortOrder"`
}

type RouteInput struct {
	PublishedModelID uint           `json:"publishedModelId"`
	ChannelID        uint           `json:"channelId"`
	UpstreamModel    string         `json:"upstreamModel"`
	Priority         int            `json:"priority"`
	Status           string         `json:"status"`
	Settings        map[string]any `json:"settings"`
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
		item, err := toAdminChannel(row)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) CreateChannel(input ChannelInput) (AdminChannel, error) {
	row, err := fromChannelInput(input, "")
	if err != nil {
		return AdminChannel{}, err
	}
	if err := s.DB.Create(&row).Error; err != nil {
		return AdminChannel{}, err
	}
	return toAdminChannel(row)
}

func (s *Service) UpdateChannel(id uint, input ChannelInput) (AdminChannel, error) {
	var existing model.UpstreamChannel
	if err := s.DB.First(&existing, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AdminChannel{}, ErrChannelNotFound
		}
		return AdminChannel{}, err
	}
	row, err := fromChannelInput(input, existing.APIKey)
	if err != nil {
		return AdminChannel{}, err
	}
	row.ID = id
	if err := s.DB.Model(&existing).Updates(map[string]any{
		"name": row.Name, "provider": row.Provider, "base_url": row.BaseURL,
		"api_key": row.APIKey, "settings_json": row.SettingsJSON, "status": row.Status,
		"sort_order": row.SortOrder,
	}).Error; err != nil {
		return AdminChannel{}, err
	}
	row.CreatedAt = existing.CreatedAt
	return toAdminChannel(row)
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
	for _, row := range rows {
		item, err := s.toAdminRoute(row)
		if err != nil {
			return nil, err
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
		"status": row.Status, "settings_json": row.SettingsJSON,
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

func fromChannelInput(input ChannelInput, existingKey string) (model.UpstreamChannel, error) {
	name := strings.TrimSpace(input.Name)
	provider := strings.TrimSpace(input.Provider)
	baseURL := strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	parsed, err := url.Parse(baseURL)
	if name == "" || len(name) > 128 || provider == "" || len(provider) > 64 ||
		baseURL == "" || err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return model.UpstreamChannel{}, ErrInvalidChannel
	}
	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" {
		apiKey = existingKey
	}
	if apiKey == "" {
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
	return model.UpstreamChannel{
		Name: name, Provider: provider, BaseURL: baseURL, APIKey: apiKey,
		SettingsJSON: settings, Status: status, SortOrder: input.SortOrder,
	}, nil
}

func (s *Service) fromRouteInput(input RouteInput) (model.ModelRoute, error) {
	upstreamModel := strings.TrimSpace(input.UpstreamModel)
	if input.PublishedModelID == 0 || input.ChannelID == 0 || upstreamModel == "" || len(upstreamModel) > 128 {
		return model.ModelRoute{}, ErrInvalidRoute
	}
	var published model.PublishedModel
	if err := s.DB.Select("id").First(&published, input.PublishedModelID).Error; err != nil {
		return model.ModelRoute{}, ErrPublishedNotFound
	}
	var channel model.UpstreamChannel
	if err := s.DB.Select("id").First(&channel, input.ChannelID).Error; err != nil {
		return model.ModelRoute{}, ErrChannelNotFound
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
	return model.ModelRoute{
		PublishedModelID: input.PublishedModelID, ChannelID: input.ChannelID,
		UpstreamModel: upstreamModel, Priority: input.Priority, Status: status,
		SettingsJSON: settings,
	}, nil
}

func toAdminChannel(row model.UpstreamChannel) (AdminChannel, error) {
	settings, err := unmarshalSettings(row.SettingsJSON)
	if err != nil {
		return AdminChannel{}, err
	}
	return AdminChannel{
		ID: row.ID, Name: row.Name, Provider: row.Provider, BaseURL: row.BaseURL,
		APIKeySet: row.APIKey != "", APIKeyMasked: maskSecret(row.APIKey), Settings: settings,
		Status: row.Status, SortOrder: row.SortOrder,
	}, nil
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
	return AdminRoute{
		ID: row.ID, PublishedModelID: row.PublishedModelID, PublishedModel: published.DisplayName,
		ChannelID: row.ChannelID, ChannelName: channel.Name, Provider: channel.Provider,
		UpstreamModel: row.UpstreamModel, Priority: row.Priority, Status: row.Status, Settings: settings,
	}, nil
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

// maskSecret never reveals any character of the stored secret; callers use
// APIKeySet to tell whether a key is configured.
func maskSecret(value string) string {
	if value == "" {
		return ""
	}
	return "******"
}

package modelcatalog

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/modelquality"
	"gorm.io/gorm"
)

var (
	ErrInvalidModel  = errors.New("invalid published model")
	ErrModelNotFound = errors.New("published model not found")
)

type Service struct {
	DB *gorm.DB
}

type Input struct {
	Capability   string         `json:"capability"`
	DisplayName  string         `json:"displayName"`
	PublicConfig map[string]any `json:"publicConfig"`
	QualitySpec  map[string]any `json:"qualitySpec,omitempty"`
	Status       string         `json:"status"`
	SortOrder    int            `json:"sortOrder"`
}

type PublicModel struct {
	ID           uint           `json:"id"`
	Capability   string         `json:"capability"`
	SourceModel  string         `json:"sourceModel,omitempty"`
	DisplayName  string         `json:"displayName"`
	PublicConfig map[string]any `json:"publicConfig"`
	QualitySpec  map[string]any `json:"qualitySpec,omitempty"`
	PriceSummary map[string]any `json:"priceSummary,omitempty"`
	Performance  map[string]any `json:"performance,omitempty"`
	Status       string         `json:"status,omitempty"`
	SortOrder    int            `json:"sortOrder,omitempty"`
}

// Performance returns a small rolling summary for the model plaza. It only
// exposes aggregate relay metrics and never includes user, prompt, or channel
// details.
func (s *Service) Performance(publishedModelID uint) map[string]any {
	from := time.Now().UTC().Add(-24 * time.Hour)
	var logs []struct {
		Status      string `gorm:"column:status"`
		DurationMs  int64  `gorm:"column:duration_ms"`
		OutputToken int64  `gorm:"column:output_tokens"`
	}
	if err := s.DB.Model(&model.UsageLog{}).
		Select("status, duration_ms, output_tokens").
		Where("published_model_id = ? AND created_at >= ?", publishedModelID, from).
		Find(&logs).Error; err != nil {
		return nil
	}
	if len(logs) == 0 {
		return nil
	}
	var totalDuration, totalOutput int64
	succeeded := 0
	for _, item := range logs {
		totalDuration += item.DurationMs
		totalOutput += item.OutputToken
		if item.Status == model.UsageLogSuccess {
			succeeded++
		}
	}
	result := map[string]any{
		"windowHours":    24,
		"requests":       len(logs),
		"successRate":    float64(succeeded) / float64(len(logs)) * 100,
		"averageLatency": totalDuration / int64(len(logs)),
	}
	if totalDuration > 0 && totalOutput > 0 {
		result["averageTps"] = float64(totalOutput) / (float64(totalDuration) / 1000)
	}
	return result
}

func (s *Service) List(capability string, includeHidden bool) ([]PublicModel, error) {
	// Reads stay read-only: the catalog is synced when channels change and at
	// startup. Syncing here turned every anonymous /models call into writes.
	query := s.DB.Order("sort_order ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.PublishedModelActive)
	}
	if capability = strings.TrimSpace(capability); capability != "" {
		query = query.Where("capability = ?", capability)
	}
	if !includeHidden {
		availableIDs, err := s.availableModelIDs()
		if err != nil {
			return nil, err
		}
		if len(availableIDs) == 0 {
			return []PublicModel{}, nil
		}
		query = query.Where("id IN ?", availableIDs)
	}
	var rows []model.PublishedModel
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]PublicModel, 0, len(rows))
	for _, row := range rows {
		item, err := toPublic(row, includeHidden)
		if err != nil {
			return nil, err
		}
		item.QualitySpec = s.QualitySpec(row)
		result = append(result, item)
	}
	return result, nil
}

func (s *Service) Create(input Input) (PublicModel, error) {
	row, err := fromInput(input)
	if err != nil {
		return PublicModel{}, err
	}
	if err := s.DB.Create(&row).Error; err != nil {
		return PublicModel{}, err
	}
	return toPublic(row, true)
}

// SyncFromChannels keeps the public catalog and its route pool aligned with
// configured upstream models. A capability and upstream name identify one
// public model even when several channels provide it.
func (s *Service) SyncFromChannels() error {
	var channelModels []model.UpstreamChannelModel
	if err := s.DB.Where("status = ? AND channel_key_id IS NOT NULL", model.ChannelModelActive).Find(&channelModels).Error; err != nil {
		return err
	}
	for _, channelModel := range channelModels {
		key := strings.TrimSpace(channelModel.Name)
		if key == "" {
			continue
		}
		var published model.PublishedModel
		err := s.DB.Where("capability = ? AND source_model = ?", channelModel.Capability, key).First(&published).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Older catalog rows did not store SourceModel. Reuse a matching
			// display name once, then keep the stable source identity going forward.
			err = s.DB.Where("capability = ? AND (source_model = '' OR source_model IS NULL) AND display_name = ?", channelModel.Capability, key).First(&published).Error
			if err == nil {
				if updateErr := s.DB.Model(&published).Update("source_model", key).Error; updateErr != nil {
					return updateErr
				}
			}
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			published = model.PublishedModel{Capability: channelModel.Capability, SourceModel: key, DisplayName: key, Status: model.PublishedModelHidden, PublicConfigJSON: "{}"}
			if err := s.DB.Create(&published).Error; err != nil {
				if retryErr := s.DB.Where("capability = ? AND source_model = ?", channelModel.Capability, key).First(&published).Error; retryErr != nil {
					return err
				}
			}
		} else if err != nil {
			return err
		}
		var route model.ModelRoute
		routeErr := s.DB.Where("published_model_id = ? AND channel_id = ? AND upstream_model = ?", published.ID, channelModel.ChannelID, key).First(&route).Error
		if errors.Is(routeErr, gorm.ErrRecordNotFound) {
			if err := s.DB.Create(&model.ModelRoute{PublishedModelID: published.ID, ChannelID: channelModel.ChannelID, UpstreamModel: key, Priority: 0, Weight: 100, Status: model.ModelRouteActive, SettingsJSON: "{}"}).Error; err != nil {
				var existing model.ModelRoute
				if retryErr := s.DB.Where("published_model_id = ? AND channel_id = ? AND upstream_model = ?", published.ID, channelModel.ChannelID, key).First(&existing).Error; retryErr != nil {
					return err
				}
			}
		} else if routeErr != nil {
			return routeErr
		}
	}
	return nil
}

func (s *Service) availableModelIDs() ([]uint, error) {
	var ids []uint
	now := time.Now().UTC()
	err := s.DB.Model(&model.ModelRoute{}).
		Select("DISTINCT model_routes.published_model_id").
		Joins("JOIN upstream_channels ON upstream_channels.id = model_routes.channel_id").
		Joins("JOIN upstream_channel_models ON upstream_channel_models.channel_id = model_routes.channel_id AND upstream_channel_models.name = model_routes.upstream_model").
		Joins("JOIN upstream_channel_keys ON upstream_channel_keys.id = upstream_channel_models.channel_key_id").
		Joins("JOIN pricing_versions ON pricing_versions.published_model_id = model_routes.published_model_id").
		Where("model_routes.status = ? AND upstream_channels.status = ? AND upstream_channel_models.status = ? AND upstream_channel_models.channel_key_id IS NOT NULL AND upstream_channel_keys.api_key <> ''", model.ModelRouteActive, model.UpstreamChannelActive, model.ChannelModelActive).
		Where("pricing_versions.status = ? AND pricing_versions.effective_at <= ? AND (pricing_versions.retired_at IS NULL OR pricing_versions.retired_at > ?)", model.PricingVersionActive, now, now).
		Pluck("model_routes.published_model_id", &ids).Error
	return ids, err
}

func (s *Service) Update(id uint, input Input) (PublicModel, error) {
	row, err := fromInput(input)
	if err != nil {
		return PublicModel{}, err
	}
	var existing model.PublishedModel
	if err := s.DB.First(&existing, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return PublicModel{}, ErrModelNotFound
		}
		return PublicModel{}, err
	}
	row.ID = id
	if err := s.DB.Model(&existing).Updates(map[string]any{
		"capability":         row.Capability,
		"display_name":       row.DisplayName,
		"public_config_json": row.PublicConfigJSON,
		"status":             row.Status,
		"sort_order":         row.SortOrder,
	}).Error; err != nil {
		return PublicModel{}, err
	}
	row.CreatedAt = existing.CreatedAt
	return toPublic(row, true)
}

func (s *Service) Hide(id uint) error {
	result := s.DB.Model(&model.PublishedModel{}).Where("id = ?", id).Update("status", model.PublishedModelHidden)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrModelNotFound
	}
	return nil
}

func fromInput(input Input) (model.PublishedModel, error) {
	capability := strings.TrimSpace(input.Capability)
	displayName := strings.TrimSpace(input.DisplayName)
	if capability == "" || len(capability) > 32 || displayName == "" || len(displayName) > 128 {
		return model.PublishedModel{}, ErrInvalidModel
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = model.PublishedModelActive
	}
	if status != model.PublishedModelActive && status != model.PublishedModelHidden {
		return model.PublishedModel{}, ErrInvalidModel
	}
	config := input.PublicConfig
	if config == nil {
		config = map[string]any{}
	}
	payload, err := json.Marshal(config)
	if err != nil {
		return model.PublishedModel{}, ErrInvalidModel
	}
	return model.PublishedModel{
		Capability: capability, DisplayName: displayName, PublicConfigJSON: string(payload),
		Status: status, SortOrder: input.SortOrder,
	}, nil
}

func toPublic(row model.PublishedModel, includeAdminFields bool) (PublicModel, error) {
	config := map[string]any{}
	if strings.TrimSpace(row.PublicConfigJSON) != "" {
		if err := json.Unmarshal([]byte(row.PublicConfigJSON), &config); err != nil {
			return PublicModel{}, err
		}
	}
	result := PublicModel{
		ID: row.ID, Capability: row.Capability, SourceModel: row.SourceModel, DisplayName: row.DisplayName,
		PublicConfig: config, QualitySpec: specMap(modelquality.Default(row.Capability, modelName(row))),
	}
	if includeAdminFields {
		result.Status = row.Status
		result.SortOrder = row.SortOrder
	}
	return result, nil
}

// QualitySpec returns the union of quality capabilities exposed by active
// channel models. This keeps 8K opt-in: it appears only when at least one
// configured channel advertises it.
func (s *Service) QualitySpec(row model.PublishedModel) map[string]any {
	var channelModels []model.UpstreamChannelModel
	query := s.DB.Where("status = ?", model.ChannelModelActive)
	if row.SourceModel != "" {
		query = query.Where("name = ?", row.SourceModel)
	}
	if err := query.Find(&channelModels).Error; err != nil || len(channelModels) == 0 {
		return specMap(modelquality.Default(row.Capability, modelName(row)))
	}
	specs := make([]modelquality.Spec, 0, len(channelModels))
	for _, channelModel := range channelModels {
		if channelModel.Capability != row.Capability {
			continue
		}
		var spec modelquality.Spec
		if strings.TrimSpace(channelModel.QualitySpecJSON) != "" {
			_ = json.Unmarshal([]byte(channelModel.QualitySpecJSON), &spec)
		}
		specs = append(specs, modelquality.Normalize(spec, row.Capability, modelName(row)))
	}
	if len(specs) == 0 {
		return specMap(modelquality.Default(row.Capability, modelName(row)))
	}
	return specMap(modelquality.Merge(specs...))
}

func modelName(row model.PublishedModel) string {
	if strings.TrimSpace(row.SourceModel) != "" {
		return row.SourceModel
	}
	return row.DisplayName
}

func specMap(spec modelquality.Spec) map[string]any {
	options := make([]map[string]any, 0, len(spec.Options))
	for _, option := range spec.Options {
		options = append(options, map[string]any{"key": option.Key, "label": option.Label})
	}
	modes := make([]map[string]any, 0, len(spec.OutputModes))
	for _, option := range spec.OutputModes {
		modes = append(modes, map[string]any{"key": option.Key, "label": option.Label})
	}
	return map[string]any{"scheme": spec.Scheme, "options": options, "supports8K": spec.Supports8K, "supportsUpscale": spec.SupportsUpscale, "outputModes": modes}
}

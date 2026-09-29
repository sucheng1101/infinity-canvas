package modelcatalog

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
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
	Status       string         `json:"status"`
	SortOrder    int            `json:"sortOrder"`
}

type PublicModel struct {
	ID           uint           `json:"id"`
	Capability   string         `json:"capability"`
	DisplayName  string         `json:"displayName"`
	PublicConfig map[string]any `json:"publicConfig"`
	PriceSummary map[string]any `json:"priceSummary,omitempty"`
	Status       string         `json:"status,omitempty"`
	SortOrder    int            `json:"sortOrder,omitempty"`
}

func (s *Service) List(capability string, includeHidden bool) ([]PublicModel, error) {
	query := s.DB.Order("sort_order ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.PublishedModelActive)
	}
	if capability = strings.TrimSpace(capability); capability != "" {
		query = query.Where("capability = ?", capability)
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
		"capability":        row.Capability,
		"display_name":      row.DisplayName,
		"public_config_json": row.PublicConfigJSON,
		"status":            row.Status,
		"sort_order":        row.SortOrder,
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
		ID: row.ID, Capability: row.Capability, DisplayName: row.DisplayName,
		PublicConfig: config,
	}
	if includeAdminFields {
		result.Status = row.Status
		result.SortOrder = row.SortOrder
	}
	return result, nil
}

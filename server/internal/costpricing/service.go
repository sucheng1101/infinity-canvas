package costpricing

import (
	"errors"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrInvalid                   = errors.New("invalid model cost pricing")
	ErrNotFound                  = errors.New("model cost pricing not found")
	ErrPriceConfirmationRequired = errors.New("price confirmation required")
)

type Service struct{ DB *gorm.DB }

type Input struct {
	PublishedModelID uint   `json:"publishedModelId"`
	ChannelID        uint   `json:"channelId"`
	UpstreamModel    string `json:"upstreamModel"`
	BillingUnit      string `json:"billingUnit"`
	CostPerUnit      int64  `json:"costPerUnit"`
	SellPerUnit      int64  `json:"sellPerUnit"`
	Status           string `json:"status"`
	ConfirmWarning   bool   `json:"confirmWarning"`
}

func (s *Service) List() ([]model.ModelCostPricing, error) {
	var rows []model.ModelCostPricing
	return rows, s.DB.Order("id DESC").Find(&rows).Error
}

func (s *Service) Upsert(input Input, id uint) (model.ModelCostPricing, error) {
	input.UpstreamModel = strings.TrimSpace(input.UpstreamModel)
	input.BillingUnit = strings.TrimSpace(input.BillingUnit)
	if input.PublishedModelID == 0 || input.ChannelID == 0 || input.UpstreamModel == "" || input.CostPerUnit < 0 || input.SellPerUnit < 0 || !validUnit(input.BillingUnit) {
		return model.ModelCostPricing{}, ErrInvalid
	}
	if input.SellPerUnit < input.CostPerUnit && !input.ConfirmWarning {
		return model.ModelCostPricing{}, ErrPriceConfirmationRequired
	}
	status := input.Status
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "hidden" {
		return model.ModelCostPricing{}, ErrInvalid
	}
	margin := 0.0
	if input.CostPerUnit > 0 {
		margin = float64(input.SellPerUnit-input.CostPerUnit) / float64(input.CostPerUnit)
	}
	row := model.ModelCostPricing{PublishedModelID: input.PublishedModelID, ChannelID: input.ChannelID, UpstreamModel: input.UpstreamModel, BillingUnit: input.BillingUnit, CostPerUnit: input.CostPerUnit, SellPerUnit: input.SellPerUnit, ProfitMargin: margin, Status: status}
	if id == 0 {
		return row, s.DB.Create(&row).Error
	}
	if err := s.DB.First(&row, id).Error; err != nil {
		return row, ErrNotFound
	}
	row.PublishedModelID, row.ChannelID, row.UpstreamModel, row.BillingUnit, row.CostPerUnit, row.SellPerUnit, row.ProfitMargin, row.Status = input.PublishedModelID, input.ChannelID, input.UpstreamModel, input.BillingUnit, input.CostPerUnit, input.SellPerUnit, margin, status
	return row, s.DB.Save(&row).Error
}

func validUnit(value string) bool {
	switch value {
	case "image", "second", "token", "request":
		return true
	default:
		return false
	}
}

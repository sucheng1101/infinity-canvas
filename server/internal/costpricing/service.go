package costpricing

import (
	"encoding/json"
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
	PublishedModelID uint           `json:"publishedModelId"`
	ChannelID        uint           `json:"channelId"`
	UpstreamModel    string         `json:"upstreamModel"`
	BillingUnit      string         `json:"billingUnit"`
	CostPerUnit      int64          `json:"costPerUnit"`
	SellPerUnit      int64          `json:"sellPerUnit"`
	Formula          map[string]any `json:"formula"`
	Status           string         `json:"status"`
	ConfirmWarning   bool           `json:"confirmWarning"`
}

type View struct {
	ID               uint           `json:"id"`
	PublishedModelID uint           `json:"publishedModelId"`
	ChannelID        uint           `json:"channelId"`
	UpstreamModel    string         `json:"upstreamModel"`
	BillingUnit      string         `json:"billingUnit"`
	CostPerUnit      int64          `json:"costPerUnit"`
	SellPerUnit      int64          `json:"sellPerUnit"`
	Formula          map[string]any `json:"formula,omitempty"`
	ProfitMargin     float64        `json:"profitMargin"`
	Status           string         `json:"status"`
}

func (s *Service) List() ([]View, error) {
	var rows []model.ModelCostPricing
	if err := s.DB.Order("id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]View, 0, len(rows))
	for _, row := range rows {
		result = append(result, toView(row))
	}
	return result, nil
}

func (s *Service) Upsert(input Input, id uint) (View, error) {
	input.UpstreamModel = strings.TrimSpace(input.UpstreamModel)
	input.BillingUnit = strings.TrimSpace(input.BillingUnit)
	if input.PublishedModelID == 0 || input.ChannelID == 0 || input.UpstreamModel == "" || input.CostPerUnit < 0 || input.SellPerUnit < 0 || !validUnit(input.BillingUnit) {
		return View{}, ErrInvalid
	}
	formula, err := normalizeFormula(input.Formula, input.CostPerUnit)
	if err != nil {
		return View{}, ErrInvalid
	}
	if formulaHasLoss(formula, input.SellPerUnit, input.CostPerUnit) && !input.ConfirmWarning {
		return View{}, ErrPriceConfirmationRequired
	}
	status := input.Status
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "hidden" {
		return View{}, ErrInvalid
	}
	margin := 0.0
	if input.CostPerUnit > 0 {
		margin = float64(input.SellPerUnit-input.CostPerUnit) / float64(input.CostPerUnit)
	}
	formulaJSON, _ := json.Marshal(formula)
	row := model.ModelCostPricing{PublishedModelID: input.PublishedModelID, ChannelID: input.ChannelID, UpstreamModel: input.UpstreamModel, BillingUnit: input.BillingUnit, CostPerUnit: input.CostPerUnit, SellPerUnit: input.SellPerUnit, FormulaJSON: string(formulaJSON), ProfitMargin: margin, Status: status}
	if id == 0 {
		var existing model.ModelCostPricing
		if err := s.DB.Where("published_model_id = ? AND channel_id = ? AND upstream_model = ? AND status = ?", input.PublishedModelID, input.ChannelID, input.UpstreamModel, status).First(&existing).Error; err == nil {
			id = existing.ID
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, err
		}
	}
	if id == 0 {
		if err := s.DB.Create(&row).Error; err != nil {
			return View{}, err
		}
		return toView(row), nil
	}
	if err := s.DB.First(&row, id).Error; err != nil {
		return View{}, ErrNotFound
	}
	row.PublishedModelID, row.ChannelID, row.UpstreamModel, row.BillingUnit, row.CostPerUnit, row.SellPerUnit, row.FormulaJSON, row.ProfitMargin, row.Status = input.PublishedModelID, input.ChannelID, input.UpstreamModel, input.BillingUnit, input.CostPerUnit, input.SellPerUnit, string(formulaJSON), margin, status
	if err := s.DB.Save(&row).Error; err != nil {
		return View{}, err
	}
	return toView(row), nil
}

func toView(row model.ModelCostPricing) View {
	formula := map[string]any{}
	if strings.TrimSpace(row.FormulaJSON) != "" {
		_ = json.Unmarshal([]byte(row.FormulaJSON), &formula)
	}
	return View{ID: row.ID, PublishedModelID: row.PublishedModelID, ChannelID: row.ChannelID, UpstreamModel: row.UpstreamModel, BillingUnit: row.BillingUnit, CostPerUnit: row.CostPerUnit, SellPerUnit: row.SellPerUnit, Formula: formula, ProfitMargin: row.ProfitMargin, Status: row.Status}
}

func normalizeFormula(input map[string]any, fallback int64) (map[string]any, error) {
	formula := map[string]any{"type": "per_unit", "unitAmount": fallback}
	for key, value := range input {
		formula[key] = value
	}
	if _, ok := number(formula["unitAmount"]); !ok || numberValue(formula["unitAmount"]) < 0 {
		return nil, ErrInvalid
	}
	items, ok := formula["variants"].([]any)
	if !ok {
		return formula, nil
	}
	for _, item := range items {
		value, valid := item.(map[string]any)
		if !valid || strings.TrimSpace(stringValue(value["key"])) == "" || numberValue(value["unitAmount"]) < 0 {
			return nil, ErrInvalid
		}
	}
	return formula, nil
}

func formulaHasLoss(formula map[string]any, fallbackSell, fallbackCost int64) bool {
	if fallbackSell < fallbackCost {
		return true
	}
	items, _ := formula["variants"].([]any)
	for _, item := range items {
		value, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if numberValue(value["sellPerUnit"]) > 0 && numberValue(value["sellPerUnit"]) < numberValue(value["unitAmount"]) {
			return true
		}
	}
	return false
}

func UnitPrice(row model.ModelCostPricing, parameters map[string]any) int64 {
	if strings.TrimSpace(row.FormulaJSON) == "" {
		return row.CostPerUnit
	}
	formula := map[string]any{}
	if json.Unmarshal([]byte(row.FormulaJSON), &formula) != nil {
		return row.CostPerUnit
	}
	variant := selectedVariant(formula, parameters)
	items, _ := formula["variants"].([]any)
	for _, item := range items {
		value, ok := item.(map[string]any)
		if ok && stringValue(value["key"]) == variant {
			return int64(numberValue(value["unitAmount"]))
		}
	}
	return row.CostPerUnit
}

func selectedVariant(formula, parameters map[string]any) string {
	if value := stringValue(parameters["variant"]); value != "" {
		return value
	}
	keys := []string{}
	quality := stringValue(parameters["quality"])
	resolution := stringValue(parameters["resolution"])
	outputMode := stringValue(parameters["outputMode"])
	if quality != "" && outputMode != "" {
		keys = append(keys, quality+":"+outputMode)
	}
	if resolution != "" && outputMode != "" {
		keys = append(keys, resolution+":"+outputMode)
	}
	if outputMode != "" {
		keys = append(keys, outputMode)
	}
	keys = append(keys, quality, resolution)
	items, _ := formula["variants"].([]any)
	for _, candidate := range keys {
		if candidate == "" {
			continue
		}
		for _, item := range items {
			value, ok := item.(map[string]any)
			if ok && stringValue(value["key"]) == candidate {
				return candidate
			}
		}
	}
	return ""
}

func number(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		value, err := typed.Float64()
		return value, err == nil
	default:
		return 0, false
	}
}

func numberValue(value any) float64 {
	parsed, _ := number(value)
	return parsed
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func validUnit(value string) bool {
	switch value {
	case "image", "second", "token", "request":
		return true
	default:
		return false
	}
}

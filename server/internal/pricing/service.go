package pricing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalidPricing     = errors.New("invalid pricing version")
	ErrPricingNotFound    = errors.New("pricing version not found")
	ErrPricingUnavailable = errors.New("pricing unavailable")
	ErrQuoteNotFound      = errors.New("quote not found")
	ErrQuoteExpired       = errors.New("quote expired")
	ErrQuoteParameter     = errors.New("quote parameters mismatch")
)

type Service struct {
	DB       *gorm.DB
	QuoteTTL time.Duration
}

type Input struct {
	PublishedModelID uint           `json:"publishedModelId"`
	Formula          map[string]any `json:"formula"`
	Currency         string         `json:"currency"`
	EffectiveAt      *time.Time     `json:"effectiveAt"`
}

type View struct {
	ID               uint           `json:"id"`
	PublishedModelID uint           `json:"publishedModelId"`
	PublishedModel   string         `json:"publishedModel,omitempty"`
	Version          int64          `json:"version"`
	Formula          map[string]any `json:"formula"`
	Currency         string         `json:"currency"`
	Status           string         `json:"status"`
	EffectiveAt      time.Time      `json:"effectiveAt"`
	RetiredAt        *time.Time     `json:"retiredAt,omitempty"`
}

type QuoteInput struct {
	ModelID    uint           `json:"modelId"`
	Capability string         `json:"capability"`
	Parameters map[string]any `json:"parameters"`
	Count      int            `json:"count"`
}

type QuoteView struct {
	QuoteID      string         `json:"quoteId"`
	ModelID      uint           `json:"modelId"`
	Amount       int64          `json:"amount"`
	Currency     string         `json:"currency"`
	PriceVersion int64          `json:"priceVersion"`
	ExpiresAt    time.Time      `json:"expiresAt"`
	Summary      map[string]any `json:"summary"`
}

type PublicSummary struct {
	Type       string `json:"type"`
	UnitAmount int64  `json:"unitAmount"`
	Currency   string `json:"currency"`
}

func (s *Service) Summary(publishedModelID uint) (PublicSummary, bool) {
	var row model.PricingVersion
	now := time.Now().UTC()
	if err := s.DB.Where("published_model_id = ? AND status = ? AND effective_at <= ?", publishedModelID, model.PricingVersionActive, now).Where("retired_at IS NULL OR retired_at > ?", now).Order("version DESC").First(&row).Error; err != nil {
		return PublicSummary{}, false
	}
	formula, err := decodeFormula(row.FormulaJSON)
	if err != nil {
		return PublicSummary{}, false
	}
	kind, _ := formula["type"].(string)
	unit := int64(numberOr(formula["unitAmount"], 0))
	return PublicSummary{Type: kind, UnitAmount: unit, Currency: row.Currency}, true
}

func (s *Service) List(includeRetired bool) ([]View, error) {
	query := s.DB.Order("published_model_id ASC").Order("version DESC")
	if !includeRetired {
		query = query.Where("status <> ?", model.PricingVersionRetired)
	}
	var rows []model.PricingVersion
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]View, 0, len(rows))
	for _, row := range rows {
		view, err := s.toView(row, includeRetired)
		if err != nil {
			return nil, err
		}
		result = append(result, view)
	}
	return result, nil
}

func (s *Service) Create(operatorID uint, input Input) (View, error) {
	row, err := s.fromInput(input)
	if err != nil {
		return View{}, err
	}
	var latest model.PricingVersion
	_ = s.DB.Where("published_model_id = ?", row.PublishedModelID).Order("version DESC").First(&latest).Error
	row.Version = latest.Version + 1
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return model.RecordAudit(tx, operatorID, "pricing.create", "pricing_version", row.ID)
	})
	if err != nil {
		return View{}, err
	}
	return s.toView(row, true)
}

func (s *Service) Publish(operatorID uint, id uint) (View, error) {
	var row model.PricingVersion
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrPricingNotFound
			}
			return err
		}
		now := time.Now().UTC()
		if err := tx.Model(&model.PricingVersion{}).Where("published_model_id = ? AND status = ? AND id <> ?", row.PublishedModelID, model.PricingVersionActive, row.ID).Updates(map[string]any{"status": model.PricingVersionRetired, "retired_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&row).Updates(map[string]any{"status": model.PricingVersionActive, "effective_at": now, "retired_at": nil}).Error; err != nil {
			return err
		}
		row.Status = model.PricingVersionActive
		row.EffectiveAt = now
		row.RetiredAt = nil
		return model.RecordAudit(tx, operatorID, "pricing.publish", "pricing_version", row.ID)
	})
	if err != nil {
		return View{}, err
	}
	return s.toView(row, true)
}

func (s *Service) Retire(operatorID uint, id uint) error {
	now := time.Now().UTC()
	return s.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.PricingVersion{}).Where("id = ? AND status <> ?", id, model.PricingVersionRetired).Updates(map[string]any{"status": model.PricingVersionRetired, "retired_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPricingNotFound
		}
		return model.RecordAudit(tx, operatorID, "pricing.retire", "pricing_version", id)
	})
}

func (s *Service) Quote(userID uint, input QuoteInput) (QuoteView, error) {
	if input.ModelID == 0 || input.Count <= 0 || input.Count > 1000 {
		return QuoteView{}, ErrQuoteParameter
	}
	if input.Parameters == nil {
		input.Parameters = map[string]any{}
	}
	var published model.PublishedModel
	if err := s.DB.Where("id = ? AND status = ?", input.ModelID, model.PublishedModelActive).First(&published).Error; err != nil {
		return QuoteView{}, ErrPricingUnavailable
	}
	if strings.TrimSpace(input.Capability) != "" && input.Capability != published.Capability {
		return QuoteView{}, ErrQuoteParameter
	}
	var price model.PricingVersion
	now := time.Now().UTC()
	if err := s.DB.Where("published_model_id = ? AND status = ? AND effective_at <= ?", input.ModelID, model.PricingVersionActive, now).Where("retired_at IS NULL OR retired_at > ?", now).Order("version DESC").First(&price).Error; err != nil {
		return QuoteView{}, ErrPricingUnavailable
	}
	formula, err := decodeFormula(price.FormulaJSON)
	if err != nil {
		return QuoteView{}, ErrPricingUnavailable
	}
	amount, err := calculate(formula, input.Parameters, input.Count)
	if err != nil {
		return QuoteView{}, err
	}
	parametersJSON, err := json.Marshal(input.Parameters)
	if err != nil {
		return QuoteView{}, ErrQuoteParameter
	}
	digest := sha256.Sum256(parametersJSON)
	ttl := s.QuoteTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	expires := now.Add(ttl)
	quote := model.Quote{ID: uuid.NewString(), UserID: userID, PublishedModelID: input.ModelID, PricingVersionID: price.ID, Capability: published.Capability, ParametersJSON: string(parametersJSON), ParameterDigest: hex.EncodeToString(digest[:]), Count: input.Count, Amount: amount, Currency: price.Currency, Status: model.QuoteStatusIssued, ExpiresAt: expires}
	if err := s.DB.Create(&quote).Error; err != nil {
		return QuoteView{}, err
	}
	return QuoteView{QuoteID: quote.ID, ModelID: quote.PublishedModelID, Amount: quote.Amount, Currency: quote.Currency, PriceVersion: price.Version, ExpiresAt: quote.ExpiresAt, Summary: summary(formula, input.Count)}, nil
}

func (s *Service) ValidateQuoteTx(tx *gorm.DB, userID uint, quoteID string, modelID uint, parameters map[string]any) (model.Quote, error) {
	return s.validateQuote(tx.Clauses(clause.Locking{Strength: "UPDATE"}), userID, quoteID, modelID, parameters)
}

func (s *Service) validateQuote(db *gorm.DB, userID uint, quoteID string, modelID uint, parameters map[string]any) (model.Quote, error) {
	var quote model.Quote
	if err := db.Where("id = ? AND user_id = ?", quoteID, userID).First(&quote).Error; err != nil {
		return model.Quote{}, ErrQuoteNotFound
	}
	if quote.Status != model.QuoteStatusIssued || !time.Now().UTC().Before(quote.ExpiresAt) {
		return model.Quote{}, ErrQuoteExpired
	}
	if modelID != quote.PublishedModelID {
		return model.Quote{}, ErrQuoteParameter
	}
	payload, err := json.Marshal(parameters)
	if err != nil {
		return model.Quote{}, ErrQuoteParameter
	}
	digest := sha256.Sum256(payload)
	if hex.EncodeToString(digest[:]) != quote.ParameterDigest {
		return model.Quote{}, ErrQuoteParameter
	}
	return quote, nil
}

func (s *Service) fromInput(input Input) (model.PricingVersion, error) {
	if input.PublishedModelID == 0 || strings.TrimSpace(input.Currency) == "" || len(input.Currency) > 16 {
		return model.PricingVersion{}, ErrInvalidPricing
	}
	var published model.PublishedModel
	if err := s.DB.Select("id").First(&published, input.PublishedModelID).Error; err != nil {
		return model.PricingVersion{}, ErrInvalidPricing
	}
	formulaInput := input.Formula
	if formulaInput == nil {
		formulaInput = map[string]any{}
	}
	if _, ok := formulaInput["type"]; !ok {
		formulaInput["type"] = "fixed"
	}
	formula, err := json.Marshal(formulaInput)
	if err != nil || len(formula) > 8192 {
		return model.PricingVersion{}, ErrInvalidPricing
	}
	decoded, err := decodeFormula(string(formula))
	if err != nil {
		return model.PricingVersion{}, ErrInvalidPricing
	}
	if _, err = calculate(decoded, map[string]any{"durationSeconds": 1, "inputTokens": 1}, 1); err != nil {
		return model.PricingVersion{}, ErrInvalidPricing
	}
	effective := time.Now().UTC()
	if input.EffectiveAt != nil {
		effective = input.EffectiveAt.UTC()
	}
	return model.PricingVersion{PublishedModelID: input.PublishedModelID, FormulaJSON: string(formula), Currency: strings.ToUpper(strings.TrimSpace(input.Currency)), Status: model.PricingVersionDraft, EffectiveAt: effective}, nil
}

func (s *Service) toView(row model.PricingVersion, includeFormula bool) (View, error) {
	formula, err := decodeFormula(row.FormulaJSON)
	if err != nil {
		return View{}, err
	}
	view := View{ID: row.ID, PublishedModelID: row.PublishedModelID, Version: row.Version, Currency: row.Currency, Status: row.Status, EffectiveAt: row.EffectiveAt, RetiredAt: row.RetiredAt}
	if includeFormula {
		view.Formula = formula
	}
	var published model.PublishedModel
	if s.DB.Select("id, display_name").First(&published, row.PublishedModelID).Error == nil {
		view.PublishedModel = published.DisplayName
	}
	return view, nil
}

func decodeFormula(payload string) (map[string]any, error) {
	formula := map[string]any{}
	if err := json.Unmarshal([]byte(payload), &formula); err != nil {
		return nil, ErrInvalidPricing
	}
	return formula, nil
}

func calculate(formula, parameters map[string]any, count int) (int64, error) {
	kind, _ := formula["type"].(string)
	if kind == "" {
		kind = "fixed"
	}
	unit, ok := number(formula["unitAmount"])
	if !ok || unit < 0 {
		return 0, ErrInvalidPricing
	}
	var units float64 = float64(count)
	switch kind {
	case "fixed":
		units = 1
	case "per_unit":
		units = float64(count)
	case "per_second":
		units = numberOr(parameters["durationSeconds"], 0) * float64(count)
	case "per_token":
		units = (numberOr(parameters["inputTokens"], 0) + numberOr(parameters["outputTokens"], 0)) * float64(count)
	default:
		return 0, ErrInvalidPricing
	}
	base := numberOr(formula["baseAmount"], 0)
	amount := base + unit*units
	if minimum := numberOr(formula["minimumAmount"], 0); amount < minimum {
		amount = minimum
	}
	if amount <= 0 || amount > math.MaxInt64 {
		return 0, ErrInvalidPricing
	}
	return int64(math.Ceil(amount)), nil
}

func summary(formula map[string]any, count int) map[string]any {
	return map[string]any{"type": formula["type"], "count": count, "unitAmount": formula["unitAmount"]}
}

func number(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	default:
		return 0, false
	}
}
func numberOr(value any, fallback float64) float64 {
	n, ok := number(value)
	if ok {
		return n
	}
	return fallback
}

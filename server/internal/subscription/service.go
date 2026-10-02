package subscription

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInvalidPlan             = errors.New("invalid subscription plan")
	ErrPlanNotFound            = errors.New("subscription plan not found")
	ErrInsufficientQuota       = errors.New("insufficient quota")
	ErrSubscriptionUnavailable = errors.New("subscription unavailable")
	ErrUnlockPlanNotFound      = errors.New("custom channel unlock plan not found")
	ErrOrderInProgress         = errors.New("purchase is already processing")
	ErrOrderFailed             = errors.New("purchase previously failed")
)

type Service struct{ DB *gorm.DB }

type QuotaInput struct {
	PublishedModelID uint  `json:"publishedModelId"`
	ImageCount       int64 `json:"imageCount"`
	VideoSeconds     int64 `json:"videoSeconds"`
	TextTokens       int64 `json:"textTokens"`
}

type PlanInput struct {
	Name         string       `json:"name"`
	Cycle        string       `json:"cycle"`
	PriceQuota   int64        `json:"priceQuota"`
	DurationDays int          `json:"durationDays"`
	Status       string       `json:"status"`
	SortOrder    int          `json:"sortOrder"`
	Quotas       []QuotaInput `json:"quotas"`
}

type QuotaView struct {
	PublishedModelID uint   `json:"publishedModelId"`
	ModelName        string `json:"modelName,omitempty"`
	ImageCount       int64  `json:"imageCount"`
	VideoSeconds     int64  `json:"videoSeconds"`
	TextTokens       int64  `json:"textTokens"`
	UsedUnits        int64  `json:"usedUnits"`
	RemainingUnits   int64  `json:"remainingUnits"`
}

type PlanView struct {
	model.SubscriptionPlan
	Quotas []QuotaView `json:"quotas"`
}

type SubscriptionView struct {
	model.UserSubscription
	Plan   PlanView    `json:"plan"`
	Quotas []QuotaView `json:"quotas"`
}

type UnlockPlanInput struct {
	Name         string `json:"name"`
	PriceQuota   int64  `json:"priceQuota"`
	DurationDays int    `json:"durationDays"`
	ChannelLimit int    `json:"channelLimit"`
	Status       string `json:"status"`
}

func (s *Service) Plans(includeHidden bool) ([]PlanView, error) {
	query := s.DB.Order("sort_order ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.SubscriptionPlanActive)
	}
	var rows []model.SubscriptionPlan
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]PlanView, 0, len(rows))
	for _, row := range rows {
		view, err := s.planView(row, false)
		if err != nil {
			return nil, err
		}
		result = append(result, view)
	}
	return result, nil
}

func (s *Service) UpsertPlan(input PlanInput, id uint) (PlanView, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || input.PriceQuota < 0 || input.DurationDays <= 0 || !validCycle(input.Cycle) {
		return PlanView{}, ErrInvalidPlan
	}
	status := input.Status
	if status == "" {
		status = model.SubscriptionPlanActive
	}
	if status != model.SubscriptionPlanActive && status != model.SubscriptionPlanHidden {
		return PlanView{}, ErrInvalidPlan
	}
	for _, quota := range input.Quotas {
		if quota.PublishedModelID == 0 || quota.ImageCount < 0 || quota.VideoSeconds < 0 || quota.TextTokens < 0 {
			return PlanView{}, ErrInvalidPlan
		}
	}
	var plan model.SubscriptionPlan
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if id > 0 {
			if err := tx.First(&plan, id).Error; err != nil {
				return ErrPlanNotFound
			}
			plan.Name, plan.Cycle, plan.PriceQuota, plan.DurationDays, plan.Status, plan.SortOrder = name, input.Cycle, input.PriceQuota, input.DurationDays, status, input.SortOrder
			if err := tx.Save(&plan).Error; err != nil {
				return err
			}
			if err := tx.Where("plan_id = ?", plan.ID).Delete(&model.SubscriptionPlanQuota{}).Error; err != nil {
				return err
			}
		} else {
			plan = model.SubscriptionPlan{Name: name, Cycle: input.Cycle, PriceQuota: input.PriceQuota, DurationDays: input.DurationDays, Status: status, SortOrder: input.SortOrder}
			if err := tx.Create(&plan).Error; err != nil {
				return err
			}
		}
		for _, quota := range input.Quotas {
			if err := tx.Create(&model.SubscriptionPlanQuota{PlanID: plan.ID, PublishedModelID: quota.PublishedModelID, ImageCount: quota.ImageCount, VideoSeconds: quota.VideoSeconds, TextTokens: quota.TextTokens}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return PlanView{}, err
	}
	return s.planView(plan, true)
}

func (s *Service) Current(userID uint) (SubscriptionView, error) {
	var row model.UserSubscription
	now := time.Now().UTC()
	if err := s.DB.Where("user_id = ? AND status = ? AND expires_at > ?", userID, model.SubscriptionActive, now).Order("expires_at DESC").First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return SubscriptionView{}, ErrSubscriptionUnavailable
		}
		return SubscriptionView{}, err
	}
	var plan model.SubscriptionPlan
	if err := s.DB.First(&plan, row.PlanID).Error; err != nil {
		return SubscriptionView{}, ErrPlanNotFound
	}
	view, err := s.planView(plan, true)
	if err != nil {
		return SubscriptionView{}, err
	}
	var usages []model.SubscriptionUsage
	if err := s.DB.Where("subscription_id = ?", row.ID).Find(&usages).Error; err != nil {
		return SubscriptionView{}, err
	}
	for index := range view.Quotas {
		hasUsage := false
		for _, usage := range usages {
			if usage.PublishedModelID != view.Quotas[index].PublishedModelID {
				continue
			}
			hasUsage = true
			view.Quotas[index].UsedUnits = usage.UsedUnits
			view.Quotas[index].RemainingUnits = quotaLimitForView(view.Quotas[index], plan, usage.BillingUnit)
		}
		if !hasUsage {
			view.Quotas[index].RemainingUnits = quotaLimitForView(view.Quotas[index], plan, billingUnitFromQuota(view.Quotas[index]))
		}
	}
	return SubscriptionView{UserSubscription: row, Plan: view, Quotas: view.Quotas}, nil
}

func (s *Service) Purchase(userID, planID uint, idempotencyKey string) (SubscriptionView, error) {
	if userID == 0 || planID == 0 {
		return SubscriptionView{}, ErrInvalidPlan
	}
	idempotencyKey = normalizeIdempotencyKey(idempotencyKey)
	var result SubscriptionView
	var businessErr error
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		order, found, err := s.findOperationOrder(tx, userID, model.OperationOrderSubscriptionPurchase, idempotencyKey)
		if err != nil {
			return err
		}
		if found {
			return decodeOperationResult(order, &result)
		}
		order = model.OperationOrder{UserID: userID, OrderNo: "SUB-" + uuid.NewString(), IdempotencyKey: idempotencyKey, Type: model.OperationOrderSubscriptionPurchase, ProductID: planID, Status: model.OperationOrderProcessing}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		var plan model.SubscriptionPlan
		if err := tx.Where("id = ? AND status = ?", planID, model.SubscriptionPlanActive).First(&plan).Error; err != nil {
			businessErr = ErrPlanNotFound
			return s.finishFailedOrder(tx, &order, "SUBSCRIPTION_PLAN_NOT_FOUND", businessErr)
		}
		order.Amount = plan.PriceQuota
		if err := tx.Model(&order).Update("amount", order.Amount).Error; err != nil {
			return err
		}
		var account model.QuotaAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		if account.Balance-account.Reserved < plan.PriceQuota {
			businessErr = ErrInsufficientQuota
			return s.finishFailedOrder(tx, &order, "QUOTA_INSUFFICIENT", businessErr)
		}
		account.Balance -= plan.PriceQuota
		if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
			return err
		}
		if plan.PriceQuota > 0 {
			if err := tx.Create(&model.QuotaLedger{UserID: userID, Delta: -plan.PriceQuota, BalanceAfter: account.Balance, Source: "subscription", BusinessType: "subscription_purchase", BusinessID: order.OrderNo, IdempotencyKey: "subscription:" + order.OrderNo, Reason: plan.Name}).Error; err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		start := now
		var current model.UserSubscription
		if tx.Where("user_id = ? AND status = ? AND expires_at > ?", userID, model.SubscriptionActive, now).Order("expires_at DESC").First(&current).Error == nil {
			start = current.ExpiresAt
			if err := tx.Model(&current).Update("status", model.SubscriptionExpired).Error; err != nil {
				return err
			}
		}
		row := model.UserSubscription{UserID: userID, PlanID: plan.ID, Status: model.SubscriptionActive, StartsAt: start, ExpiresAt: start.AddDate(0, 0, plan.DurationDays)}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		view, err := s.subscriptionViewTx(tx, row, plan)
		if err != nil {
			return err
		}
		result = view
		encoded, err := json.Marshal(view)
		if err != nil {
			return err
		}
		return tx.Model(&order).Updates(map[string]any{"status": model.OperationOrderSucceeded, "result_json": string(encoded)}).Error
	})
	if err != nil {
		if order, lookupErr := s.loadOperationOrder(userID, model.OperationOrderSubscriptionPurchase, idempotencyKey); lookupErr == nil {
			if decodeErr := decodeOperationResult(order, &result); decodeErr == nil {
				return result, nil
			}
		}
		return SubscriptionView{}, err
	}
	if businessErr != nil {
		return SubscriptionView{}, businessErr
	}
	return result, nil
}

func (s *Service) ConsumeTx(tx *gorm.DB, userID, modelID uint, capability string, units int64) (bool, uint, error) {
	if units <= 0 {
		return false, 0, nil
	}
	now := time.Now().UTC()
	var sub model.UserSubscription
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND status = ? AND expires_at > ?", userID, model.SubscriptionActive, now).Order("expires_at DESC").First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, 0, nil
		}
		return false, 0, err
	}
	var planQuota model.SubscriptionPlanQuota
	if err := tx.Where("plan_id = ? AND published_model_id = ?", sub.PlanID, modelID).First(&planQuota).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, 0, nil
		}
		return false, 0, err
	}
	limit := quotaLimit(planQuota, capability)
	if limit < units {
		return false, 0, nil
	}
	unit := billingUnit(capability)
	var usage model.SubscriptionUsage
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("subscription_id = ? AND published_model_id = ? AND billing_unit = ?", sub.ID, modelID, unit).First(&usage).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			usage = model.SubscriptionUsage{SubscriptionID: sub.ID, UserID: userID, PublishedModelID: modelID, BillingUnit: unit, UsedUnits: units}
			return true, sub.ID, tx.Create(&usage).Error
		}
		return false, 0, err
	}
	if usage.UsedUnits+units > limit {
		return false, 0, nil
	}
	usage.UsedUnits += units
	return true, sub.ID, tx.Save(&usage).Error
}

// ReleaseTx restores subscription units when a covered task is cancelled or fails
// before a successful upstream response is recorded.
func (s *Service) ReleaseTx(tx *gorm.DB, subscriptionID, userID, modelID uint, billingUnit string, units int64) error {
	if subscriptionID == 0 || userID == 0 || modelID == 0 || units <= 0 {
		return nil
	}
	var usage model.SubscriptionUsage
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("subscription_id = ? AND user_id = ? AND published_model_id = ? AND billing_unit = ?", subscriptionID, userID, modelID, billingUnit).First(&usage).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	usage.UsedUnits -= units
	if usage.UsedUnits <= 0 {
		return tx.Delete(&usage).Error
	}
	return tx.Model(&usage).Update("used_units", usage.UsedUnits).Error
}

func (s *Service) UnlockPlans(includeHidden bool) ([]model.CustomChannelUnlockPlan, error) {
	query := s.DB.Order("price_quota ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.SubscriptionPlanActive)
	}
	var rows []model.CustomChannelUnlockPlan
	return rows, query.Find(&rows).Error
}

func (s *Service) UpsertUnlockPlan(input UnlockPlanInput, id uint) (model.CustomChannelUnlockPlan, error) {
	if strings.TrimSpace(input.Name) == "" || input.PriceQuota <= 0 || input.DurationDays <= 0 || input.ChannelLimit <= 0 {
		return model.CustomChannelUnlockPlan{}, ErrInvalidPlan
	}
	status := input.Status
	if status == "" {
		status = model.SubscriptionPlanActive
	}
	if id == 0 {
		row := model.CustomChannelUnlockPlan{Name: strings.TrimSpace(input.Name), PriceQuota: input.PriceQuota, DurationDays: input.DurationDays, ChannelLimit: input.ChannelLimit, Status: status}
		return row, s.DB.Create(&row).Error
	}
	var row model.CustomChannelUnlockPlan
	if err := s.DB.First(&row, id).Error; err != nil {
		return row, ErrUnlockPlanNotFound
	}
	row.Name, row.PriceQuota, row.DurationDays, row.ChannelLimit, row.Status = strings.TrimSpace(input.Name), input.PriceQuota, input.DurationDays, input.ChannelLimit, status
	return row, s.DB.Save(&row).Error
}

func (s *Service) UnlockChannel(userID, planID uint, idempotencyKey string) (model.UserChannelEntitlement, error) {
	if userID == 0 || planID == 0 {
		return model.UserChannelEntitlement{}, ErrUnlockPlanNotFound
	}
	idempotencyKey = normalizeIdempotencyKey(idempotencyKey)
	var entitlement model.UserChannelEntitlement
	var businessErr error
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		order, found, err := s.findOperationOrder(tx, userID, model.OperationOrderChannelUnlock, idempotencyKey)
		if err != nil {
			return err
		}
		if found {
			return decodeOperationResult(order, &entitlement)
		}
		order = model.OperationOrder{UserID: userID, OrderNo: "CHN-" + uuid.NewString(), IdempotencyKey: idempotencyKey, Type: model.OperationOrderChannelUnlock, ProductID: planID, Status: model.OperationOrderProcessing}
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		var plan model.CustomChannelUnlockPlan
		if err := tx.Where("id = ? AND status = ?", planID, model.SubscriptionPlanActive).First(&plan).Error; err != nil {
			businessErr = ErrUnlockPlanNotFound
			return s.finishFailedOrder(tx, &order, "CHANNEL_UNLOCK_PLAN_NOT_FOUND", businessErr)
		}
		order.Amount = plan.PriceQuota
		if err := tx.Model(&order).Update("amount", order.Amount).Error; err != nil {
			return err
		}
		var account model.QuotaAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		if account.Balance-account.Reserved < plan.PriceQuota {
			businessErr = ErrInsufficientQuota
			return s.finishFailedOrder(tx, &order, "QUOTA_INSUFFICIENT", businessErr)
		}
		account.Balance -= plan.PriceQuota
		if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		expires := now.AddDate(0, 0, plan.DurationDays)
		if err := tx.Create(&model.QuotaLedger{UserID: userID, Delta: -plan.PriceQuota, BalanceAfter: account.Balance, Source: "channel_unlock", BusinessType: "custom_channel_unlock", BusinessID: order.OrderNo, IdempotencyKey: "channel_unlock:" + order.OrderNo, Reason: plan.Name}).Error; err != nil {
			return err
		}
		entitlement = model.UserChannelEntitlement{UserID: userID, Source: "balance_unlock", UnlockPlanID: &plan.ID, UnlockCost: plan.PriceQuota, ChannelLimit: plan.ChannelLimit, ExpiresAt: &expires, Status: model.UserChannelActive}
		if err := tx.Create(&entitlement).Error; err != nil {
			return err
		}
		encoded, err := json.Marshal(entitlement)
		if err != nil {
			return err
		}
		return tx.Model(&order).Updates(map[string]any{"status": model.OperationOrderSucceeded, "result_json": string(encoded)}).Error
	})
	if err != nil {
		if order, lookupErr := s.loadOperationOrder(userID, model.OperationOrderChannelUnlock, idempotencyKey); lookupErr == nil {
			if decodeErr := decodeOperationResult(order, &entitlement); decodeErr == nil {
				return entitlement, nil
			}
		}
		return model.UserChannelEntitlement{}, err
	}
	if businessErr != nil {
		return model.UserChannelEntitlement{}, businessErr
	}
	return entitlement, nil
}

func normalizeIdempotencyKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return uuid.NewString()
	}
	if len(value) > 191 {
		return value[:191]
	}
	return value
}

func (s *Service) findOperationOrder(tx *gorm.DB, userID uint, orderType, idempotencyKey string) (model.OperationOrder, bool, error) {
	var order model.OperationOrder
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND type = ? AND idempotency_key = ?", userID, orderType, idempotencyKey).First(&order).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return order, false, nil
	}
	return order, true, err
}

func (s *Service) loadOperationOrder(userID uint, orderType, idempotencyKey string) (model.OperationOrder, error) {
	var order model.OperationOrder
	err := s.DB.Where("user_id = ? AND type = ? AND idempotency_key = ?", userID, orderType, idempotencyKey).First(&order).Error
	return order, err
}

func decodeOperationResult(order model.OperationOrder, target any) error {
	switch order.Status {
	case model.OperationOrderSucceeded:
		if strings.TrimSpace(order.ResultJSON) == "" {
			return errors.New("purchase result is missing")
		}
		return json.Unmarshal([]byte(order.ResultJSON), target)
	case model.OperationOrderFailed:
		return ErrOrderFailed
	default:
		return ErrOrderInProgress
	}
}

func (s *Service) finishFailedOrder(tx *gorm.DB, order *model.OperationOrder, code string, cause error) error {
	return tx.Model(order).Updates(map[string]any{
		"status":        model.OperationOrderFailed,
		"error_code":    code,
		"error_message": cause.Error(),
	}).Error
}

func (s *Service) subscriptionViewTx(tx *gorm.DB, row model.UserSubscription, plan model.SubscriptionPlan) (SubscriptionView, error) {
	var quotas []model.SubscriptionPlanQuota
	if err := tx.Where("plan_id = ?", plan.ID).Find(&quotas).Error; err != nil {
		return SubscriptionView{}, err
	}
	var usages []model.SubscriptionUsage
	if err := tx.Where("subscription_id = ?", row.ID).Find(&usages).Error; err != nil {
		return SubscriptionView{}, err
	}
	view := PlanView{SubscriptionPlan: plan, Quotas: make([]QuotaView, 0, len(quotas))}
	for _, quota := range quotas {
		item := QuotaView{PublishedModelID: quota.PublishedModelID, ImageCount: quota.ImageCount, VideoSeconds: quota.VideoSeconds, TextTokens: quota.TextTokens}
		var published model.PublishedModel
		if tx.First(&published, quota.PublishedModelID).Error == nil {
			item.ModelName = published.DisplayName
		}
		hasUsage := false
		for _, usage := range usages {
			if usage.PublishedModelID == quota.PublishedModelID {
				hasUsage = true
				item.UsedUnits = usage.UsedUnits
				item.RemainingUnits = quotaLimitForView(item, plan, usage.BillingUnit)
			}
		}
		if !hasUsage {
			item.RemainingUnits = quotaLimitForView(item, plan, billingUnitFromQuota(item))
		}
		view.Quotas = append(view.Quotas, item)
	}
	return SubscriptionView{UserSubscription: row, Plan: view, Quotas: view.Quotas}, nil
}

func (s *Service) planView(plan model.SubscriptionPlan, withUsage bool) (PlanView, error) {
	var rows []model.SubscriptionPlanQuota
	if err := s.DB.Where("plan_id = ?", plan.ID).Find(&rows).Error; err != nil {
		return PlanView{}, err
	}
	result := PlanView{SubscriptionPlan: plan, Quotas: make([]QuotaView, 0, len(rows))}
	for _, row := range rows {
		item := QuotaView{PublishedModelID: row.PublishedModelID, ImageCount: row.ImageCount, VideoSeconds: row.VideoSeconds, TextTokens: row.TextTokens}
		var published model.PublishedModel
		if s.DB.First(&published, row.PublishedModelID).Error == nil {
			item.ModelName = published.DisplayName
		}
		result.Quotas = append(result.Quotas, item)
	}
	return result, nil
}

func validCycle(value string) bool {
	switch value {
	case model.SubscriptionDaily, model.SubscriptionWeekly, model.SubscriptionMonthly, model.SubscriptionQuarterly, model.SubscriptionYearly:
		return true
	default:
		return false
	}
}
func quotaLimit(row model.SubscriptionPlanQuota, capability string) int64 {
	switch strings.ToLower(capability) {
	case "image":
		return row.ImageCount
	case "video":
		return row.VideoSeconds
	case "text":
		return row.TextTokens
	default:
		return 0
	}
}
func billingUnit(capability string) string {
	switch strings.ToLower(capability) {
	case "image":
		return "image"
	case "video":
		return "second"
	case "text":
		return "token"
	default:
		return "request"
	}
}
func formatID(value uint) string { return strconv.FormatUint(uint64(value), 10) }

func quotaLimitForView(view QuotaView, plan model.SubscriptionPlan, unit string) int64 {
	if unit == "image" {
		return view.ImageCount - view.UsedUnits
	}
	if unit == "second" {
		return view.VideoSeconds - view.UsedUnits
	}
	if unit == "token" {
		return view.TextTokens - view.UsedUnits
	}
	return 0
}

func billingUnitFromQuota(view QuotaView) string {
	if view.ImageCount > 0 {
		return "image"
	}
	if view.VideoSeconds > 0 {
		return "second"
	}
	if view.TextTokens > 0 {
		return "token"
	}
	return "request"
}

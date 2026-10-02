package subscription

import (
	"errors"
	"strconv"
	"strings"
	"time"

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
		for _, usage := range usages {
			if usage.PublishedModelID != view.Quotas[index].PublishedModelID {
				continue
			}
			view.Quotas[index].UsedUnits = usage.UsedUnits
			view.Quotas[index].RemainingUnits = quotaLimitForView(view.Quotas[index], plan, usage.BillingUnit)
		}
		if view.Quotas[index].RemainingUnits == 0 {
			view.Quotas[index].RemainingUnits = quotaLimitForView(view.Quotas[index], plan, billingUnitFromQuota(view.Quotas[index]))
		}
	}
	return SubscriptionView{UserSubscription: row, Plan: view, Quotas: view.Quotas}, nil
}

func (s *Service) Purchase(userID, planID uint) (SubscriptionView, error) {
	var row model.UserSubscription
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var plan model.SubscriptionPlan
		if err := tx.Where("id = ? AND status = ?", planID, model.SubscriptionPlanActive).First(&plan).Error; err != nil {
			return ErrPlanNotFound
		}
		var account model.QuotaAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		if account.Balance-account.Reserved < plan.PriceQuota {
			return ErrInsufficientQuota
		}
		account.Balance -= plan.PriceQuota
		if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
			return err
		}
		if plan.PriceQuota > 0 {
			if err := tx.Create(&model.QuotaLedger{UserID: userID, Delta: -plan.PriceQuota, BalanceAfter: account.Balance, Source: "subscription", BusinessType: "subscription_purchase", BusinessID: strings.Join([]string{"plan", formatID(plan.ID)}, ":"), IdempotencyKey: strings.Join([]string{"subscription", formatID(userID), formatID(plan.ID), formatID(uint(time.Now().UnixNano()))}, ":"), Reason: plan.Name}).Error; err != nil {
				return err
			}
		}
		now := time.Now().UTC()
		start := now
		var current model.UserSubscription
		if tx.Where("user_id = ? AND status = ? AND expires_at > ?", userID, model.SubscriptionActive, now).Order("expires_at DESC").First(&current).Error == nil {
			start = current.ExpiresAt
			_ = tx.Model(&current).Update("status", model.SubscriptionExpired).Error
		}
		row = model.UserSubscription{UserID: userID, PlanID: plan.ID, Status: model.SubscriptionActive, StartsAt: start, ExpiresAt: start.AddDate(0, 0, plan.DurationDays)}
		return tx.Create(&row).Error
	})
	if err != nil {
		return SubscriptionView{}, err
	}
	return s.Current(userID)
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

func (s *Service) UnlockChannel(userID, planID uint) (model.UserChannelEntitlement, error) {
	var entitlement model.UserChannelEntitlement
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var plan model.CustomChannelUnlockPlan
		if err := tx.Where("id = ? AND status = ?", planID, model.SubscriptionPlanActive).First(&plan).Error; err != nil {
			return ErrUnlockPlanNotFound
		}
		var account model.QuotaAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
			return err
		}
		if account.Balance-account.Reserved < plan.PriceQuota {
			return ErrInsufficientQuota
		}
		account.Balance -= plan.PriceQuota
		if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
			return err
		}
		now := time.Now().UTC()
		expires := now.AddDate(0, 0, plan.DurationDays)
		if err := tx.Create(&model.QuotaLedger{UserID: userID, Delta: -plan.PriceQuota, BalanceAfter: account.Balance, Source: "channel_unlock", BusinessType: "custom_channel_unlock", BusinessID: strings.Join([]string{"unlock", formatID(plan.ID)}, ":"), IdempotencyKey: strings.Join([]string{"channel_unlock", formatID(userID), formatID(plan.ID), formatID(uint(time.Now().UnixNano()))}, ":"), Reason: plan.Name}).Error; err != nil {
			return err
		}
		entitlement = model.UserChannelEntitlement{UserID: userID, Source: "balance_unlock", UnlockPlanID: &plan.ID, UnlockCost: plan.PriceQuota, ChannelLimit: plan.ChannelLimit, ExpiresAt: &expires, Status: model.UserChannelActive}
		return tx.Create(&entitlement).Error
	})
	return entitlement, err
}

func (s *Service) planView(plan model.SubscriptionPlan, withUsage bool) (PlanView, error) {
	var rows []model.SubscriptionPlanQuota
	if err := s.DB.Where("plan_id = ?", plan.ID).Find(&rows).Error; err != nil {
		return PlanView{}, err
	}
	result := PlanView{SubscriptionPlan: plan, Quotas: make([]QuotaView, 0, len(rows))}
	for _, row := range rows {
		item := QuotaView{PublishedModelID: row.PublishedModelID, ImageCount: row.ImageCount, VideoSeconds: row.VideoSeconds, TextTokens: row.TextTokens}
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

package store

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

type schemaMigration struct {
	Version   string    `gorm:"size:64;primaryKey"`
	AppliedAt time.Time `gorm:"not null"`
}

type migration struct {
	version string
	apply   func(*gorm.DB) error
}

func migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		return err
	}
	migrations := []migration{
		{
			version: "20260920_m1_auth",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&model.User{},
					&model.Session{},
					&model.EmailVerificationToken{},
					&model.PasswordResetToken{},
					&model.AuditLog{},
					&model.QuotaAccount{},
					&model.QuotaLedger{},
					&model.OperationSetting{},
					&model.InvitationRelation{},
					&model.InvitationReward{},
				)
			},
		},
		{
			version: "20260921_m4_usernames_and_registration_codes",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.User{}, &model.EmailVerificationToken{}, &model.RegistrationCode{})
			},
		},
		{
			version: "20260921_m2_recharge",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(
					&model.TopupProduct{},
					&model.TopupOrder{},
					&model.PaymentEvent{},
				)
			},
		},
		{
			version: "20260921_m3_published_models",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.PublishedModel{})
			},
		},
		{
			version: "20260921_m3_channels_and_routes",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.UpstreamChannel{}, &model.ModelRoute{})
			},
		},
		{
			version: "20260930_m5_channel_model_keys",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.UpstreamChannel{}, &model.UpstreamChannelKey{}, &model.UpstreamChannelModel{})
			},
		},
		{
			version: "20260930_m6_model_pool_fields",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.PublishedModel{}, &model.UpstreamChannelModel{}, &model.ModelRoute{})
			},
		},
		{
			version: "20260921_m3_pricing_and_quotes",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.PricingVersion{}, &model.Quote{}, &model.QuotaReservation{}, &model.GenerationTask{})
			},
		},
		{
			version: "20261002_m7_admin_users_usage_logs",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.User{}, &model.QuotaLedger{}, &model.UsageLog{})
			},
		},
		{
			version: "20261002_m8_system_settings_user_channels",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.TopupProduct{}, &model.TopupOrder{}, &model.UserChannelEntitlement{}, &model.UserChannel{}, &model.SystemUpdateJob{}, &model.GenerationTask{}, &model.UsageLog{}, &model.AccessEvent{}, &model.IPBlock{})
			},
		},
		{
			version: "20261002_m9_subscriptions_costs_unlocks",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.UserChannelEntitlement{}, &model.SubscriptionPlan{}, &model.SubscriptionPlanQuota{}, &model.UserSubscription{}, &model.SubscriptionUsage{}, &model.CustomChannelUnlockPlan{}, &model.ModelCostPricing{})
			},
		},
		{
			version: "20261002_m10_subscription_task_release",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.GenerationTask{})
			},
		},
		{
			version: "20261002_m11_operation_orders_pricing_snapshots",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.OperationOrder{}, &model.UsageLog{}, &model.ModelCostPricing{})
			},
		},
		{
			version: "20261003_m12_model_quality_specs",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.UpstreamChannelModel{})
			},
		},
		{
			version: "20261003_m13_usage_log_quality_fields",
			apply: func(tx *gorm.DB) error {
				return tx.AutoMigrate(&model.UsageLog{})
			},
		},
		{
			version: "20261003_m14_backfill_usage_logs",
			apply: func(tx *gorm.DB) error {
				var tasks []model.GenerationTask
				if err := tx.Find(&tasks).Error; err != nil {
					return err
				}
				for _, task := range tasks {
					var count int64
					if err := tx.Model(&model.UsageLog{}).Where("task_id = ?", task.ID).Count(&count).Error; err != nil {
						return err
					}
					if count > 0 {
						continue
					}
					startedAt := task.CreatedAt
					if task.StartedAt != nil {
						startedAt = *task.StartedAt
					}
					status := model.UsageLogRunning
					if task.Status == model.GenerationTaskSucceeded {
						status = model.UsageLogSuccess
					} else if task.Status == model.GenerationTaskFailed || task.Status == model.GenerationTaskCancelled {
						status = model.UsageLogFailed
					}
					item := model.UsageLog{
						TaskID: task.ID, UserID: task.UserID, PublishedModelID: task.PublishedModelID,
						Capability: task.Capability, RequestedQuality: migrationRequestedQuality(task),
						BillingUnit: migrationBillingUnit(task.Capability), BilledUnits: migrationBilledUnits(task),
						Status: status, ChargedQuota: task.SettledAmount, StartedAt: startedAt,
						ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage,
						RequestSummaryJSON: migrationTaskSummary(task),
					}
					if task.CompletedAt != nil {
						item.CompletedAt = task.CompletedAt
					}
					if task.Status == model.GenerationTaskSucceeded {
						item.RevenueTotal = task.SettledAmount
						item.ProfitTotal = task.SettledAmount
					}
					if err := tx.Create(&item).Error; err != nil {
						return err
					}
				}
				return nil
			},
		},
	}
	for _, item := range migrations {
		var count int64
		if err := db.Model(&schemaMigration{}).Where("version = ?", item.version).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := item.apply(tx); err != nil {
				return err
			}
			return tx.Create(&schemaMigration{Version: item.version, AppliedAt: time.Now().UTC()}).Error
		}); err != nil {
			return err
		}
	}
	return nil
}

func migrationRequestedQuality(task model.GenerationTask) string {
	if strings.ToLower(strings.TrimSpace(task.Capability)) != "image" {
		return ""
	}
	for _, raw := range []string{task.ParametersJSON, task.PayloadJSON} {
		var value map[string]any
		if json.Unmarshal([]byte(raw), &value) != nil {
			continue
		}
		if quality, ok := value["quality"].(string); ok && strings.TrimSpace(quality) != "" {
			return strings.TrimSpace(quality)
		}
	}
	return ""
}

func migrationBillingUnit(capability string) string {
	switch strings.ToLower(strings.TrimSpace(capability)) {
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

func migrationBilledUnits(task model.GenerationTask) float64 {
	var parameters map[string]any
	_ = json.Unmarshal([]byte(task.ParametersJSON), &parameters)
	switch strings.ToLower(strings.TrimSpace(task.Capability)) {
	case "image":
		if value, ok := parameters["count"].(float64); ok && value > 0 {
			return value
		}
		return 1
	case "video":
		if value, ok := parameters["durationSeconds"].(float64); ok && value > 0 {
			return value
		}
	case "text":
		if value, ok := parameters["totalTokens"].(float64); ok && value > 0 {
			return value
		}
	}
	return 1
}

func migrationTaskSummary(task model.GenerationTask) string {
	var payload, parameters map[string]any
	_ = json.Unmarshal([]byte(task.PayloadJSON), &payload)
	_ = json.Unmarshal([]byte(task.ParametersJSON), &parameters)
	payloadKeys := make([]string, 0, len(payload))
	for key := range payload {
		payloadKeys = append(payloadKeys, key)
	}
	parameterKeys := make([]string, 0, len(parameters))
	for key := range parameters {
		parameterKeys = append(parameterKeys, key)
	}
	encoded, _ := json.Marshal(map[string]any{"payloadKeys": payloadKeys, "parameterKeys": parameterKeys, "payloadBytes": len(task.PayloadJSON)})
	return string(encoded)
}

package store

import (
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

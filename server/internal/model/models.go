package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

const (
	UserStatusActive  = "active"
	UserStatusPending = "pending"
	UserStatusBlocked = "blocked"
	RoleUser          = "user"
	RoleAdmin         = "admin"
)

type User struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	Username        string     `gorm:"size:64;uniqueIndex;not null" json:"username"`
	Email           string     `gorm:"size:255;uniqueIndex;not null" json:"email"`
	DisplayName     string     `gorm:"size:128;index" json:"displayName"`
	Remark          string     `gorm:"size:512" json:"remark"`
	GroupName       string     `gorm:"size:64;index" json:"groupName"`
	InviteCode      string     `gorm:"size:32;uniqueIndex;not null" json:"-"`
	PasswordHash    string     `gorm:"size:255;not null" json:"-"`
	Status          string     `gorm:"size:32;index;not null" json:"status"`
	Role            string     `gorm:"size:32;index;not null" json:"role"`
	EmailVerifiedAt *time.Time `json:"emailVerifiedAt,omitempty"`
	LastLoginAt     *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type QuotaAccount struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"uniqueIndex;not null" json:"userId"`
	Balance   int64     `gorm:"not null;default:0" json:"balance"`
	Reserved  int64     `gorm:"not null;default:0" json:"reserved"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type QuotaLedger struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	UserID              uint      `gorm:"index;not null" json:"userId"`
	Delta               int64     `gorm:"not null" json:"delta"`
	BalanceAfter        int64     `gorm:"not null" json:"balanceAfter"`
	Source              string    `gorm:"size:32;index;not null" json:"source"`
	BusinessType        string    `gorm:"size:64;index;not null" json:"businessType"`
	BusinessID          string    `gorm:"size:128;index;not null" json:"businessId"`
	Reason              string    `gorm:"size:255" json:"reason,omitempty"`
	IdempotencyKey      string    `gorm:"size:191;uniqueIndex;not null" json:"-"`
	PricingSnapshotJSON string    `gorm:"type:text" json:"-"`
	CreatedAt           time.Time `json:"createdAt"`
}

const (
	QuotaReservationOpen     = "open"
	QuotaReservationReleased = "released"
	QuotaReservationSettled  = "settled"
)

// QuotaReservation records the amount held for an in-flight generation task.
// The account's Reserved field is the aggregate of open reservations.
type QuotaReservation struct {
	ID             string    `gorm:"size:36;primaryKey" json:"id"`
	UserID         uint      `gorm:"index;not null" json:"userId"`
	TaskID         string    `gorm:"size:36;uniqueIndex;not null" json:"taskId"`
	Amount         int64     `gorm:"not null" json:"amount"`
	Status         string    `gorm:"size:32;index;not null" json:"status"`
	IdempotencyKey string    `gorm:"size:191;uniqueIndex;not null" json:"-"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type OperationSetting struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Key       string    `gorm:"size:128;uniqueIndex;not null" json:"key"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	Version   int64     `gorm:"not null;default:1" json:"version"`
	UpdatedBy *uint     `gorm:"index" json:"updatedBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type InvitationRelation struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	InviterUserID uint       `gorm:"index;not null" json:"inviterUserId"`
	InviteeUserID uint       `gorm:"uniqueIndex;not null" json:"inviteeUserId"`
	InviteCode    string     `gorm:"size:32;index;not null" json:"inviteCode"`
	BoundAt       time.Time  `json:"boundAt"`
	VerifiedAt    *time.Time `json:"verifiedAt,omitempty"`
	Status        string     `gorm:"size:32;index;not null" json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type InvitationReward struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	RelationID        uint       `gorm:"index;not null" json:"relationId"`
	BeneficiaryUserID uint       `gorm:"index;not null" json:"beneficiaryUserId"`
	RewardType        string     `gorm:"size:32;index;not null" json:"rewardType"`
	QuotaAmount       int64      `gorm:"not null" json:"quotaAmount"`
	ConfigVersion     int64      `gorm:"not null" json:"configVersion"`
	Status            string     `gorm:"size:32;index;not null" json:"status"`
	IdempotencyKey    string     `gorm:"size:191;uniqueIndex;not null" json:"-"`
	CreditedAt        *time.Time `json:"creditedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
}

const (
	TopupProductActive       = "active"
	TopupProductHidden       = "hidden"
	TopupOrderPendingPayment = "pending_payment"
	TopupOrderPaid           = "paid"
	TopupOrderQuotaCredited  = "quota_credited"
	TopupOrderExpired        = "expired"
)

type TopupProduct struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	Name                 string    `gorm:"size:128;not null" json:"name"`
	PayAmountFen         int64     `gorm:"not null" json:"payAmountFen"`
	QuotaAmount          int64     `gorm:"not null" json:"quotaAmount"`
	GiftQuota            int64     `gorm:"not null;default:0" json:"giftQuota"`
	CustomChannelEnabled bool      `gorm:"not null;default:false" json:"customChannelEnabled"`
	CustomChannelLimit   int       `gorm:"not null;default:0" json:"customChannelLimit"`
	CustomChannelDays    int       `gorm:"not null;default:0" json:"customChannelDays"`
	Status               string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder            int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type TopupOrder struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	UserID          uint       `gorm:"index;not null" json:"userId"`
	ProductID       uint       `gorm:"index;not null" json:"productId"`
	OrderNo         string     `gorm:"size:64;uniqueIndex;not null" json:"orderNo"`
	IdempotencyKey  string     `gorm:"size:191;uniqueIndex;not null" json:"-"`
	PaymentProvider string     `gorm:"size:32;index;not null" json:"paymentProvider"`
	PaymentMethod   string     `gorm:"size:32;not null" json:"paymentMethod"`
	PayAmountFen    int64      `gorm:"not null" json:"payAmountFen"`
	QuotaAmount     int64      `gorm:"not null" json:"quotaAmount"`
	GiftQuota       int64      `gorm:"not null;default:0" json:"giftQuota"`
	Status          string     `gorm:"size:32;index;not null" json:"status"`
	ProviderTradeNo string     `gorm:"size:128;index" json:"providerTradeNo,omitempty"`
	ExpiresAt       time.Time  `gorm:"index;not null" json:"expiresAt"`
	PaidAt          *time.Time `json:"paidAt,omitempty"`
	CreditedAt      *time.Time `json:"creditedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

const (
	OperationOrderProcessing           = "processing"
	OperationOrderSucceeded            = "succeeded"
	OperationOrderFailed               = "failed"
	OperationOrderSubscriptionPurchase = "subscription_purchase"
	OperationOrderChannelUnlock        = "channel_unlock"
)

// OperationOrder makes balance-backed purchases replay-safe. ResultJSON stores
// the original response so retries do not repeat the mutation.
type OperationOrder struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserID         uint      `gorm:"uniqueIndex:ux_operation_order_user_type_key;not null" json:"userId"`
	OrderNo        string    `gorm:"size:64;uniqueIndex;not null" json:"orderNo"`
	IdempotencyKey string    `gorm:"size:191;uniqueIndex:ux_operation_order_user_type_key;not null" json:"-"`
	Type           string    `gorm:"size:64;uniqueIndex:ux_operation_order_user_type_key;not null" json:"type"`
	ProductID      uint      `gorm:"index;not null" json:"productId"`
	Amount         int64     `gorm:"not null;default:0" json:"amount"`
	Status         string    `gorm:"size:32;index;not null" json:"status"`
	ResultJSON     string    `gorm:"type:text" json:"-"`
	ErrorCode      string    `gorm:"size:64" json:"errorCode,omitempty"`
	ErrorMessage   string    `gorm:"type:text" json:"errorMessage,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type UserChannelEntitlement struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	UserID        uint       `gorm:"index;not null" json:"userId"`
	SourceOrderID *uint      `gorm:"index" json:"sourceOrderId,omitempty"`
	Source        string     `gorm:"size:32;index;not null;default:topup" json:"source"`
	UnlockPlanID  *uint      `gorm:"index" json:"unlockPlanId,omitempty"`
	UnlockCost    int64      `gorm:"not null;default:0" json:"unlockCost"`
	ChannelLimit  int        `gorm:"not null;default:0" json:"channelLimit"`
	ExpiresAt     *time.Time `gorm:"index" json:"expiresAt,omitempty"`
	Status        string     `gorm:"size:32;index;not null" json:"status"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

const (
	SubscriptionPlanActive = "active"
	SubscriptionPlanHidden = "hidden"
	SubscriptionDaily      = "daily"
	SubscriptionWeekly     = "weekly"
	SubscriptionMonthly    = "monthly"
	SubscriptionQuarterly  = "quarterly"
	SubscriptionYearly     = "yearly"
	SubscriptionActive     = "active"
	SubscriptionExpired    = "expired"
	SubscriptionCancelled  = "cancelled"
)

type SubscriptionPlan struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:128;not null" json:"name"`
	Cycle        string    `gorm:"size:32;index;not null" json:"cycle"`
	PriceQuota   int64     `gorm:"not null" json:"priceQuota"`
	DurationDays int       `gorm:"not null" json:"durationDays"`
	Status       string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder    int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type SubscriptionPlanQuota struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	PlanID           uint      `gorm:"uniqueIndex:ux_subscription_plan_model;not null" json:"planId"`
	PublishedModelID uint      `gorm:"uniqueIndex:ux_subscription_plan_model;not null" json:"publishedModelId"`
	ImageCount       int64     `gorm:"not null;default:0" json:"imageCount"`
	VideoSeconds     int64     `gorm:"not null;default:0" json:"videoSeconds"`
	TextTokens       int64     `gorm:"not null;default:0" json:"textTokens"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type UserSubscription struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"userId"`
	PlanID    uint      `gorm:"index;not null" json:"planId"`
	Status    string    `gorm:"size:32;index;not null" json:"status"`
	StartsAt  time.Time `gorm:"index;not null" json:"startsAt"`
	ExpiresAt time.Time `gorm:"index;not null" json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SubscriptionUsage struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	SubscriptionID   uint      `gorm:"uniqueIndex:ux_subscription_usage_model;not null" json:"subscriptionId"`
	UserID           uint      `gorm:"index;not null" json:"userId"`
	PublishedModelID uint      `gorm:"uniqueIndex:ux_subscription_usage_model;not null" json:"publishedModelId"`
	BillingUnit      string    `gorm:"size:32;not null" json:"billingUnit"`
	UsedUnits        int64     `gorm:"not null;default:0" json:"usedUnits"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type CustomChannelUnlockPlan struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:128;not null" json:"name"`
	PriceQuota   int64     `gorm:"not null" json:"priceQuota"`
	DurationDays int       `gorm:"not null;default:30" json:"durationDays"`
	ChannelLimit int       `gorm:"not null;default:1" json:"channelLimit"`
	Status       string    `gorm:"size:32;index;not null" json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ModelCostPricing struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	PublishedModelID uint      `gorm:"uniqueIndex:ux_model_cost_pricing;not null" json:"publishedModelId"`
	ChannelID        uint      `gorm:"uniqueIndex:ux_model_cost_pricing;not null" json:"channelId"`
	UpstreamModel    string    `gorm:"uniqueIndex:ux_model_cost_pricing;size:128;not null" json:"upstreamModel"`
	BillingUnit      string    `gorm:"size:32;not null" json:"billingUnit"`
	CostPerUnit      int64     `gorm:"not null" json:"costPerUnit"`
	SellPerUnit      int64     `gorm:"not null" json:"sellPerUnit"`
	ProfitMargin     float64   `gorm:"not null;default:0" json:"profitMargin"`
	Status           string    `gorm:"uniqueIndex:ux_model_cost_pricing;size:32;index;not null" json:"status"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

const (
	UserChannelActive = "active"
	UserChannelHidden = "hidden"
)

type UserChannel struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	UserID       uint       `gorm:"index;not null" json:"userId"`
	Name         string     `gorm:"size:128;not null" json:"name"`
	Provider     string     `gorm:"size:64;not null" json:"provider"`
	BaseURL      string     `gorm:"size:512;not null" json:"baseUrl"`
	APIKeyCipher string     `gorm:"size:2048;not null" json:"-"`
	ModelsJSON   string     `gorm:"type:text;not null" json:"-"`
	Status       string     `gorm:"size:32;index;not null" json:"status"`
	LastTestedAt *time.Time `json:"lastTestedAt,omitempty"`
	LastError    string     `gorm:"size:512" json:"lastError,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type PaymentEvent struct {
	ID              string     `gorm:"size:36;primaryKey" json:"id"`
	Provider        string     `gorm:"size:32;uniqueIndex:ux_payment_event;not null" json:"provider"`
	ProviderEventID string     `gorm:"size:191;uniqueIndex:ux_payment_event;not null" json:"providerEventId"`
	OrderID         uint       `gorm:"index;not null" json:"orderId"`
	PayloadJSON     string     `gorm:"type:text;not null" json:"-"`
	VerifyState     string     `gorm:"size:32;index;not null" json:"verifyState"`
	ProcessedAt     *time.Time `json:"processedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
}

const (
	PublishedModelActive = "active"
	PublishedModelHidden = "hidden"
)

type PublishedModel struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	Capability       string    `gorm:"size:32;index;not null" json:"capability"`
	SourceModel      string    `gorm:"size:128;index" json:"sourceModel"`
	DisplayName      string    `gorm:"size:128;not null" json:"displayName"`
	PublicConfigJSON string    `gorm:"type:text;not null" json:"-"`
	Status           string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder        int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

const (
	UpstreamChannelActive = "active"
	UpstreamChannelHidden = "hidden"
	ChannelModelActive    = "active"
	ChannelModelHidden    = "hidden"
	ModelRouteActive      = "active"
	ModelRouteHidden      = "hidden"
)

// UpstreamChannel stores the shared connection settings for administrator-managed relay traffic.
// Model-specific credentials live in UpstreamChannelKey and are never serialized to clients.
type UpstreamChannel struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:128;not null" json:"name"`
	Provider     string    `gorm:"size:64;index;not null" json:"provider"`
	BaseURL      string    `gorm:"size:512;not null" json:"baseUrl"`
	APIKey       string    `gorm:"size:512;not null;default:''" json:"-"`
	SettingsJSON string    `gorm:"type:text;not null" json:"-"`
	Status       string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder    int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type UpstreamChannelKey struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ChannelID uint      `gorm:"index;not null" json:"channelId"`
	Name      string    `gorm:"size:128;not null" json:"name"`
	APIKey    string    `gorm:"size:512;not null" json:"-"`
	SortOrder int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UpstreamChannelModel struct {
	ID              uint      `gorm:"primaryKey" json:"id"`
	ChannelID       uint      `gorm:"uniqueIndex:ux_channel_model;not null" json:"channelId"`
	ChannelKeyID    *uint     `gorm:"index" json:"channelKeyId,omitempty"`
	Name            string    `gorm:"uniqueIndex:ux_channel_model;size:128;not null" json:"name"`
	Capability      string    `gorm:"size:32;index;not null" json:"capability"`
	Script          string    `gorm:"type:text;not null" json:"-"`
	QualitySpecJSON string    `gorm:"type:text" json:"-"`
	Status          string    `gorm:"size:32;index;not null;default:active" json:"status"`
	SortOrder       int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type ModelRoute struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	PublishedModelID uint      `gorm:"uniqueIndex:ux_model_route;not null" json:"publishedModelId"`
	ChannelID        uint      `gorm:"uniqueIndex:ux_model_route;not null" json:"channelId"`
	UpstreamModel    string    `gorm:"uniqueIndex:ux_model_route;size:128;not null" json:"upstreamModel"`
	Priority         int       `gorm:"index;not null;default:0" json:"priority"`
	Weight           int       `gorm:"not null;default:100" json:"weight"`
	Status           string    `gorm:"size:32;index;not null" json:"status"`
	SettingsJSON     string    `gorm:"type:text;not null" json:"-"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

const (
	PricingVersionDraft   = "draft"
	PricingVersionActive  = "active"
	PricingVersionRetired = "retired"
	QuoteStatusIssued     = "issued"
	QuoteStatusConsumed   = "consumed"
	QuoteStatusExpired    = "expired"
)

type PricingVersion struct {
	ID               uint       `gorm:"primaryKey" json:"id"`
	PublishedModelID uint       `gorm:"index;not null" json:"publishedModelId"`
	Version          int64      `gorm:"not null" json:"version"`
	FormulaJSON      string     `gorm:"type:text;not null" json:"-"`
	Currency         string     `gorm:"size:16;not null" json:"currency"`
	Status           string     `gorm:"size:32;index;not null" json:"status"`
	EffectiveAt      time.Time  `gorm:"index;not null" json:"effectiveAt"`
	RetiredAt        *time.Time `gorm:"index" json:"retiredAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type Quote struct {
	ID               string    `gorm:"size:36;primaryKey" json:"id"`
	UserID           uint      `gorm:"index;not null" json:"userId"`
	PublishedModelID uint      `gorm:"index;not null" json:"publishedModelId"`
	PricingVersionID uint      `gorm:"index;not null" json:"pricingVersionId"`
	Capability       string    `gorm:"size:32;not null" json:"capability"`
	ParametersJSON   string    `gorm:"type:text;not null" json:"-"`
	ParameterDigest  string    `gorm:"size:64;not null" json:"-"`
	Count            int       `gorm:"not null" json:"count"`
	Amount           int64     `gorm:"not null" json:"amount"`
	Currency         string    `gorm:"size:16;not null" json:"currency"`
	Status           string    `gorm:"size:32;index;not null" json:"status"`
	ExpiresAt        time.Time `gorm:"index;not null" json:"expiresAt"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

const (
	GenerationTaskQueued    = "queued"
	GenerationTaskRunning   = "running"
	GenerationTaskSucceeded = "succeeded"
	GenerationTaskFailed    = "failed"
	GenerationTaskCancelled = "cancelled"
)

const (
	UsageLogRunning = "running"
	UsageLogSuccess = "succeeded"
	UsageLogFailed  = "failed"
)

type GenerationTask struct {
	ID                  string     `gorm:"size:36;primaryKey" json:"id"`
	UserID              uint       `gorm:"index;not null" json:"userId"`
	QuoteID             string     `gorm:"size:36;index;not null" json:"quoteId"`
	PublishedModelID    uint       `gorm:"index;not null" json:"publishedModelId"`
	Capability          string     `gorm:"size:32;index;not null" json:"capability"`
	UserChannelID       *uint      `gorm:"index" json:"userChannelId,omitempty"`
	UserChannelModel    string     `gorm:"size:128" json:"userChannelModel,omitempty"`
	ParametersJSON      string     `gorm:"type:text;not null" json:"-"`
	PayloadJSON         string     `gorm:"type:text;not null" json:"-"`
	Status              string     `gorm:"size:32;index;not null" json:"status"`
	ReservedAmount      int64      `gorm:"not null" json:"reservedAmount"`
	SettledAmount       int64      `gorm:"not null;default:0" json:"settledAmount"`
	SubscriptionUnit    string     `gorm:"size:32" json:"subscriptionUnit,omitempty"`
	SubscriptionUnits   int64      `gorm:"not null;default:0" json:"subscriptionUnits"`
	SubscriptionCovered bool       `gorm:"not null;default:false" json:"subscriptionCovered"`
	SubscriptionID      *uint      `gorm:"index" json:"-"`
	OutputJSON          string     `gorm:"type:text" json:"-"`
	ErrorCode           string     `gorm:"size:64" json:"errorCode,omitempty"`
	ErrorMessage        string     `gorm:"type:text" json:"errorMessage,omitempty"`
	IdempotencyKey      string     `gorm:"size:191;uniqueIndex;not null" json:"-"`
	StartedAt           *time.Time `json:"startedAt,omitempty"`
	CompletedAt         *time.Time `json:"completedAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

// UsageLog stores a redacted, queryable record for each relay execution.
// Request/response summaries never contain credentials or binary payloads.
type UsageLog struct {
	ID                  uint       `gorm:"primaryKey" json:"id"`
	TaskID              string     `gorm:"size:36;index;not null" json:"taskId"`
	RequestID           string     `gorm:"size:128;index" json:"requestId"`
	UserID              uint       `gorm:"index;not null" json:"userId"`
	PublishedModelID    uint       `gorm:"index" json:"publishedModelId"`
	PublishedModel      string     `gorm:"size:128;index" json:"publishedModel"`
	Capability          string     `gorm:"size:32;index" json:"capability"`
	ChannelID           uint       `gorm:"index" json:"channelId"`
	ChannelName         string     `gorm:"size:128;index" json:"channelName"`
	Provider            string     `gorm:"size:64;index" json:"provider"`
	UpstreamModel       string     `gorm:"size:128;index" json:"upstreamModel"`
	RequestType         string     `gorm:"size:32;index" json:"requestType"`
	ReasoningEffort     string     `gorm:"size:32" json:"reasoningEffort,omitempty"`
	RequestedQuality    string     `gorm:"size:32" json:"requestedQuality,omitempty"`
	ActualQuality       string     `gorm:"size:32" json:"actualQuality,omitempty"`
	BillingUnit         string     `gorm:"size:32;index" json:"billingUnit"`
	BilledUnits         float64    `json:"billedUnits"`
	Status              string     `gorm:"size:32;index;not null" json:"status"`
	DurationMs          int64      `json:"durationMs"`
	InputTokens         int64      `json:"inputTokens"`
	OutputTokens        int64      `json:"outputTokens"`
	CachedTokens        int64      `json:"cachedTokens"`
	TotalTokens         int64      `json:"totalTokens"`
	ChargedQuota        int64      `json:"chargedQuota"`
	CostQuota           int64      `json:"costQuota"`
	ProfitQuota         int64      `json:"profitQuota"`
	CostPricingID       uint       `gorm:"index" json:"costPricingId"`
	CostPerUnit         int64      `json:"costPerUnit"`
	SellPerUnit         int64      `json:"sellPerUnit"`
	CostTotal           int64      `json:"costTotal"`
	RevenueTotal        int64      `json:"revenueTotal"`
	ProfitTotal         int64      `json:"profitTotal"`
	IP                  string     `gorm:"size:64;index" json:"ip,omitempty"`
	RetryCount          int        `json:"retryCount"`
	ErrorCode           string     `gorm:"size:64;index" json:"errorCode,omitempty"`
	ErrorMessage        string     `gorm:"size:1000" json:"errorMessage,omitempty"`
	RequestSummaryJSON  string     `gorm:"type:text" json:"-"`
	ResponseSummaryJSON string     `gorm:"type:text" json:"-"`
	StartedAt           time.Time  `gorm:"index;not null" json:"startedAt"`
	CompletedAt         *time.Time `gorm:"index" json:"completedAt,omitempty"`
	CreatedAt           time.Time  `gorm:"index" json:"createdAt"`
}

type Session struct {
	ID                string     `gorm:"size:36;primaryKey" json:"id"`
	UserID            uint       `gorm:"index;not null" json:"userId"`
	TokenHash         string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	ExpiresAt         time.Time  `gorm:"index;not null" json:"expiresAt"`
	AbsoluteExpiresAt time.Time  `gorm:"index;not null" json:"absoluteExpiresAt"`
	RevokedAt         *time.Time `gorm:"index" json:"-"`
	IP                string     `gorm:"size:64" json:"-"`
	UserAgent         string     `gorm:"size:512" json:"-"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type EmailVerificationToken struct {
	ID        string     `gorm:"size:36;primaryKey" json:"id"`
	UserID    uint       `gorm:"index;not null" json:"userId"`
	TokenHash string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	Code      string     `gorm:"size:6;index" json:"-"`
	ExpiresAt time.Time  `gorm:"index;not null" json:"expiresAt"`
	UsedAt    *time.Time `gorm:"index" json:"usedAt"`
	CreatedAt time.Time  `json:"createdAt"`
}

type RegistrationCode struct {
	ID        string     `gorm:"size:36;primaryKey" json:"id"`
	Email     string     `gorm:"size:255;index;not null" json:"email"`
	Code      string     `gorm:"size:6;index;not null" json:"-"`
	ExpiresAt time.Time  `gorm:"index;not null" json:"expiresAt"`
	UsedAt    *time.Time `gorm:"index" json:"usedAt"`
	CreatedAt time.Time  `json:"createdAt"`
}

type PasswordResetToken struct {
	ID        string     `gorm:"size:36;primaryKey" json:"id"`
	UserID    uint       `gorm:"index;not null" json:"userId"`
	TokenHash string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time  `gorm:"index;not null" json:"expiresAt"`
	UsedAt    *time.Time `gorm:"index" json:"usedAt"`
	CreatedAt time.Time  `json:"createdAt"`
}

type AuditLog struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	OperatorID   *uint     `gorm:"index" json:"operatorId,omitempty"`
	Action       string    `gorm:"size:128;index;not null" json:"action"`
	ResourceType string    `gorm:"size:64;index" json:"resourceType"`
	ResourceID   string    `gorm:"size:128;index" json:"resourceId"`
	RequestID    string    `gorm:"size:128;index" json:"requestId"`
	CreatedAt    time.Time `json:"createdAt"`
}

type SystemUpdateJob struct {
	ID            string     `gorm:"size:36;primaryKey" json:"id"`
	TargetVersion string     `gorm:"size:32;index;not null" json:"targetVersion"`
	Source        string     `gorm:"size:64;not null" json:"source"`
	Status        string     `gorm:"size:32;index;not null" json:"status"`
	ErrorMessage  string     `gorm:"size:1000" json:"errorMessage,omitempty"`
	RequestedBy   uint       `gorm:"index;not null" json:"requestedBy"`
	CreatedAt     time.Time  `json:"createdAt"`
	StartedAt     *time.Time `json:"startedAt,omitempty"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
}

type AccessEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    *uint     `gorm:"index" json:"userId,omitempty"`
	EventType string    `gorm:"size:64;index;not null" json:"eventType"`
	IP        string    `gorm:"size:64;index" json:"ip"`
	UserAgent string    `gorm:"size:512" json:"userAgent,omitempty"`
	Success   bool      `gorm:"not null;default:true" json:"success"`
	Detail    string    `gorm:"size:512" json:"detail,omitempty"`
	CreatedAt time.Time `gorm:"index" json:"createdAt"`
}

type IPBlock struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Value     string    `gorm:"size:128;uniqueIndex;not null" json:"value"`
	Reason    string    `gorm:"size:256" json:"reason,omitempty"`
	Status    string    `gorm:"size:32;index;not null" json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const (
	IPBlockActive = "active"
	IPBlockHidden = "hidden"
)

// RecordAudit appends an administrator audit entry. It runs on the caller's
// transaction so the trail and the change it describes commit together.
func RecordAudit(tx *gorm.DB, operatorID uint, action, resourceType string, resourceID any) error {
	return tx.Create(&AuditLog{OperatorID: &operatorID, Action: action, ResourceType: resourceType, ResourceID: fmt.Sprint(resourceID)}).Error
}

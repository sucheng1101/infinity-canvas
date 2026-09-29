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
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:128;not null" json:"name"`
	PayAmountFen int64     `gorm:"not null" json:"payAmountFen"`
	QuotaAmount  int64     `gorm:"not null" json:"quotaAmount"`
	GiftQuota    int64     `gorm:"not null;default:0" json:"giftQuota"`
	Status       string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder    int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
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
	ModelRouteActive      = "active"
	ModelRouteHidden      = "hidden"
)

// UpstreamChannel stores provider credentials for administrator-managed relay traffic.
// APIKey is intentionally excluded from JSON responses and is only read by server-side relay code.
type UpstreamChannel struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Name         string    `gorm:"size:128;not null" json:"name"`
	Provider     string    `gorm:"size:64;index;not null" json:"provider"`
	BaseURL      string    `gorm:"size:512;not null" json:"baseUrl"`
	APIKey       string    `gorm:"size:512;not null" json:"-"`
	SettingsJSON string    `gorm:"type:text;not null" json:"-"`
	Status       string    `gorm:"size:32;index;not null" json:"status"`
	SortOrder    int       `gorm:"not null;default:0" json:"sortOrder"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ModelRoute struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	PublishedModelID uint      `gorm:"uniqueIndex:ux_model_route;not null" json:"publishedModelId"`
	ChannelID        uint      `gorm:"uniqueIndex:ux_model_route;not null" json:"channelId"`
	UpstreamModel    string    `gorm:"uniqueIndex:ux_model_route;size:128;not null" json:"upstreamModel"`
	Priority         int       `gorm:"index;not null;default:0" json:"priority"`
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

type GenerationTask struct {
	ID               string     `gorm:"size:36;primaryKey" json:"id"`
	UserID           uint       `gorm:"index;not null" json:"userId"`
	QuoteID          string     `gorm:"size:36;index;not null" json:"quoteId"`
	PublishedModelID uint       `gorm:"index;not null" json:"publishedModelId"`
	Capability       string     `gorm:"size:32;index;not null" json:"capability"`
	ParametersJSON   string     `gorm:"type:text;not null" json:"-"`
	PayloadJSON      string     `gorm:"type:text;not null" json:"-"`
	Status           string     `gorm:"size:32;index;not null" json:"status"`
	ReservedAmount   int64      `gorm:"not null" json:"reservedAmount"`
	SettledAmount    int64      `gorm:"not null;default:0" json:"settledAmount"`
	OutputJSON       string     `gorm:"type:text" json:"-"`
	ErrorCode        string     `gorm:"size:64" json:"errorCode,omitempty"`
	ErrorMessage     string     `gorm:"type:text" json:"errorMessage,omitempty"`
	IdempotencyKey   string     `gorm:"size:191;uniqueIndex;not null" json:"-"`
	StartedAt        *time.Time `json:"startedAt,omitempty"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
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

// RecordAudit appends an administrator audit entry. It runs on the caller's
// transaction so the trail and the change it describes commit together.
func RecordAudit(tx *gorm.DB, operatorID uint, action, resourceType string, resourceID any) error {
	return tx.Create(&AuditLog{OperatorID: &operatorID, Action: action, ResourceType: resourceType, ResourceID: fmt.Sprint(resourceID)}).Error
}

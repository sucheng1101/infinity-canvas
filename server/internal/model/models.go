package model

import "time"

const (
	UserStatusActive  = "active"
	UserStatusPending = "pending"
	UserStatusBlocked = "blocked"
	RoleUser           = "user"
	RoleAdmin          = "admin"
)

type User struct {
	ID                uint       `gorm:"primaryKey" json:"id"`
	Email             string     `gorm:"size:255;uniqueIndex;not null" json:"email"`
	PasswordHash      string     `gorm:"size:255;not null" json:"-"`
	Status            string     `gorm:"size:32;index;not null" json:"status"`
	Role              string     `gorm:"size:32;index;not null" json:"role"`
	EmailVerifiedAt   *time.Time `json:"emailVerifiedAt,omitempty"`
	LastLoginAt       *time.Time `json:"lastLoginAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type Session struct {
	ID                string     `gorm:"size:36;primaryKey" json:"id"`
	UserID            uint       `gorm:"index;not null" json:"userId"`
	TokenHash         string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
	ExpiresAt         time.Time  `gorm:"index;not null" json:"expiresAt"`
	AbsoluteExpiresAt time.Time `gorm:"index;not null" json:"absoluteExpiresAt"`
	RevokedAt         *time.Time `gorm:"index" json:"-"`
	IP                string     `gorm:"size:64" json:"-"`
	UserAgent         string     `gorm:"size:512" json:"-"`
	CreatedAt         time.Time  `json:"createdAt"`
}

type EmailVerificationToken struct {
	ID        string     `gorm:"size:36;primaryKey" json:"id"`
	UserID    uint       `gorm:"index;not null" json:"userId"`
	TokenHash string     `gorm:"size:64;uniqueIndex;not null" json:"-"`
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

package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrEmailNotVerified   = errors.New("email not verified")
	ErrTokenInvalid       = errors.New("token invalid")
	ErrUserBlocked        = errors.New("user blocked")
)

type Service struct {
	DB  *gorm.DB
	Cfg config.Config
}

type Registration struct {
	User             model.User
	VerificationToken string
}

func (s *Service) Register(email, password string) (Registration, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	address, parseErr := mail.ParseAddress(email)
	if parseErr != nil || address.Address != email || len(password) < 8 || len(password) > 72 {
		return Registration{}, ErrInvalidCredentials
	}
	var existing model.User
	if err := s.DB.Where("email = ?", email).First(&existing).Error; err == nil {
		return Registration{}, gorm.ErrDuplicatedKey
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return Registration{}, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Registration{}, err
	}
	user := model.User{Email: email, PasswordHash: string(hash), Status: model.UserStatusPending, Role: model.RoleUser}
	token, tokenHash, err := newToken()
	if err != nil {
		return Registration{}, err
	}
	now := time.Now().UTC()
	verification := model.EmailVerificationToken{ID: uuid.NewString(), TokenHash: tokenHash, ExpiresAt: now.Add(s.Cfg.VerificationTTL)}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		verification.UserID = user.ID
		return tx.Create(&verification).Error
	})
	if err != nil {
		return Registration{}, err
	}
	return Registration{User: user, VerificationToken: token}, nil
}

func (s *Service) VerifyEmail(token string) (model.User, bool, error) {
	var verification model.EmailVerificationToken
	if err := s.DB.Where("token_hash = ?", hashToken(token)).First(&verification).Error; err != nil {
		return model.User{}, false, ErrTokenInvalid
	}
	if time.Now().UTC().After(verification.ExpiresAt) {
		return model.User{}, false, ErrTokenInvalid
	}
	if verification.UsedAt != nil {
		var user model.User
		if err := s.DB.First(&user, verification.UserID).Error; err != nil || user.EmailVerifiedAt == nil {
			return model.User{}, false, ErrTokenInvalid
		}
		return user, false, nil
	}
	var user model.User
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		result := tx.Model(&model.EmailVerificationToken{}).
			Where("id = ? AND used_at IS NULL AND expires_at > ?", verification.ID, now).
			Update("used_at", &now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTokenInvalid
		}
		if err := tx.First(&user, verification.UserID).Error; err != nil {
			return err
		}
		user.Status = model.UserStatusActive
		user.EmailVerifiedAt = &now
		return tx.Save(&user).Error
	})
	return user, err == nil, err
}

func (s *Service) Login(email, password, ip, userAgent string) (model.User, string, error) {
	var user model.User
	if err := s.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(email))).First(&user).Error; err != nil {
		return model.User{}, "", ErrInvalidCredentials
	}
	if user.Status == model.UserStatusBlocked {
		return model.User{}, "", ErrUserBlocked
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return model.User{}, "", ErrInvalidCredentials
	}
	if user.EmailVerifiedAt == nil {
		return model.User{}, "", ErrEmailNotVerified
	}
	raw, session, err := s.newSession(user.ID, ip, userAgent)
	if err != nil {
		return model.User{}, "", err
	}
	now := time.Now().UTC()
	user.LastLoginAt = &now
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&session).Error; err != nil {
			return err
		}
		return tx.Save(&user).Error
	})
	return user, raw, err
}

func (s *Service) CreateSession(userID uint, ip, userAgent string) (string, error) {
	raw, session, err := s.newSession(userID, ip, userAgent)
	if err != nil {
		return "", err
	}
	return raw, s.DB.Create(&session).Error
}

func (s *Service) newSession(userID uint, ip, userAgent string) (string, model.Session, error) {
	raw, tokenHash, err := newToken()
	if err != nil {
		return "", model.Session{}, err
	}
	now := time.Now().UTC()
	absoluteExpiry := now.Add(s.Cfg.SessionMaxTTL)
	expiresAt := now.Add(s.Cfg.SessionTTL)
	if expiresAt.After(absoluteExpiry) {
		expiresAt = absoluteExpiry
	}
	return raw, model.Session{ID: uuid.NewString(), UserID: userID, TokenHash: tokenHash, ExpiresAt: expiresAt, AbsoluteExpiresAt: absoluteExpiry, IP: ip, UserAgent: userAgent}, nil
}

func (s *Service) IssueVerification(email string) (model.User, string, error) {
	var user model.User
	if err := s.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(email))).First(&user).Error; err != nil {
		return model.User{}, "", nil
	}
	if user.EmailVerifiedAt != nil {
		return model.User{}, "", nil
	}
	raw, tokenHash, err := newToken()
	if err != nil {
		return model.User{}, "", err
	}
	now := time.Now().UTC()
	token := model.EmailVerificationToken{ID: uuid.NewString(), UserID: user.ID, TokenHash: tokenHash, ExpiresAt: now.Add(s.Cfg.VerificationTTL)}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.EmailVerificationToken{}).Where("user_id = ? AND used_at IS NULL", user.ID).Update("used_at", &now).Error; err != nil {
			return err
		}
		return tx.Create(&token).Error
	})
	return user, raw, err
}

func (s *Service) UserBySession(raw string) (model.User, model.Session, error) {
	var session model.Session
	if err := s.DB.Where("token_hash = ? AND revoked_at IS NULL", hashToken(raw)).First(&session).Error; err != nil {
		return model.User{}, model.Session{}, ErrTokenInvalid
	}
	now := time.Now().UTC()
	if now.After(session.ExpiresAt) || now.After(session.AbsoluteExpiresAt) {
		return model.User{}, model.Session{}, ErrTokenInvalid
	}
	if session.ExpiresAt.Before(session.AbsoluteExpiresAt) && time.Until(session.ExpiresAt) < s.Cfg.SessionTTL/2 {
		newExpiry := time.Now().UTC().Add(s.Cfg.SessionTTL)
		if newExpiry.After(session.AbsoluteExpiresAt) {
			newExpiry = session.AbsoluteExpiresAt
		}
		_ = s.DB.Model(&model.Session{}).Where("id = ?", session.ID).Update("expires_at", newExpiry).Error
		session.ExpiresAt = newExpiry
	}
	var user model.User
	if err := s.DB.First(&user, session.UserID).Error; err != nil {
		return model.User{}, model.Session{}, ErrTokenInvalid
	}
	if user.Status == model.UserStatusBlocked {
		return model.User{}, model.Session{}, ErrUserBlocked
	}
	return user, session, nil
}

func EnsureAdmin(db *gorm.DB, cfg config.Config) error {
	if cfg.AdminEmail == "" && cfg.AdminPassword == "" {
		return nil
	}
	if cfg.AdminEmail == "" || cfg.AdminPassword == "" {
		return errors.New("ADMIN_EMAIL and ADMIN_PASSWORD must be configured together")
	}
	email := strings.ToLower(strings.TrimSpace(cfg.AdminEmail))
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(cfg.AdminPassword) < 8 || len(cfg.AdminPassword) > 72 {
		return errors.New("invalid administrator bootstrap credentials")
	}
	var user model.User
	err = db.Where("email = ?", email).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		hash, hashErr := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
		if hashErr != nil {
			return hashErr
		}
		now := time.Now().UTC()
		return db.Transaction(func(tx *gorm.DB) error {
			created := model.User{Email: email, PasswordHash: string(hash), Status: model.UserStatusActive, Role: model.RoleAdmin, EmailVerifiedAt: &now}
			if err := tx.Create(&created).Error; err != nil {
				return err
			}
			return tx.Create(&model.AuditLog{OperatorID: &created.ID, Action: "admin.bootstrap", ResourceType: "user", ResourceID: fmt.Sprint(created.ID)}).Error
		})
	}
	if err != nil {
		return err
	}
	if user.Role != model.RoleAdmin {
		return errors.New("ADMIN_EMAIL belongs to a non-admin user")
	}
	return nil
}

func (s *Service) Logout(raw string) error {
	now := time.Now().UTC()
	return s.DB.Model(&model.Session{}).Where("token_hash = ? AND revoked_at IS NULL", hashToken(raw)).Update("revoked_at", &now).Error
}

func (s *Service) ForgotPassword(email string) (string, error) {
	var user model.User
	if err := s.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(email))).First(&user).Error; err != nil {
		return "", nil
	}
	raw, tokenHash, err := newToken()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	token := model.PasswordResetToken{ID: uuid.NewString(), UserID: user.ID, TokenHash: tokenHash, ExpiresAt: now.Add(s.Cfg.PasswordResetTTL)}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.PasswordResetToken{}).Where("user_id = ? AND used_at IS NULL", user.ID).Update("used_at", &now).Error; err != nil {
			return err
		}
		return tx.Create(&token).Error
	})
	return raw, err
}

func (s *Service) ResetPassword(token, password string) error {
	if len(password) < 8 {
		return ErrInvalidCredentials
	}
	var reset model.PasswordResetToken
	if err := s.DB.Where("token_hash = ? AND used_at IS NULL", hashToken(token)).First(&reset).Error; err != nil {
		return ErrTokenInvalid
	}
	if time.Now().UTC().After(reset.ExpiresAt) {
		return ErrTokenInvalid
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return s.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.PasswordResetToken{}).
			Where("id = ? AND used_at IS NULL AND expires_at > ?", reset.ID, now).
			Update("used_at", &now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTokenInvalid
		}
		if err := tx.Model(&model.User{}).Where("id = ?", reset.UserID).Update("password_hash", string(hash)).Error; err != nil {
			return err
		}
		return tx.Model(&model.Session{}).Where("user_id = ? AND revoked_at IS NULL", reset.UserID).Update("revoked_at", &now).Error
	})
}

func newToken() (string, string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(bytes)
	return raw, hashToken(raw), nil
}

func hashToken(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

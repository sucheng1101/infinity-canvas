// Package storageadmin exposes administrator-managed storage providers and the
// per-user choice among the enabled ones.
package storageadmin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/secret"
	"github.com/sucheng1101/infinity-canvas/server/internal/storage"
	"gorm.io/gorm"
)

var (
	ErrNotFound      = errors.New("storage provider not found")
	ErrInvalid       = errors.New("storage provider is invalid")
	ErrLastProvider  = errors.New("at least one enabled provider must remain")
	ErrNotAvailable  = errors.New("storage provider is not available")
	ErrDeleteInvalid = errors.New("storage provider cannot be deleted")
)

type Service struct {
	DB       *gorm.DB
	Cfg      config.Config
	Registry *storage.Registry
}

// Input is what the console sends. Empty credentials keep the stored values.
type Input struct {
	Name         string `json:"name"`
	Driver       string `json:"driver"`
	Enabled      *bool  `json:"enabled"`
	IsDefault    *bool  `json:"isDefault"`
	Endpoint     string `json:"endpoint"`
	Region       string `json:"region"`
	Bucket       string `json:"bucket"`
	AccessKey    string `json:"accessKey"`
	SecretKey    string `json:"secretKey"`
	PublicBase   string `json:"publicBase"`
	UsePathStyle *bool  `json:"usePathStyle"`
	LocalDir     string `json:"localDir"`
	SortOrder    int    `json:"sortOrder"`
}

// View is the console representation: credentials are masked, never returned.
type View struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Driver        string    `json:"driver"`
	Enabled       bool      `json:"enabled"`
	IsDefault     bool      `json:"isDefault"`
	Endpoint      string    `json:"endpoint"`
	Region        string    `json:"region"`
	Bucket        string    `json:"bucket"`
	PublicBase    string    `json:"publicBase"`
	UsePathStyle  bool      `json:"usePathStyle"`
	LocalDir      string    `json:"localDir"`
	SortOrder     int       `json:"sortOrder"`
	AccessKeyMask string    `json:"accessKeyMask"`
	SecretKeyMask string    `json:"secretKeyMask"`
	Ready         bool      `json:"ready"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// Option is what a normal user sees when picking their own storage.
type Option struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Driver string `json:"driver"`
}

func toView(provider model.StorageProvider, accessKey, secretKey string) View {
	return View{
		ID:            provider.ID,
		Name:          provider.Name,
		Driver:        provider.Driver,
		Enabled:       provider.Enabled,
		IsDefault:     provider.IsDefault,
		Endpoint:      provider.Endpoint,
		Region:        provider.Region,
		Bucket:        provider.Bucket,
		PublicBase:    provider.PublicBase,
		UsePathStyle:  provider.UsePathStyle,
		LocalDir:      provider.LocalDir,
		SortOrder:     provider.SortOrder,
		AccessKeyMask: secret.Mask(accessKey),
		SecretKeyMask: secret.Mask(secretKey),
		Ready:         provider.Driver == "local" || (provider.Endpoint != "" && provider.Bucket != "" && secretKey != ""),
		CreatedAt:     provider.CreatedAt,
		UpdatedAt:     provider.UpdatedAt,
	}
}

func (s *Service) masks(provider model.StorageProvider) (string, string) {
	accessKey, _ := secret.Decrypt(s.Cfg.ChannelEncryptionKey, provider.AccessKeyCipher)
	secretKey, _ := secret.Decrypt(s.Cfg.ChannelEncryptionKey, provider.SecretKeyCipher)
	return accessKey, secretKey
}

func (s *Service) List() ([]View, error) {
	var rows []model.StorageProvider
	if err := s.DB.Order("sort_order ASC").Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	views := make([]View, 0, len(rows))
	for _, row := range rows {
		accessKey, secretKey := s.masks(row)
		views = append(views, toView(row, accessKey, secretKey))
	}
	return views, nil
}

func (s *Service) Create(operatorID uint, input Input) (View, error) {
	row, err := s.prepare(nil, input)
	if err != nil {
		return View{}, err
	}
	row.ID = uuid.NewString()
	row.CreatedAt = time.Now().UTC()
	row.UpdatedAt = row.CreatedAt
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if row.IsDefault {
			if err := tx.Model(&model.StorageProvider{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return model.RecordAudit(tx, operatorID, "storage.create", "storage_provider", row.ID)
	})
	if err != nil {
		return View{}, err
	}
	accessKey, secretKey := s.masks(row)
	return toView(row, accessKey, secretKey), nil
}

func (s *Service) Update(operatorID uint, id string, input Input) (View, error) {
	var row model.StorageProvider
	if err := s.DB.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	updated, err := s.prepare(&row, input)
	if err != nil {
		return View{}, err
	}
	updated.ID = row.ID
	updated.CreatedAt = row.CreatedAt
	updated.UpdatedAt = time.Now().UTC()
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if updated.IsDefault {
			if err := tx.Model(&model.StorageProvider{}).Where("id <> ? AND is_default = ?", updated.ID, true).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		if err := tx.Save(&updated).Error; err != nil {
			return err
		}
		return model.RecordAudit(tx, operatorID, "storage.update", "storage_provider", updated.ID)
	})
	if err != nil {
		return View{}, err
	}
	s.Registry.Invalidate(updated.ID)
	accessKey, secretKey := s.masks(updated)
	return toView(updated, accessKey, secretKey), nil
}

func (s *Service) Delete(operatorID uint, id string) error {
	var row model.StorageProvider
	if err := s.DB.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	if row.Enabled {
		var enabled int64
		if err := s.DB.Model(&model.StorageProvider{}).Where("enabled = ?", true).Count(&enabled).Error; err != nil {
			return err
		}
		if enabled <= 1 {
			return ErrLastProvider
		}
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.User{}).Where("storage_provider_id = ?", id).Update("storage_provider_id", "").Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.StorageProvider{}, "id = ?", id).Error; err != nil {
			return err
		}
		return model.RecordAudit(tx, operatorID, "storage.delete", "storage_provider", id)
	})
}

// Test builds the driver and performs one health round-trip.
func (s *Service) Test(id string) error {
	var row model.StorageProvider
	if err := s.DB.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	store, err := s.Registry.ForProvider(row)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := store.Health(ctx); err != nil {
		return fmt.Errorf("%s: %w", store.Driver(), err)
	}
	return nil
}

// Options lists the providers a user may choose from, plus the current choice.
func (s *Service) Options(userID uint) ([]Option, string, bool, error) {
	var rows []model.StorageProvider
	if err := s.DB.Where("enabled = ?", true).Order("sort_order ASC").Order("created_at ASC").Find(&rows).Error; err != nil {
		return nil, "", false, err
	}
	options := make([]Option, 0, len(rows))
	for _, row := range rows {
		options = append(options, Option{ID: row.ID, Name: row.Name, Driver: row.Driver})
	}
	var user model.User
	if err := s.DB.Select("id", "storage_provider_id").First(&user, userID).Error; err != nil {
		return nil, "", false, err
	}
	for _, row := range rows {
		if row.ID == user.StorageProviderID {
			return options, row.ID, false, nil
		}
	}
	// Not chosen yet: report the administrator default as the effective one.
	for _, row := range rows {
		if row.IsDefault {
			return options, row.ID, true, nil
		}
	}
	if len(rows) > 0 {
		return options, rows[0].ID, true, nil
	}
	return options, "", true, nil
}

// Choose stores the user's own selection; empty clears it back to the default.
func (s *Service) Choose(userID uint, providerID string) error {
	providerID = strings.TrimSpace(providerID)
	if providerID != "" {
		var row model.StorageProvider
		if err := s.DB.First(&row, "id = ? AND enabled = ?", providerID, true).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotAvailable
			}
			return err
		}
	}
	return s.DB.Model(&model.User{}).Where("id = ?", userID).Update("storage_provider_id", providerID).Error
}

func (s *Service) prepare(existing *model.StorageProvider, input Input) (model.StorageProvider, error) {
	row := model.StorageProvider{}
	if existing != nil {
		row = *existing
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return model.StorageProvider{}, fmt.Errorf("%w: 名称不能为空", ErrInvalid)
	}
	driver := strings.ToLower(strings.TrimSpace(input.Driver))
	if driver == "" {
		driver = "local"
	}
	if driver != "local" && driver != "s3" {
		return model.StorageProvider{}, fmt.Errorf("%w: 驱动只支持 local 或 s3", ErrInvalid)
	}
	row.Name = name
	row.Driver = driver
	row.Endpoint = strings.TrimSpace(input.Endpoint)
	row.Region = strings.TrimSpace(input.Region)
	row.Bucket = strings.TrimSpace(input.Bucket)
	row.PublicBase = strings.TrimSpace(input.PublicBase)
	row.LocalDir = strings.TrimSpace(input.LocalDir)
	row.SortOrder = input.SortOrder
	if input.UsePathStyle != nil {
		row.UsePathStyle = *input.UsePathStyle
	} else if existing == nil {
		row.UsePathStyle = true
	}
	if input.Enabled != nil {
		row.Enabled = *input.Enabled
	}
	if input.IsDefault != nil {
		row.IsDefault = *input.IsDefault
	}

	if driver == "s3" {
		if row.Endpoint == "" || row.Bucket == "" {
			return model.StorageProvider{}, fmt.Errorf("%w: S3 需要填写 Endpoint 和 Bucket", ErrInvalid)
		}
		if accessKey := strings.TrimSpace(input.AccessKey); accessKey != "" {
			encrypted, err := secret.Encrypt(s.Cfg.ChannelEncryptionKey, accessKey)
			if err != nil {
				return model.StorageProvider{}, err
			}
			row.AccessKeyCipher = encrypted
		}
		if secretKey := strings.TrimSpace(input.SecretKey); secretKey != "" {
			encrypted, err := secret.Encrypt(s.Cfg.ChannelEncryptionKey, secretKey)
			if err != nil {
				return model.StorageProvider{}, err
			}
			row.SecretKeyCipher = encrypted
		}
		if row.AccessKeyCipher == "" || row.SecretKeyCipher == "" {
			return model.StorageProvider{}, fmt.Errorf("%w: S3 需要填写 Access Key 与 Secret Key", ErrInvalid)
		}
	}
	if driver == "local" && row.LocalDir == "" {
		row.LocalDir = s.Cfg.StorageLocalDir
	}
	if row.PublicBase == "" {
		row.PublicBase = s.Cfg.StoragePublicBase
	}
	return row, nil
}

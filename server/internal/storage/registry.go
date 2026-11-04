package storage

import (
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/cipherbox"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

// ErrNoProvider means no storage is enabled, so uploads cannot be served.
var ErrNoProvider = errors.New("no storage provider is enabled")

// Registry resolves the storage a user should write to, honouring the user's own
// choice first and the administrator default second.
type Registry struct {
	DB  *gorm.DB
	Cfg config.Config

	mu     sync.RWMutex
	stores map[string]Store
}

func NewRegistry(db *gorm.DB, cfg config.Config) (*Registry, error) {
	registry := &Registry{DB: db, Cfg: cfg, stores: map[string]Store{}}
	if err := registry.seedDefault(); err != nil {
		return nil, err
	}
	return registry, nil
}

// seedDefault keeps a fresh installation usable: one local provider, enabled.
func (r *Registry) seedDefault() error {
	var count int64
	if err := r.DB.Model(&model.StorageProvider{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	row := model.StorageProvider{
		ID:           uuid.NewString(),
		Name:         "本地存储",
		Driver:       "local",
		Enabled:      true,
		IsDefault:    true,
		LocalDir:     r.Cfg.StorageLocalDir,
		PublicBase:   r.Cfg.StoragePublicBase,
		UsePathStyle: true,
	}
	return r.DB.Create(&row).Error
}

// Invalidate drops a cached driver after the provider row changed.
func (r *Registry) Invalidate(id string) {
	r.mu.Lock()
	delete(r.stores, id)
	r.mu.Unlock()
}

// ForProvider builds (or reuses) the driver for one provider row.
func (r *Registry) ForProvider(provider model.StorageProvider) (Store, error) {
	r.mu.RLock()
	cached, ok := r.stores[provider.ID]
	r.mu.RUnlock()
	if ok {
		return cached, nil
	}
	store, err := r.build(provider)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.stores[provider.ID] = store
	r.mu.Unlock()
	return store, nil
}

func (r *Registry) build(provider model.StorageProvider) (Store, error) {
	switch provider.Driver {
	case "local":
		dir := provider.LocalDir
		if dir == "" {
			dir = r.Cfg.StorageLocalDir
		}
		base := provider.PublicBase
		if base == "" {
			base = r.Cfg.StoragePublicBase
		}
		return newLocal(dir, base)
	case "s3":
		accessKey, err := cipherbox.Decrypt(r.Cfg.ChannelEncryptionKey, provider.AccessKeyCipher)
		if err != nil {
			return nil, err
		}
		secretKey, err := cipherbox.Decrypt(r.Cfg.ChannelEncryptionKey, provider.SecretKeyCipher)
		if err != nil {
			return nil, err
		}
		return newS3(s3Options{
			Endpoint:     provider.Endpoint,
			Region:       provider.Region,
			Bucket:       provider.Bucket,
			AccessKey:    accessKey,
			SecretKey:    secretKey,
			PublicBase:   provider.PublicBase,
			UsePathStyle: provider.UsePathStyle,
		})
	default:
		return nil, ErrNotConfigured
	}
}

// ResolveForUser returns the store and provider a write for this user should use.
func (r *Registry) ResolveForUser(userID uint) (Store, model.StorageProvider, error) {
	var user model.User
	if err := r.DB.Select("id", "storage_provider_id").First(&user, userID).Error; err != nil {
		return nil, model.StorageProvider{}, err
	}
	providers, err := r.providers()
	if err != nil {
		return nil, model.StorageProvider{}, err
	}
	return r.storeFor(pickProvider(providers, user.StorageProviderID))
}

// Default returns the administrator default store, used for reads that are not
// tied to a user (public file URLs).
func (r *Registry) Default() (Store, model.StorageProvider, error) {
	providers, err := r.providers()
	if err != nil {
		return nil, model.StorageProvider{}, err
	}
	return r.storeFor(pickProvider(providers, ""))
}

// providers lists the enabled providers in the administrator's display order.
func (r *Registry) providers() ([]model.StorageProvider, error) {
	var providers []model.StorageProvider
	if err := r.DB.Where("enabled = ?", true).Order("sort_order ASC").Order("created_at ASC").Find(&providers).Error; err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, ErrNoProvider
	}
	return providers, nil
}

func (r *Registry) storeFor(provider model.StorageProvider) (Store, model.StorageProvider, error) {
	store, err := r.ForProvider(provider)
	if err != nil {
		return nil, model.StorageProvider{}, err
	}
	return store, provider, nil
}

// pickProvider applies the shared rule: the user's own choice wins when it is
// still enabled, then the administrator default, then the first enabled one.
func pickProvider(providers []model.StorageProvider, preferred string) model.StorageProvider {
	if preferred != "" {
		for _, provider := range providers {
			if provider.ID == preferred {
				return provider
			}
		}
	}
	for _, provider := range providers {
		if provider.IsDefault {
			return provider
		}
	}
	return providers[0]
}

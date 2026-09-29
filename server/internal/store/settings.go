package store

import (
	"encoding/json"
	"errors"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

// LoadEmailSettings restores administrator-managed email settings after a restart.
// Environment variables remain the fallback for a fresh database.
func LoadEmailSettings(db *gorm.DB, cfg config.Config) (config.Config, error) {
	var row model.OperationSetting
	if err := db.Where("`key` = ?", "email.smtp").First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return cfg, nil
		}
		return cfg, err
	}
	settings := cfg.EmailSettings()
	if err := json.Unmarshal([]byte(row.Value), &settings); err != nil {
		return cfg, err
	}
	cfg.ApplyEmailSettings(settings)
	return cfg, nil
}

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
				)
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

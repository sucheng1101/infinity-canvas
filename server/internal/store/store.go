package store

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis/v8"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func Open(cfg config.Config) (*gorm.DB, *redis.Client, error) {
	db, err := gorm.Open(mysql.Open(cfg.DatabaseDSN), &gorm.Config{TranslateError: true})
	if err != nil {
		return nil, nil, fmt.Errorf("open mysql: %w", err)
	}
	if err := migrate(db); err != nil {
		return nil, nil, fmt.Errorf("migrate mysql: %w", err)
	}

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		_ = redisClient.Close()
		return nil, nil, fmt.Errorf("connect redis: %w", err)
	}
	return db, redisClient, nil
}

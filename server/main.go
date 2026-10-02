package main

import (
	"log"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/auth"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/generation"
	"github.com/sucheng1101/infinity-canvas/server/internal/httpapi"
	"github.com/sucheng1101/infinity-canvas/server/internal/mailer"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"github.com/sucheng1101/infinity-canvas/server/internal/store"
	"github.com/sucheng1101/infinity-canvas/server/internal/subscription"
	"gorm.io/gorm"
)

func main() {
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatal(err)
	}
	db, redisClient, err := store.Open(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer redisClient.Close()
	cfg, err = store.LoadEmailSettings(db, cfg)
	if err != nil {
		log.Fatal(err)
	}
	if err := auth.EnsureAdmin(db, cfg); err != nil {
		log.Fatal(err)
	}
	go reapStaleTasks(db, cfg)

	router := httpapi.NewRouter(cfg, db, redisClient, mailer.NewSMTP(cfg))
	// 只有 TRUSTED_PROXIES 中显式列出的代理才允许影响客户端 IP；默认为空表示不信任任何代理，
	// 避免伪造 X-Forwarded-For 绕过登录 / 注册 / 找回密码的频率限制。
	if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		log.Fatal(err)
	}
	log.Printf("infinite canvas server listening on %s", cfg.Addr)
	if err := router.Run(cfg.Addr); err != nil {
		log.Fatal(err)
	}
}

// reapStaleTasks releases quota stranded by tasks that were left running when
// the process died, since only the owning process can settle or fail them.
func reapStaleTasks(db *gorm.DB, cfg config.Config) {
	service := &generation.Service{DB: db, Quota: &quota.Service{DB: db}, Subscriptions: &subscription.Service{DB: db}}
	interval := cfg.RelayTimeout + time.Minute
	if interval < time.Minute {
		interval = time.Minute
	}
	for {
		time.Sleep(interval)
		reaped, err := service.ReapStale(time.Now().UTC().Add(-interval))
		if err != nil {
			log.Printf("reap stale generation tasks failed: %v", err)
			continue
		}
		if reaped > 0 {
			log.Printf("reaped %d stale generation task(s)", reaped)
		}
	}
}

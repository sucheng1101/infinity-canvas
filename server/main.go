package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/auth"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/generation"
	"github.com/sucheng1101/infinity-canvas/server/internal/httpapi"
	"github.com/sucheng1101/infinity-canvas/server/internal/mailer"
	"github.com/sucheng1101/infinity-canvas/server/internal/modelcatalog"
	"github.com/sucheng1101/infinity-canvas/server/internal/payment"
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
	// The public catalog used to sync on every /models read; keep it current at
	// boot and on channel writes instead.
	if err := (&modelcatalog.Service{DB: db}).SyncFromChannels(); err != nil {
		log.Printf("sync model catalog failed: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go reapStaleTasks(ctx, db, cfg)
	go expireOrders(ctx, &payment.Service{DB: db, Cfg: cfg, Quota: &quota.Service{DB: db}})

	router := httpapi.NewRouter(cfg, db, redisClient, mailer.NewSMTP(cfg))
	// 只有 TRUSTED_PROXIES 中显式列出的代理才允许影响客户端 IP；默认为空表示不信任任何代理，
	// 避免伪造 X-Forwarded-For 绕过登录 / 注册 / 找回密码的频率限制。
	if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: cfg.Addr, Handler: router}
	go func() {
		log.Printf("infinite canvas server listening on %s", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down, waiting up to %s for in-flight requests", cfg.ShutdownTimeout)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

// reapStaleTasks releases quota stranded by tasks that were left running when
// the process died, since only the owning process can settle or fail them.
func reapStaleTasks(ctx context.Context, db *gorm.DB, cfg config.Config) {
	service := &generation.Service{DB: db, Quota: &quota.Service{DB: db}, Subscriptions: &subscription.Service{DB: db}}
	interval := cfg.RelayTimeout + time.Minute
	if interval < time.Minute {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
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
}

// expireOrders flips unpaid orders past their deadline so a delayed payment
// notification no longer has to wait for the user to poll the order first.
func expireOrders(ctx context.Context, service *payment.Service) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			expired, err := service.ExpireOrders(time.Now().UTC())
			if err != nil {
				log.Printf("expire topup orders failed: %v", err)
				continue
			}
			if expired > 0 {
				log.Printf("expired %d topup order(s)", expired)
			}
		}
	}
}

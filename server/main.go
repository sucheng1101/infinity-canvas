package main

import (
	"log"

	"github.com/sucheng1101/infinity-canvas/server/internal/auth"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/httpapi"
	"github.com/sucheng1101/infinity-canvas/server/internal/mailer"
	"github.com/sucheng1101/infinity-canvas/server/internal/store"
)

func main() {
	cfg := config.Load()
	db, redisClient, err := store.Open(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer redisClient.Close()
	if err := auth.EnsureAdmin(db, cfg); err != nil {
		log.Fatal(err)
	}

	router := httpapi.NewRouter(cfg, db, redisClient, mailer.NewSMTP(cfg))
	log.Printf("infinite canvas server listening on %s", cfg.Addr)
	if err := router.Run(cfg.Addr); err != nil {
		log.Fatal(err)
	}
}

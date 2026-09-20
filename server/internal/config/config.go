package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Addr                 string
	DatabaseDSN          string
	RedisAddr            string
	RedisPassword        string
	RedisDB              int
	SessionCookie        string
	SessionTTL           time.Duration
	SessionMaxTTL        time.Duration
	VerificationTTL      time.Duration
	PasswordResetTTL     time.Duration
	CookieSecure         bool
	DevExposeTokens      bool
	InvitationRewardOpen bool
	PublicWebURL         string
	SMTPHost             string
	SMTPPort             int
	SMTPUsername         string
	SMTPPassword         string
	SMTPFrom             string
	AdminEmail           string
	AdminPassword        string
}

func Load() Config {
	return Config{
		Addr:                 env("SERVER_ADDR", ":8080"),
		DatabaseDSN:          env("DATABASE_DSN", "root:password@tcp(127.0.0.1:3306)/infinite_canvas?charset=utf8mb4&parseTime=True&loc=UTC"),
		RedisAddr:            env("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:        os.Getenv("REDIS_PASSWORD"),
		RedisDB:              envInt("REDIS_DB", 0),
		SessionCookie:         env("SESSION_COOKIE", "ic_session"),
		SessionTTL:            envDuration("SESSION_TTL", 7*24*time.Hour),
		SessionMaxTTL:         envDuration("SESSION_MAX_TTL", 30*24*time.Hour),
		VerificationTTL:       envDuration("EMAIL_VERIFICATION_TTL", 30*time.Minute),
		PasswordResetTTL:      envDuration("PASSWORD_RESET_TTL", 30*time.Minute),
		CookieSecure:          envBool("COOKIE_SECURE", false),
		DevExposeTokens:       envBool("DEV_EXPOSE_TOKENS", false),
		InvitationRewardOpen:  envBool("INVITATION_REWARD_OPEN", false),
		PublicWebURL:          env("PUBLIC_WEB_URL", "http://localhost:3000"),
		SMTPHost:             os.Getenv("SMTP_HOST"),
		SMTPPort:             envInt("SMTP_PORT", 587),
		SMTPUsername:         os.Getenv("SMTP_USERNAME"),
		SMTPPassword:         os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:             os.Getenv("SMTP_FROM"),
		AdminEmail:           os.Getenv("ADMIN_EMAIL"),
		AdminPassword:        os.Getenv("ADMIN_PASSWORD"),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

func envDuration(key string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(os.Getenv(key))
	if err != nil {
		return fallback
	}
	return value
}

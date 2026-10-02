package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Addr                          string
	DatabaseDSN                   string
	RedisAddr                     string
	RedisPassword                 string
	RedisDB                       int
	SessionCookie                 string
	SessionTTL                    time.Duration
	SessionMaxTTL                 time.Duration
	VerificationTTL               time.Duration
	PasswordResetTTL              time.Duration
	PaymentOrderTTL               time.Duration
	QuoteTTL                      time.Duration
	RelayTimeout                  time.Duration
	CookieSecure                  bool
	DevExposeTokens               bool
	InvitationRewardOpen          bool
	InvitationInviterQuota        int64
	InvitationInviteeQuota        int64
	PublicWebURL                  string
	TrustedProxies                []string
	SMTPHost                      string
	SMTPPort                      int
	SMTPUsername                  string
	SMTPPassword                  string
	SMTPFrom                      string
	EmailEnabled                  bool
	EmailVerificationRequired     bool
	RegistrationEnabled           bool
	EmailDomainRestrictionEnabled bool
	EmailAliasRestrictionEnabled  bool
	EmailAllowedDomains           []string
	EmailBlockedDomains           []string
	SMTPSSLEnabled                bool
	SMTPForceAuthLogin            bool
	AdminUsername                 string
	AdminEmail                    string
	AdminPassword                 string
	EpayEnabled                   bool
	EpayGatewayURL                string
	EpayPartnerID                 string
	EpayKey                       string
	EpayPayMethods                []string
	EpayCallbackURL               string
	ChannelEncryptionKey          string
}

// EmailSettings is the administrator-managed email and registration policy.
// SMTPPassword is never returned by the admin API.
type EmailSettings struct {
	Enabled                  bool     `json:"enabled"`
	VerificationRequired     bool     `json:"verificationRequired"`
	RegistrationEnabled      bool     `json:"registrationEnabled"`
	DomainRestrictionEnabled bool     `json:"domainRestrictionEnabled"`
	AliasRestrictionEnabled  bool     `json:"aliasRestrictionEnabled"`
	SMTPHost                 string   `json:"smtpHost"`
	SMTPPort                 int      `json:"smtpPort"`
	SMTPUsername             string   `json:"smtpUsername"`
	SMTPPassword             string   `json:"smtpPassword"`
	SMTPFrom                 string   `json:"smtpFrom"`
	SMTPSSLEnabled           bool     `json:"smtpSSLEnabled"`
	SMTPForceAuthLogin       bool     `json:"smtpForceAuthLogin"`
	AllowedDomains           []string `json:"allowedDomains"`
	BlockedDomains           []string `json:"blockedDomains"`
}

func Load() Config {
	return Config{
		Addr:                          env("SERVER_ADDR", ":1011"),
		DatabaseDSN:                   env("DATABASE_DSN", "root:password@tcp(127.0.0.1:3306)/infinite_canvas?charset=utf8mb4&parseTime=True&loc=UTC"),
		RedisAddr:                     env("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:                 os.Getenv("REDIS_PASSWORD"),
		RedisDB:                       envInt("REDIS_DB", 0),
		SessionCookie:                 env("SESSION_COOKIE", "ic_session"),
		SessionTTL:                    envDuration("SESSION_TTL", 7*24*time.Hour),
		SessionMaxTTL:                 envDuration("SESSION_MAX_TTL", 30*24*time.Hour),
		VerificationTTL:               envDuration("EMAIL_VERIFICATION_TTL", 30*time.Minute),
		PasswordResetTTL:              envDuration("PASSWORD_RESET_TTL", 30*time.Minute),
		PaymentOrderTTL:               envDuration("PAYMENT_ORDER_TTL", 30*time.Minute),
		QuoteTTL:                      envDuration("QUOTE_TTL", 5*time.Minute),
		RelayTimeout:                  envDuration("RELAY_TIMEOUT", 5*time.Minute),
		CookieSecure:                  envBool("COOKIE_SECURE", false),
		DevExposeTokens:               envBool("DEV_EXPOSE_TOKENS", false),
		InvitationRewardOpen:          envBool("INVITATION_REWARD_OPEN", false),
		InvitationInviterQuota:        envInt64("INVITATION_INVITER_QUOTA", 0),
		InvitationInviteeQuota:        envInt64("INVITATION_INVITEE_QUOTA", 0),
		PublicWebURL:                  env("PUBLIC_WEB_URL", "http://localhost:1010"),
		TrustedProxies:                envList("TRUSTED_PROXIES", nil),
		SMTPHost:                      os.Getenv("SMTP_HOST"),
		SMTPPort:                      envInt("SMTP_PORT", 587),
		SMTPUsername:                  os.Getenv("SMTP_USERNAME"),
		SMTPPassword:                  os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:                      os.Getenv("SMTP_FROM"),
		EmailEnabled:                  envBool("EMAIL_ENABLED", true),
		EmailVerificationRequired:     envBool("EMAIL_VERIFICATION_REQUIRED", true),
		RegistrationEnabled:           envBool("REGISTRATION_ENABLED", true),
		EmailDomainRestrictionEnabled: envBool("EMAIL_DOMAIN_RESTRICTION_ENABLED", false),
		EmailAliasRestrictionEnabled:  envBool("EMAIL_ALIAS_RESTRICTION_ENABLED", false),
		EmailAllowedDomains:           envList("EMAIL_ALLOWED_DOMAINS", nil),
		EmailBlockedDomains:           envList("EMAIL_BLOCKED_DOMAINS", nil),
		SMTPSSLEnabled:                envBool("SMTP_SSL_ENABLED", false),
		SMTPForceAuthLogin:            envBool("SMTP_FORCE_AUTH_LOGIN", false),
		AdminUsername:                 os.Getenv("ADMIN_USERNAME"),
		AdminEmail:                    os.Getenv("ADMIN_EMAIL"),
		AdminPassword:                 os.Getenv("ADMIN_PASSWORD"),
		EpayEnabled:                   envBool("EPAY_ENABLED", false),
		EpayGatewayURL:                os.Getenv("EPAY_GATEWAY_URL"),
		EpayPartnerID:                 os.Getenv("EPAY_PARTNER_ID"),
		EpayKey:                       os.Getenv("EPAY_KEY"),
		EpayPayMethods:                envList("EPAY_PAY_METHODS", []string{"alipay", "wxpay"}),
		EpayCallbackURL:               env("EPAY_CALLBACK_URL", "http://localhost:1011"),
		ChannelEncryptionKey:          env("CHANNEL_ENCRYPTION_KEY", "infinite-canvas-local-channel-key"),
	}
}

func (c Config) EmailSettings() EmailSettings {
	return EmailSettings{
		Enabled:                  c.EmailEnabled,
		VerificationRequired:     c.EmailVerificationRequired,
		RegistrationEnabled:      c.RegistrationEnabled,
		DomainRestrictionEnabled: c.EmailDomainRestrictionEnabled,
		AliasRestrictionEnabled:  c.EmailAliasRestrictionEnabled,
		SMTPHost:                 c.SMTPHost, SMTPPort: c.SMTPPort, SMTPUsername: c.SMTPUsername,
		SMTPPassword: c.SMTPPassword, SMTPFrom: c.SMTPFrom,
		SMTPSSLEnabled: c.SMTPSSLEnabled, SMTPForceAuthLogin: c.SMTPForceAuthLogin,
		AllowedDomains: append([]string(nil), c.EmailAllowedDomains...),
		BlockedDomains: append([]string(nil), c.EmailBlockedDomains...),
	}
}

func (c *Config) ApplyEmailSettings(s EmailSettings) {
	c.EmailEnabled = s.Enabled
	c.EmailVerificationRequired = s.VerificationRequired
	c.RegistrationEnabled = s.RegistrationEnabled
	c.EmailDomainRestrictionEnabled = s.DomainRestrictionEnabled
	c.EmailAliasRestrictionEnabled = s.AliasRestrictionEnabled
	c.SMTPHost, c.SMTPPort, c.SMTPUsername, c.SMTPPassword, c.SMTPFrom = s.SMTPHost, s.SMTPPort, s.SMTPUsername, s.SMTPPassword, s.SMTPFrom
	c.SMTPSSLEnabled, c.SMTPForceAuthLogin = s.SMTPSSLEnabled, s.SMTPForceAuthLogin
	c.EmailAllowedDomains = normalizeDomains(s.AllowedDomains)
	c.EmailBlockedDomains = normalizeDomains(s.BlockedDomains)
}

func normalizeDomains(domains []string) []string {
	result := make([]string, 0, len(domains))
	seen := make(map[string]struct{}, len(domains))
	for _, value := range domains {
		domain := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "@")))
		if domain == "" {
			continue
		}
		if _, ok := seen[domain]; ok {
			continue
		}
		seen[domain] = struct{}{}
		result = append(result, domain)
	}
	return result
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

func envInt64(key string, fallback int64) int64 {
	value, err := strconv.ParseInt(os.Getenv(key), 10, 64)
	if err != nil {
		return fallback
	}
	return value
}

func envList(key string, fallback []string) []string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if item := strings.TrimSpace(part); item != "" {
			result = append(result, item)
		}
	}
	if len(result) == 0 {
		return fallback
	}
	return result
}

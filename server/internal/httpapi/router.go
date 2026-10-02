package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
	adminservice "github.com/sucheng1101/infinity-canvas/server/internal/admin"
	"github.com/sucheng1101/infinity-canvas/server/internal/auth"
	"github.com/sucheng1101/infinity-canvas/server/internal/channelcatalog"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/generation"
	"github.com/sucheng1101/infinity-canvas/server/internal/invitation"
	"github.com/sucheng1101/infinity-canvas/server/internal/mailer"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/modelcatalog"
	"github.com/sucheng1101/infinity-canvas/server/internal/payment"
	"github.com/sucheng1101/infinity-canvas/server/internal/pricing"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"github.com/sucheng1101/infinity-canvas/server/internal/relay"
	"github.com/sucheng1101/infinity-canvas/server/internal/userchannel"
	versionservice "github.com/sucheng1101/infinity-canvas/server/internal/version"
	"gorm.io/gorm"
)

type Router struct {
	Cfg            config.Config
	DB             *gorm.DB
	Auth           *auth.Service
	Quota          *quota.Service
	Invitation     *invitation.Service
	Payment        *payment.Service
	Pricing        *pricing.Service
	Generation     *generation.Service
	Relay          *relay.Service
	ModelCatalog   *modelcatalog.Service
	ChannelCatalog *channelcatalog.Service
	Admin          *adminservice.Service
	Version        *versionservice.Service
	UserChannels   *userchannel.Service
	Redis          *redis.Client
	Mailer         mailer.Mailer
}

func NewRouter(cfg config.Config, db *gorm.DB, redisClient *redis.Client, outbound mailer.Mailer) *gin.Engine {
	service := &auth.Service{DB: db, Cfg: cfg}
	quotaService := &quota.Service{DB: db}
	invitationService := &invitation.Service{DB: db, Cfg: cfg, Quota: quotaService}
	paymentService := &payment.Service{DB: db, Cfg: cfg, Quota: quotaService}
	pricingService := &pricing.Service{DB: db, QuoteTTL: cfg.QuoteTTL}
	generationService := &generation.Service{DB: db, Quota: quotaService, Pricing: pricingService}
	relayService := &relay.Service{DB: db, Generation: generationService, Client: &http.Client{Timeout: cfg.RelayTimeout}}
	modelCatalogService := &modelcatalog.Service{DB: db}
	channelCatalogService := &channelcatalog.Service{DB: db, Client: &http.Client{Timeout: cfg.RelayTimeout}}
	adminService := &adminservice.Service{DB: db, Quota: quotaService}
	versionService := &versionservice.Service{DB: db, Client: &http.Client{Timeout: cfg.RelayTimeout}}
	userChannelService := &userchannel.Service{DB: db, Cfg: cfg, Client: &http.Client{Timeout: cfg.RelayTimeout}}
	relayService.UserChannels = userChannelService
	app := &Router{Cfg: cfg, DB: db, Auth: service, Quota: quotaService, Invitation: invitationService, Payment: paymentService, Pricing: pricingService, Generation: generationService, Relay: relayService, ModelCatalog: modelCatalogService, ChannelCatalog: channelCatalogService, Admin: adminService, Version: versionService, UserChannels: userChannelService, Redis: redisClient, Mailer: outbound}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(requestID())
	r.GET("/healthz", app.health)

	v1 := r.Group("/api/v1")
	v1.POST("/auth/register", app.register)
	v1.POST("/auth/register/code", app.registrationCode)
	v1.POST("/auth/verify-email", app.verifyEmail)
	v1.POST("/auth/verify-email/resend", app.resendVerification)
	v1.POST("/auth/login", app.login)
	v1.POST("/auth/password/forgot", app.forgotPassword)
	v1.POST("/auth/password/reset", app.resetPassword)
	v1.POST("/auth/logout", app.logout)
	v1.GET("/auth/me", app.requireAuth(), app.me)
	v1.GET("/models", app.models)
	v1.POST("/quotes", app.requireAuth(), app.createQuote)
	v1.POST("/generation-tasks", app.requireAuth(), app.createGenerationTask)
	v1.GET("/generation-tasks/:id", app.requireAuth(), app.getGenerationTask)
	v1.POST("/generation-tasks/:id/execute", app.requireAuth(), app.executeGenerationTask)
	v1.POST("/generation-tasks/:id/cancel", app.requireAuth(), app.cancelGenerationTask)
	v1.GET("/account/quota", app.requireAuth(), app.accountQuota)
	v1.GET("/account/channels", app.requireAuth(), app.userChannels)
	v1.POST("/account/channels", app.requireAuth(), app.userChannelCreate)
	v1.PUT("/account/channels/:id", app.requireAuth(), app.userChannelUpdate)
	v1.DELETE("/account/channels/:id", app.requireAuth(), app.userChannelDelete)
	v1.POST("/account/channels/:id/test", app.requireAuth(), app.userChannelTest)
	v1.GET("/account/ledger", app.requireAuth(), app.accountLedger)
	v1.GET("/recharge/products", app.requireAuth(), app.rechargeProducts)
	v1.POST("/recharge/orders", app.requireAuth(), app.allowGuard("recharge-order", 10, time.Minute), app.createRechargeOrder)
	v1.GET("/recharge/orders/:id", app.requireAuth(), app.rechargeOrder)
	v1.POST("/payments/epay/webhook", app.allowGuard("epay-webhook", 120, time.Minute), app.epayWebhook)
	v1.GET("/payments/epay/webhook", app.allowGuard("epay-webhook", 120, time.Minute), app.epayWebhook)
	v1.POST("/payments/epay/return", app.allowGuard("epay-return", 120, time.Minute), app.epayReturn)
	v1.GET("/payments/epay/return", app.allowGuard("epay-return", 120, time.Minute), app.epayReturn)
	v1.GET("/invitation/self", app.requireAuth(), app.invitationSelf)
	v1.GET("/invitation/rewards", app.requireAuth(), app.invitationRewards)
	v1.GET("/invitation/referrals", app.requireAuth(), app.invitationReferrals)
	v1.GET("/admin/health", app.requireAdmin(), func(c *gin.Context) { successJSON(c, http.StatusOK, gin.H{"status": "ok"}) })
	v1.GET("/admin/users", app.requireAdmin(), app.adminUsers)
	v1.GET("/admin/users/:id", app.requireAdmin(), app.adminUser)
	v1.POST("/admin/users", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreateUser)
	v1.PATCH("/admin/users/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUpdateUser)
	v1.POST("/admin/users/:id/status", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUserStatus)
	v1.POST("/admin/users/:id/password", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUserPassword)
	v1.POST("/admin/users/:id/quota", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUserQuota)
	v1.GET("/admin/users/:id/usage", app.requireAdmin(), app.adminUserUsage)
	v1.GET("/admin/usage-logs", app.requireAdmin(), app.adminUsageLogs)
	v1.GET("/admin/usage-logs/:id", app.requireAdmin(), app.adminUsageLog)
	v1.GET("/admin/invitation-settings", app.requireAdmin(), app.adminInvitationSettings)
	v1.PUT("/admin/invitation-settings", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.updateAdminInvitationSettings)
	v1.POST("/admin/quota-adjustments", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminQuotaAdjustment)
	v1.GET("/admin/recharge-products", app.requireAdmin(), app.adminRechargeProducts)
	v1.POST("/admin/recharge-products", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreateRechargeProduct)
	v1.PUT("/admin/recharge-products/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUpdateRechargeProduct)
	v1.GET("/admin/payment-settings", app.requireAdmin(), app.adminPaymentSettings)
	v1.PUT("/admin/payment-settings", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.updateAdminPaymentSettings)
	v1.GET("/admin/email-settings", app.requireAdmin(), app.adminEmailSettings)
	v1.PUT("/admin/email-settings", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.updateAdminEmailSettings)
	v1.POST("/admin/email-settings/test", app.requireAdmin(), app.testAdminEmailSettings)
	v1.GET("/admin/system/releases", app.requireAdmin(), app.adminSystemRelease)
	v1.POST("/admin/system/releases/check", app.requireAdmin(), app.adminSystemRelease)
	v1.POST("/admin/system/releases/update", app.requireAdmin(), app.allowGuard("admin-write", 5, time.Minute), app.adminSystemUpdate)
	v1.GET("/admin/security/access", app.requireAdmin(), app.adminSecurityAccess)
	v1.PUT("/admin/security/access/settings", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.updateAdminSecuritySettings)
	v1.POST("/admin/security/ip-blocks", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.createIPBlock)
	v1.DELETE("/admin/security/ip-blocks/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.deleteIPBlock)
	v1.POST("/admin/security/sessions/:id/revoke", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.revokeSecuritySession)
	v1.GET("/admin/models", app.requireAdmin(), app.adminModels)
	v1.POST("/admin/models", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreateModel)
	v1.PUT("/admin/models/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUpdateModel)
	v1.DELETE("/admin/models/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminDeleteModel)
	v1.GET("/admin/channels", app.requireAdmin(), app.adminChannels)
	v1.POST("/admin/channels/fetch-models", app.requireAdmin(), app.adminFetchChannelModels)
	v1.POST("/admin/channels/:id/test", app.requireAdmin(), app.adminTestChannel)
	v1.POST("/admin/channels", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreateChannel)
	v1.PUT("/admin/channels/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUpdateChannel)
	v1.DELETE("/admin/channels/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminDeleteChannel)
	v1.GET("/admin/model-routes", app.requireAdmin(), app.adminModelRoutes)
	v1.POST("/admin/model-routes", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreateModelRoute)
	v1.PUT("/admin/model-routes/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminUpdateModelRoute)
	v1.DELETE("/admin/model-routes/:id", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminDeleteModelRoute)
	v1.GET("/admin/pricing", app.requireAdmin(), app.adminPricing)
	v1.POST("/admin/pricing", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminCreatePricing)
	v1.POST("/admin/pricing/:id/publish", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminPublishPricing)
	v1.POST("/admin/pricing/:id/retire", app.requireAdmin(), app.allowGuard("admin-write", 30, time.Minute), app.adminRetirePricing)
	return r
}

type credentialsRequest struct {
	Username         string `json:"username"`
	Email            string `json:"email"`
	Password         string `json:"password"`
	VerificationCode string `json:"verificationCode"`
	InviteCode       string `json:"inviteCode"`
}

type tokenRequest struct {
	Token string `json:"token"`
}

func (a *Router) register(c *gin.Context) {
	if a.ipBlocked(c.ClientIP()) {
		errorJSON(c, http.StatusForbidden, "ACCESS_IP_BLOCKED", "当前访问地址已被禁止")
		return
	}
	if !a.Cfg.RegistrationEnabled {
		errorJSON(c, http.StatusForbidden, "REGISTRATION_DISABLED", "当前暂未开放注册")
		return
	}
	if !a.allow(c, "register", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if a.Cfg.EmailEnabled && a.Cfg.EmailVerificationRequired && !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "邮件服务尚未配置")
		return
	}
	result, err := a.Auth.Register(req.Username, req.Email, req.Password, req.VerificationCode, req.InviteCode)
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			errorJSON(c, http.StatusConflict, "ACCOUNT_EXISTS", "用户名或邮箱已注册")
			return
		}
		if errors.Is(err, auth.ErrVerificationCodeInvalid) {
			errorJSON(c, http.StatusBadRequest, "VERIFICATION_CODE_INVALID", "验证码无效或已过期")
			return
		}
		if errors.Is(err, auth.ErrInvitationCodeInvalid) {
			errorJSON(c, http.StatusBadRequest, "INVITATION_CODE_INVALID", "邀请码无效")
			return
		}
		if errors.Is(err, auth.ErrInvitationAlreadyBound) {
			errorJSON(c, http.StatusBadRequest, "INVITATION_ALREADY_BOUND", "该账号已经绑定邀请码")
			return
		}
		if errors.Is(err, auth.ErrInvitationSelfUse) {
			errorJSON(c, http.StatusBadRequest, "INVITATION_SELF_USE", "不能使用自己的邀请码")
			return
		}
		if errors.Is(err, auth.ErrEmailAliasNotAllowed) {
			errorJSON(c, http.StatusBadRequest, "EMAIL_ALIAS_NOT_ALLOWED", "email alias is not allowed")
			return
		}
		if errors.Is(err, auth.ErrRegistrationDisabled) {
			errorJSON(c, http.StatusForbidden, "REGISTRATION_DISABLED", "registration is disabled")
			return
		}
		if errors.Is(err, auth.ErrEmailDomainNotAllowed) {
			errorJSON(c, http.StatusBadRequest, "EMAIL_DOMAIN_NOT_ALLOWED", "该邮箱域名不在允许范围内")
			return
		}
		errorJSON(c, http.StatusBadRequest, "REGISTER_FAILED", "注册信息无效")
		return
	}
	a.recordAccessEvent(c, &result.User.ID, "register", true, "")
	data := gin.H{"user": publicUser(result.User), "verificationRequired": result.VerificationRequired}
	if a.Cfg.DevExposeTokens {
		data["verificationToken"] = result.VerificationToken
	}
	if result.VerificationRequired && a.Mailer != nil {
		if err := a.Mailer.SendVerification(result.User.Email, result.VerificationToken); err != nil && !a.Cfg.DevExposeTokens {
			errorJSON(c, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "验证邮件发送失败，请稍后重新发送")
			return
		}
	}
	successJSON(c, http.StatusCreated, data)
}

func (a *Router) registrationCode(c *gin.Context) {
	if !a.Cfg.RegistrationEnabled {
		errorJSON(c, http.StatusForbidden, "REGISTRATION_DISABLED", "当前暂未开放注册")
		return
	}
	if !a.Cfg.EmailEnabled || !a.Cfg.EmailVerificationRequired {
		errorJSON(c, http.StatusBadRequest, "EMAIL_VERIFICATION_DISABLED", "当前未开启邮箱验证")
		return
	}
	if !a.allow(c, "register-code", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Email) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "邮箱格式无效")
		return
	}
	if a.Cfg.EmailEnabled && !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "邮件服务尚未配置")
		return
	}
	code, err := a.Auth.IssueRegistrationCode(req.Email)
	if err != nil {
		if errors.Is(err, auth.ErrEmailAliasNotAllowed) {
			errorJSON(c, http.StatusBadRequest, "EMAIL_ALIAS_NOT_ALLOWED", "email alias is not allowed")
			return
		}
		if errors.Is(err, auth.ErrRegistrationDisabled) {
			errorJSON(c, http.StatusForbidden, "REGISTRATION_DISABLED", "registration is disabled")
			return
		}
		if errors.Is(err, auth.ErrEmailDomainNotAllowed) {
			errorJSON(c, http.StatusBadRequest, "EMAIL_DOMAIN_NOT_ALLOWED", "该邮箱域名不在允许范围内")
			return
		}
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "邮箱格式无效")
		return
	}
	if a.Mailer != nil {
		if err := a.Mailer.SendRegistrationCode(req.Email, code); err != nil && !a.Cfg.DevExposeTokens {
			errorJSON(c, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "验证码发送失败，请稍后重试")
			return
		}
	}
	data := gin.H{"accepted": true}
	if a.Cfg.DevExposeTokens {
		data["verificationCode"] = code
	}
	successJSON(c, http.StatusOK, data)
}

func (a *Router) verifyEmail(c *gin.Context) {
	var req tokenRequest
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Token) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	user, verifiedNow, err := a.Auth.VerifyEmail(req.Token)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "AUTH_VERIFY_TOKEN_INVALID", "验证链接无效或已过期")
		return
	}
	if verifiedNow {
		if err := a.Invitation.RewardVerified(user.ID); err != nil {
			errorJSON(c, http.StatusInternalServerError, "INVITATION_REWARD_FAILED", "邀请奖励处理失败")
			return
		}
		sessionToken, err := a.Auth.CreateSession(user.ID, c.ClientIP(), c.GetHeader("User-Agent"))
		if err != nil {
			errorJSON(c, http.StatusInternalServerError, "SESSION_CREATE_FAILED", "登录会话创建失败")
			return
		}
		a.setSessionCookie(c, sessionToken)
	}
	successJSON(c, http.StatusOK, gin.H{"user": publicUser(user), "sessionCreated": verifiedNow})
}

func (a *Router) resendVerification(c *gin.Context) {
	if !a.Cfg.EmailEnabled || !a.Cfg.EmailVerificationRequired {
		errorJSON(c, http.StatusBadRequest, "EMAIL_VERIFICATION_DISABLED", "当前未开启邮箱验证")
		return
	}
	if !a.allow(c, "verify-email-resend", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if a.Cfg.EmailEnabled && !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "邮件服务尚未配置")
		return
	}
	user, token, err := a.Auth.IssueVerification(req.Email)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "EMAIL_VERIFICATION_FAILED", "验证邮件请求失败")
		return
	}
	data := gin.H{"accepted": true}
	if token != "" && a.Cfg.DevExposeTokens {
		data["verificationToken"] = token
	}
	if token != "" && a.Mailer != nil {
		_ = a.Mailer.SendVerification(user.Email, token)
	}
	successJSON(c, http.StatusAccepted, data)
}

func (a *Router) login(c *gin.Context) {
	if a.ipBlocked(c.ClientIP()) {
		errorJSON(c, http.StatusForbidden, "ACCESS_IP_BLOCKED", "当前访问地址已被禁止")
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if !a.loginAllowed(c, req.Email) {
		return
	}
	user, token, err := a.Auth.Login(req.Email, req.Password, c.ClientIP(), c.GetHeader("User-Agent"))
	if err != nil {
		a.recordLoginFailure(c, req.Email)
		a.recordAccessEvent(c, nil, "login", false, err.Error())
		status := http.StatusUnauthorized
		code, message := "AUTH_INVALID_CREDENTIALS", "邮箱或密码错误"
		if errors.Is(err, auth.ErrEmailNotVerified) {
			code, message = "AUTH_EMAIL_NOT_VERIFIED", "请先完成邮箱验证"
		}
		if errors.Is(err, auth.ErrUserBlocked) {
			status, code, message = http.StatusForbidden, "AUTH_USER_BLOCKED", "账号已停用"
		}
		errorJSON(c, status, code, message)
		return
	}
	a.clearLoginFailures(c, req.Email)
	a.recordAccessEvent(c, &user.ID, "login", true, "")
	a.setSessionCookie(c, token)
	successJSON(c, http.StatusOK, gin.H{"user": publicUser(user)})
}

func (a *Router) forgotPassword(c *gin.Context) {
	if !a.Cfg.EmailEnabled {
		errorJSON(c, http.StatusBadRequest, "EMAIL_SERVICE_DISABLED", "当前未启用邮箱服务")
		return
	}
	if !a.allow(c, "password-forgot", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if a.Cfg.EmailEnabled && !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "邮件服务尚未配置")
		return
	}
	token, err := a.Auth.ForgotPassword(req.Email)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "PASSWORD_RESET_FAILED", "找回密码请求失败")
		return
	}
	data := gin.H{"accepted": true}
	if a.Cfg.DevExposeTokens && token != "" {
		data["resetToken"] = token
	}
	if token != "" && a.Mailer != nil {
		var user model.User
		if a.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(req.Email))).First(&user).Error == nil {
			_ = a.Mailer.SendPasswordReset(user.Email, token)
		}
	}
	successJSON(c, http.StatusAccepted, data)
}

func (a *Router) resetPassword(c *gin.Context) {
	if !a.allow(c, "password-reset", 5, 15*time.Minute) {
		return
	}
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Token) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if err := a.Auth.ResetPassword(req.Token, req.Password); err != nil {
		errorJSON(c, http.StatusBadRequest, "AUTH_RESET_TOKEN_INVALID", "重置链接无效或已过期")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) logout(c *gin.Context) {
	if raw, err := c.Cookie(a.Cfg.SessionCookie); err == nil {
		_ = a.Auth.Logout(raw)
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(a.Cfg.SessionCookie, "", -1, "/", "", a.Cfg.CookieSecure, true)
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) me(c *gin.Context) {
	user, _ := currentUser(c)
	data := gin.H{"user": publicUser(user)}
	if summary, err := a.Quota.Summary(user.ID); err == nil {
		data["quota"] = summary
	}
	successJSON(c, http.StatusOK, data)
}

func (a *Router) models(c *gin.Context) {
	items, err := a.ModelCatalog.List(c.Query("capability"), false)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "MODELS_READ_FAILED", "模型目录读取失败")
		return
	}
	for index := range items {
		if summary, ok := a.Pricing.Summary(items[index].ID); ok {
			items[index].PriceSummary = gin.H{"type": summary.Type, "unitAmount": summary.UnitAmount, "currency": summary.Currency}
		}
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) createQuote(c *gin.Context) {
	user, _ := currentUser(c)
	var input pricing.QuoteInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	quote, err := a.Pricing.Quote(user.ID, input)
	if errors.Is(err, pricing.ErrQuoteParameter) {
		errorJSON(c, http.StatusBadRequest, "QUOTE_PARAMETER_MISMATCH", "报价参数无效")
		return
	}
	if errors.Is(err, pricing.ErrPricingUnavailable) {
		errorJSON(c, http.StatusBadRequest, "MODEL_UNAVAILABLE", "模型暂不可用")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "QUOTE_FAILED", "报价生成失败")
		return
	}
	successJSON(c, http.StatusCreated, quote)
}

func (a *Router) createGenerationTask(c *gin.Context) {
	user, _ := currentUser(c)
	var input generation.CreateInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		input.IdempotencyKey = strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	}
	task, err := a.Generation.Create(user.ID, input)
	if errors.Is(err, pricing.ErrQuoteNotFound) || errors.Is(err, pricing.ErrQuoteExpired) {
		errorJSON(c, http.StatusConflict, "QUOTE_INVALID", "报价已失效，请重新获取")
		return
	}
	if errors.Is(err, pricing.ErrQuoteParameter) {
		errorJSON(c, http.StatusBadRequest, "QUOTE_PARAMETER_MISMATCH", "报价参数与任务参数不一致")
		return
	}
	if errors.Is(err, quota.ErrInsufficient) {
		errorJSON(c, http.StatusConflict, "QUOTA_INSUFFICIENT", "可用额度不足")
		return
	}
	if errors.Is(err, generation.ErrInvalidTask) {
		errorJSON(c, http.StatusBadRequest, "TASK_INVALID", "任务参数无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "TASK_CREATE_FAILED", "生成任务创建失败")
		return
	}
	successJSON(c, http.StatusCreated, task)
}

func (a *Router) getGenerationTask(c *gin.Context) {
	user, _ := currentUser(c)
	task, err := a.Generation.Get(user.ID, c.Param("id"))
	if errors.Is(err, generation.ErrTaskNotFound) {
		errorJSON(c, http.StatusNotFound, "TASK_NOT_FOUND", "生成任务不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "TASK_READ_FAILED", "生成任务读取失败")
		return
	}
	successJSON(c, http.StatusOK, task)
}

func (a *Router) executeGenerationTask(c *gin.Context) {
	user, _ := currentUser(c)
	task, err := a.Relay.Execute(c.Request.Context(), user.ID, c.Param("id"), relay.ExecuteMeta{RequestID: c.GetString("requestId"), IP: c.ClientIP(), RequestType: "generation"})
	if errors.Is(err, relay.ErrTaskNotFound) {
		errorJSON(c, http.StatusNotFound, "TASK_NOT_FOUND", "生成任务不存在")
		return
	}
	if errors.Is(err, relay.ErrRouteUnavailable) {
		errorJSON(c, http.StatusServiceUnavailable, "ROUTE_UNAVAILABLE", "模型暂时没有可用渠道")
		return
	}
	if errors.Is(err, relay.ErrUnsupported) {
		errorJSON(c, http.StatusBadRequest, "CAPABILITY_UNSUPPORTED", "当前模型能力暂不支持托管生成")
		return
	}
	if err != nil {
		// The task has already been marked failed by Relay. Return the task view
		// so the client can display the persisted failure state and error code.
		if task.ID != "" {
			successJSON(c, http.StatusOK, task)
			return
		}
		errorJSON(c, http.StatusBadGateway, "UPSTREAM_GENERATION_FAILED", "上游模型生成失败")
		return
	}
	successJSON(c, http.StatusOK, task)
}

func (a *Router) adminUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize"))
	result, err := a.Admin.ListUsers(adminservice.UserFilter{Query: c.Query("q"), Status: c.Query("status"), Role: c.Query("role"), GroupName: c.Query("groupName"), Page: page, PageSize: pageSize})
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USERS_READ_FAILED", "用户列表读取失败")
		return
	}
	successJSON(c, http.StatusOK, result)
}

func (a *Router) adminUser(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	user, err := a.Admin.GetUser(id)
	if errors.Is(err, adminservice.ErrUserNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USER_READ_FAILED", "用户读取失败")
		return
	}
	ledger, _, ledgerErr := a.Admin.UserLedger(id, 20, 0)
	if ledgerErr != nil {
		errorJSON(c, http.StatusInternalServerError, "USER_LEDGER_READ_FAILED", "额度流水读取失败")
		return
	}
	usage, usageErr := a.Admin.UserUsage(id, 1, 10)
	if usageErr != nil {
		errorJSON(c, http.StatusInternalServerError, "USER_USAGE_READ_FAILED", "用户使用记录读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"user": user, "ledger": ledger, "usage": usage.Items})
}

func (a *Router) adminCreateUser(c *gin.Context) {
	var input adminservice.UserInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户参数无效")
		return
	}
	created, err := a.Admin.CreateUser(input)
	if errors.Is(err, adminservice.ErrInvalidUser) {
		errorJSON(c, http.StatusBadRequest, "USER_INVALID", "用户信息或密码无效")
		return
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		errorJSON(c, http.StatusConflict, "ACCOUNT_EXISTS", "用户名或邮箱已存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_CREATE_FAILED", "用户创建失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "user.create", "user", created.ID)
	successJSON(c, http.StatusCreated, created)
}

func (a *Router) adminUpdateUser(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	var input adminservice.UpdateUserInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户参数无效")
		return
	}
	updated, err := a.Admin.UpdateUser(id, input)
	if errors.Is(err, adminservice.ErrUserNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if errors.Is(err, adminservice.ErrInvalidStatus) || errors.Is(err, adminservice.ErrInvalidRole) {
		errorJSON(c, http.StatusBadRequest, "USER_INVALID", "用户状态或角色无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_UPDATE_FAILED", "用户更新失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "user.update", "user", id)
	successJSON(c, http.StatusOK, updated)
}

func (a *Router) adminUserStatus(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户状态无效")
		return
	}
	updated, err := a.Admin.SetStatus(id, input.Status)
	if errors.Is(err, adminservice.ErrUserNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if errors.Is(err, adminservice.ErrInvalidStatus) {
		errorJSON(c, http.StatusBadRequest, "USER_STATUS_INVALID", "用户状态无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_STATUS_UPDATE_FAILED", "用户状态更新失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "user.status", "user", id)
	successJSON(c, http.StatusOK, updated)
}

func (a *Router) adminUserPassword(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	var input struct {
		NewPassword string `json:"newPassword"`
	}
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "密码参数无效")
		return
	}
	temporary, err := a.Admin.ResetPassword(id, input.NewPassword)
	if errors.Is(err, adminservice.ErrUserNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_NOT_FOUND", "用户不存在")
		return
	}
	if errors.Is(err, adminservice.ErrInvalidPassword) {
		errorJSON(c, http.StatusBadRequest, "PASSWORD_INVALID", "密码长度应为 8 到 72 位")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "PASSWORD_RESET_FAILED", "密码重置失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "user.password_reset", "user", id)
	successJSON(c, http.StatusOK, gin.H{"temporaryPassword": temporary})
}

func (a *Router) adminUserQuota(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	var input struct {
		Delta          int64  `json:"delta"`
		Source         string `json:"source"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Delta == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "额度调整参数无效")
		return
	}
	if strings.TrimSpace(input.IdempotencyKey) == "" {
		input.IdempotencyKey = uuid.NewString()
	}
	if strings.TrimSpace(input.Source) == "" {
		input.Source = "admin"
	}
	if err := a.Admin.AdjustQuota(id, input.Delta, input.Source, input.Reason, input.IdempotencyKey); err != nil {
		if errors.Is(err, quota.ErrAccountNotFound) {
			errorJSON(c, http.StatusNotFound, "QUOTA_ACCOUNT_NOT_FOUND", "额度账户不存在")
			return
		}
		if errors.Is(err, quota.ErrInsufficient) {
			errorJSON(c, http.StatusConflict, "QUOTA_INSUFFICIENT", "额度余额不足")
			return
		}
		errorJSON(c, http.StatusBadRequest, "QUOTA_ADJUSTMENT_FAILED", "额度调整失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "quota.adjust", "user", id)
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) adminUserUsage(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "用户编号无效")
		return
	}
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize"))
	result, err := a.Admin.UserUsage(id, page, pageSize)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USAGE_READ_FAILED", "使用记录读取失败")
		return
	}
	successJSON(c, http.StatusOK, result)
}

func (a *Router) adminUsageLogs(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize"))
	from, _ := time.Parse(time.RFC3339, c.Query("from"))
	to, _ := time.Parse(time.RFC3339, c.Query("to"))
	userID, _ := strconv.ParseUint(c.Query("userId"), 10, 64)
	result, err := a.Admin.ListUsageLogs(adminservice.UsageFilter{Query: c.Query("q"), User: c.Query("user"), UserID: uint(userID), Model: c.Query("model"), Channel: c.Query("channel"), Status: c.Query("status"), RequestID: c.Query("requestId"), From: from, To: to, Page: page, PageSize: pageSize})
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USAGE_LOGS_READ_FAILED", "使用日志读取失败")
		return
	}
	successJSON(c, http.StatusOK, result)
}

func (a *Router) adminUsageLog(c *gin.Context) {
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "日志编号无效")
		return
	}
	item, err := a.Admin.GetUsageLog(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		errorJSON(c, http.StatusNotFound, "USAGE_LOG_NOT_FOUND", "使用日志不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USAGE_LOG_READ_FAILED", "使用日志读取失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func parseAdminID(value string) (uint, error) {
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil || id == 0 {
		return 0, errors.New("invalid id")
	}
	return uint(id), nil
}

func (a *Router) cancelGenerationTask(c *gin.Context) {
	user, _ := currentUser(c)
	task, err := a.Generation.Cancel(user.ID, c.Param("id"))
	if errors.Is(err, generation.ErrTaskNotFound) {
		errorJSON(c, http.StatusNotFound, "TASK_NOT_FOUND", "生成任务不存在")
		return
	}
	if errors.Is(err, generation.ErrInvalidTransition) {
		errorJSON(c, http.StatusConflict, "TASK_NOT_CANCELLABLE", "当前任务状态不允许取消")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "TASK_CANCEL_FAILED", "生成任务取消失败")
		return
	}
	successJSON(c, http.StatusOK, task)
}

func (a *Router) adminPricing(c *gin.Context) {
	items, err := a.Pricing.List(true)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "PRICING_READ_FAILED", "定价版本读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminCreatePricing(c *gin.Context) {
	var input pricing.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	operator, _ := currentUser(c)
	item, err := a.Pricing.Create(operator.ID, input)
	if errors.Is(err, pricing.ErrInvalidPricing) {
		errorJSON(c, http.StatusBadRequest, "PRICING_INVALID", "定价规则无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "PRICING_CREATE_FAILED", "定价版本创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) adminPublishPricing(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "定价版本编号无效")
		return
	}
	operator, _ := currentUser(c)
	item, err := a.Pricing.Publish(operator.ID, uint(id))
	if errors.Is(err, pricing.ErrPricingNotFound) {
		errorJSON(c, http.StatusNotFound, "PRICING_NOT_FOUND", "定价版本不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "PRICING_PUBLISH_FAILED", "定价版本发布失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) adminRetirePricing(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "定价版本编号无效")
		return
	}
	operator, _ := currentUser(c)
	if err := a.Pricing.Retire(operator.ID, uint(id)); err != nil {
		if errors.Is(err, pricing.ErrPricingNotFound) {
			errorJSON(c, http.StatusNotFound, "PRICING_NOT_FOUND", "定价版本不存在")
			return
		}
		errorJSON(c, http.StatusBadRequest, "PRICING_RETIRE_FAILED", "定价版本停用失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) adminModels(c *gin.Context) {
	items, err := a.ModelCatalog.List(c.Query("capability"), true)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "MODELS_READ_FAILED", "模型目录读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminCreateModel(c *gin.Context) {
	var input modelcatalog.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ModelCatalog.Create(input)
	if errors.Is(err, modelcatalog.ErrInvalidModel) {
		errorJSON(c, http.StatusBadRequest, "MODEL_INVALID", "模型配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "MODEL_CREATE_FAILED", "模型创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "model.create", "published_model", item.ID)
}

func (a *Router) adminUpdateModel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "模型编号无效")
		return
	}
	var input modelcatalog.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ModelCatalog.Update(uint(id), input)
	if errors.Is(err, modelcatalog.ErrModelNotFound) {
		errorJSON(c, http.StatusNotFound, "MODEL_NOT_FOUND", "模型不存在")
		return
	}
	if errors.Is(err, modelcatalog.ErrInvalidModel) {
		errorJSON(c, http.StatusBadRequest, "MODEL_INVALID", "模型配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "MODEL_UPDATE_FAILED", "模型更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "model.update", "published_model", item.ID)
}

func (a *Router) adminDeleteModel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "模型编号无效")
		return
	}
	if err := a.ModelCatalog.Hide(uint(id)); err != nil {
		if errors.Is(err, modelcatalog.ErrModelNotFound) {
			errorJSON(c, http.StatusNotFound, "MODEL_NOT_FOUND", "模型不存在")
			return
		}
		errorJSON(c, http.StatusBadRequest, "MODEL_DELETE_FAILED", "模型下线失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
	_ = model.RecordAudit(a.DB, operatorID(c), "model.hide", "published_model", uint(id))
}

func (a *Router) adminChannels(c *gin.Context) {
	items, err := a.ChannelCatalog.ListChannels(true)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "CHANNELS_READ_FAILED", "渠道列表读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminFetchChannelModels(c *gin.Context) {
	var input channelcatalog.FetchModelsInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	items, err := a.ChannelCatalog.FetchModels(c.Request.Context(), input)
	if errors.Is(err, channelcatalog.ErrInvalidChannel) {
		errorJSON(c, http.StatusBadRequest, "CHANNEL_INVALID", "渠道地址或密钥无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadGateway, "CHANNEL_MODELS_FETCH_FAILED", "渠道模型读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminTestChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	result, err := a.ChannelCatalog.TestChannel(c.Request.Context(), uint(id))
	if errors.Is(err, channelcatalog.ErrChannelNotFound) {
		errorJSON(c, http.StatusNotFound, "CHANNEL_NOT_FOUND", "渠道不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadGateway, "CHANNEL_TEST_FAILED", result.Message)
		return
	}
	successJSON(c, http.StatusOK, result)
}

func (a *Router) adminCreateChannel(c *gin.Context) {
	var input channelcatalog.ChannelInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ChannelCatalog.CreateChannel(input)
	if errors.Is(err, channelcatalog.ErrInvalidChannel) {
		errorJSON(c, http.StatusBadRequest, "CHANNEL_INVALID", "渠道配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "CHANNEL_CREATE_FAILED", "渠道创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "channel.create", "upstream_channel", item.ID)
}

func (a *Router) adminUpdateChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	var input channelcatalog.ChannelInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ChannelCatalog.UpdateChannel(uint(id), input)
	if errors.Is(err, channelcatalog.ErrChannelNotFound) {
		errorJSON(c, http.StatusNotFound, "CHANNEL_NOT_FOUND", "渠道不存在")
		return
	}
	if errors.Is(err, channelcatalog.ErrInvalidChannel) {
		errorJSON(c, http.StatusBadRequest, "CHANNEL_INVALID", "渠道配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "CHANNEL_UPDATE_FAILED", "渠道更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "channel.update", "upstream_channel", item.ID)
}

func (a *Router) adminDeleteChannel(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	if err := a.ChannelCatalog.HideChannel(uint(id)); err != nil {
		if errors.Is(err, channelcatalog.ErrChannelNotFound) {
			errorJSON(c, http.StatusNotFound, "CHANNEL_NOT_FOUND", "渠道不存在")
			return
		}
		errorJSON(c, http.StatusBadRequest, "CHANNEL_DELETE_FAILED", "渠道下线失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
	_ = model.RecordAudit(a.DB, operatorID(c), "channel.hide", "upstream_channel", uint(id))
}

func (a *Router) adminModelRoutes(c *gin.Context) {
	items, err := a.ChannelCatalog.ListRoutes(true)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "MODEL_ROUTES_READ_FAILED", "模型路由读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminCreateModelRoute(c *gin.Context) {
	var input channelcatalog.RouteInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ChannelCatalog.CreateRoute(input)
	if errors.Is(err, channelcatalog.ErrInvalidRoute) || errors.Is(err, channelcatalog.ErrPublishedNotFound) || errors.Is(err, channelcatalog.ErrChannelNotFound) {
		errorJSON(c, http.StatusBadRequest, "MODEL_ROUTE_INVALID", "模型路由配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "MODEL_ROUTE_CREATE_FAILED", "模型路由创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "model_route.create", "model_route", item.ID)
}

func (a *Router) adminUpdateModelRoute(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "路由编号无效")
		return
	}
	var input channelcatalog.RouteInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.ChannelCatalog.UpdateRoute(uint(id), input)
	if errors.Is(err, channelcatalog.ErrRouteNotFound) {
		errorJSON(c, http.StatusNotFound, "MODEL_ROUTE_NOT_FOUND", "模型路由不存在")
		return
	}
	if errors.Is(err, channelcatalog.ErrInvalidRoute) || errors.Is(err, channelcatalog.ErrPublishedNotFound) || errors.Is(err, channelcatalog.ErrChannelNotFound) {
		errorJSON(c, http.StatusBadRequest, "MODEL_ROUTE_INVALID", "模型路由配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "MODEL_ROUTE_UPDATE_FAILED", "模型路由更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
	_ = model.RecordAudit(a.DB, operatorID(c), "model_route.update", "model_route", item.ID)
}

func (a *Router) adminDeleteModelRoute(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "路由编号无效")
		return
	}
	if err := a.ChannelCatalog.HideRoute(uint(id)); err != nil {
		if errors.Is(err, channelcatalog.ErrRouteNotFound) {
			errorJSON(c, http.StatusNotFound, "MODEL_ROUTE_NOT_FOUND", "模型路由不存在")
			return
		}
		errorJSON(c, http.StatusBadRequest, "MODEL_ROUTE_DELETE_FAILED", "模型路由下线失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
	_ = model.RecordAudit(a.DB, operatorID(c), "model_route.hide", "model_route", uint(id))
}

func (a *Router) accountQuota(c *gin.Context) {
	user, _ := currentUser(c)
	summary, err := a.Quota.Summary(user.ID)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "QUOTA_READ_FAILED", "额度读取失败")
		return
	}
	successJSON(c, http.StatusOK, summary)
}

func (a *Router) userChannels(c *gin.Context) {
	user, _ := currentUser(c)
	items, entitlement, err := a.UserChannels.List(user.ID)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "USER_CHANNELS_READ_FAILED", "自定义渠道读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items, "entitlement": entitlement})
}

func (a *Router) userChannelCreate(c *gin.Context) {
	user, _ := currentUser(c)
	var input userchannel.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道参数无效")
		return
	}
	item, err := a.UserChannels.Create(user.ID, input)
	if errors.Is(err, userchannel.ErrEntitlementRequired) {
		errorJSON(c, http.StatusForbidden, "CUSTOM_CHANNEL_PLAN_REQUIRED", "请先开通自定义渠道套餐")
		return
	}
	if errors.Is(err, userchannel.ErrInvalidChannel) {
		errorJSON(c, http.StatusBadRequest, "USER_CHANNEL_INVALID", "渠道配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_CHANNEL_CREATE_FAILED", "渠道创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) userChannelUpdate(c *gin.Context) {
	user, _ := currentUser(c)
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	var input userchannel.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道参数无效")
		return
	}
	item, err := a.UserChannels.Update(user.ID, id, input)
	if errors.Is(err, userchannel.ErrChannelNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_CHANNEL_NOT_FOUND", "渠道不存在")
		return
	}
	if errors.Is(err, userchannel.ErrInvalidChannel) {
		errorJSON(c, http.StatusBadRequest, "USER_CHANNEL_INVALID", "渠道配置无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_CHANNEL_UPDATE_FAILED", "渠道更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) userChannelDelete(c *gin.Context) {
	user, _ := currentUser(c)
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	if err := a.UserChannels.Delete(user.ID, id); errors.Is(err, userchannel.ErrChannelNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_CHANNEL_NOT_FOUND", "渠道不存在")
		return
	} else if err != nil {
		errorJSON(c, http.StatusBadRequest, "USER_CHANNEL_DELETE_FAILED", "渠道停用失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) userChannelTest(c *gin.Context) {
	user, _ := currentUser(c)
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "渠道编号无效")
		return
	}
	item, err := a.UserChannels.Test(user.ID, id)
	if errors.Is(err, userchannel.ErrChannelNotFound) {
		errorJSON(c, http.StatusNotFound, "USER_CHANNEL_NOT_FOUND", "渠道不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadGateway, "USER_CHANNEL_TEST_FAILED", "渠道连接测试失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) accountLedger(c *gin.Context) {
	user, _ := currentUser(c)
	limit, offset := pageParams(c)
	items, hasMore, err := a.Quota.Ledger(user.ID, limit, offset)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "QUOTA_LEDGER_READ_FAILED", "额度流水读取失败")
		return
	}
	nextCursor := ""
	if hasMore {
		nextCursor = fmt.Sprintf("%d", offset+len(items))
	}
	successJSON(c, http.StatusOK, gin.H{"items": items, "nextCursor": nextCursor})
}

func (a *Router) rechargeProducts(c *gin.Context) {
	products, err := a.Payment.Products(false)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "RECHARGE_PRODUCTS_READ_FAILED", "充值套餐读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": products})
}

func (a *Router) createRechargeOrder(c *gin.Context) {
	user, _ := currentUser(c)
	var req struct {
		ProductID       uint   `json:"productId"`
		PaymentProvider string `json:"paymentProvider"`
		PaymentMethod   string `json:"paymentMethod"`
		IdempotencyKey  string `json:"idempotencyKey"`
	}
	if c.ShouldBindJSON(&req) != nil || req.ProductID == 0 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	}
	order, checkout, err := a.Payment.CreateOrder(user.ID, req.ProductID, req.PaymentProvider, req.PaymentMethod, idempotencyKey)
	if err != nil {
		status := http.StatusBadRequest
		code := "RECHARGE_ORDER_CREATE_FAILED"
		message := "\u5145\u503c\u8ba2\u5355\u521b\u5efa\u5931\u8d25"
		if errors.Is(err, payment.ErrProviderUnavailable) {
			status, code = http.StatusServiceUnavailable, "PAYMENT_PROVIDER_UNAVAILABLE"
		}
		if errors.Is(err, payment.ErrCallbackUnavailable) {
			status, code = http.StatusServiceUnavailable, "PAYMENT_CALLBACK_UNAVAILABLE"
			message = "\u652f\u4ed8\u56de\u8c03\u5730\u5740\u9700\u8981\u4f7f\u7528\u652f\u4ed8\u7f51\u5173\u53ef\u4ee5\u8bbf\u95ee\u7684\u516c\u7f51\u5730\u5740\uff0c\u8bf7\u5728\u652f\u4ed8\u8bbe\u7f6e\u4e2d\u586b\u5199\u57df\u540d\u5730\u5740"
		}
		if errors.Is(err, payment.ErrProductUnavailable) {
			status, code = http.StatusConflict, "RECHARGE_PRODUCT_UNAVAILABLE"
		}
		errorJSON(c, status, code, message)
		return
	}
	successJSON(c, http.StatusCreated, gin.H{"order": order, "checkout": checkout})
}

func (a *Router) rechargeOrder(c *gin.Context) {
	user, _ := currentUser(c)
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "订单编号无效")
		return
	}
	order, checkout, err := a.Payment.Order(user.ID, uint(id))
	if err != nil {
		errorJSON(c, http.StatusNotFound, "RECHARGE_ORDER_NOT_FOUND", "充值订单不存在")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"order": order, "checkout": checkout})
}

func (a *Router) epayWebhook(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if err := a.Payment.HandleEpayWebhook(c.Request.Form); err != nil {
		if errors.Is(err, payment.ErrSignatureInvalid) {
			c.String(http.StatusUnauthorized, "fail")
			return
		}
		c.String(http.StatusBadRequest, "fail")
		return
	}
	c.String(http.StatusOK, "success")
}

func (a *Router) epayReturn(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		c.Redirect(http.StatusFound, strings.TrimRight(a.Cfg.PublicWebURL, "/")+"/billing?payment=fail")
		return
	}
	status := "pending"
	if err := a.Payment.HandleEpayWebhook(c.Request.Form); err != nil {
		status = "fail"
	} else if strings.EqualFold(c.Request.Form.Get("trade_status"), "TRADE_SUCCESS") || strings.EqualFold(c.Request.Form.Get("trade_status"), "success") {
		status = "success"
	}
	c.Redirect(http.StatusFound, strings.TrimRight(a.Cfg.PublicWebURL, "/")+"/billing?payment="+status)
}

func (a *Router) invitationSelf(c *gin.Context) {
	user, _ := currentUser(c)
	self, err := a.Invitation.Self(user.ID)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "INVITATION_READ_FAILED", "邀请信息读取失败")
		return
	}
	successJSON(c, http.StatusOK, self)
}

func (a *Router) invitationRewards(c *gin.Context) {
	user, _ := currentUser(c)
	limit, offset := pageParams(c)
	items, hasMore, err := a.Invitation.Rewards(user.ID, limit, offset)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "INVITATION_REWARDS_READ_FAILED", "邀请奖励读取失败")
		return
	}
	nextCursor := ""
	if hasMore {
		nextCursor = fmt.Sprintf("%d", offset+len(items))
	}
	successJSON(c, http.StatusOK, gin.H{"items": items, "nextCursor": nextCursor})
}

func (a *Router) invitationReferrals(c *gin.Context) {
	user, _ := currentUser(c)
	limit, offset := pageParams(c)
	items, hasMore, err := a.Invitation.Referrals(user.ID, limit, offset)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "INVITATION_REFERRALS_READ_FAILED", "邀请关系读取失败")
		return
	}
	nextCursor := ""
	if hasMore {
		nextCursor = fmt.Sprintf("%d", offset+len(items))
	}
	successJSON(c, http.StatusOK, gin.H{"items": items, "nextCursor": nextCursor})
}

func (a *Router) adminInvitationSettings(c *gin.Context) {
	settings, err := a.Invitation.Settings()
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "INVITATION_SETTINGS_READ_FAILED", "邀请奖励配置读取失败")
		return
	}
	successJSON(c, http.StatusOK, settings)
}

func (a *Router) updateAdminInvitationSettings(c *gin.Context) {
	operator, _ := currentUser(c)
	var settings invitation.Settings
	if c.ShouldBindJSON(&settings) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	updated, err := a.Invitation.UpdateSettings(operator.ID, settings)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVITATION_SETTINGS_UPDATE_FAILED", "邀请奖励配置更新失败")
		return
	}
	successJSON(c, http.StatusOK, updated)
}

func (a *Router) adminQuotaAdjustment(c *gin.Context) {
	operator, _ := currentUser(c)
	var req struct {
		UserID         uint   `json:"userId"`
		Delta          int64  `json:"delta"`
		Source         string `json:"source"`
		Reason         string `json:"reason"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if c.ShouldBindJSON(&req) != nil || req.UserID == 0 || req.Delta == 0 || strings.TrimSpace(req.IdempotencyKey) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if strings.TrimSpace(req.Source) == "" {
		req.Source = "admin"
	}
	businessID := fmt.Sprintf("%d:%d", operator.ID, time.Now().UnixNano())
	if err := a.Quota.AdjustWithReason(req.UserID, req.Delta, req.Source, businessID, strings.TrimSpace(req.IdempotencyKey), req.Reason); err != nil {
		if errors.Is(err, quota.ErrAccountNotFound) {
			errorJSON(c, http.StatusNotFound, "QUOTA_ACCOUNT_NOT_FOUND", "目标用户不存在或尚未开通额度账户")
			return
		}
		if errors.Is(err, quota.ErrInsufficient) {
			errorJSON(c, http.StatusConflict, "QUOTA_INSUFFICIENT", "额度不足")
			return
		}
		errorJSON(c, http.StatusBadRequest, "QUOTA_ADJUSTMENT_FAILED", "额度调整失败")
		return
	}
	_ = model.RecordAudit(a.DB, operator.ID, "quota.adjust", "user", req.UserID)
	successJSON(c, http.StatusOK, gin.H{"ok": true, "operatorId": operator.ID, "reason": req.Reason})
}

func (a *Router) adminRechargeProducts(c *gin.Context) {
	products, err := a.Payment.Products(true)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "RECHARGE_PRODUCTS_READ_FAILED", "充值套餐读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": products})
}

func (a *Router) adminCreateRechargeProduct(c *gin.Context) {
	var product model.TopupProduct
	if c.ShouldBindJSON(&product) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	created, err := a.Payment.UpsertProduct(product)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "RECHARGE_PRODUCT_INVALID", "充值套餐配置无效")
		return
	}
	successJSON(c, http.StatusCreated, created)
	_ = model.RecordAudit(a.DB, operatorID(c), "recharge_product.create", "topup_product", created.ID)
}

func (a *Router) adminUpdateRechargeProduct(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "套餐编号无效")
		return
	}
	var product model.TopupProduct
	if c.ShouldBindJSON(&product) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	product.ID = uint(id)
	updated, err := a.Payment.UpsertProduct(product)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "RECHARGE_PRODUCT_INVALID", "充值套餐配置无效")
		return
	}
	successJSON(c, http.StatusOK, updated)
	_ = model.RecordAudit(a.DB, operatorID(c), "recharge_product.update", "topup_product", updated.ID)
}

func (a *Router) adminPaymentSettings(c *gin.Context) {
	settings, err := a.Payment.EpaySettings()
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "PAYMENT_SETTINGS_READ_FAILED", "支付配置读取失败")
		return
	}
	settings.Key = ""
	successJSON(c, http.StatusOK, settings)
}

func (a *Router) updateAdminPaymentSettings(c *gin.Context) {
	operator, _ := currentUser(c)
	var settings payment.EpaySettings
	if c.ShouldBindJSON(&settings) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	updated, err := a.Payment.UpdateEpaySettings(operator.ID, settings)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "PAYMENT_SETTINGS_UPDATE_FAILED", "支付配置更新失败")
		return
	}
	updated.Key = ""
	successJSON(c, http.StatusOK, updated)
	_ = model.RecordAudit(a.DB, operator.ID, "payment.settings.update", "payment_settings", "")
}

func (a *Router) adminEmailSettings(c *gin.Context) {
	settings := a.Cfg.EmailSettings()
	var row model.OperationSetting
	if err := a.DB.Where("`key` = ?", "email.smtp").First(&row).Error; err == nil {
		if jsonErr := json.Unmarshal([]byte(row.Value), &settings); jsonErr != nil {
			errorJSON(c, http.StatusInternalServerError, "EMAIL_SETTINGS_READ_FAILED", "邮箱配置读取失败")
			return
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		errorJSON(c, http.StatusInternalServerError, "EMAIL_SETTINGS_READ_FAILED", "邮箱配置读取失败")
		return
	}
	settings.SMTPPassword = ""
	successJSON(c, http.StatusOK, settings)
}

func (a *Router) updateAdminEmailSettings(c *gin.Context) {
	operator, _ := currentUser(c)
	var settings config.EmailSettings
	if c.ShouldBindJSON(&settings) != nil || settings.SMTPPort < 1 || settings.SMTPPort > 65535 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "邮箱配置无效")
		return
	}
	current := a.Cfg.EmailSettings()
	settings.AllowedDomains = normalizeEmailDomains(settings.AllowedDomains)
	settings.BlockedDomains = normalizeEmailDomains(settings.BlockedDomains)
	if settings.DomainRestrictionEnabled && len(settings.AllowedDomains) == 0 {
		errorJSON(c, http.StatusBadRequest, "EMAIL_ALLOWED_DOMAINS_REQUIRED", "allowed domains are required when restriction is enabled")
		return
	}
	if strings.TrimSpace(settings.SMTPPassword) == "" {
		settings.SMTPPassword = current.SMTPPassword
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "邮箱配置无效")
		return
	}
	if err = a.DB.Transaction(func(tx *gorm.DB) error {
		var row model.OperationSetting
		findErr := tx.Where("`key` = ?", "email.smtp").First(&row).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			return tx.Create(&model.OperationSetting{Key: "email.smtp", Value: string(payload), Version: 1, UpdatedBy: &operator.ID}).Error
		}
		if findErr != nil {
			return findErr
		}
		row.Value, row.Version, row.UpdatedBy = string(payload), row.Version+1, &operator.ID
		return tx.Save(&row).Error
	}); err != nil {
		errorJSON(c, http.StatusBadRequest, "EMAIL_SETTINGS_UPDATE_FAILED", "邮箱配置更新失败")
		return
	}
	a.Cfg.ApplyEmailSettings(settings)
	a.Auth.Cfg.ApplyEmailSettings(settings)
	a.Invitation.Cfg.ApplyEmailSettings(settings)
	if smtp, ok := a.Mailer.(*mailer.SMTP); ok {
		smtp.UpdateConfig(a.Cfg)
	}
	settings.SMTPPassword = ""
	successJSON(c, http.StatusOK, settings)
	_ = model.RecordAudit(a.DB, operator.ID, "email.settings.update", "email_settings", "")
}

func (a *Router) testAdminEmailSettings(c *gin.Context) {
	var req struct {
		Email string `json:"email"`
	}
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Email) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请输入测试收件邮箱")
		return
	}
	address, err := mail.ParseAddress(strings.TrimSpace(req.Email))
	if err != nil || address.Address != strings.TrimSpace(req.Email) {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "测试收件邮箱格式无效")
		return
	}
	if !a.Cfg.EmailEnabled || a.Mailer == nil || !a.Mailer.Ready() {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "请先完成 SMTP 配置")
		return
	}
	if err := a.Mailer.SendTest(address.Address); err != nil {
		errorJSON(c, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "测试邮件发送失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"sent": true})
}

func (a *Router) adminSystemRelease(c *gin.Context) {
	release, err := a.Version.Check(c.Request.Context())
	if err != nil {
		errorJSON(c, http.StatusBadGateway, "RELEASE_CHECK_FAILED", "版本信息读取失败")
		return
	}
	job, jobErr := a.Version.LatestJob()
	if jobErr == nil {
		release.UpdateJob = job
	}
	successJSON(c, http.StatusOK, release)
}

func (a *Router) adminSystemUpdate(c *gin.Context) {
	var input struct {
		Version string `json:"version"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Version) == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "目标版本无效")
		return
	}
	job, err := a.Version.QueueUpdate(operatorID(c), input.Version)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "RELEASE_UPDATE_QUEUE_FAILED", "更新任务创建失败")
		return
	}
	_ = model.RecordAudit(a.DB, operatorID(c), "system.update.request", "system_update", input.Version)
	successJSON(c, http.StatusAccepted, job)
}

type securityAccessSettings struct {
	IPLoggingEnabled bool `json:"ipLoggingEnabled"`
}

func (a *Router) adminSecurityAccess(c *gin.Context) {
	settings := securityAccessSettings{IPLoggingEnabled: true}
	var setting model.OperationSetting
	if err := a.DB.Where("`key` = ?", "security.access").First(&setting).Error; err == nil {
		_ = json.Unmarshal([]byte(setting.Value), &settings)
	}
	var events []model.AccessEvent
	if err := a.DB.Order("id DESC").Limit(100).Find(&events).Error; err != nil {
		errorJSON(c, http.StatusInternalServerError, "SECURITY_EVENTS_READ_FAILED", "安全事件读取失败")
		return
	}
	var sessions []model.Session
	if err := a.DB.Where("revoked_at IS NULL AND expires_at > ?", time.Now().UTC()).Order("created_at DESC").Limit(100).Find(&sessions).Error; err != nil {
		errorJSON(c, http.StatusInternalServerError, "SECURITY_SESSIONS_READ_FAILED", "会话读取失败")
		return
	}
	var blocks []model.IPBlock
	if err := a.DB.Where("status = ?", model.IPBlockActive).Order("id DESC").Find(&blocks).Error; err != nil {
		errorJSON(c, http.StatusInternalServerError, "SECURITY_BLOCKS_READ_FAILED", "IP 黑名单读取失败")
		return
	}
	var audits []model.AuditLog
	_ = a.DB.Order("id DESC").Limit(100).Find(&audits).Error
	successJSON(c, http.StatusOK, gin.H{"settings": settings, "events": events, "sessions": sessions, "blocks": blocks, "audits": audits})
}

func (a *Router) updateAdminSecuritySettings(c *gin.Context) {
	operator, _ := currentUser(c)
	var settings securityAccessSettings
	if c.ShouldBindJSON(&settings) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "安全设置无效")
		return
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "安全设置无效")
		return
	}
	var row model.OperationSetting
	findErr := a.DB.Where("`key` = ?", "security.access").First(&row).Error
	if errors.Is(findErr, gorm.ErrRecordNotFound) {
		row = model.OperationSetting{Key: "security.access", Value: string(payload), Version: 1}
	} else if findErr != nil {
		errorJSON(c, http.StatusInternalServerError, "SECURITY_SETTINGS_READ_FAILED", "安全设置读取失败")
		return
	} else {
		row.Value, row.Version = string(payload), row.Version+1
	}
	row.UpdatedBy = &operator.ID
	if err := a.DB.Save(&row).Error; err != nil {
		errorJSON(c, http.StatusBadRequest, "SECURITY_SETTINGS_UPDATE_FAILED", "安全设置保存失败")
		return
	}
	_ = model.RecordAudit(a.DB, operator.ID, "security.settings.update", "security_access", "")
	successJSON(c, http.StatusOK, settings)
}

func (a *Router) createIPBlock(c *gin.Context) {
	operator, _ := currentUser(c)
	var input struct {
		Value  string `json:"value"`
		Reason string `json:"reason"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Value) == "" || len(input.Value) > 128 {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "IP 或网段无效")
		return
	}
	block := model.IPBlock{Value: strings.TrimSpace(input.Value), Reason: strings.TrimSpace(input.Reason), Status: model.IPBlockActive}
	if err := a.DB.Create(&block).Error; err != nil {
		errorJSON(c, http.StatusBadRequest, "IP_BLOCK_CREATE_FAILED", "IP 黑名单保存失败")
		return
	}
	_ = model.RecordAudit(a.DB, operator.ID, "security.ip_block.create", "ip_block", block.ID)
	successJSON(c, http.StatusCreated, block)
}

func (a *Router) deleteIPBlock(c *gin.Context) {
	operator, _ := currentUser(c)
	id, err := parseAdminID(c.Param("id"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "编号无效")
		return
	}
	result := a.DB.Model(&model.IPBlock{}).Where("id = ?", id).Update("status", model.IPBlockHidden)
	if result.Error != nil {
		errorJSON(c, http.StatusBadRequest, "IP_BLOCK_DELETE_FAILED", "IP 黑名单删除失败")
		return
	}
	_ = model.RecordAudit(a.DB, operator.ID, "security.ip_block.delete", "ip_block", id)
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) revokeSecuritySession(c *gin.Context) {
	operator, _ := currentUser(c)
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "会话编号无效")
		return
	}
	now := time.Now().UTC()
	result := a.DB.Model(&model.Session{}).Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", &now)
	if result.Error != nil {
		errorJSON(c, http.StatusBadRequest, "SESSION_REVOKE_FAILED", "会话撤销失败")
		return
	}
	_ = model.RecordAudit(a.DB, operator.ID, "security.session.revoke", "session", id)
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) recordAccessEvent(c *gin.Context, userID *uint, eventType string, success bool, detail string) {
	var settings securityAccessSettings
	settings.IPLoggingEnabled = true
	var row model.OperationSetting
	if a.DB.Where("`key` = ?", "security.access").First(&row).Error == nil {
		_ = json.Unmarshal([]byte(row.Value), &settings)
	}
	if !settings.IPLoggingEnabled {
		return
	}
	detail = strings.TrimSpace(detail)
	if len(detail) > 512 {
		detail = detail[:512]
	}
	_ = a.DB.Create(&model.AccessEvent{UserID: userID, EventType: eventType, IP: c.ClientIP(), UserAgent: c.GetHeader("User-Agent"), Success: success, Detail: detail}).Error
}

func (a *Router) ipBlocked(value string) bool {
	var blocks []model.IPBlock
	if a.DB.Where("status = ?", model.IPBlockActive).Find(&blocks).Error != nil {
		return false
	}
	ip := net.ParseIP(strings.TrimSpace(value))
	for _, block := range blocks {
		candidate := strings.TrimSpace(block.Value)
		if candidate == value {
			return true
		}
		if _, network, err := net.ParseCIDR(candidate); err == nil && ip != nil && network.Contains(ip) {
			return true
		}
	}
	return false
}

func normalizeEmailDomains(domains []string) []string {
	result := make([]string, 0, len(domains))
	seen := make(map[string]struct{}, len(domains))
	for _, value := range domains {
		domain := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(value, "@")))
		if domain == "" {
			continue
		}
		if _, exists := seen[domain]; exists {
			continue
		}
		seen[domain] = struct{}{}
		result = append(result, domain)
	}
	return result
}

func pageParams(c *gin.Context) (int, int) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("cursor"))
	if limit <= 0 {
		limit = 50
	}
	return limit, offset
}

func (a *Router) requireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.authenticate(c) {
			return
		}
		c.Next()
	}
}

func (a *Router) requireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.authenticate(c) {
			return
		}
		user, _ := currentUser(c)
		if user.Role != model.RoleAdmin {
			errorJSON(c, http.StatusForbidden, "ADMIN_FORBIDDEN", "需要管理员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (a *Router) authenticate(c *gin.Context) bool {
	raw, err := c.Cookie(a.Cfg.SessionCookie)
	if err != nil {
		errorJSON(c, http.StatusUnauthorized, "AUTH_REQUIRED", "请先登录")
		c.Abort()
		return false
	}
	user, session, err := a.Auth.UserBySession(raw)
	if err != nil {
		errorJSON(c, http.StatusUnauthorized, "AUTH_SESSION_EXPIRED", "登录状态已失效")
		c.Abort()
		return false
	}
	c.Set("user", user)
	c.Set("session", session)
	a.setSessionCookie(c, raw)
	return true
}

func (a *Router) allowGuard(action string, limit int64, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !a.allow(c, action, limit, window) {
			return
		}
		c.Next()
	}
}

func (a *Router) allow(c *gin.Context, action string, limit int64, window time.Duration) bool {
	if a.Redis == nil {
		return true
	}
	key := "ic:rate:" + action + ":" + c.ClientIP()
	count, err := a.Redis.Incr(c.Request.Context(), key).Result()
	if err != nil {
		return true
	}
	if count == 1 {
		_ = a.Redis.Expire(c.Request.Context(), key, window).Err()
	}
	if count > limit {
		errorJSON(c, http.StatusTooManyRequests, "RATE_LIMITED", "请求过于频繁，请稍后再试")
		c.Abort()
		return false
	}
	return true
}

func currentUser(c *gin.Context) (model.User, bool) {
	value, ok := c.Get("user")
	if !ok {
		return model.User{}, false
	}
	user, ok := value.(model.User)
	return user, ok
}

// operatorID returns the acting administrator's id for audit records; admin
// routes are already behind requireAdmin so a missing user is not expected.
func operatorID(c *gin.Context) uint {
	user, _ := currentUser(c)
	return user.ID
}

func (a *Router) setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(a.Cfg.SessionCookie, token, int(a.Cfg.SessionTTL.Seconds()), "/", "", a.Cfg.CookieSecure, true)
}

func publicUser(user model.User) gin.H {
	return gin.H{"id": user.ID, "username": user.Username, "email": user.Email, "displayName": user.DisplayName, "remark": user.Remark, "groupName": user.GroupName, "status": user.Status, "role": user.Role, "emailVerifiedAt": user.EmailVerifiedAt}
}

func errorJSON(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}, "requestId": c.GetString("requestId")})
}

func successJSON(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"data": data, "requestId": c.GetString("requestId")})
}

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-Id")
		if id == "" {
			id = uuid.NewString()
		}
		c.Set("requestId", id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

func (a *Router) health(c *gin.Context) {
	status := http.StatusOK
	checks := gin.H{"mysql": "ok", "redis": "ok"}
	sqlDB, err := a.DB.DB()
	if err != nil || sqlDB.PingContext(c.Request.Context()) != nil {
		status, checks["mysql"] = http.StatusServiceUnavailable, "error"
	}
	if a.Redis == nil || a.Redis.Ping(c.Request.Context()).Err() != nil {
		status, checks["redis"] = http.StatusServiceUnavailable, "error"
	}
	c.JSON(status, gin.H{"status": map[bool]string{true: "ok", false: "error"}[status == http.StatusOK], "checks": checks})
}

func (a *Router) loginAllowed(c *gin.Context, email string) bool {
	if a.Redis == nil {
		return true
	}
	ctx := c.Request.Context()
	keys := a.loginRateKeys(c.ClientIP(), email)
	for _, key := range keys {
		count, err := a.Redis.Get(ctx, key).Int64()
		if err != nil && err != redis.Nil {
			continue
		}
		if count >= 5 {
			errorJSON(c, http.StatusTooManyRequests, "RATE_LIMITED", "登录失败次数过多，请稍后再试")
			c.Abort()
			return false
		}
	}
	return true
}

func (a *Router) recordLoginFailure(c *gin.Context, email string) {
	if a.Redis == nil {
		return
	}
	ctx := c.Request.Context()
	for _, key := range a.loginRateKeys(c.ClientIP(), email) {
		count, err := a.Redis.Incr(ctx, key).Result()
		if err == nil && count == 1 {
			_ = a.Redis.Expire(ctx, key, 15*time.Minute).Err()
		}
	}
}

func (a *Router) clearLoginFailures(c *gin.Context, email string) {
	if a.Redis != nil {
		keys := a.loginRateKeys(c.ClientIP(), email)
		_ = a.Redis.Del(c.Request.Context(), keys...).Err()
	}
}

func (a *Router) loginRateKeys(ip, email string) []string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return []string{"ic:login-fail:ip:" + ip, "ic:login-fail:account:" + hex.EncodeToString(digest[:])}
}

package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/go-redis/redis/v8"
	"github.com/sucheng1101/infinity-canvas/server/internal/auth"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/mailer"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

type Router struct {
	Cfg  config.Config
	DB   *gorm.DB
	Auth *auth.Service
	Redis *redis.Client
	Mailer mailer.Mailer
}

func NewRouter(cfg config.Config, db *gorm.DB, redisClient *redis.Client, outbound mailer.Mailer) *gin.Engine {
	service := &auth.Service{DB: db, Cfg: cfg}
	app := &Router{Cfg: cfg, DB: db, Auth: service, Redis: redisClient, Mailer: outbound}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.Use(requestID())
	r.GET("/healthz", app.health)

	v1 := r.Group("/api/v1")
	v1.POST("/auth/register", app.register)
	v1.POST("/auth/verify-email", app.verifyEmail)
	v1.POST("/auth/verify-email/resend", app.resendVerification)
	v1.POST("/auth/login", app.login)
	v1.POST("/auth/password/forgot", app.forgotPassword)
	v1.POST("/auth/password/reset", app.resetPassword)
	v1.POST("/auth/logout", app.logout)
	v1.GET("/auth/me", app.requireAuth(), app.me)
	v1.GET("/admin/health", app.requireAdmin(), func(c *gin.Context) { successJSON(c, http.StatusOK, gin.H{"status": "ok"}) })
	return r
}

type credentialsRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenRequest struct {
	Token string `json:"token"`
}

func (a *Router) register(c *gin.Context) {
	if !a.allow(c, "register", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
		errorJSON(c, http.StatusServiceUnavailable, "EMAIL_SERVICE_UNAVAILABLE", "邮件服务尚未配置")
		return
	}
	result, err := a.Auth.Register(req.Email, req.Password)
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			errorJSON(c, http.StatusConflict, "EMAIL_EXISTS", "邮箱已注册")
			return
		}
		errorJSON(c, http.StatusBadRequest, "REGISTER_FAILED", "注册信息无效")
		return
	}
	data := gin.H{"user": publicUser(result.User), "verificationRequired": true}
	if a.Cfg.DevExposeTokens {
		data["verificationToken"] = result.VerificationToken
	}
	if a.Mailer != nil {
		if err := a.Mailer.SendVerification(result.User.Email, result.VerificationToken); err != nil && !a.Cfg.DevExposeTokens {
			errorJSON(c, http.StatusBadGateway, "EMAIL_DELIVERY_FAILED", "验证邮件发送失败，请稍后重新发送")
			return
		}
	}
	successJSON(c, http.StatusCreated, data)
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
	if !a.allow(c, "verify-email-resend", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
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
	a.setSessionCookie(c, token)
	successJSON(c, http.StatusOK, gin.H{"user": publicUser(user)})
}

func (a *Router) forgotPassword(c *gin.Context) {
	if !a.allow(c, "password-forgot", 5, 15*time.Minute) {
		return
	}
	var req credentialsRequest
	if c.ShouldBindJSON(&req) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if !a.Cfg.DevExposeTokens && (a.Mailer == nil || !a.Mailer.Ready()) {
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
	successJSON(c, http.StatusOK, gin.H{"user": publicUser(user)})
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

func (a *Router) setSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(a.Cfg.SessionCookie, token, int(a.Cfg.SessionTTL.Seconds()), "/", "", a.Cfg.CookieSecure, true)
}

func publicUser(user model.User) gin.H {
	return gin.H{"id": user.ID, "email": user.Email, "status": user.Status, "role": user.Role, "emailVerifiedAt": user.EmailVerifiedAt}
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

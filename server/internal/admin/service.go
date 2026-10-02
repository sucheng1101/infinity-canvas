package admin

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

var (
	ErrUserNotFound    = errors.New("user not found")
	ErrInvalidUser     = errors.New("invalid user")
	ErrInvalidStatus   = errors.New("invalid user status")
	ErrInvalidRole     = errors.New("invalid user role")
	ErrInvalidPassword = errors.New("invalid password")
)

type Service struct {
	DB    *gorm.DB
	Quota *quota.Service
}

type UserFilter struct {
	Query     string
	Status    string
	Role      string
	GroupName string
	Page      int
	PageSize  int
}

type UserView struct {
	ID              uint          `json:"id"`
	Username        string        `json:"username"`
	Email           string        `json:"email"`
	DisplayName     string        `json:"displayName"`
	Remark          string        `json:"remark"`
	GroupName       string        `json:"groupName"`
	Status          string        `json:"status"`
	Role            string        `json:"role"`
	EmailVerifiedAt *time.Time    `json:"emailVerifiedAt,omitempty"`
	LastLoginAt     *time.Time    `json:"lastLoginAt,omitempty"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
	Quota           quota.Summary `json:"quota"`
}

type UserInput struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Remark      string `json:"remark"`
	GroupName   string `json:"groupName"`
	Status      string `json:"status"`
	Role        string `json:"role"`
}

type UpdateUserInput struct {
	DisplayName string `json:"displayName"`
	Remark      string `json:"remark"`
	GroupName   string `json:"groupName"`
	Status      string `json:"status"`
	Role        string `json:"role"`
}

type ListUsersResult struct {
	Items    []UserView `json:"items"`
	Total    int64      `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}

func (s *Service) ListUsers(filter UserFilter) (ListUsersResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	query := s.DB.Model(&model.User{})
	if value := strings.TrimSpace(filter.Query); value != "" {
		like := "%" + value + "%"
		query = query.Where("username LIKE ? OR email LIKE ? OR display_name LIKE ?", like, like, like)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Role != "" {
		query = query.Where("role = ?", filter.Role)
	}
	if filter.GroupName != "" {
		query = query.Where("group_name = ?", filter.GroupName)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return ListUsersResult{}, err
	}
	var users []model.User
	if err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&users).Error; err != nil {
		return ListUsersResult{}, err
	}
	return ListUsersResult{Items: s.views(users), Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) GetUser(id uint) (UserView, error) {
	var user model.User
	if err := s.DB.First(&user, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return UserView{}, ErrUserNotFound
		}
		return UserView{}, err
	}
	return s.view(user), nil
}

func (s *Service) CreateUser(input UserInput) (UserView, error) {
	username := strings.TrimSpace(input.Username)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if !validUsername(username) || email == "" || len(input.Password) < 8 || len(input.Password) > 72 {
		return UserView{}, ErrInvalidUser
	}
	status, role := normalizeStatusRole(input.Status, input.Role)
	if status == "" || role == "" {
		return UserView{}, ErrInvalidUser
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return UserView{}, err
	}
	inviteCode, err := newInviteCode()
	if err != nil {
		return UserView{}, err
	}
	user := model.User{Username: username, Email: email, InviteCode: inviteCode, PasswordHash: string(hash), DisplayName: strings.TrimSpace(input.DisplayName), Remark: strings.TrimSpace(input.Remark), GroupName: strings.TrimSpace(input.GroupName), Status: status, Role: role}
	now := time.Now().UTC()
	if status == model.UserStatusActive {
		user.EmailVerifiedAt = &now
	}
	if err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		return tx.Create(&model.QuotaAccount{UserID: user.ID}).Error
	}); err != nil {
		return UserView{}, err
	}
	return s.view(user), nil
}

func (s *Service) UpdateUser(id uint, input UpdateUserInput) (UserView, error) {
	status, role := normalizeStatusRole(input.Status, input.Role)
	if status == "" {
		return UserView{}, ErrInvalidStatus
	}
	if role == "" {
		return UserView{}, ErrInvalidRole
	}
	updates := map[string]any{"display_name": strings.TrimSpace(input.DisplayName), "remark": strings.TrimSpace(input.Remark), "group_name": strings.TrimSpace(input.GroupName), "status": status, "role": role}
	if status == model.UserStatusActive {
		now := time.Now().UTC()
		updates["email_verified_at"] = &now
	}
	result := s.DB.Model(&model.User{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return UserView{}, result.Error
	}
	if result.RowsAffected == 0 {
		return UserView{}, ErrUserNotFound
	}
	return s.GetUser(id)
}

func (s *Service) SetStatus(id uint, status string) (UserView, error) {
	status, _ = normalizeStatusRole(status, model.RoleUser)
	if status == "" {
		return UserView{}, ErrInvalidStatus
	}
	result := s.DB.Model(&model.User{}).Where("id = ?", id).Update("status", status)
	if result.Error != nil {
		return UserView{}, result.Error
	}
	if result.RowsAffected == 0 {
		return UserView{}, ErrUserNotFound
	}
	return s.GetUser(id)
}

func (s *Service) ResetPassword(id uint, password string) (string, error) {
	if strings.TrimSpace(password) == "" {
		var err error
		password, err = temporaryPassword()
		if err != nil {
			return "", err
		}
	}
	if len(password) < 8 || len(password) > 72 {
		return "", ErrInvalidPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	result := s.DB.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"password_hash": string(hash), "status": model.UserStatusActive})
	if result.Error != nil {
		return "", result.Error
	}
	if result.RowsAffected == 0 {
		return "", ErrUserNotFound
	}
	now := time.Now().UTC()
	_ = s.DB.Model(&model.Session{}).Where("user_id = ? AND revoked_at IS NULL", id).Update("revoked_at", &now).Error
	return password, nil
}

func (s *Service) AdjustQuota(userID uint, delta int64, source, reason, idempotencyKey string) error {
	return s.Quota.AdjustWithReason(userID, delta, source, fmt.Sprintf("admin:%d:%s", userID, uuid.NewString()), idempotencyKey, strings.TrimSpace(reason))
}

func (s *Service) UserLedger(userID uint, limit, offset int) ([]model.QuotaLedger, bool, error) {
	return s.Quota.Ledger(userID, limit, offset)
}

func (s *Service) views(users []model.User) []UserView {
	items := make([]UserView, 0, len(users))
	for _, user := range users {
		items = append(items, s.view(user))
	}
	return items
}

func (s *Service) view(user model.User) UserView {
	result := UserView{ID: user.ID, Username: user.Username, Email: user.Email, DisplayName: user.DisplayName, Remark: user.Remark, GroupName: user.GroupName, Status: user.Status, Role: user.Role, EmailVerifiedAt: user.EmailVerifiedAt, LastLoginAt: user.LastLoginAt, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt}
	var account model.QuotaAccount
	if s.DB.Where("user_id = ?", user.ID).First(&account).Error == nil {
		result.Quota = quota.Summary{Balance: account.Balance, Reserved: account.Reserved, Available: account.Balance - account.Reserved}
	}
	return result
}

func normalizeStatusRole(status, role string) (string, string) {
	status = strings.TrimSpace(status)
	role = strings.TrimSpace(role)
	if status == "" {
		status = model.UserStatusActive
	}
	if role == "" {
		role = model.RoleUser
	}
	if status != model.UserStatusActive && status != model.UserStatusPending && status != model.UserStatusBlocked {
		status = ""
	}
	if role != model.RoleUser && role != model.RoleAdmin {
		role = ""
	}
	return status, role
}

func validUsername(value string) bool {
	if len(value) < 3 || len(value) > 32 {
		return false
	}
	for _, char := range value {
		if !(char == '_' || char == '-' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

func newInviteCode() (string, error) {
	value := make([]byte, 8)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(value)), nil
}

func temporaryPassword() (string, error) {
	value := make([]byte, 9)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return "T-" + hex.EncodeToString(value), nil
}

type UsageFilter struct {
	Query     string
	User      string
	UserID    uint
	Model     string
	Channel   string
	Status    string
	RequestID string
	From      time.Time
	To        time.Time
	Page      int
	PageSize  int
}

type UsageLogView struct {
	model.UsageLog
	RequestSummary  map[string]any `json:"requestSummary,omitempty"`
	ResponseSummary map[string]any `json:"responseSummary,omitempty"`
	Username        string         `json:"username,omitempty"`
}

type UsageListResult struct {
	Items    []UsageLogView `json:"items"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Stats    UsageStats     `json:"stats"`
}

type UsageStats struct {
	Total             int64   `json:"total"`
	Succeeded         int64   `json:"succeeded"`
	Failed            int64   `json:"failed"`
	Running           int64   `json:"running"`
	ChargedQuota      int64   `json:"chargedQuota"`
	TotalTokens       int64   `json:"totalTokens"`
	AverageDurationMs float64 `json:"averageDurationMs"`
}

func (s *Service) ListUsageLogs(filter UsageFilter) (UsageListResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	query := s.DB.Model(&model.UsageLog{})
	query = applyUsageFilters(query, filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return UsageListResult{}, err
	}
	var logs []model.UsageLog
	if err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs).Error; err != nil {
		return UsageListResult{}, err
	}
	return UsageListResult{Items: s.usageViews(logs), Total: total, Page: page, PageSize: pageSize, Stats: s.usageStats(query)}, nil
}

func (s *Service) GetUsageLog(id uint) (UsageLogView, error) {
	var item model.UsageLog
	if err := s.DB.First(&item, id).Error; err != nil {
		return UsageLogView{}, err
	}
	return s.usageView(item), nil
}

func (s *Service) UserUsage(userID uint, page, pageSize int) (UsageListResult, error) {
	return s.ListUsageLogs(UsageFilter{UserID: userID, Page: page, PageSize: pageSize})
}

func (s *Service) usageViews(logs []model.UsageLog) []UsageLogView {
	items := make([]UsageLogView, 0, len(logs))
	for _, item := range logs {
		items = append(items, s.usageView(item))
	}
	return items
}

func (s *Service) usageView(item model.UsageLog) UsageLogView {
	view := UsageLogView{UsageLog: item}
	_ = json.Unmarshal([]byte(item.RequestSummaryJSON), &view.RequestSummary)
	_ = json.Unmarshal([]byte(item.ResponseSummaryJSON), &view.ResponseSummary)
	var user model.User
	if s.DB.First(&user, item.UserID).Error == nil {
		view.Username = user.Username
	}
	return view
}

func (s *Service) usageStats(query *gorm.DB) UsageStats {
	stats := UsageStats{}
	query.Session(&gorm.Session{}).Count(&stats.Total)
	query.Session(&gorm.Session{}).Where("status = ?", model.UsageLogSuccess).Count(&stats.Succeeded)
	query.Session(&gorm.Session{}).Where("status = ?", model.UsageLogFailed).Count(&stats.Failed)
	query.Session(&gorm.Session{}).Where("status = ?", model.UsageLogRunning).Count(&stats.Running)
	query.Session(&gorm.Session{}).Select("COALESCE(SUM(charged_quota), 0)").Scan(&stats.ChargedQuota)
	query.Session(&gorm.Session{}).Select("COALESCE(SUM(total_tokens), 0)").Scan(&stats.TotalTokens)
	var average float64
	query.Session(&gorm.Session{}).Select("AVG(duration_ms)").Scan(&average)
	stats.AverageDurationMs = average
	return stats
}

func applyUsageFilters(query *gorm.DB, filter UsageFilter) *gorm.DB {
	if filter.UserID > 0 {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if value := strings.TrimSpace(filter.User); value != "" {
		like := "%" + value + "%"
		query = query.Where("user_id IN (?)", query.Session(&gorm.Session{NewDB: true}).Model(&model.User{}).Select("id").Where("username LIKE ? OR email LIKE ? OR display_name LIKE ?", like, like, like))
	}
	if value := strings.TrimSpace(filter.Query); value != "" {
		like := "%" + value + "%"
		query = query.Where("published_model LIKE ? OR upstream_model LIKE ? OR channel_name LIKE ? OR request_id LIKE ?", like, like, like, like)
	}
	if filter.Model != "" {
		query = query.Where("published_model LIKE ? OR upstream_model LIKE ?", "%"+filter.Model+"%", "%"+filter.Model+"%")
	}
	if filter.Channel != "" {
		query = query.Where("channel_name LIKE ? OR provider LIKE ?", "%"+filter.Channel+"%", "%"+filter.Channel+"%")
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.RequestID != "" {
		query = query.Where("request_id LIKE ?", "%"+filter.RequestID+"%")
	}
	if !filter.From.IsZero() {
		query = query.Where("started_at >= ?", filter.From)
	}
	if !filter.To.IsZero() {
		query = query.Where("started_at < ?", filter.To)
	}
	return query
}

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	return page, pageSize
}

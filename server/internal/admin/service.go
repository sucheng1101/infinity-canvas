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

type UserUsageLogView struct {
	ID           uint       `json:"id"`
	TaskID       string     `json:"taskId"`
	Project      string     `json:"project"`
	Capability   string     `json:"capability"`
	BillingUnit  string     `json:"billingUnit"`
	BilledUnits  float64    `json:"billedUnits"`
	Status       string     `json:"status"`
	DurationMs   int64      `json:"durationMs"`
	TotalTokens  int64      `json:"totalTokens"`
	ChargedQuota int64      `json:"chargedQuota"`
	ErrorMessage string     `json:"errorMessage,omitempty"`
	StartedAt    time.Time  `json:"startedAt"`
	CompletedAt  *time.Time `json:"completedAt,omitempty"`
}

type UserUsageListResult struct {
	Items    []UserUsageLogView `json:"items"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
	Stats    UsageStats         `json:"stats"`
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

// OrderFilter describes the operator-facing order list. The list intentionally
// combines paid recharge orders and balance-backed operation orders while
// keeping their source-specific fields separate.
type OrderFilter struct {
	Type     string
	Status   string
	Query    string
	From     time.Time
	To       time.Time
	Page     int
	PageSize int
}

type OrderView struct {
	ID              uint       `json:"id"`
	Kind            string     `json:"kind"`
	OrderNo         string     `json:"orderNo"`
	UserID          uint       `json:"userId"`
	Username        string     `json:"username"`
	ProductID       uint       `json:"productId"`
	ProductName     string     `json:"productName"`
	Amount          int64      `json:"amount"`
	PayAmountFen    int64      `json:"payAmountFen"`
	QuotaAmount     int64      `json:"quotaAmount"`
	GiftQuota       int64      `json:"giftQuota"`
	PaymentProvider string     `json:"paymentProvider,omitempty"`
	PaymentMethod   string     `json:"paymentMethod,omitempty"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"createdAt"`
	PaidAt          *time.Time `json:"paidAt,omitempty"`
	CreditedAt      *time.Time `json:"creditedAt,omitempty"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
}

type OrderListResult struct {
	Items    []OrderView `json:"items"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
}

type GenerationFilter struct {
	Query      string
	Status     string
	Capability string
	Page       int
	PageSize   int
}

type GenerationView struct {
	ID                  string     `json:"id"`
	UserID              uint       `json:"userId"`
	Username            string     `json:"username"`
	ModelID             uint       `json:"modelId"`
	ModelName           string     `json:"modelName"`
	Capability          string     `json:"capability"`
	ChannelID           *uint      `json:"channelId,omitempty"`
	ChannelName         string     `json:"channelName,omitempty"`
	ChannelModel        string     `json:"channelModel,omitempty"`
	Status              string     `json:"status"`
	ReservedAmount      int64      `json:"reservedAmount"`
	SettledAmount       int64      `json:"settledAmount"`
	SubscriptionCovered bool       `json:"subscriptionCovered"`
	ErrorCode           string     `json:"errorCode,omitempty"`
	ErrorMessage        string     `json:"errorMessage,omitempty"`
	StartedAt           *time.Time `json:"startedAt,omitempty"`
	CompletedAt         *time.Time `json:"completedAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
}

type GenerationListResult struct {
	Items    []GenerationView `json:"items"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

type AuditFilter struct {
	Query    string
	Action   string
	Resource string
	Page     int
	PageSize int
}

type AuditView struct {
	model.AuditLog
	OperatorName string `json:"operatorName,omitempty"`
}

type AuditListResult struct {
	Items    []AuditView `json:"items"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
}

type FinanceSummary struct {
	RechargeOrders   int64               `json:"rechargeOrders"`
	RechargeFen      int64               `json:"rechargeFen"`
	UsageCount       int64               `json:"usageCount"`
	RevenueQuota     int64               `json:"revenueQuota"`
	CostQuota        int64               `json:"costQuota"`
	ProfitQuota      int64               `json:"profitQuota"`
	FailedCount      int64               `json:"failedCount"`
	TodayRechargeFen int64               `json:"todayRechargeFen"`
	TodayRevenue     int64               `json:"todayRevenueQuota"`
	TodayCost        int64               `json:"todayCostQuota"`
	TodayProfit      int64               `json:"todayProfitQuota"`
	Daily            []FinanceDailyPoint `json:"daily"`
}

type FinanceDailyPoint struct {
	Date         string `json:"date"`
	RechargeFen  int64  `json:"rechargeFen"`
	UsageCount   int64  `json:"usageCount"`
	RevenueQuota int64  `json:"revenueQuota"`
	CostQuota    int64  `json:"costQuota"`
	ProfitQuota  int64  `json:"profitQuota"`
}

type orderPageKey struct {
	Kind      string
	ID        uint
	CreatedAt time.Time
}

// orderFilterSQL builds the shared WHERE clause for both order tables. The
// admin filters are identical for recharges and operations.
func orderFilterSQL(filter OrderFilter) (string, []any) {
	clauses := make([]string, 0, 4)
	args := make([]any, 0, 5)
	if filter.Status != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, filter.Status)
	}
	if !filter.From.IsZero() {
		clauses = append(clauses, "created_at >= ?")
		args = append(args, filter.From)
	}
	if !filter.To.IsZero() {
		clauses = append(clauses, "created_at < ?")
		args = append(args, filter.To)
	}
	if filter.Query != "" {
		like := "%" + filter.Query + "%"
		clauses = append(clauses, "(order_no LIKE ? OR user_id IN (SELECT id FROM users WHERE username LIKE ? OR email LIKE ?))")
		args = append(args, like, like, like)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

func (s *Service) ListOrders(filter OrderFilter) (OrderListResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)

	// Both order tables are paged together through one UNION, so the page and the
	// total are computed by the database instead of by loading every row.
	where, args := orderFilterSQL(filter)
	branches := make([]string, 0, 2)
	countParts := make([]string, 0, 2)
	unionArgs := make([]any, 0, len(args)*2)
	if filter.Type == "" || filter.Type == "recharge" {
		branches = append(branches, "SELECT 'recharge' AS kind, id, created_at FROM topup_orders"+where)
		countParts = append(countParts, "(SELECT COUNT(*) FROM topup_orders"+where+")")
		unionArgs = append(unionArgs, args...)
	}
	if filter.Type == "" || filter.Type == "operation" {
		branches = append(branches, "SELECT 'operation' AS kind, id, created_at FROM operation_orders"+where)
		countParts = append(countParts, "(SELECT COUNT(*) FROM operation_orders"+where+")")
		unionArgs = append(unionArgs, args...)
	}

	var total int64
	if len(countParts) > 0 {
		if err := s.DB.Raw("SELECT "+strings.Join(countParts, " + "), unionArgs...).Scan(&total).Error; err != nil {
			return OrderListResult{}, err
		}
	}

	keys := make([]orderPageKey, 0, pageSize)
	if len(branches) > 0 {
		sql := "SELECT kind, id, created_at FROM (" + strings.Join(branches, " UNION ALL ") + ") AS merged ORDER BY created_at DESC LIMIT ? OFFSET ?"
		pageArgs := append(append([]any{}, unionArgs...), pageSize, (page-1)*pageSize)
		if err := s.DB.Raw(sql, pageArgs...).Scan(&keys).Error; err != nil {
			return OrderListResult{}, err
		}
	}

	rechargeIDs := make([]uint, 0, len(keys))
	operationIDs := make([]uint, 0, len(keys))
	for _, key := range keys {
		if key.Kind == "recharge" {
			rechargeIDs = append(rechargeIDs, key.ID)
		} else {
			operationIDs = append(operationIDs, key.ID)
		}
	}

	topupByID := make(map[uint]model.TopupOrder, len(rechargeIDs))
	if len(rechargeIDs) > 0 {
		var orders []model.TopupOrder
		if err := s.DB.Where("id IN ?", rechargeIDs).Find(&orders).Error; err != nil {
			return OrderListResult{}, err
		}
		for _, order := range orders {
			topupByID[order.ID] = order
		}
	}
	operationByID := make(map[uint]model.OperationOrder, len(operationIDs))
	if len(operationIDs) > 0 {
		var orders []model.OperationOrder
		if err := s.DB.Where("id IN ?", operationIDs).Find(&orders).Error; err != nil {
			return OrderListResult{}, err
		}
		for _, order := range orders {
			operationByID[order.ID] = order
		}
	}

	productIDs := make([]uint, 0, len(keys))
	for _, order := range topupByID {
		productIDs = append(productIDs, order.ProductID)
	}
	productNames := make(map[uint]string, len(productIDs))
	if len(productIDs) > 0 {
		var products []model.TopupProduct
		if err := s.DB.Where("id IN ?", productIDs).Find(&products).Error; err != nil {
			return OrderListResult{}, err
		}
		for _, product := range products {
			productNames[product.ID] = product.Name
		}
	}

	userIDs := make([]uint, 0, len(keys))
	for _, key := range keys {
		if order, ok := topupByID[key.ID]; ok {
			userIDs = append(userIDs, order.UserID)
			continue
		}
		if order, ok := operationByID[key.ID]; ok {
			userIDs = append(userIDs, order.UserID)
		}
	}
	usernames := make(map[uint]string, len(userIDs))
	if len(userIDs) > 0 {
		var users []model.User
		if err := s.DB.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
			return OrderListResult{}, err
		}
		for _, user := range users {
			usernames[user.ID] = user.Username
		}
	}

	items := make([]OrderView, 0, len(keys))
	for _, key := range keys {
		if order, ok := topupByID[key.ID]; ok {
			expiresAt := order.ExpiresAt
			items = append(items, OrderView{ID: order.ID, Kind: "recharge", OrderNo: order.OrderNo, UserID: order.UserID, Username: usernames[order.UserID], ProductID: order.ProductID, ProductName: productNames[order.ProductID], Amount: order.QuotaAmount + order.GiftQuota, PayAmountFen: order.PayAmountFen, QuotaAmount: order.QuotaAmount, GiftQuota: order.GiftQuota, PaymentProvider: order.PaymentProvider, PaymentMethod: order.PaymentMethod, Status: order.Status, CreatedAt: order.CreatedAt, PaidAt: order.PaidAt, CreditedAt: order.CreditedAt, ExpiresAt: &expiresAt})
			continue
		}
		if order, ok := operationByID[key.ID]; ok {
			name := "订阅购买"
			if order.Type == model.OperationOrderChannelUnlock {
				name = "自定义渠道解锁"
			}
			items = append(items, OrderView{ID: order.ID, Kind: "operation", OrderNo: order.OrderNo, UserID: order.UserID, Username: usernames[order.UserID], ProductID: order.ProductID, ProductName: name, Amount: order.Amount, Status: order.Status, CreatedAt: order.CreatedAt})
		}
	}
	return OrderListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) ListGenerations(filter GenerationFilter) (GenerationListResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	query := s.DB.Model(&model.GenerationTask{})
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Capability != "" {
		query = query.Where("capability = ?", filter.Capability)
	}
	if filter.Query != "" {
		like := "%" + filter.Query + "%"
		query = query.Where("id LIKE ? OR user_id IN (?)", like, s.DB.Model(&model.User{}).Select("id").Where("username LIKE ? OR email LIKE ?", like, like))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return GenerationListResult{}, err
	}
	var tasks []model.GenerationTask
	if err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks).Error; err != nil {
		return GenerationListResult{}, err
	}
	items := make([]GenerationView, 0, len(tasks))
	for _, task := range tasks {
		item := GenerationView{ID: task.ID, UserID: task.UserID, ModelID: task.PublishedModelID, Capability: task.Capability, ChannelID: task.UserChannelID, ChannelModel: task.UserChannelModel, Status: task.Status, ReservedAmount: task.ReservedAmount, SettledAmount: task.SettledAmount, SubscriptionCovered: task.SubscriptionCovered, ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage, StartedAt: task.StartedAt, CompletedAt: task.CompletedAt, CreatedAt: task.CreatedAt}
		var user model.User
		if s.DB.First(&user, task.UserID).Error == nil {
			item.Username = user.Username
		}
		var published model.PublishedModel
		if s.DB.First(&published, task.PublishedModelID).Error == nil {
			item.ModelName = published.DisplayName
		}
		if task.UserChannelID != nil {
			var channel model.UserChannel
			if s.DB.First(&channel, *task.UserChannelID).Error == nil {
				item.ChannelName = channel.Name
			}
		}
		items = append(items, item)
	}
	return GenerationListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) ListAuditLogs(filter AuditFilter) (AuditListResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	query := s.DB.Model(&model.AuditLog{})
	if filter.Action != "" {
		query = query.Where("action LIKE ?", "%"+filter.Action+"%")
	}
	if filter.Resource != "" {
		query = query.Where("resource_type = ?", filter.Resource)
	}
	if filter.Query != "" {
		like := "%" + filter.Query + "%"
		query = query.Where("action LIKE ? OR resource_id LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return AuditListResult{}, err
	}
	var logs []model.AuditLog
	if err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs).Error; err != nil {
		return AuditListResult{}, err
	}
	items := make([]AuditView, 0, len(logs))
	for _, log := range logs {
		item := AuditView{AuditLog: log}
		if log.OperatorID != nil {
			var user model.User
			if s.DB.First(&user, *log.OperatorID).Error == nil {
				item.OperatorName = user.Username
			}
		}
		items = append(items, item)
	}
	return AuditListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s *Service) FinanceSummary(from, to time.Time) (FinanceSummary, error) {
	if from.IsZero() {
		from = time.Now().UTC().AddDate(0, 0, -30)
	}
	if to.IsZero() {
		to = time.Now().UTC()
	}
	var summary FinanceSummary
	if err := s.DB.Model(&model.TopupOrder{}).Where("status = ? AND created_at >= ? AND created_at < ?", model.TopupOrderQuotaCredited, from, to).Count(&summary.RechargeOrders).Error; err != nil {
		return summary, err
	}
	if err := s.DB.Model(&model.TopupOrder{}).Where("status = ? AND created_at >= ? AND created_at < ?", model.TopupOrderQuotaCredited, from, to).Select("COALESCE(SUM(pay_amount_fen),0)").Scan(&summary.RechargeFen).Error; err != nil {
		return summary, err
	}
	query := s.DB.Model(&model.UsageLog{}).Where("created_at >= ? AND created_at < ?", from, to)
	if err := query.Count(&summary.UsageCount).Error; err != nil {
		return summary, err
	}
	if err := query.Select("COALESCE(SUM(revenue_total),0)").Scan(&summary.RevenueQuota).Error; err != nil {
		return summary, err
	}
	if err := query.Select("COALESCE(SUM(cost_total),0)").Scan(&summary.CostQuota).Error; err != nil {
		return summary, err
	}
	if err := query.Select("COALESCE(SUM(profit_total),0)").Scan(&summary.ProfitQuota).Error; err != nil {
		return summary, err
	}
	if err := query.Where("status = ?", model.UsageLogFailed).Count(&summary.FailedCount).Error; err != nil {
		return summary, err
	}

	// Keep the overview chart database-agnostic by aggregating the already
	// persisted ledger rows in Go instead of relying on vendor-specific DATE()
	// functions. The requested range is normally a few days, so this stays
	// small while preserving exact revenue/cost/profit snapshots.
	fromUTC, toUTC := from.UTC(), to.UTC()
	daily := make(map[string]*FinanceDailyPoint)
	firstDay := time.Date(fromUTC.Year(), fromUTC.Month(), fromUTC.Day(), 0, 0, 0, 0, time.UTC)
	lastDay := time.Date(toUTC.Year(), toUTC.Month(), toUTC.Day(), 0, 0, 0, 0, time.UTC)
	if toUTC.Equal(lastDay) {
		lastDay = lastDay.AddDate(0, 0, -1)
	}
	for day := firstDay; !day.After(lastDay); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		daily[key] = &FinanceDailyPoint{Date: key}
	}
	var usageRows []model.UsageLog
	if err := s.DB.Where("created_at >= ? AND created_at < ?", from, to).Find(&usageRows).Error; err != nil {
		return summary, err
	}
	for _, row := range usageRows {
		key := row.CreatedAt.UTC().Format("2006-01-02")
		point := daily[key]
		if point == nil {
			point = &FinanceDailyPoint{Date: key}
			daily[key] = point
		}
		point.UsageCount++
		point.RevenueQuota += row.RevenueTotal
		point.CostQuota += row.CostTotal
		point.ProfitQuota += row.ProfitTotal
	}
	var rechargeRows []model.TopupOrder
	if err := s.DB.Where("status = ? AND created_at >= ? AND created_at < ?", model.TopupOrderQuotaCredited, from, to).Find(&rechargeRows).Error; err != nil {
		return summary, err
	}
	for _, row := range rechargeRows {
		key := row.CreatedAt.UTC().Format("2006-01-02")
		point := daily[key]
		if point == nil {
			point = &FinanceDailyPoint{Date: key}
			daily[key] = point
		}
		point.RechargeFen += row.PayAmountFen
	}
	for day := firstDay; !day.After(lastDay); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		if point := daily[key]; point != nil {
			summary.Daily = append(summary.Daily, *point)
		}
	}
	today := daily[time.Now().UTC().Format("2006-01-02")]
	if today != nil {
		summary.TodayRechargeFen = today.RechargeFen
		summary.TodayRevenue = today.RevenueQuota
		summary.TodayCost = today.CostQuota
		summary.TodayProfit = today.ProfitQuota
	}
	return summary, nil
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

func (s *Service) ListUserUsageLogs(filter UsageFilter) (UserUsageListResult, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	query := s.DB.Model(&model.UsageLog{}).Where("user_id = ?", filter.UserID)
	query = applyUsageFilters(query, filter)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return UserUsageListResult{}, err
	}
	var logs []model.UsageLog
	if err := query.Order("started_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&logs).Error; err != nil {
		return UserUsageListResult{}, err
	}
	items := make([]UserUsageLogView, 0, len(logs))
	for _, item := range logs {
		project := item.PublishedModel
		if strings.TrimSpace(project) == "" {
			project = item.Capability
		}
		items = append(items, UserUsageLogView{
			ID: item.ID, TaskID: item.TaskID, Project: project, Capability: item.Capability,
			BillingUnit: item.BillingUnit, BilledUnits: item.BilledUnits, Status: item.Status,
			DurationMs: item.DurationMs, TotalTokens: item.TotalTokens, ChargedQuota: item.ChargedQuota,
			ErrorMessage: item.ErrorMessage, StartedAt: item.StartedAt, CompletedAt: item.CompletedAt,
		})
	}
	return UserUsageListResult{Items: items, Total: total, Page: page, PageSize: pageSize, Stats: s.usageStats(query)}, nil
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
	query.Session(&gorm.Session{}).Select("COALESCE(AVG(duration_ms), 0)").Scan(&average)
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

package payment

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	ProviderEpay    = "epay"
	VerifyValid     = "valid"
	VerifyDuplicate = "duplicate"
	VerifyRejected  = "rejected"
)

var (
	ErrProductUnavailable  = errors.New("recharge product unavailable")
	ErrOrderNotFound       = errors.New("recharge order not found")
	ErrOrderExpired        = errors.New("recharge order expired")
	ErrProviderUnavailable = errors.New("payment provider unavailable")
	ErrSignatureInvalid    = errors.New("payment signature invalid")
	ErrAmountMismatch      = errors.New("payment amount mismatch")
	ErrCallbackUnavailable = errors.New("payment callback address is not publicly reachable")
)

type EpaySettings struct {
	Enabled     bool     `json:"enabled"`
	GatewayURL  string   `json:"gatewayUrl"`
	PartnerID   string   `json:"partnerId"`
	Key         string   `json:"key"`
	PayMethods  []string `json:"payMethods"`
	CallbackURL string   `json:"callbackUrl"`
}

type Checkout struct {
	Provider string            `json:"provider"`
	URL      string            `json:"url"`
	Params   map[string]string `json:"params"`
}

type Service struct {
	DB    *gorm.DB
	Cfg   config.Config
	Quota *quota.Service
}

func (s *Service) Products(includeHidden bool) ([]model.TopupProduct, error) {
	query := s.DB.Order("sort_order ASC").Order("id ASC")
	if !includeHidden {
		query = query.Where("status = ?", model.TopupProductActive)
	}
	var products []model.TopupProduct
	return products, query.Find(&products).Error
}

func (s *Service) UpsertProduct(product model.TopupProduct) (model.TopupProduct, error) {
	if strings.TrimSpace(product.Name) == "" || product.PayAmountFen < 100 || product.PayAmountFen > 500000 ||
		product.QuotaAmount <= 0 || product.GiftQuota < 0 {
		return model.TopupProduct{}, errors.New("invalid recharge product")
	}
	if product.Status == "" {
		product.Status = model.TopupProductActive
	}
	if product.Status != model.TopupProductActive && product.Status != model.TopupProductHidden {
		return model.TopupProduct{}, errors.New("invalid recharge product status")
	}
	if product.ID == 0 {
		return product, s.DB.Create(&product).Error
	}
	if err := s.DB.Model(&model.TopupProduct{}).Where("id = ?", product.ID).Updates(map[string]any{
		"name": product.Name, "pay_amount_fen": product.PayAmountFen, "quota_amount": product.QuotaAmount,
		"gift_quota": product.GiftQuota, "status": product.Status, "sort_order": product.SortOrder,
	}).Error; err != nil {
		return model.TopupProduct{}, err
	}
	return product, s.DB.First(&product, product.ID).Error
}

func (s *Service) EpaySettings() (EpaySettings, error) {
	settings := EpaySettings{
		Enabled:     s.Cfg.EpayEnabled,
		GatewayURL:  s.Cfg.EpayGatewayURL,
		PartnerID:   s.Cfg.EpayPartnerID,
		Key:         s.Cfg.EpayKey,
		PayMethods:  append([]string(nil), s.Cfg.EpayPayMethods...),
		CallbackURL: s.Cfg.EpayCallbackURL,
	}
	var row model.OperationSetting
	if err := s.DB.Where("`key` = ?", "payment.epay").First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return settings, nil
		}
		return EpaySettings{}, err
	}
	if err := json.Unmarshal([]byte(row.Value), &settings); err != nil {
		return EpaySettings{}, err
	}
	if strings.TrimSpace(settings.CallbackURL) == "" {
		settings.CallbackURL = s.Cfg.EpayCallbackURL
	}
	return settings, nil
}

func (s *Service) UpdateEpaySettings(operatorID uint, settings EpaySettings) (EpaySettings, error) {
	current, err := s.EpaySettings()
	if err != nil {
		return EpaySettings{}, err
	}
	if strings.TrimSpace(settings.Key) == "" {
		settings.Key = current.Key
	}
	if strings.TrimSpace(settings.GatewayURL) == "" {
		settings.GatewayURL = current.GatewayURL
	}
	if strings.TrimSpace(settings.PartnerID) == "" {
		settings.PartnerID = current.PartnerID
	}
	if len(settings.PayMethods) == 0 {
		settings.PayMethods = current.PayMethods
	}
	if strings.TrimSpace(settings.CallbackURL) == "" {
		settings.CallbackURL = current.CallbackURL
	}
	if strings.TrimSpace(settings.GatewayURL) == "" || strings.TrimSpace(settings.PartnerID) == "" ||
		strings.TrimSpace(settings.Key) == "" || len(settings.PayMethods) == 0 || strings.TrimSpace(settings.CallbackURL) == "" {
		return EpaySettings{}, ErrProviderUnavailable
	}
	payload, err := json.Marshal(settings)
	if err != nil {
		return EpaySettings{}, err
	}
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		var row model.OperationSetting
		findErr := tx.Where("`key` = ?", "payment.epay").First(&row).Error
		if errors.Is(findErr, gorm.ErrRecordNotFound) {
			return tx.Create(&model.OperationSetting{Key: "payment.epay", Value: string(payload), Version: 1, UpdatedBy: &operatorID}).Error
		}
		if findErr != nil {
			return findErr
		}
		row.Value = string(payload)
		row.Version++
		row.UpdatedBy = &operatorID
		return tx.Save(&row).Error
	})
	if err != nil {
		return EpaySettings{}, err
	}
	return settings, nil
}

func (s *Service) CreateOrder(userID, productID uint, provider, paymentMethod, idempotencyKey string) (model.TopupOrder, Checkout, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return model.TopupOrder{}, Checkout{}, errors.New("idempotency key required")
	}
	if provider == "" {
		provider = ProviderEpay
	}
	if provider != ProviderEpay {
		return model.TopupOrder{}, Checkout{}, ErrProviderUnavailable
	}
	settings, err := s.EpaySettings()
	if err != nil || !settings.Enabled || settings.GatewayURL == "" || settings.PartnerID == "" || settings.Key == "" || settings.CallbackURL == "" {
		return model.TopupOrder{}, Checkout{}, ErrProviderUnavailable
	}
	if err := validateEpayCallbackURL(settings.CallbackURL); err != nil {
		return model.TopupOrder{}, Checkout{}, err
	}
	if paymentMethod == "" {
		paymentMethod = firstOr(settings.PayMethods, "alipay")
	}
	if !contains(settings.PayMethods, paymentMethod) {
		return model.TopupOrder{}, Checkout{}, errors.New("payment method unavailable")
	}
	var order model.TopupOrder
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("idempotency_key = ? AND user_id = ?", idempotencyKey, userID).First(&order).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var product model.TopupProduct
		if err := tx.Where("id = ? AND status = ?", productID, model.TopupProductActive).First(&product).Error; err != nil {
			return ErrProductUnavailable
		}
		now := time.Now().UTC()
		order = model.TopupOrder{
			UserID: userID, ProductID: product.ID, OrderNo: newOrderNo(),
			IdempotencyKey: idempotencyKey, PaymentProvider: provider, PaymentMethod: paymentMethod,
			PayAmountFen: product.PayAmountFen, QuotaAmount: product.QuotaAmount, GiftQuota: product.GiftQuota,
			Status: model.TopupOrderPendingPayment, ExpiresAt: now.Add(s.Cfg.PaymentOrderTTL),
		}
		return tx.Create(&order).Error
	})
	if err != nil {
		return model.TopupOrder{}, Checkout{}, err
	}
	checkout, err := buildEpayCheckout(settings, order)
	if err != nil {
		return model.TopupOrder{}, Checkout{}, err
	}
	return order, checkout, nil
}

func (s *Service) Order(userID, orderID uint) (model.TopupOrder, Checkout, error) {
	var order model.TopupOrder
	if err := s.DB.Where("id = ? AND user_id = ?", orderID, userID).First(&order).Error; err != nil {
		return model.TopupOrder{}, Checkout{}, ErrOrderNotFound
	}
	if order.Status == model.TopupOrderPendingPayment && !time.Now().UTC().Before(order.ExpiresAt) {
		order.Status = model.TopupOrderExpired
		if err := s.DB.Model(&model.TopupOrder{}).Where("id = ? AND status = ?", order.ID, model.TopupOrderPendingPayment).Update("status", model.TopupOrderExpired).Error; err != nil {
			return model.TopupOrder{}, Checkout{}, err
		}
	}
	settings, err := s.EpaySettings()
	if err != nil {
		return model.TopupOrder{}, Checkout{}, ErrProviderUnavailable
	}
	checkout := Checkout{}
	if order.Status == model.TopupOrderPendingPayment && time.Now().UTC().Before(order.ExpiresAt) {
		checkout, err = buildEpayCheckout(settings, order)
		if err != nil {
			return model.TopupOrder{}, Checkout{}, err
		}
	}
	return order, checkout, nil
}

func (s *Service) HandleEpayWebhook(values url.Values) error {
	settings, err := s.EpaySettings()
	if err != nil || !settings.Enabled || settings.Key == "" {
		return ErrProviderUnavailable
	}
	params := make(map[string]string, len(values))
	for key := range values {
		params[key] = values.Get(key)
	}
	if !verifyEpay(params, settings.Key) {
		return ErrSignatureInvalid
	}
	orderNo := firstNonEmpty(params["out_trade_no"], params["service_trade_no"])
	if orderNo == "" {
		return ErrOrderNotFound
	}
	eventID := firstNonEmpty(params["trade_no"], params["transaction_id"], orderNo)
	payload, _ := json.Marshal(params)
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var order model.TopupOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("order_no = ?", orderNo).First(&order).Error; err != nil {
			return ErrOrderNotFound
		}
		var event model.PaymentEvent
		if err := tx.Where("provider = ? AND provider_event_id = ?", ProviderEpay, eventID).First(&event).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		event = model.PaymentEvent{ID: uuid.NewString(), Provider: ProviderEpay, ProviderEventID: eventID, OrderID: order.ID, PayloadJSON: string(payload), VerifyState: VerifyValid}
		now := time.Now().UTC()
		if order.Status == model.TopupOrderQuotaCredited {
			event.VerifyState = VerifyDuplicate
			event.ProcessedAt = &now
			return tx.Create(&event).Error
		}
		if order.Status == model.TopupOrderExpired || !now.Before(order.ExpiresAt) {
			if order.Status == model.TopupOrderPendingPayment {
				order.Status = model.TopupOrderExpired
				if err := tx.Save(&order).Error; err != nil {
					return err
				}
			}
			event.VerifyState = VerifyRejected
			event.ProcessedAt = &now
			return tx.Create(&event).Error
		}
		if !isSuccessStatus(params["trade_status"]) {
			event.ProcessedAt = &now
			return tx.Create(&event).Error
		}
		if !sameMoney(params["money"], order.PayAmountFen) {
			event.VerifyState = VerifyRejected
			return tx.Create(&event).Error
		}
		paidAt := now
		order.Status = model.TopupOrderPaid
		order.ProviderTradeNo = firstNonEmpty(params["trade_no"], params["transaction_id"])
		order.PaidAt = &paidAt
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		if err := s.Quota.CreditTx(tx, order.UserID, order.QuotaAmount+order.GiftQuota, "recharge", "topup_order", order.OrderNo, "topup:"+order.OrderNo); err != nil {
			return err
		}
		order.Status = model.TopupOrderQuotaCredited
		order.CreditedAt = &now
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		event.ProcessedAt = &now
		return tx.Create(&event).Error
	})
}

func buildEpayCheckout(settings EpaySettings, order model.TopupOrder) (Checkout, error) {
	if err := validateEpayCallbackURL(settings.CallbackURL); err != nil {
		return Checkout{}, err
	}
	callbackURL := strings.TrimRight(strings.TrimSpace(settings.CallbackURL), "/")
	notifyURL := callbackURL + "/api/v1/payments/epay/webhook"
	returnURL := callbackURL + "/api/v1/payments/epay/return"
	params := map[string]string{
		"pid":          settings.PartnerID,
		"type":         order.PaymentMethod,
		"out_trade_no": order.OrderNo,
		"notify_url":   notifyURL,
		"name":         "Infinite Canvas Recharge",
		"money":        formatMoney(order.PayAmountFen),
		"device":       "pc",
		"sign_type":    "MD5",
		"return_url":   returnURL,
	}
	params["sign"] = signEpay(params, settings.Key)
	return Checkout{Provider: ProviderEpay, URL: epaySubmitURL(settings.GatewayURL), Params: params}, nil
}

func validateEpayCallbackURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return ErrCallbackUnavailable
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".local") {
		return ErrCallbackUnavailable
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified()) {
		return ErrCallbackUnavailable
	}
	return nil
}

func epaySubmitURL(gatewayURL string) string {
	base := strings.TrimRight(strings.TrimSpace(gatewayURL), "/")
	if strings.HasSuffix(base, "/submit.php") {
		return base
	}
	return base + "/submit.php"
}

func verifyEpay(params map[string]string, key string) bool {
	return params["sign"] != "" && strings.EqualFold(params["sign"], signEpay(params, key))
}

func signEpay(params map[string]string, key string) string {
	keys := make([]string, 0, len(params))
	for name := range params {
		if name == "sign" || name == "sign_type" || params[name] == "" {
			continue
		}
		keys = append(keys, name)
	}
	sort.Strings(keys)
	var parts []string
	for _, name := range keys {
		parts = append(parts, name+"="+params[name])
	}
	sum := md5.Sum([]byte(strings.Join(parts, "&") + key))
	return hex.EncodeToString(sum[:])
}

func sameMoney(value string, fen int64) bool {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	return err == nil && fmt.Sprintf("%.2f", parsed) == formatMoney(fen)
}

func formatMoney(fen int64) string {
	return fmt.Sprintf("%d.%02d", fen/100, fen%100)
}

func isSuccessStatus(value string) bool {
	return strings.EqualFold(value, "TRADE_SUCCESS") || strings.EqualFold(value, "success")
}

func newOrderNo() string {
	raw := make([]byte, 5)
	if _, err := rand.Read(raw); err != nil {
		return "IC" + strconv.FormatInt(time.Now().UnixNano(), 10)
	}
	return "IC" + time.Now().UTC().Format("20060102150405") + strings.ToUpper(hex.EncodeToString(raw))
}

func firstOr(values []string, fallback string) string {
	if len(values) > 0 && strings.TrimSpace(values[0]) != "" {
		return values[0]
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

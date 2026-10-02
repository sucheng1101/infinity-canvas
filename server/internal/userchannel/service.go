package userchannel

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrEntitlementRequired = errors.New("custom channel entitlement required")
	ErrChannelNotFound     = errors.New("user channel not found")
	ErrInvalidChannel      = errors.New("invalid user channel")
)

type Model struct {
	Name       string `json:"name"`
	Capability string `json:"capability"`
	Status     string `json:"status"`
}

type View struct {
	ID           uint       `json:"id"`
	Name         string     `json:"name"`
	Provider     string     `json:"provider"`
	BaseURL      string     `json:"baseUrl"`
	APIKeySet    bool       `json:"apiKeySet"`
	APIKeyMasked string     `json:"apiKeyMasked,omitempty"`
	Models       []Model    `json:"models"`
	Status       string     `json:"status"`
	LastTestedAt *time.Time `json:"lastTestedAt,omitempty"`
	LastError    string     `json:"lastError,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type Route struct {
	Name     string
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
}

type Input struct {
	Name     string  `json:"name"`
	Provider string  `json:"provider"`
	BaseURL  string  `json:"baseUrl"`
	APIKey   string  `json:"apiKey"`
	Models   []Model `json:"models"`
	Status   string  `json:"status"`
}

type EntitlementView struct {
	Enabled      bool       `json:"enabled"`
	ChannelLimit int        `json:"channelLimit"`
	Used         int        `json:"used"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
}

type Service struct {
	DB     *gorm.DB
	Cfg    config.Config
	Client *http.Client
}

func (s *Service) Entitlement(userID uint) (EntitlementView, error) {
	if userID == 0 {
		return EntitlementView{}, ErrEntitlementRequired
	}
	var rows []model.UserChannelEntitlement
	if err := s.DB.Where("user_id = ? AND status = ?", userID, model.UserChannelActive).Find(&rows).Error; err != nil {
		return EntitlementView{}, err
	}
	now := time.Now().UTC()
	limit := 0
	var expires *time.Time
	for _, row := range rows {
		if row.ExpiresAt != nil && !now.Before(*row.ExpiresAt) {
			continue
		}
		limit += row.ChannelLimit
		if row.ExpiresAt != nil && (expires == nil || row.ExpiresAt.After(*expires)) {
			expires = row.ExpiresAt
		}
	}
	var used int64
	if err := s.DB.Model(&model.UserChannel{}).Where("user_id = ? AND status = ?", userID, model.UserChannelActive).Count(&used).Error; err != nil {
		return EntitlementView{}, err
	}
	return EntitlementView{Enabled: limit > 0, ChannelLimit: limit, Used: int(used), ExpiresAt: expires}, nil
}

func (s *Service) List(userID uint) ([]View, EntitlementView, error) {
	entitlement, err := s.Entitlement(userID)
	if err != nil {
		return nil, EntitlementView{}, err
	}
	var rows []model.UserChannel
	if err := s.DB.Where("user_id = ?", userID).Order("id DESC").Find(&rows).Error; err != nil {
		return nil, entitlement, err
	}
	items := make([]View, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.toView(row))
	}
	return items, entitlement, nil
}

func (s *Service) Create(userID uint, input Input) (View, error) {
	entitlement, err := s.Entitlement(userID)
	if err != nil {
		return View{}, err
	}
	if !entitlement.Enabled || entitlement.Used >= entitlement.ChannelLimit {
		return View{}, ErrEntitlementRequired
	}
	prepared, err := s.prepare(input)
	if err != nil {
		return View{}, err
	}
	row := model.UserChannel{UserID: userID, Name: prepared.Name, Provider: prepared.Provider, BaseURL: prepared.BaseURL, ModelsJSON: prepared.ModelsJSON, APIKeyCipher: prepared.APIKeyCipher, Status: prepared.Status}
	if err := s.DB.Create(&row).Error; err != nil {
		return View{}, err
	}
	return s.toView(row), nil
}

func (s *Service) Update(userID, id uint, input Input) (View, error) {
	var row model.UserChannel
	if err := s.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrChannelNotFound
		}
		return View{}, err
	}
	prepared, err := s.prepare(input)
	if err != nil {
		return View{}, err
	}
	if prepared.APIKeyCipher == "" {
		prepared.APIKeyCipher = row.APIKeyCipher
	}
	if err := s.DB.Model(&row).Updates(map[string]any{"name": prepared.Name, "provider": prepared.Provider, "base_url": prepared.BaseURL, "api_key_cipher": prepared.APIKeyCipher, "models_json": prepared.ModelsJSON, "status": prepared.Status}).Error; err != nil {
		return View{}, err
	}
	if err := s.DB.First(&row, row.ID).Error; err != nil {
		return View{}, err
	}
	return s.toView(row), nil
}

func (s *Service) Delete(userID, id uint) error {
	result := s.DB.Model(&model.UserChannel{}).Where("id = ? AND user_id = ?", id, userID).Update("status", model.UserChannelHidden)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrChannelNotFound
	}
	return nil
}

func (s *Service) Test(userID, id uint) (View, error) {
	var row model.UserChannel
	if err := s.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		return View{}, ErrChannelNotFound
	}
	key, err := s.decrypt(row.APIKeyCipher)
	if err != nil {
		return View{}, err
	}
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(row.BaseURL, "/")+"/models", nil)
	if err != nil {
		return View{}, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := client.Do(req)
	now := time.Now().UTC()
	updates := map[string]any{"last_tested_at": now, "last_error": ""}
	if err != nil {
		updates["last_error"] = err.Error()
	} else {
		defer res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			updates["last_error"] = fmt.Sprintf("upstream returned HTTP %d", res.StatusCode)
		}
	}
	_ = s.DB.Model(&row).Updates(updates).Error
	if err != nil {
		return View{}, err
	}
	if value, ok := updates["last_error"].(string); ok && value != "" {
		return View{}, errors.New(value)
	}
	_ = s.DB.First(&row, row.ID).Error
	return s.toView(row), nil
}

func (s *Service) Resolve(userID, id uint, modelName, capability string) (Route, error) {
	var row model.UserChannel
	if err := s.DB.Where("id = ? AND user_id = ? AND status = ?", id, userID, model.UserChannelActive).First(&row).Error; err != nil {
		return Route{}, ErrChannelNotFound
	}
	var models []Model
	if err := json.Unmarshal([]byte(row.ModelsJSON), &models); err != nil {
		return Route{}, ErrInvalidChannel
	}
	for _, item := range models {
		if item.Name == strings.TrimSpace(modelName) && item.Capability == strings.TrimSpace(capability) && item.Status != model.UserChannelHidden {
			key, err := s.decrypt(row.APIKeyCipher)
			if err != nil || key == "" {
				return Route{}, ErrInvalidChannel
			}
			return Route{Name: row.Name, Provider: row.Provider, BaseURL: row.BaseURL, APIKey: key, Model: item.Name}, nil
		}
	}
	return Route{}, ErrInvalidChannel
}

type preparedInput struct {
	Name, Provider, BaseURL, APIKeyCipher, ModelsJSON, Status string
}

func (s *Service) prepare(input Input) (preparedInput, error) {
	name, provider, baseURL := strings.TrimSpace(input.Name), strings.TrimSpace(input.Provider), strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	if name == "" || len(name) > 128 || provider == "" || len(provider) > 64 || baseURL == "" || len(baseURL) > 512 || len(input.Models) > 200 {
		return preparedInput{}, ErrInvalidChannel
	}
	status := strings.TrimSpace(input.Status)
	if status == "" {
		status = model.UserChannelActive
	}
	if status != model.UserChannelActive && status != model.UserChannelHidden {
		return preparedInput{}, ErrInvalidChannel
	}
	models, err := json.Marshal(input.Models)
	if err != nil || len(models) > 128*1024 {
		return preparedInput{}, ErrInvalidChannel
	}
	ciphertext := ""
	if strings.TrimSpace(input.APIKey) != "" {
		ciphertext, err = s.encrypt(strings.TrimSpace(input.APIKey))
		if err != nil {
			return preparedInput{}, err
		}
	}
	return preparedInput{Name: name, Provider: provider, BaseURL: baseURL, APIKeyCipher: ciphertext, ModelsJSON: string(models), Status: status}, nil
}

func (s *Service) toView(row model.UserChannel) View {
	var models []Model
	_ = json.Unmarshal([]byte(row.ModelsJSON), &models)
	return View{ID: row.ID, Name: row.Name, Provider: row.Provider, BaseURL: row.BaseURL, APIKeySet: row.APIKeyCipher != "", APIKeyMasked: maskKey(row.APIKeyCipher != ""), Models: models, Status: row.Status, LastTestedAt: row.LastTestedAt, LastError: row.LastError, CreatedAt: row.CreatedAt}
}

func maskKey(set bool) string {
	if !set {
		return ""
	}
	return "已配置"
}

func (s *Service) encrypt(value string) (string, error) {
	key := sha256.Sum256([]byte(s.Cfg.ChannelEncryptionKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(value), nil)), nil
}

func (s *Service) decrypt(value string) (string, error) {
	key := sha256.Sum256([]byte(s.Cfg.ChannelEncryptionKey))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	payload, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(payload) < gcm.NonceSize() {
		return "", errors.New("invalid encrypted channel key")
	}
	plain, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

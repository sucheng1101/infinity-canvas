// Package assets 实现用户资产库：角色 / 场景 / 道具 / 媒体卡片，参考图放在
// 管理员配置的对象存储里，数据库只保存 storage key 与访问地址。
package assets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/storage"
	"gorm.io/gorm"
)

var (
	ErrInvalid  = errors.New("asset is invalid")
	ErrNotFound = errors.New("asset not found")
)

// Input 是创建 / 更新资产时前端提交的字段。Tags 为 nil 表示本次不改标签。
type Input struct {
	Kind    string   `json:"kind"`
	Name    string   `json:"name"`
	Prompt  string   `json:"prompt"`
	Tags    []string `json:"tags"`
	License string   `json:"license"`
}

// ImageView 是一张参考图的返回结构。
type ImageView struct {
	ID         uint      `json:"id"`
	StorageKey string    `json:"storageKey"`
	URL        string    `json:"url"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	Bytes      int64     `json:"bytes"`
	CreatedAt  time.Time `json:"createdAt"`
}

// View 是资产的返回结构：资产本体 + 标签数组 + 参考图列表。
type View struct {
	model.Asset
	Tags   []string    `json:"tags"`
	Images []ImageView `json:"images"`
}

type Service struct {
	DB       *gorm.DB
	Registry *storage.Registry
}

func (s *Service) Create(userID uint, input Input) (View, error) {
	prepared, err := prepare(input)
	if err != nil {
		return View{}, err
	}
	if !prepared.TagsSet {
		prepared.TagsJSON = "[]"
	}
	row := model.Asset{
		ID:       uuid.NewString(),
		UserID:   userID,
		Kind:     prepared.Kind,
		Name:     prepared.Name,
		Prompt:   prepared.Prompt,
		TagsJSON: prepared.TagsJSON,
		License:  prepared.License,
	}
	if err := s.DB.Create(&row).Error; err != nil {
		return View{}, err
	}
	return toView(row, nil), nil
}

func (s *Service) Update(userID uint, id string, input Input) (View, error) {
	var row model.Asset
	if err := s.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	prepared, err := prepare(input)
	if err != nil {
		return View{}, err
	}
	updates := map[string]any{"kind": prepared.Kind, "name": prepared.Name, "prompt": prepared.Prompt, "license": prepared.License}
	if prepared.TagsSet {
		updates["tags_json"] = prepared.TagsJSON
	}
	if err := s.DB.Model(&row).Updates(updates).Error; err != nil {
		return View{}, err
	}
	return s.load(userID, id)
}

// Delete 先清参考图（对象存储删除失败只记日志，不阻断数据库删除），再删资产。
func (s *Service) Delete(userID uint, id string) error {
	var row model.Asset
	if err := s.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	var images []model.AssetImage
	if err := s.DB.Where("asset_id = ?", row.ID).Find(&images).Error; err != nil {
		return err
	}
	if len(images) > 0 {
		s.deleteObjects(userID, images)
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("asset_id = ?", row.ID).Delete(&model.AssetImage{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Asset{}, "id = ?", row.ID).Error
	})
}

func (s *Service) deleteObjects(userID uint, images []model.AssetImage) {
	if s.Registry == nil {
		return
	}
	store, _, err := s.Registry.ResolveForUser(userID)
	if err != nil {
		log.Printf("assets: resolve storage for user %d failed: %v", userID, err)
		return
	}
	for _, image := range images {
		if err := store.Delete(context.Background(), image.StorageKey); err != nil {
			log.Printf("assets: delete object %s failed: %v", image.StorageKey, err)
		}
	}
}

func (s *Service) List(userID uint, kind, query string, page, pageSize int) ([]View, int64, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != "" && !validKind(kind) {
		return nil, 0, ErrInvalid
	}
	page, pageSize = normalizePage(page, pageSize)
	scope := s.DB.Model(&model.Asset{}).Where("user_id = ?", userID)
	if kind != "" {
		scope = scope.Where("kind = ?", kind)
	}
	if value := strings.TrimSpace(query); value != "" {
		scope = scope.Where("name LIKE ?", "%"+value+"%")
	}
	var total int64
	if err := scope.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.Asset
	if err := scope.Order("created_at DESC").Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	images, err := s.imagesOf(rows)
	if err != nil {
		return nil, 0, err
	}
	items := make([]View, 0, len(rows))
	for _, row := range rows {
		items = append(items, toView(row, images[row.ID]))
	}
	return items, total, nil
}

// AddImage 把一张参考图写入对象存储，key 由服务端生成，客户端无法自定义。
func (s *Service) AddImage(userID uint, assetID string, r io.Reader, size int64, contentType string) (View, error) {
	var row model.Asset
	if err := s.DB.Where("id = ? AND user_id = ?", assetID, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	if s.Registry == nil {
		return View{}, storage.ErrNoProvider
	}
	store, _, err := s.Registry.ResolveForUser(userID)
	if err != nil {
		return View{}, err
	}
	key := "asset/" + row.ID + "/" + uuid.NewString() + "." + extensionFor(contentType)
	url, err := store.Put(context.Background(), key, r, size, contentType)
	if err != nil {
		return View{}, err
	}
	image := model.AssetImage{AssetID: row.ID, StorageKey: key, URL: url, Bytes: size}
	if err := s.DB.Create(&image).Error; err != nil {
		// 数据库写入失败时清掉刚上传的对象，避免留下孤儿文件。
		if deleteErr := store.Delete(context.Background(), key); deleteErr != nil {
			log.Printf("assets: delete orphan object %s failed: %v", key, deleteErr)
		}
		return View{}, err
	}
	return s.load(userID, assetID)
}

// load 按归属读取一个资产及其参考图。
func (s *Service) load(userID uint, id string) (View, error) {
	var row model.Asset
	if err := s.DB.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrNotFound
		}
		return View{}, err
	}
	var images []model.AssetImage
	if err := s.DB.Where("asset_id = ?", row.ID).Order("id ASC").Find(&images).Error; err != nil {
		return View{}, err
	}
	return toView(row, images), nil
}

// imagesOf 一次查出这一页资产的参考图，避免逐条查询。
func (s *Service) imagesOf(rows []model.Asset) (map[string][]model.AssetImage, error) {
	result := make(map[string][]model.AssetImage, len(rows))
	if len(rows) == 0 {
		return result, nil
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	var images []model.AssetImage
	if err := s.DB.Where("asset_id IN ?", ids).Order("id ASC").Find(&images).Error; err != nil {
		return nil, err
	}
	for _, image := range images {
		result[image.AssetID] = append(result[image.AssetID], image)
	}
	return result, nil
}

type prepared struct {
	Kind     string
	Name     string
	Prompt   string
	License  string
	TagsJSON string
	TagsSet  bool
}

func prepare(input Input) (prepared, error) {
	name := strings.TrimSpace(input.Name)
	kind := strings.ToLower(strings.TrimSpace(input.Kind))
	if name == "" || len(name) > 128 || !validKind(kind) {
		return prepared{}, ErrInvalid
	}
	license := strings.ToLower(strings.TrimSpace(input.License))
	if license == "" {
		license = model.AssetLicenseOwn
	}
	if len(license) > 16 {
		return prepared{}, ErrInvalid
	}
	result := prepared{Kind: kind, Name: name, Prompt: input.Prompt, License: license}
	if input.Tags != nil {
		encoded, err := encodeTags(input.Tags)
		if err != nil {
			return prepared{}, err
		}
		result.TagsJSON, result.TagsSet = encoded, true
	}
	return result, nil
}

// validKind 限定资产的四种类型，与 model.AssetKind* 一一对应。
func validKind(kind string) bool {
	switch kind {
	case model.AssetKindCharacter, model.AssetKindScene, model.AssetKindProp, model.AssetKindMedia:
		return true
	default:
		return false
	}
}

// encodeTags 去掉空白标签与重复项后按 JSON 数组存库。
func encodeTags(tags []string) (string, error) {
	clean := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		value := strings.TrimSpace(tag)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		clean = append(clean, value)
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func decodeTags(raw string) []string {
	tags := []string{}
	if strings.TrimSpace(raw) == "" {
		return tags
	}
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return []string{}
	}
	if tags == nil {
		return []string{}
	}
	return tags
}

// extensionFor 按 MIME 类型推导扩展名，未知类型一律 .bin。
func extensionFor(contentType string) string {
	mime := strings.ToLower(strings.TrimSpace(contentType))
	if index := strings.Index(mime, ";"); index >= 0 {
		mime = strings.TrimSpace(mime[:index])
	}
	extensions := map[string]string{
		"image/png":       "png",
		"image/jpeg":      "jpg",
		"image/jpg":       "jpg",
		"image/webp":      "webp",
		"image/gif":       "gif",
		"image/avif":      "avif",
		"image/bmp":       "bmp",
		"image/svg+xml":   "svg",
		"video/mp4":       "mp4",
		"video/webm":      "webm",
		"video/quicktime": "mov",
		"audio/mpeg":      "mp3",
		"audio/wav":       "wav",
		"audio/x-wav":     "wav",
		"audio/mp4":       "m4a",
	}
	if value, ok := extensions[mime]; ok {
		return value
	}
	return "bin"
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

func toView(row model.Asset, images []model.AssetImage) View {
	views := make([]ImageView, 0, len(images))
	for _, image := range images {
		views = append(views, ImageView{ID: image.ID, StorageKey: image.StorageKey, URL: image.URL, Width: image.Width, Height: image.Height, Bytes: image.Bytes, CreatedAt: image.CreatedAt})
	}
	return View{Asset: row, Tags: decodeTags(row.TagsJSON), Images: views}
}

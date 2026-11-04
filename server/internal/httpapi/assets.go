package httpapi

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sucheng1101/infinity-canvas/server/internal/assets"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/storage"
)

// maxAssetImageBytes 是单张参考图的上限，超限直接拒绝，不落库。
const maxAssetImageBytes = 20 << 20

func (a *Router) assetsList(c *gin.Context) {
	user, _ := currentUser(c)
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize"))
	items, total, err := a.Assets.List(user.ID, c.Query("kind"), c.Query("q"), page, pageSize)
	if errors.Is(err, assets.ErrInvalid) {
		errorJSON(c, http.StatusBadRequest, "ASSET_KIND_INVALID", "资产类型只能是 character / scene / prop / media")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "ASSETS_READ_FAILED", "资产列表读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items, "total": total})
}

func (a *Router) assetCreate(c *gin.Context) {
	user, _ := currentUser(c)
	var input assets.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "资产参数无效")
		return
	}
	item, err := a.Assets.Create(user.ID, input)
	if errors.Is(err, assets.ErrInvalid) {
		errorJSON(c, http.StatusBadRequest, "ASSET_INVALID", "资产名称、类型或授权信息无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "ASSET_CREATE_FAILED", "资产创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) assetUpdate(c *gin.Context) {
	user, _ := currentUser(c)
	var input assets.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "资产参数无效")
		return
	}
	item, err := a.Assets.Update(user.ID, c.Param("id"), input)
	if errors.Is(err, assets.ErrNotFound) {
		errorJSON(c, http.StatusNotFound, "ASSET_NOT_FOUND", "资产不存在")
		return
	}
	if errors.Is(err, assets.ErrInvalid) {
		errorJSON(c, http.StatusBadRequest, "ASSET_INVALID", "资产名称、类型或授权信息无效")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "ASSET_UPDATE_FAILED", "资产更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) assetDelete(c *gin.Context) {
	user, _ := currentUser(c)
	err := a.Assets.Delete(user.ID, c.Param("id"))
	if errors.Is(err, assets.ErrNotFound) {
		errorJSON(c, http.StatusNotFound, "ASSET_NOT_FOUND", "资产不存在")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "ASSET_DELETE_FAILED", "资产删除失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) assetUploadImage(c *gin.Context) {
	user, _ := currentUser(c)
	header, err := c.FormFile("file")
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "ASSET_FILE_REQUIRED", "请选择要上传的图片文件")
		return
	}
	if header.Size <= 0 || header.Size > maxAssetImageBytes {
		errorJSON(c, http.StatusRequestEntityTooLarge, "ASSET_FILE_TOO_LARGE", "单个文件不能超过 20MB")
		return
	}
	file, err := header.Open()
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "ASSET_FILE_READ_FAILED", "图片读取失败")
		return
	}
	defer file.Close()
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = mime.TypeByExtension(path.Ext(header.Filename))
	}
	item, err := a.Assets.AddImage(user.ID, c.Param("id"), file, header.Size, contentType)
	if errors.Is(err, assets.ErrNotFound) {
		errorJSON(c, http.StatusNotFound, "ASSET_NOT_FOUND", "资产不存在")
		return
	}
	if errors.Is(err, storage.ErrNoProvider) {
		errorJSON(c, http.StatusServiceUnavailable, "STORAGE_NOT_CONFIGURED", "暂无可用的存储")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusBadGateway, "ASSET_IMAGE_UPLOAD_FAILED", "参考图保存失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
}

// assetFile 是公开的文件读取路由：本地驱动直接回写对象内容，S3 驱动跳转到对象地址。
// 对象 key 只由服务端生成（asset/<id>/<uuid>.<ext>），不接受客户端自定义路径。
func (a *Router) assetFile(c *gin.Context) {
	key, err := storage.NormalizeKey(c.Param("key"))
	if err != nil {
		errorJSON(c, http.StatusBadRequest, "FILE_KEY_INVALID", "文件路径无效")
		return
	}
	if a.Registry == nil {
		errorJSON(c, http.StatusServiceUnavailable, "STORAGE_NOT_CONFIGURED", "暂无可用的存储")
		return
	}
	store, provider, err := a.fileStoreForKey(key)
	if errors.Is(err, storage.ErrNoProvider) {
		errorJSON(c, http.StatusServiceUnavailable, "STORAGE_NOT_CONFIGURED", "暂无可用的存储")
		return
	}
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "STORAGE_READ_FAILED", "存储读取失败")
		return
	}
	if provider.Driver != "local" {
		c.Redirect(http.StatusFound, store.URL(key))
		return
	}
	body, err := store.Open(c.Request.Context(), key)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			errorJSON(c, http.StatusNotFound, "FILE_NOT_FOUND", "文件不存在")
			return
		}
		errorJSON(c, http.StatusInternalServerError, "FILE_READ_FAILED", "文件读取失败")
		return
	}
	defer body.Close()
	if contentType := mime.TypeByExtension(path.Ext(key)); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	c.Header("Cache-Control", "public, max-age=86400")
	c.Status(http.StatusOK)
	if _, err := io.Copy(c.Writer, body); err != nil {
		_ = c.Error(err)
	}
}

// fileStoreForKey 按对象 key 找到所属用户，再用该用户选择的存储读取；找不到归属时回落到默认存储。
func (a *Router) fileStoreForKey(key string) (storage.Store, model.StorageProvider, error) {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) >= 3 && parts[0] == "asset" {
		var image model.AssetImage
		if err := a.DB.Where("storage_key = ?", key).First(&image).Error; err == nil {
			var asset model.Asset
			if err := a.DB.Select("id", "user_id").First(&asset, "id = ?", image.AssetID).Error; err == nil {
				return a.Registry.ResolveForUser(asset.UserID)
			}
		}
	}
	return a.Registry.Default()
}

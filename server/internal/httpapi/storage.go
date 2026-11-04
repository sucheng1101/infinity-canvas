package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sucheng1101/infinity-canvas/server/internal/storageadmin"
)

func (a *Router) adminStorageProviders(c *gin.Context) {
	items, err := a.Storage.List()
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "STORAGE_READ_FAILED", "存储配置读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) adminCreateStorageProvider(c *gin.Context) {
	var input storageadmin.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storage.Create(operatorID(c), input)
	if err != nil {
		storageError(c, err, "STORAGE_CREATE_FAILED", "存储配置创建失败")
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) adminUpdateStorageProvider(c *gin.Context) {
	var input storageadmin.Input
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storage.Update(operatorID(c), c.Param("id"), input)
	if err != nil {
		storageError(c, err, "STORAGE_UPDATE_FAILED", "存储配置更新失败")
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) adminDeleteStorageProvider(c *gin.Context) {
	err := a.Storage.Delete(operatorID(c), c.Param("id"))
	if err != nil {
		storageError(c, err, "STORAGE_DELETE_FAILED", "存储配置删除失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) adminTestStorageProvider(c *gin.Context) {
	if err := a.Storage.Test(c.Param("id")); err != nil {
		errorJSON(c, http.StatusBadGateway, "STORAGE_TEST_FAILED", "存储连接失败："+err.Error())
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) accountStorageOptions(c *gin.Context) {
	user, _ := currentUser(c)
	options, current, inherited, err := a.Storage.Options(user.ID)
	if err != nil {
		errorJSON(c, http.StatusInternalServerError, "STORAGE_READ_FAILED", "存储选项读取失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": options, "current": current, "inherited": inherited})
}

func (a *Router) accountChooseStorage(c *gin.Context) {
	user, _ := currentUser(c)
	var input struct {
		ProviderID string `json:"providerId"`
	}
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	if err := a.Storage.Choose(user.ID, input.ProviderID); err != nil {
		if errors.Is(err, storageadmin.ErrNotAvailable) {
			errorJSON(c, http.StatusBadRequest, "STORAGE_NOT_AVAILABLE", "该存储未启用")
			return
		}
		errorJSON(c, http.StatusInternalServerError, "STORAGE_CHOOSE_FAILED", "存储偏好保存失败")
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func storageError(c *gin.Context, err error, code, message string) {
	switch {
	case errors.Is(err, storageadmin.ErrNotFound):
		errorJSON(c, http.StatusNotFound, "STORAGE_NOT_FOUND", "存储配置不存在")
	case errors.Is(err, storageadmin.ErrLastProvider):
		errorJSON(c, http.StatusBadRequest, "STORAGE_LAST_PROVIDER", "至少要保留一个启用的存储")
	case errors.Is(err, storageadmin.ErrInvalid):
		errorJSON(c, http.StatusBadRequest, "STORAGE_INVALID", err.Error())
	default:
		errorJSON(c, http.StatusInternalServerError, code, message)
	}
}

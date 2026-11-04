package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sucheng1101/infinity-canvas/server/internal/storyboard"
)

func storyboardError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, storyboard.ErrNotFound):
		errorJSON(c, http.StatusNotFound, "STORYBOARD_NOT_FOUND", "分镜条目不存在")
	case errors.Is(err, storyboard.ErrInvalid):
		errorJSON(c, http.StatusBadRequest, "STORYBOARD_INVALID", "分镜参数无效")
	default:
		errorJSON(c, http.StatusInternalServerError, "STORYBOARD_FAILED", "分镜操作失败")
	}
}

func (a *Router) storyboardScenes(c *gin.Context) {
	user, _ := currentUser(c)
	items, err := a.Storyboard.ListScenes(user.ID, c.Param("projectId"))
	if err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusOK, gin.H{"items": items})
}

func (a *Router) storyboardCreateScene(c *gin.Context) {
	user, _ := currentUser(c)
	var input storyboard.SceneInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storyboard.CreateScene(user.ID, c.Param("projectId"), input)
	if err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) storyboardUpdateScene(c *gin.Context) {
	user, _ := currentUser(c)
	var input storyboard.SceneInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storyboard.UpdateScene(user.ID, c.Param("id"), input)
	if err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) storyboardDeleteScene(c *gin.Context) {
	user, _ := currentUser(c)
	if err := a.Storyboard.DeleteScene(user.ID, c.Param("id")); err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

func (a *Router) storyboardCreateShot(c *gin.Context) {
	user, _ := currentUser(c)
	var input storyboard.ShotInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storyboard.CreateShot(user.ID, c.Param("id"), input)
	if err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusCreated, item)
}

func (a *Router) storyboardUpdateShot(c *gin.Context) {
	user, _ := currentUser(c)
	var input storyboard.ShotInput
	if c.ShouldBindJSON(&input) != nil {
		errorJSON(c, http.StatusBadRequest, "INVALID_REQUEST", "请求参数无效")
		return
	}
	item, err := a.Storyboard.UpdateShot(user.ID, c.Param("id"), input)
	if err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusOK, item)
}

func (a *Router) storyboardDeleteShot(c *gin.Context) {
	user, _ := currentUser(c)
	if err := a.Storyboard.DeleteShot(user.ID, c.Param("id")); err != nil {
		storyboardError(c, err)
		return
	}
	successJSON(c, http.StatusOK, gin.H{"ok": true})
}

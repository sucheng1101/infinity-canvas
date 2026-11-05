// Package storyboard stores scenes and shots for one canvas project.
package storyboard

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

var (
	ErrNotFound = errors.New("storyboard item not found")
	ErrInvalid  = errors.New("storyboard item is invalid")
)

type Service struct {
	DB *gorm.DB
}

type SceneInput struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

type ShotInput struct {
	DurationSec int      `json:"durationSec"`
	ShotSize    string   `json:"shotSize"`
	Camera      string   `json:"camera"`
	Dialogue    string   `json:"dialogue"`
	Prompt      string   `json:"prompt"`
	AssetRefs   []string `json:"assetRefs"`
	ImageNodeID string   `json:"imageNodeId"`
	VideoNodeID string   `json:"videoNodeId"`
	AudioURL    string   `json:"audioUrl"`
}

type ShotView struct {
	model.Shot
	AssetRefs []string `json:"assetRefs"`
}

type SceneView struct {
	model.Scene
	Shots []ShotView `json:"shots"`
}

func (s *Service) ListScenes(userID uint, projectID string) ([]SceneView, error) {
	var scenes []model.Scene
	if err := s.DB.Where("user_id = ? AND project_id = ?", userID, projectID).Order("order_index ASC").Order("created_at ASC").Find(&scenes).Error; err != nil {
		return nil, err
	}
	views := make([]SceneView, 0, len(scenes))
	for _, scene := range scenes {
		shots, err := s.listShots(userID, scene.ID)
		if err != nil {
			return nil, err
		}
		views = append(views, SceneView{Scene: scene, Shots: shots})
	}
	return views, nil
}

func (s *Service) CreateScene(userID uint, projectID string, input SceneInput) (SceneView, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return SceneView{}, ErrInvalid
	}
	var count int64
	if err := s.DB.Model(&model.Scene{}).Where("user_id = ? AND project_id = ?", userID, projectID).Count(&count).Error; err != nil {
		return SceneView{}, err
	}
	scene := model.Scene{ID: uuid.NewString(), UserID: userID, ProjectID: projectID, Name: name, Summary: strings.TrimSpace(input.Summary), OrderIndex: int(count)}
	if err := s.DB.Create(&scene).Error; err != nil {
		return SceneView{}, err
	}
	return SceneView{Scene: scene, Shots: []ShotView{}}, nil
}

func (s *Service) UpdateScene(userID uint, sceneID string, input SceneInput) (SceneView, error) {
	var scene model.Scene
	if err := s.DB.Where("id = ? AND user_id = ?", sceneID, userID).First(&scene).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return SceneView{}, ErrNotFound
		}
		return SceneView{}, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return SceneView{}, ErrInvalid
	}
	scene.Name = name
	scene.Summary = strings.TrimSpace(input.Summary)
	if err := s.DB.Save(&scene).Error; err != nil {
		return SceneView{}, err
	}
	return SceneView{Scene: scene}, nil
}

func (s *Service) DeleteScene(userID uint, sceneID string) error {
	var scene model.Scene
	if err := s.DB.Where("id = ? AND user_id = ?", sceneID, userID).First(&scene).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("scene_id = ?", sceneID).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Scene{}, "id = ?", sceneID).Error
	})
}

func (s *Service) listShots(userID uint, sceneID string) ([]ShotView, error) {
	var shots []model.Shot
	if err := s.DB.Where("user_id = ? AND scene_id = ?", userID, sceneID).Order("order_index ASC").Order("created_at ASC").Find(&shots).Error; err != nil {
		return nil, err
	}
	views := make([]ShotView, 0, len(shots))
	for _, shot := range shots {
		views = append(views, toShotView(shot))
	}
	return views, nil
}

func (s *Service) CreateShot(userID uint, sceneID string, input ShotInput) (ShotView, error) {
	var scene model.Scene
	if err := s.DB.Where("id = ? AND user_id = ?", sceneID, userID).First(&scene).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ShotView{}, ErrNotFound
		}
		return ShotView{}, err
	}
	var count int64
	if err := s.DB.Model(&model.Shot{}).Where("scene_id = ?", sceneID).Count(&count).Error; err != nil {
		return ShotView{}, err
	}
	shot, err := buildShot(userID, sceneID, int(count), input)
	if err != nil {
		return ShotView{}, err
	}
	if err := s.DB.Create(&shot).Error; err != nil {
		return ShotView{}, err
	}
	return toShotView(shot), nil
}

func (s *Service) UpdateShot(userID uint, shotID string, input ShotInput) (ShotView, error) {
	var shot model.Shot
	if err := s.DB.Where("id = ? AND user_id = ?", shotID, userID).First(&shot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ShotView{}, ErrNotFound
		}
		return ShotView{}, err
	}
	updated, err := buildShot(userID, shot.SceneID, shot.OrderIndex, input)
	if err != nil {
		return ShotView{}, err
	}
	updated.ID = shot.ID
	updated.CreatedAt = shot.CreatedAt
	if err := s.DB.Save(&updated).Error; err != nil {
		return ShotView{}, err
	}
	return toShotView(updated), nil
}

func (s *Service) DeleteShot(userID uint, shotID string) error {
	result := s.DB.Where("id = ? AND user_id = ?", shotID, userID).Delete(&model.Shot{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func buildShot(userID uint, sceneID string, order int, input ShotInput) (model.Shot, error) {
	duration := input.DurationSec
	if duration <= 0 {
		duration = 4
	}
	if duration > 600 {
		return model.Shot{}, ErrInvalid
	}
	refs, err := json.Marshal(input.AssetRefs)
	if err != nil {
		return model.Shot{}, err
	}
	if input.AssetRefs == nil {
		refs = []byte("[]")
	}
	return model.Shot{
		ID:            uuid.NewString(),
		UserID:        userID,
		SceneID:       sceneID,
		OrderIndex:    order,
		DurationSec:   duration,
		ShotSize:      strings.TrimSpace(input.ShotSize),
		Camera:        strings.TrimSpace(input.Camera),
		Dialogue:      strings.TrimSpace(input.Dialogue),
		Prompt:        strings.TrimSpace(input.Prompt),
		AssetRefsJSON: string(refs),
		ImageNodeID:   strings.TrimSpace(input.ImageNodeID),
		VideoNodeID:   strings.TrimSpace(input.VideoNodeID),
		AudioURL:      strings.TrimSpace(input.AudioURL),
	}, nil
}

func toShotView(shot model.Shot) ShotView {
	refs := []string{}
	if strings.TrimSpace(shot.AssetRefsJSON) != "" {
		_ = json.Unmarshal([]byte(shot.AssetRefsJSON), &refs)
	}
	if refs == nil {
		refs = []string{}
	}
	return ShotView{Shot: shot, AssetRefs: refs}
}

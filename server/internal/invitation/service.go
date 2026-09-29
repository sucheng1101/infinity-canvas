package invitation

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"gorm.io/gorm"
)

const (
	relationBound    = "bound"
	relationVerified = "verified"
	rewardCredited   = "credited"
	rewardInviter    = "inviter"
	rewardInvitee    = "invitee"
)

var (
	ErrCodeInvalid  = errors.New("invitation code invalid")
	ErrSelfUse      = errors.New("invitation code cannot be used by its owner")
	ErrAlreadyBound = errors.New("invitation already bound")
)

type Service struct {
	DB    *gorm.DB
	Cfg   config.Config
	Quota *quota.Service
}

type Settings struct {
	Open         bool  `json:"open"`
	InviterQuota int64 `json:"inviterQuota"`
	InviteeQuota int64 `json:"inviteeQuota"`
	Version      int64 `json:"version"`
}

func (s *Service) Settings() (Settings, error) {
	settings := Settings{
		Open:         s.Cfg.InvitationRewardOpen,
		InviterQuota: s.Cfg.InvitationInviterQuota,
		InviteeQuota: s.Cfg.InvitationInviteeQuota,
		Version:      1,
	}
	var rows []model.OperationSetting
	if err := s.DB.Where("`key` IN ?", []string{"invitation.reward.open", "invitation.reward.inviter_quota", "invitation.reward.invitee_quota"}).Find(&rows).Error; err != nil {
		return Settings{}, err
	}
	for _, row := range rows {
		switch row.Key {
		case "invitation.reward.open":
			settings.Open, _ = strconv.ParseBool(row.Value)
		case "invitation.reward.inviter_quota":
			settings.InviterQuota, _ = strconv.ParseInt(row.Value, 10, 64)
		case "invitation.reward.invitee_quota":
			settings.InviteeQuota, _ = strconv.ParseInt(row.Value, 10, 64)
		}
		if row.Version > settings.Version {
			settings.Version = row.Version
		}
	}
	return settings, nil
}

func (s *Service) UpdateSettings(operatorID uint, settings Settings) (Settings, error) {
	if settings.InviterQuota < 0 || settings.InviteeQuota < 0 {
		return Settings{}, errors.New("invitation quota must not be negative")
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		values := map[string]string{
			"invitation.reward.open":          strconv.FormatBool(settings.Open),
			"invitation.reward.inviter_quota": strconv.FormatInt(settings.InviterQuota, 10),
			"invitation.reward.invitee_quota": strconv.FormatInt(settings.InviteeQuota, 10),
		}
		for key, value := range values {
			var row model.OperationSetting
			err := tx.Where("`key` = ?", key).First(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := tx.Create(&model.OperationSetting{Key: key, Value: value, Version: 1, UpdatedBy: &operatorID}).Error; err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			row.Value = value
			row.Version++
			row.UpdatedBy = &operatorID
			if err := tx.Save(&row).Error; err != nil {
				return err
			}
		}
		return model.RecordAudit(tx, operatorID, "invitation.settings.update", "invitation_settings", "")
	})
	if err != nil {
		return Settings{}, err
	}
	return s.Settings()
}

func (s *Service) Bind(tx *gorm.DB, inviteeUserID uint, inviteCode string) error {
	code := strings.ToUpper(strings.TrimSpace(inviteCode))
	if code == "" {
		return nil
	}
	var inviter model.User
	if err := tx.Where("invite_code = ?", code).First(&inviter).Error; err != nil {
		return ErrCodeInvalid
	}
	if inviter.ID == inviteeUserID {
		return ErrSelfUse
	}
	var existing model.InvitationRelation
	if err := tx.Where("invitee_user_id = ?", inviteeUserID).First(&existing).Error; err == nil {
		return ErrAlreadyBound
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&model.InvitationRelation{
		InviterUserID: inviter.ID,
		InviteeUserID: inviteeUserID,
		InviteCode:    code,
		BoundAt:       time.Now().UTC(),
		Status:        relationBound,
	}).Error
}

func (s *Service) RewardVerified(userID uint) error {
	settings, err := s.Settings()
	if err != nil || !settings.Open {
		return err
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var relation model.InvitationRelation
		if err := tx.Where("invitee_user_id = ?", userID).First(&relation).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if relation.Status == relationVerified {
			return nil
		}
		now := time.Now().UTC()
		relation.Status = relationVerified
		relation.VerifiedAt = &now
		if err := tx.Save(&relation).Error; err != nil {
			return err
		}
		if settings.InviterQuota > 0 {
			if err := s.creditReward(tx, relation, relation.InviterUserID, rewardInviter, settings.InviterQuota, settings.Version); err != nil {
				return err
			}
		}
		if settings.InviteeQuota > 0 {
			if err := s.creditReward(tx, relation, relation.InviteeUserID, rewardInvitee, settings.InviteeQuota, settings.Version); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Service) creditReward(tx *gorm.DB, relation model.InvitationRelation, beneficiaryID uint, rewardType string, amount, version int64) error {
	idempotencyKey := fmt.Sprintf("invitation:%d:%s", relation.ID, rewardType)
	var existing model.InvitationReward
	if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if err := s.Quota.CreditTx(tx, beneficiaryID, amount, "invitation", "invitation_reward", fmt.Sprint(relation.ID), idempotencyKey); err != nil {
		return err
	}
	now := time.Now().UTC()
	return tx.Create(&model.InvitationReward{
		RelationID: relation.ID, BeneficiaryUserID: beneficiaryID, RewardType: rewardType,
		QuotaAmount: amount, ConfigVersion: version, Status: rewardCredited,
		IdempotencyKey: idempotencyKey, CreditedAt: &now,
	}).Error
}

func (s *Service) Self(userID uint) (ginSelf, error) {
	var user model.User
	if err := s.DB.First(&user, userID).Error; err != nil {
		return ginSelf{}, err
	}
	var invited, rewarded int64
	if err := s.DB.Model(&model.InvitationRelation{}).Where("inviter_user_id = ?", userID).Count(&invited).Error; err != nil {
		return ginSelf{}, err
	}
	if err := s.DB.Model(&model.InvitationReward{}).Where("beneficiary_user_id = ? AND status = ?", userID, rewardCredited).Count(&rewarded).Error; err != nil {
		return ginSelf{}, err
	}
	settings, err := s.Settings()
	if err != nil {
		return ginSelf{}, err
	}
	return ginSelf{InviteCode: user.InviteCode, Counts: map[string]int64{"invited": invited, "rewarded": rewarded}, Settings: settings}, nil
}

type ginSelf struct {
	InviteCode string           `json:"inviteCode"`
	Counts     map[string]int64 `json:"counts"`
	Settings   Settings         `json:"rewardConfigSummary"`
}

func (s *Service) Rewards(userID uint, limit, offset int) ([]model.InvitationReward, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var items []model.InvitationReward
	if err := s.DB.Where("beneficiary_user_id = ?", userID).Order("id DESC").Offset(offset).Limit(limit + 1).Find(&items).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

func (s *Service) Referrals(userID uint, limit, offset int) ([]model.InvitationRelation, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var items []model.InvitationRelation
	if err := s.DB.Where("inviter_user_id = ?", userID).Order("id DESC").Offset(offset).Limit(limit + 1).Find(&items).Error; err != nil {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

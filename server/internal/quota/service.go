package quota

import (
	"errors"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInsufficient        = errors.New("quota insufficient")
	ErrInvalidAmount       = errors.New("quota amount must be positive")
	ErrReservationNotFound = errors.New("quota reservation not found")
	ErrReservationAmount   = errors.New("settled amount exceeds reservation")
	ErrAccountNotFound     = errors.New("quota account not found")
)

type Service struct {
	DB *gorm.DB
}

type Summary struct {
	Balance   int64 `json:"balance"`
	Reserved  int64 `json:"reserved"`
	Available int64 `json:"available"`
}

func (s *Service) EnsureAccount(tx *gorm.DB, userID uint) (model.QuotaAccount, error) {
	var account model.QuotaAccount
	err := tx.Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		account = model.QuotaAccount{UserID: userID}
		err = tx.Create(&account).Error
	}
	return account, err
}

func (s *Service) Summary(userID uint) (Summary, error) {
	account, err := s.EnsureAccount(s.DB, userID)
	if err != nil {
		return Summary{}, err
	}
	return Summary{Balance: account.Balance, Reserved: account.Reserved, Available: account.Balance - account.Reserved}, nil
}

func (s *Service) Credit(userID uint, amount int64, source, businessType, businessID, idempotencyKey string) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		return s.CreditTx(tx, userID, amount, source, businessType, businessID, idempotencyKey)
	})
}

func (s *Service) CreditTx(tx *gorm.DB, userID uint, amount int64, source, businessType, businessID, idempotencyKey string) error {
	if amount <= 0 {
		return ErrInvalidAmount
	}
	var existing model.QuotaLedger
	if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var account model.QuotaAccount
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		account = model.QuotaAccount{UserID: userID}
		if err := tx.Create(&account).Error; err != nil {
			return err
		}
	}
	account.Balance += amount
	if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
		return err
	}
	return tx.Create(&model.QuotaLedger{
		UserID: userID, Delta: amount, BalanceAfter: account.Balance, Source: source,
		BusinessType: businessType, BusinessID: businessID, IdempotencyKey: idempotencyKey,
	}).Error
}

func (s *Service) Reserve(userID uint, taskID string, amount int64, idempotencyKey string) (model.QuotaReservation, error) {
	var reservation model.QuotaReservation
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		var err error
		reservation, err = s.ReserveTx(tx, userID, taskID, amount, idempotencyKey)
		return err
	})
	return reservation, err
}

func (s *Service) ReserveTx(tx *gorm.DB, userID uint, taskID string, amount int64, idempotencyKey string) (model.QuotaReservation, error) {
	if amount <= 0 || taskID == "" || idempotencyKey == "" {
		return model.QuotaReservation{}, ErrInvalidAmount
	}
	var existing model.QuotaReservation
	if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
		return existing, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return model.QuotaReservation{}, err
	}
	account, err := s.lockAccount(tx, userID)
	if err != nil {
		return model.QuotaReservation{}, err
	}
	if account.Balance-account.Reserved < amount {
		return model.QuotaReservation{}, ErrInsufficient
	}
	account.Reserved += amount
	if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("reserved", account.Reserved).Error; err != nil {
		return model.QuotaReservation{}, err
	}
	reservation := model.QuotaReservation{
		ID: uuid.NewString(), UserID: userID, TaskID: taskID, Amount: amount,
		Status: model.QuotaReservationOpen, IdempotencyKey: idempotencyKey,
	}
	if err := tx.Create(&reservation).Error; err != nil {
		return model.QuotaReservation{}, err
	}
	return reservation, nil
}

func (s *Service) Release(taskID string) error {
	return s.DB.Transaction(func(tx *gorm.DB) error { return s.ReleaseTx(tx, taskID) })
}

func (s *Service) ReleaseTx(tx *gorm.DB, taskID string) error {
	reservation, account, err := s.lockReservation(tx, taskID)
	if err != nil {
		return err
	}
	if reservation.Status != model.QuotaReservationOpen {
		return nil
	}
	if account.Reserved < reservation.Amount {
		return ErrReservationAmount
	}
	account.Reserved -= reservation.Amount
	if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("reserved", account.Reserved).Error; err != nil {
		return err
	}
	return tx.Model(&model.QuotaReservation{}).Where("id = ?", reservation.ID).Update("status", model.QuotaReservationReleased).Error
}

func (s *Service) Settle(taskID string, amount int64) error {
	return s.DB.Transaction(func(tx *gorm.DB) error { return s.SettleTx(tx, taskID, amount) })
}

func (s *Service) SettleTx(tx *gorm.DB, taskID string, amount int64) error {
	if amount < 0 {
		return ErrInvalidAmount
	}
	reservation, account, err := s.lockReservation(tx, taskID)
	if err != nil {
		return err
	}
	if reservation.Status != model.QuotaReservationOpen {
		return nil
	}
	if amount > reservation.Amount || account.Reserved < reservation.Amount || account.Balance < amount {
		return ErrReservationAmount
	}
	account.Reserved -= reservation.Amount
	account.Balance -= amount
	if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Updates(map[string]any{"reserved": account.Reserved, "balance": account.Balance}).Error; err != nil {
		return err
	}
	if amount > 0 {
		if err := tx.Create(&model.QuotaLedger{
			UserID: account.UserID, Delta: -amount, BalanceAfter: account.Balance,
			Source: "generation", BusinessType: "generation_settlement", BusinessID: taskID,
			IdempotencyKey: "generation:settle:" + taskID,
		}).Error; err != nil {
			return err
		}
	}
	return tx.Model(&model.QuotaReservation{}).Where("id = ?", reservation.ID).Updates(map[string]any{"status": model.QuotaReservationSettled}).Error
}

func (s *Service) lockAccount(tx *gorm.DB, userID uint) (model.QuotaAccount, error) {
	var account model.QuotaAccount
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		account = model.QuotaAccount{UserID: userID}
		err = tx.Create(&account).Error
	}
	return account, err
}

func (s *Service) lockReservation(tx *gorm.DB, taskID string) (model.QuotaReservation, model.QuotaAccount, error) {
	var reservation model.QuotaReservation
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("task_id = ?", taskID).First(&reservation).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.QuotaReservation{}, model.QuotaAccount{}, ErrReservationNotFound
		}
		return model.QuotaReservation{}, model.QuotaAccount{}, err
	}
	account, err := s.lockAccount(tx, reservation.UserID)
	return reservation, account, err
}

func (s *Service) Adjust(userID uint, delta int64, source, businessID, idempotencyKey string) error {
	return s.AdjustWithReason(userID, delta, source, businessID, idempotencyKey, "")
}

func (s *Service) AdjustWithReason(userID uint, delta int64, source, businessID, idempotencyKey, reason string) error {
	if delta == 0 {
		return ErrInvalidAmount
	}
	return s.DB.Transaction(func(tx *gorm.DB) error {
		var existing model.QuotaLedger
		if err := tx.Where("idempotency_key = ?", idempotencyKey).First(&existing).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var account model.QuotaAccount
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", userID).First(&account).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAccountNotFound
			}
			return err
		}
		if account.Balance+delta < account.Reserved {
			return ErrInsufficient
		}
		account.Balance += delta
		if err := tx.Model(&model.QuotaAccount{}).Where("id = ?", account.ID).Update("balance", account.Balance).Error; err != nil {
			return err
		}
		return tx.Create(&model.QuotaLedger{
			UserID: userID, Delta: delta, BalanceAfter: account.Balance, Source: source,
			BusinessType: "admin_adjustment", BusinessID: businessID, Reason: reason, IdempotencyKey: idempotencyKey,
		}).Error
	})
}

func (s *Service) Ledger(userID uint, limit, offset int) ([]model.QuotaLedger, bool, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	var items []model.QuotaLedger
	err := s.DB.Where("user_id = ?", userID).Order("id DESC").Offset(offset).Limit(limit + 1).Find(&items).Error
	if err != nil {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
}

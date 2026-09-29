package generation

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/pricing"
	"github.com/sucheng1101/infinity-canvas/server/internal/quota"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrTaskNotFound      = errors.New("generation task not found")
	ErrInvalidTask       = errors.New("invalid generation task")
	ErrInvalidTransition = errors.New("invalid generation task transition")
)

type Service struct {
	DB      *gorm.DB
	Quota   *quota.Service
	Pricing *pricing.Service
}

type CreateInput struct {
	QuoteID        string         `json:"quoteId"`
	ModelID        uint           `json:"modelId"`
	Capability     string         `json:"capability"`
	Parameters     map[string]any `json:"parameters"`
	Payload        map[string]any `json:"payload"`
	IdempotencyKey string         `json:"idempotencyKey"`
}

type View struct {
	ID             string         `json:"id"`
	QuoteID        string         `json:"quoteId"`
	ModelID        uint           `json:"modelId"`
	Capability     string         `json:"capability"`
	Status         string         `json:"status"`
	ReservedAmount int64          `json:"reservedAmount"`
	SettledAmount  int64          `json:"settledAmount"`
	Output         map[string]any `json:"output,omitempty"`
	ErrorCode      string         `json:"errorCode,omitempty"`
	ErrorMessage   string         `json:"errorMessage,omitempty"`
	StartedAt      *time.Time     `json:"startedAt,omitempty"`
	CompletedAt    *time.Time     `json:"completedAt,omitempty"`
	CreatedAt      time.Time      `json:"createdAt"`
}

func (s *Service) Create(userID uint, input CreateInput) (View, error) {
	if userID == 0 || strings.TrimSpace(input.QuoteID) == "" || input.ModelID == 0 || strings.TrimSpace(input.IdempotencyKey) == "" {
		return View{}, ErrInvalidTask
	}
	if input.Parameters == nil {
		input.Parameters = map[string]any{}
	}
	if input.Payload == nil {
		input.Payload = map[string]any{}
	}
	parameters, err := json.Marshal(input.Parameters)
	if err != nil || len(parameters) > 64*1024 {
		return View{}, ErrInvalidTask
	}
	payload, err := json.Marshal(input.Payload)
	if err != nil || len(payload) > 256*1024 {
		return View{}, ErrInvalidTask
	}
	var task model.GenerationTask
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND idempotency_key = ?", userID, input.IdempotencyKey).First(&task).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		quote, err := s.Pricing.ValidateQuoteTx(tx, userID, input.QuoteID, input.ModelID, input.Parameters)
		if err != nil {
			return err
		}
		if strings.TrimSpace(input.Capability) != "" && input.Capability != quote.Capability {
			return pricing.ErrQuoteParameter
		}
		task = model.GenerationTask{
			ID: uuid.NewString(), UserID: userID, QuoteID: quote.ID, PublishedModelID: quote.PublishedModelID,
			Capability: quote.Capability, ParametersJSON: string(parameters), PayloadJSON: string(payload),
			Status: model.GenerationTaskQueued, ReservedAmount: quote.Amount, IdempotencyKey: input.IdempotencyKey,
		}
		if _, err := s.Quota.ReserveTx(tx, userID, task.ID, quote.Amount, "generation:reserve:"+task.ID); err != nil {
			return err
		}
		if err := tx.Create(&task).Error; err != nil {
			return err
		}
		return tx.Model(&model.Quote{}).Where("id = ? AND status = ?", quote.ID, model.QuoteStatusIssued).Update("status", model.QuoteStatusConsumed).Error
	})
	if err != nil {
		// A concurrent retry may have committed the same idempotent task while this
		// transaction was waiting on the quote lock. Return that task instead of
		// exposing the intermediate quote-consumed error.
		if lookupErr := s.DB.Where("user_id = ? AND idempotency_key = ?", userID, input.IdempotencyKey).First(&task).Error; lookupErr == nil {
			return toView(task)
		}
	}
	if err != nil {
		return View{}, err
	}
	return toView(task)
}

func (s *Service) Get(userID uint, taskID string) (View, error) {
	var task model.GenerationTask
	if err := s.DB.Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return View{}, ErrTaskNotFound
		}
		return View{}, err
	}
	return toView(task)
}

func (s *Service) Start(taskID string) error {
	now := time.Now().UTC()
	result := s.DB.Model(&model.GenerationTask{}).Where("id = ? AND status = ?", taskID, model.GenerationTaskQueued).Updates(map[string]any{"status": model.GenerationTaskRunning, "started_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrInvalidTransition
	}
	return nil
}

// ReapStale fails tasks stuck past the cutoff and releases their reservations,
// so quota stranded by a crash is recovered. Running tasks are measured from
// started_at, because a task may sit queued well before a worker picks it up;
// only the time since the upstream call began bounds a legitimate run.
func (s *Service) ReapStale(cutoff time.Time) (int, error) {
	var ids []string
	if err := s.DB.Model(&model.GenerationTask{}).
		Where("status = ? AND created_at < ?", model.GenerationTaskQueued, cutoff).
		Or("status = ? AND started_at IS NOT NULL AND started_at < ?", model.GenerationTaskRunning, cutoff).
		Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	reaped := 0
	for _, id := range ids {
		if _, err := s.Fail(id, "TASK_TIMEOUT", "生成任务超时，已释放预占额度"); err != nil {
			if errors.Is(err, ErrInvalidTransition) || errors.Is(err, ErrTaskNotFound) {
				continue
			}
			return reaped, err
		}
		reaped++
	}
	return reaped, nil
}

func (s *Service) Complete(taskID string, output map[string]any, settledAmount int64) (View, error) {
	if output == nil {
		output = map[string]any{}
	}
	encoded, err := json.Marshal(output)
	if err != nil || len(encoded) > 512*1024 {
		return View{}, ErrInvalidTask
	}
	var task model.GenerationTask
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ?", taskID).Error; err != nil {
			return ErrTaskNotFound
		}
		if task.Status != model.GenerationTaskRunning && task.Status != model.GenerationTaskQueued {
			return ErrInvalidTransition
		}
		if settledAmount < 0 {
			settledAmount = task.ReservedAmount
		}
		if settledAmount > task.ReservedAmount {
			return quota.ErrReservationAmount
		}
		if err := s.Quota.SettleTx(tx, task.ID, settledAmount); err != nil {
			return err
		}
		now := time.Now().UTC()
		task.Status, task.SettledAmount, task.OutputJSON, task.CompletedAt = model.GenerationTaskSucceeded, settledAmount, string(encoded), &now
		return tx.Model(&model.GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": task.Status, "settled_amount": task.SettledAmount, "output_json": task.OutputJSON, "completed_at": task.CompletedAt}).Error
	})
	if err != nil {
		return View{}, err
	}
	return toView(task)
}

func (s *Service) Fail(taskID, code, message string) (View, error) {
	var task model.GenerationTask
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ?", taskID).Error; err != nil {
			return ErrTaskNotFound
		}
		if task.Status == model.GenerationTaskSucceeded || task.Status == model.GenerationTaskFailed || task.Status == model.GenerationTaskCancelled {
			return ErrInvalidTransition
		}
		if err := s.Quota.ReleaseTx(tx, task.ID); err != nil {
			return err
		}
		now := time.Now().UTC()
		task.Status, task.ErrorCode, task.ErrorMessage, task.CompletedAt = model.GenerationTaskFailed, strings.TrimSpace(code), strings.TrimSpace(message), &now
		return tx.Model(&model.GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": task.Status, "error_code": task.ErrorCode, "error_message": task.ErrorMessage, "completed_at": task.CompletedAt}).Error
	})
	if err != nil {
		return View{}, err
	}
	return toView(task)
}

func (s *Service) Cancel(userID uint, taskID string) (View, error) {
	var task model.GenerationTask
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
			return ErrTaskNotFound
		}
		if task.Status != model.GenerationTaskQueued && task.Status != model.GenerationTaskRunning {
			return ErrInvalidTransition
		}
		if err := s.Quota.ReleaseTx(tx, task.ID); err != nil {
			return err
		}
		now := time.Now().UTC()
		task.Status, task.CompletedAt = model.GenerationTaskCancelled, &now
		return tx.Model(&model.GenerationTask{}).Where("id = ?", task.ID).Updates(map[string]any{"status": task.Status, "completed_at": task.CompletedAt}).Error
	})
	if err != nil {
		return View{}, err
	}
	return toView(task)
}

func toView(task model.GenerationTask) (View, error) {
	view := View{ID: task.ID, QuoteID: task.QuoteID, ModelID: task.PublishedModelID, Capability: task.Capability, Status: task.Status, ReservedAmount: task.ReservedAmount, SettledAmount: task.SettledAmount, ErrorCode: task.ErrorCode, ErrorMessage: task.ErrorMessage, StartedAt: task.StartedAt, CompletedAt: task.CompletedAt, CreatedAt: task.CreatedAt}
	if strings.TrimSpace(task.OutputJSON) != "" {
		if err := json.Unmarshal([]byte(task.OutputJSON), &view.Output); err != nil {
			return View{}, err
		}
	}
	return view, nil
}

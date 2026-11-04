// Package queue runs hosted generation tasks in the background so one HTTP
// request no longer blocks on the upstream model call.
package queue

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"github.com/sucheng1101/infinity-canvas/server/internal/relay"
	"gorm.io/gorm"
)

// ErrQueueFull means the in-memory queue is at capacity; callers must not reserve quota.
var ErrQueueFull = errors.New("generation queue is full")

type job struct {
	userID   uint
	taskID   string
	queuedAt time.Time
}

// Queue is a bounded worker pool over generation_tasks.
type Queue struct {
	DB         *gorm.DB
	Relay      *relay.Service
	Workers    int
	MaxPending int

	jobs chan job
	wg   sync.WaitGroup
	ctx  context.Context
	stop context.CancelFunc
}

func New(db *gorm.DB, relayService *relay.Service, workers, maxPending int) *Queue {
	if workers <= 0 {
		workers = 1
	}
	if maxPending <= 0 {
		maxPending = 200
	}
	return &Queue{DB: db, Relay: relayService, Workers: workers, MaxPending: maxPending, jobs: make(chan job, maxPending)}
}

// Start launches the worker pool and returns immediately.
func (q *Queue) Start(parent context.Context) {
	q.ctx, q.stop = context.WithCancel(parent)
	for index := 0; index < q.Workers; index++ {
		q.wg.Add(1)
		go q.worker()
	}
}

// Stop stops accepting work and waits for running tasks to return.
func (q *Queue) Stop() {
	if q.stop != nil {
		q.stop()
	}
	q.wg.Wait()
}

func (q *Queue) Pending() int { return len(q.jobs) }

// Enqueue schedules one task. The caller has already validated ownership.
func (q *Queue) Enqueue(userID uint, taskID string) error {
	select {
	case q.jobs <- job{userID: userID, taskID: taskID, queuedAt: time.Now()}:
		return nil
	default:
		return ErrQueueFull
	}
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for {
		select {
		case <-q.ctx.Done():
			return
		case item := <-q.jobs:
			q.run(item)
		}
	}
}

func (q *Queue) run(item job) {
	// 用队列自己的 ctx：优雅退出时取消在跑的任务，重启后由 Recover / reaper 接续处理。
	task, err := q.Relay.Execute(q.ctx, item.userID, item.taskID, relay.ExecuteMeta{RequestType: "generation"})
	if err != nil {
		log.Printf("queue: task %s finished with error: %v (status=%s)", item.taskID, err, task.Status)
	}
}

// Recover re-queues tasks that were still marked queued when the process stopped.
func (q *Queue) Recover(ctx context.Context) error {
	cutoff := time.Now().UTC().Add(-30 * time.Minute)
	var tasks []model.GenerationTask
	if err := q.DB.WithContext(ctx).Where("status = ? AND created_at >= ?", model.GenerationTaskQueued, cutoff).Order("created_at ASC").Limit(q.MaxPending).Find(&tasks).Error; err != nil {
		return err
	}
	count := 0
	for _, task := range tasks {
		if err := q.Enqueue(task.UserID, task.ID); err != nil {
			break
		}
		count++
	}
	if count > 0 {
		log.Printf("queue: recovered %d queued tasks", count)
	}
	return nil
}

package queue

import (
	"errors"
	"testing"
)

func TestEnqueueAcceptsUntilFull(t *testing.T) {
	q := New(nil, nil, 1, 2)
	if err := q.Enqueue(1, "task-a"); err != nil {
		t.Fatalf("first enqueue: %v", err)
	}
	if err := q.Enqueue(1, "task-b"); err != nil {
		t.Fatalf("second enqueue: %v", err)
	}
	if q.Pending() != 2 {
		t.Fatalf("pending = %d, want 2", q.Pending())
	}
	if err := q.Enqueue(1, "task-c"); !errors.Is(err, ErrQueueFull) {
		t.Fatalf("third enqueue should report queue full, got %v", err)
	}
}

func TestNewAppliesDefaults(t *testing.T) {
	q := New(nil, nil, 0, 0)
	if q.Workers != 1 || q.MaxPending != 200 {
		t.Fatalf("unexpected defaults: workers=%d max=%d", q.Workers, q.MaxPending)
	}
}

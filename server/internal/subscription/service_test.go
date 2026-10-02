package subscription

import (
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
)

func TestDecodeOperationResult(t *testing.T) {
	var value struct {
		ID uint `json:"id"`
	}
	if err := decodeOperationResult(model.OperationOrder{Status: model.OperationOrderSucceeded, ResultJSON: `{"id":9}`}, &value); err != nil || value.ID != 9 {
		t.Fatalf("decode succeeded order: value=%+v err=%v", value, err)
	}
	if err := decodeOperationResult(model.OperationOrder{Status: model.OperationOrderFailed}, &value); err != ErrOrderFailed {
		t.Fatalf("failed order error = %v", err)
	}
	if err := decodeOperationResult(model.OperationOrder{Status: model.OperationOrderProcessing}, &value); err != ErrOrderInProgress {
		t.Fatalf("processing order error = %v", err)
	}
}

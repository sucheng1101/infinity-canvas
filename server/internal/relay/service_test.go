package relay

import (
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
)

func TestBilledUnitsByCapability(t *testing.T) {
	if got := billedUnits(model.GenerationTask{Capability: "image", ParametersJSON: `{"count":3}`}, 0); got != 3 {
		t.Fatalf("image units = %v, want 3", got)
	}
	if got := billedUnits(model.GenerationTask{Capability: "video", ParametersJSON: `{"durationSeconds":7}`}, 0); got != 7 {
		t.Fatalf("video units = %v, want 7", got)
	}
	if got := billedUnits(model.GenerationTask{Capability: "text"}, 42); got != 42 {
		t.Fatalf("text units = %v, want 42", got)
	}
}

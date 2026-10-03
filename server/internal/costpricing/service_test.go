package costpricing

import (
	"encoding/json"
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
)

func TestUnitPriceSelectsQualityAndOutputModeVariant(t *testing.T) {
	formula, _ := json.Marshal(map[string]any{"unitAmount": 10, "variants": []map[string]any{{"key": "native", "unitAmount": 10}, {"key": "4k:upscale", "unitAmount": 35}}})
	row := model.ModelCostPricing{CostPerUnit: 10, FormulaJSON: string(formula)}
	if got := UnitPrice(row, map[string]any{"quality": "4k", "outputMode": "upscale"}); got != 35 {
		t.Fatalf("variant cost = %d, want 35", got)
	}
	if got := UnitPrice(row, map[string]any{"outputMode": "native"}); got != 10 {
		t.Fatalf("native cost = %d, want 10", got)
	}
}

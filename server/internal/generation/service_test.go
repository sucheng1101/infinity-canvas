package generation

import "testing"

func TestBillingUnits(t *testing.T) {
	cases := []struct {
		name       string
		capability string
		parameters map[string]any
		count      int
		want       int64
	}{
		{"image uses explicit count", "image", map[string]any{"count": float64(4)}, 1, 4},
		{"image falls back to requested count", "image", map[string]any{}, 3, 3},
		{"image without any count", "image", map[string]any{}, 0, 0},
		{"video bills seconds", "video", map[string]any{"durationSeconds": float64(8)}, 1, 8},
		{"video without duration", "video", map[string]any{}, 1, 0},
		{"text bills input tokens", "text", map[string]any{"inputTokens": float64(1200)}, 1, 1200},
		{"text without tokens", "text", map[string]any{}, 1, 0},
		{"unknown capability", "audio", map[string]any{"count": float64(2)}, 1, 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := billingUnits(testCase.capability, testCase.parameters, testCase.count); got != testCase.want {
				t.Fatalf("billingUnits() = %d, want %d", got, testCase.want)
			}
		})
	}
}

func TestSubscriptionUnit(t *testing.T) {
	cases := map[string]string{"image": "image", "video": "second", "text": "token", "audio": "request"}
	for capability, want := range cases {
		if got := subscriptionUnit(capability); got != want {
			t.Fatalf("subscriptionUnit(%q) = %q, want %q", capability, got, want)
		}
	}
}

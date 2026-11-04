package billing

import "testing"

func TestUnits(t *testing.T) {
	cases := []struct {
		name       string
		capability string
		image      float64
		video      float64
		text       float64
		want       float64
	}{
		{"image", "image", 3, 8, 500, 3},
		{"video", "video", 1, 8, 500, 8},
		{"text", "text", 1, 8, 500, 500},
		{"case insensitive", " IMAGE ", 2, 0, 0, 2},
		{"unknown capability", "audio", 1, 1, 1, 0},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := Units(testCase.capability, testCase.image, testCase.video, testCase.text); got != testCase.want {
				t.Fatalf("Units() = %v, want %v", got, testCase.want)
			}
		})
	}
}

func TestUnitForCapability(t *testing.T) {
	cases := map[string]string{"image": "image", "video": "second", "text": "token", "audio": "request", "": "request"}
	for capability, want := range cases {
		if got := UnitForCapability(capability); got != want {
			t.Fatalf("UnitForCapability(%q) = %q, want %q", capability, got, want)
		}
	}
}

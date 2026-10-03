package modelquality

import "testing"

func TestDefaultRecognizesCommonQualitySchemes(t *testing.T) {
	if got := Default("image", "gpt-image-1"); got.Scheme != "resolution" || len(got.Options) != 3 {
		t.Fatalf("gpt image quality scheme = %#v", got)
	}
	if got := Default("image", "custom-image-model"); got.Scheme != "tier" {
		t.Fatalf("custom image quality scheme = %#v", got)
	}
	if got := Default("video", "sora-2"); got.Scheme != "resolution" || len(got.Options) < 4 {
		t.Fatalf("video quality scheme = %#v", got)
	}
}

func TestGuessCapability(t *testing.T) {
	for name, expected := range map[string]string{"sora-2": "video", "gpt-image-1": "image", "tts-1": "audio", "gpt-5.6-sol": "text"} {
		if got := GuessCapability(name); got != expected {
			t.Fatalf("GuessCapability(%q) = %q, want %q", name, got, expected)
		}
	}
}

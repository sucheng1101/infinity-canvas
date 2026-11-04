package assets

import (
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/model"
)

func TestValidKind(t *testing.T) {
	for _, kind := range []string{model.AssetKindCharacter, model.AssetKindScene, model.AssetKindProp, model.AssetKindMedia} {
		if !validKind(kind) {
			t.Fatalf("kind %q should be accepted", kind)
		}
	}
	for _, kind := range []string{"", "Character", "audio", "character ", "text"} {
		if validKind(kind) {
			t.Fatalf("kind %q should be rejected", kind)
		}
	}
}

func TestExtensionFor(t *testing.T) {
	cases := map[string]string{
		"image/png":                 "png",
		"image/jpeg":                "jpg",
		"IMAGE/PNG":                 "png",
		"image/webp; charset=utf-8": "webp",
		"video/mp4":                 "mp4",
		"audio/mpeg":                "mp3",
		"":                          "bin",
		"application/octet-stream":  "bin",
		"image/x-unknown":           "bin",
	}
	for contentType, want := range cases {
		if got := extensionFor(contentType); got != want {
			t.Fatalf("extensionFor(%q) = %q, want %q", contentType, got, want)
		}
	}
}

func TestEncodeAndDecodeTags(t *testing.T) {
	encoded, err := encodeTags([]string{" 主角 ", "", "主角", "侧脸"})
	if err != nil {
		t.Fatalf("encodeTags: %v", err)
	}
	// 去空白、去重后的 JSON 数组。
	if encoded != `["主角","侧脸"]` {
		t.Fatalf("encodeTags = %s", encoded)
	}
	tags := decodeTags(encoded)
	if len(tags) != 2 || tags[0] != "主角" || tags[1] != "侧脸" {
		t.Fatalf("decodeTags = %#v", tags)
	}
}

func TestEncodeTagsEmptyStaysArray(t *testing.T) {
	encoded, err := encodeTags(nil)
	if err != nil {
		t.Fatalf("encodeTags: %v", err)
	}
	if encoded != "[]" {
		t.Fatalf("encodeTags(nil) = %s, want []", encoded)
	}
}

func TestDecodeTagsToleratesBadInput(t *testing.T) {
	for _, raw := range []string{"", "   ", "null", "{", `"x"`} {
		tags := decodeTags(raw)
		if tags == nil || len(tags) != 0 {
			t.Fatalf("decodeTags(%q) = %#v, want empty slice", raw, tags)
		}
	}
}

func TestPrepareValidatesAndNormalizes(t *testing.T) {
	prepared, err := prepare(Input{Kind: " Character ", Name: " 阿离 ", Tags: []string{"主角"}})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if prepared.Kind != model.AssetKindCharacter || prepared.Name != "阿离" {
		t.Fatalf("prepare normalised wrong: %#v", prepared)
	}
	if prepared.License != model.AssetLicenseOwn {
		t.Fatalf("license should default to own, got %q", prepared.License)
	}
	if !prepared.TagsSet || prepared.TagsJSON != `["主角"]` {
		t.Fatalf("tags not encoded: %#v", prepared)
	}

	// 未传 tags 时不覆盖已有标签。
	prepared, err = prepare(Input{Kind: model.AssetKindProp, Name: "钥匙"})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if prepared.TagsSet {
		t.Fatalf("nil tags should not mark TagsSet")
	}

	for _, input := range []Input{
		{Kind: model.AssetKindProp, Name: "  "},
		{Kind: "audio", Name: "声音"},
		{Kind: model.AssetKindProp, Name: string(make([]byte, 200))},
	} {
		if _, err := prepare(input); err == nil {
			t.Fatalf("input %#v should be rejected", input)
		}
	}
}

func TestNormalizePage(t *testing.T) {
	cases := []struct{ page, size, wantPage, wantSize int }{
		{0, 0, 1, 20},
		{1, 50, 1, 50},
		{-3, -1, 1, 20},
		{2, 101, 2, 20},
	}
	for _, item := range cases {
		page, size := normalizePage(item.page, item.size)
		if page != item.wantPage || size != item.wantSize {
			t.Fatalf("normalizePage(%d, %d) = (%d, %d)", item.page, item.size, page, size)
		}
	}
}

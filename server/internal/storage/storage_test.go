package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
)

func testStore(t *testing.T) Store {
	t.Helper()
	store, err := newLocal(filepath.Join(t.TempDir(), "uploads"), "/api/v1/files")
	if err != nil {
		t.Fatalf("newLocal: %v", err)
	}
	return store
}

func TestLocalPutOpenDelete(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()

	url, err := store.Put(ctx, "asset/2026/01/a.png", strings.NewReader("hello"), 5, "image/png")
	if err != nil {
		t.Fatalf("Put: %v", err)
	}
	if url != "/api/v1/files/asset/2026/01/a.png" {
		t.Fatalf("unexpected url %q", url)
	}

	body, err := store.Open(ctx, "asset/2026/01/a.png")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	opened, err := io.ReadAll(body)
	body.Close()
	if err != nil {
		t.Fatalf("read open body: %v", err)
	}
	if string(opened) != "hello" {
		t.Fatalf("unexpected opened content %q", string(opened))
	}
	data, err := os.ReadFile(filepath.Join(store.(*local).root, "asset", "2026", "01", "a.png"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("unexpected content %q", string(data))
	}

	if err := store.Delete(ctx, "asset/2026/01/a.png"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := store.Delete(ctx, "asset/2026/01/a.png"); err != nil {
		t.Fatalf("deleting a missing object should be nil, got %v", err)
	}
}

func TestNormalizeKeyRejectsEscapes(t *testing.T) {
	for _, key := range []string{"", "  ", "../etc/passwd", "a/../../b"} {
		if _, err := NormalizeKey(key); err == nil {
			t.Fatalf("key %q should be rejected", key)
		}
	}
	if got, err := NormalizeKey("/a/b.png"); err != nil || got != "a/b.png" {
		t.Fatalf("NormalizeKey trimmed wrong: %q %v", got, err)
	}
}

func TestNewDefaultsToLocal(t *testing.T) {
	store, err := New(config.Config{StorageLocalDir: filepath.Join(t.TempDir(), "uploads")})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if store.Driver() != "local" {
		t.Fatalf("expected local driver, got %s", store.Driver())
	}
}

func TestS3DriverIsNotWired(t *testing.T) {
	_, err := New(config.Config{StorageDriver: "s3", S3Bucket: "bucket"})
	if err == nil {
		t.Fatal("s3 driver should report not configured")
	}
}

func TestUnknownDriverFails(t *testing.T) {
	if _, err := New(config.Config{StorageDriver: "ftp"}); err == nil {
		t.Fatal("unknown driver should fail")
	}
}

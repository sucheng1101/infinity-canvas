// Package storage keeps uploaded media behind one interface so the backend can
// move from local disk to any S3-compatible service without touching callers.
//
// Every mainstream object store speaks the S3 API (MinIO, Cloudflare R2, Aliyun
// OSS, Tencent COS, Backblaze B2, AWS S3), so switching providers is a config
// change, not a code change.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/sucheng1101/infinity-canvas/server/internal/config"
)

// ErrNotConfigured marks a driver that is selected but has no usable settings.
var ErrNotConfigured = errors.New("storage driver is not configured")

// Store is the minimal surface the platform needs today.
type Store interface {
	// Put stores r under key and returns the URL the browser can load.
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error)
	// Open returns the object body for key.
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Delete removes key; missing objects are not an error.
	Delete(ctx context.Context, key string) error
	// URL returns the public URL for key without touching the network.
	URL(key string) string
	// Driver names the active backend for logs and health output.
	Driver() string
	// Health verifies the backend is reachable.
	Health(ctx context.Context) error
}

// New builds the configured driver. Only "local" is wired today; "s3" reports a
// clear error so a misconfigured deployment fails loudly instead of silently.
func New(cfg config.Config) (Store, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.StorageDriver)) {
	case "", "local":
		return newLocal(cfg.StorageLocalDir, cfg.StoragePublicBase)
	case "s3":
		return nil, fmt.Errorf("%w: STORAGE_DRIVER=s3 is reserved for a later release; keep STORAGE_DRIVER=local for now", ErrNotConfigured)
	default:
		return nil, fmt.Errorf("unknown STORAGE_DRIVER %q (expected local or s3)", cfg.StorageDriver)
	}
}

// NormalizeKey rejects keys that could escape the storage root.
func NormalizeKey(key string) (string, error) {
	clean := strings.TrimSpace(strings.ReplaceAll(key, "\\", "/"))
	clean = strings.TrimPrefix(clean, "/")
	if clean == "" || strings.Contains(clean, "..") {
		return "", errors.New("invalid storage key")
	}
	return clean, nil
}

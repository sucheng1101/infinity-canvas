package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// local stores objects under one directory and serves them through the API.
type local struct {
	root       string
	publicBase string
}

func newLocal(root, publicBase string) (Store, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, fmt.Errorf("%w: STORAGE_LOCAL_DIR is empty", ErrNotConfigured)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, err
	}
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	if base == "" {
		base = "/api/v1/files"
	}
	return &local{root: abs, publicBase: base}, nil
}

func (l *local) Driver() string { return "local" }

func (l *local) Put(_ context.Context, key string, r io.Reader, size int64, _ string) (string, error) {
	clean, err := NormalizeKey(key)
	if err != nil {
		return "", err
	}
	target := filepath.Join(l.root, filepath.FromSlash(clean))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	file, err := os.Create(target)
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := io.Copy(file, r); err != nil {
		_ = os.Remove(target)
		return "", err
	}
	return l.URL(clean), nil
}

func (l *local) Open(_ context.Context, key string) (io.ReadCloser, error) {
	clean, err := NormalizeKey(key)
	if err != nil {
		return nil, err
	}
	return os.Open(filepath.Join(l.root, filepath.FromSlash(clean)))
}

func (l *local) Delete(_ context.Context, key string) error {
	clean, err := NormalizeKey(key)
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(l.root, filepath.FromSlash(clean)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (l *local) URL(key string) string {
	return path.Join(l.publicBase, key)
}

func (l *local) Health(context.Context) error {
	info, err := os.Stat(l.root)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("STORAGE_LOCAL_DIR is not a directory: %s", l.root)
	}
	return nil
}

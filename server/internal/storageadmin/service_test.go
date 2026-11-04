package storageadmin

import (
	"strings"
	"testing"

	"github.com/sucheng1101/infinity-canvas/server/internal/cipherbox"
	"github.com/sucheng1101/infinity-canvas/server/internal/config"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
)

func modelProvider(driver, endpoint, bucket string, withSecret bool) model.StorageProvider {
	provider := model.StorageProvider{ID: "p1", Name: "P", Driver: driver, Endpoint: endpoint, Bucket: bucket}
	if withSecret {
		provider.AccessKeyCipher = "cipher-a"
		provider.SecretKeyCipher = "cipher-b"
	}
	return provider
}

func testService() *Service {
	return &Service{Cfg: config.Config{ChannelEncryptionKey: "test-channel-key", StorageLocalDir: "data/uploads", StoragePublicBase: "/api/v1/files"}}
}

func boolPtr(value bool) *bool { return &value }

func TestPrepareLocalDefaults(t *testing.T) {
	service := testService()
	row, err := service.prepare(nil, Input{Name: "本地存储", Driver: "local"})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if row.LocalDir != "data/uploads" || row.PublicBase != "/api/v1/files" {
		t.Fatalf("unexpected local defaults: %+v", row)
	}
	if !row.UsePathStyle {
		t.Fatal("path style should default to true")
	}
}

func TestPrepareRequiresNameAndDriver(t *testing.T) {
	service := testService()
	if _, err := service.prepare(nil, Input{Name: "  ", Driver: "local"}); err == nil {
		t.Fatal("empty name must fail")
	}
	if _, err := service.prepare(nil, Input{Name: "x", Driver: "ftp"}); err == nil {
		t.Fatal("unsupported driver must fail")
	}
}

func TestPrepareS3EncryptsCredentials(t *testing.T) {
	service := testService()
	row, err := service.prepare(nil, Input{Name: "R2", Driver: "s3", Endpoint: "https://example.r2.cloudflarestorage.com", Bucket: "assets", AccessKey: "AKIAEXAMPLE", SecretKey: "super-secret-value"})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if row.AccessKeyCipher == "" || row.SecretKeyCipher == "" {
		t.Fatal("credentials must be encrypted")
	}
	if strings.Contains(row.AccessKeyCipher, "AKIAEXAMPLE") || strings.Contains(row.SecretKeyCipher, "super-secret-value") {
		t.Fatal("ciphertext must not contain the plaintext")
	}
	plain, err := cipherbox.Decrypt(service.Cfg.ChannelEncryptionKey, row.SecretKeyCipher)
	if err != nil || plain != "super-secret-value" {
		t.Fatalf("decrypt failed: %q %v", plain, err)
	}
}

func TestPrepareS3RequiresEndpointBucketAndKeys(t *testing.T) {
	service := testService()
	if _, err := service.prepare(nil, Input{Name: "R2", Driver: "s3", Bucket: "assets", AccessKey: "a", SecretKey: "b"}); err == nil {
		t.Fatal("missing endpoint must fail")
	}
	if _, err := service.prepare(nil, Input{Name: "R2", Driver: "s3", Endpoint: "https://e", Bucket: "assets"}); err == nil {
		t.Fatal("missing keys must fail")
	}
}

func TestPrepareKeepsExistingSecretsWhenBlank(t *testing.T) {
	service := testService()
	created, err := service.prepare(nil, Input{Name: "R2", Driver: "s3", Endpoint: "https://e", Bucket: "b", AccessKey: "a", SecretKey: "s"})
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	updated, err := service.prepare(&created, Input{Name: "R2 renamed", Driver: "s3", Endpoint: "https://e", Bucket: "b"})
	if err != nil {
		t.Fatalf("prepare update: %v", err)
	}
	if updated.AccessKeyCipher != created.AccessKeyCipher || updated.SecretKeyCipher != created.SecretKeyCipher {
		t.Fatal("blank credentials must keep the stored ones")
	}
}

func TestToViewMasksAndReadiness(t *testing.T) {
	provider := modelProvider("s3", "https://e", "bucket", true)
	view := toView(provider, "AKIAEXAMPLE1234", "secret-value-1234")
	if view.AccessKeyMask != "AKIA********1234" {
		t.Fatalf("unexpected access key mask %q", view.AccessKeyMask)
	}
	if !view.Ready {
		t.Fatal("provider with endpoint, bucket and secret should be ready")
	}
	notReady := toView(modelProvider("s3", "", "", false), "", "")
	if notReady.Ready {
		t.Fatal("incomplete provider must not be ready")
	}
}

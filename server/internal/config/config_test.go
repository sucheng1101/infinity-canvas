package config

import "testing"

func TestValidateProductionChannelKey(t *testing.T) {
	if err := (Config{AppEnv: "production", ChannelEncryptionKey: defaultChannelEncryptionKey}).Validate(); err == nil {
		t.Fatal("expected the development default key to be rejected in production")
	}
	if err := (Config{AppEnv: "production", ChannelEncryptionKey: "a-unique-production-channel-key-123456"}).Validate(); err != nil {
		t.Fatalf("expected a unique production key to pass: %v", err)
	}
	if err := (Config{AppEnv: "development", ChannelEncryptionKey: defaultChannelEncryptionKey}).Validate(); err != nil {
		t.Fatalf("expected development defaults to pass: %v", err)
	}
}

package cipherbox

import "testing"

func TestEncryptDecryptRoundTrip(t *testing.T) {
	ciphertext, err := Encrypt("test-key", "AKIA-EXAMPLE")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if ciphertext == "AKIA-EXAMPLE" || ciphertext == "" {
		t.Fatal("ciphertext should be encoded and non-empty")
	}
	plain, err := Decrypt("test-key", ciphertext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plain != "AKIA-EXAMPLE" {
		t.Fatalf("round trip mismatch: %q", plain)
	}
	if _, err := Decrypt("other-key", ciphertext); err == nil {
		t.Fatal("decrypting with the wrong key must fail")
	}
}

func TestMask(t *testing.T) {
	if got := Mask(""); got != "" {
		t.Fatalf("empty mask should be empty, got %q", got)
	}
	if got := Mask("short"); got != "********" {
		t.Fatalf("short values must be fully masked, got %q", got)
	}
	if got := Mask("AKIAEXAMPLE1234"); got != "AKIA********1234" {
		t.Fatalf("unexpected mask %q", got)
	}
}

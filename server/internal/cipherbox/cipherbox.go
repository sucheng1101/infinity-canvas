// Package secret wraps the AES-GCM encryption used for credentials at rest.
package cipherbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"io"
)

func key(keyMaterial string) [32]byte {
	return sha256.Sum256([]byte(keyMaterial))
}

// Encrypt returns a base64 string containing nonce + ciphertext.
func Encrypt(keyMaterial, plaintext string) (string, error) {
	derived := key(keyMaterial)
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plaintext), nil)), nil
}

// Decrypt reverses Encrypt.
func Decrypt(keyMaterial, ciphertext string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(ciphertext)
	if err != nil {
		return "", err
	}
	derived := key(keyMaterial)
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", io.ErrUnexpectedEOF
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// Mask renders a credential for display without revealing it.
func Mask(value string) string {
	if value == "" {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= 8 {
		return "********"
	}
	return string(runes[:4]) + "********" + string(runes[len(runes)-4:])
}

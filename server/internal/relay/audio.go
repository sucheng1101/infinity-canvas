package relay

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// errNoAudio 表示上游没有返回可用的音频数据。
var errNoAudio = errors.New("upstream returned no audio data")

// isGeminiAudio 判断这个模型是否走 Gemini 原生协议（模型名以 gemini 开头）。
func isGeminiAudio(capability, upstreamModel string) bool {
	return strings.EqualFold(strings.TrimSpace(capability), "audio") &&
		strings.HasPrefix(strings.ToLower(strings.TrimSpace(upstreamModel)), "gemini")
}

// geminiAudioRequest 把我们的 payload 转成 Gemini 的 generateContent 请求体。
func geminiAudioRequest(payload map[string]any) map[string]any {
	text := ""
	for _, key := range []string{"input", "content", "text", "prompt"} {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			text = value
			break
		}
	}
	return map[string]any{
		"contents": []any{
			map[string]any{"parts": []any{map[string]any{"text": text}}},
		},
	}
}

// extractGeminiAudio 从 Gemini 响应里取出 inlineData 的 base64 与 mimeType。
func extractGeminiAudio(output map[string]any) (string, string, error) {
	candidates, ok := output["candidates"].([]any)
	if !ok || len(candidates) == 0 {
		return "", "", errNoAudio
	}
	first, ok := candidates[0].(map[string]any)
	if !ok {
		return "", "", errNoAudio
	}
	content, ok := first["content"].(map[string]any)
	if !ok {
		return "", "", errNoAudio
	}
	parts, ok := content["parts"].([]any)
	if !ok {
		return "", "", errNoAudio
	}
	for _, raw := range parts {
		part, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		inline, ok := part["inlineData"].(map[string]any)
		if !ok {
			continue
		}
		data, _ := inline["data"].(string)
		mime, _ := inline["mimeType"].(string)
		if strings.TrimSpace(data) != "" {
			return data, mime, nil
		}
	}
	return "", "", errNoAudio
}

// pcmToWav 给裸 PCM 套 44 字节 WAV 头；Gemini 返回的是 audio/l16，直接存文件无法播放。
func pcmToWav(pcm []byte, sampleRate, channels, bitsPerSample int) []byte {
	if sampleRate <= 0 {
		sampleRate = 24000
	}
	if channels <= 0 {
		channels = 1
	}
	if bitsPerSample <= 0 {
		bitsPerSample = 16
	}
	blockAlign := channels * bitsPerSample / 8
	byteRate := sampleRate * blockAlign
	dataSize := len(pcm)

	buf := make([]byte, 44+dataSize)
	copy(buf[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:8], uint32(36+dataSize))
	copy(buf[8:12], "WAVE")
	copy(buf[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:20], 16)
	binary.LittleEndian.PutUint16(buf[20:22], 1) // PCM
	binary.LittleEndian.PutUint16(buf[22:24], uint16(channels))
	binary.LittleEndian.PutUint32(buf[24:28], uint32(sampleRate))
	binary.LittleEndian.PutUint32(buf[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(buf[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(buf[34:36], uint16(bitsPerSample))
	copy(buf[36:40], "data")
	binary.LittleEndian.PutUint32(buf[40:44], uint32(dataSize))
	copy(buf[44:], pcm)
	return buf
}

// mimeAudioParams 从 mimeType 里读采样率与声道，例如 audio/l16; rate=24000; channels=1。
func mimeAudioParams(mime string) (int, int) {
	rate, channels := 24000, 1
	for _, part := range strings.Split(mime, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "rate=") {
			if value, err := parseInt(strings.TrimPrefix(part, "rate=")); err == nil && value > 0 {
				rate = value
			}
		}
		if strings.HasPrefix(part, "channels=") {
			if value, err := parseInt(strings.TrimPrefix(part, "channels=")); err == nil && value > 0 {
				channels = value
			}
		}
	}
	return rate, channels
}

func parseInt(value string) (int, error) {
	total := 0
	if value == "" {
		return 0, errors.New("empty")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0, errors.New("not a number")
		}
		total = total*10 + int(char-'0')
	}
	return total, nil
}

// storeAudio 把音频存进用户选择的存储，返回可访问 URL。
func (s *Service) storeAudio(ctx context.Context, userID uint, wav []byte) (string, error) {
	if s.Registry == nil {
		return "", errors.New("storage registry unavailable")
	}
	store, _, err := s.Registry.ResolveForUser(userID)
	if err != nil {
		return "", err
	}
	key := "audio/" + time.Now().UTC().Format("2006/01") + "/" + uuid.NewString() + ".wav"
	return store.Put(ctx, key, strings.NewReader(string(wav)), int64(len(wav)), "audio/wav")
}

// decodeAudioOutput 把 Gemini 的内联音频转成我们自己的 {url, format} 输出。
func (s *Service) decodeAudioOutput(ctx context.Context, userID uint, output map[string]any) (map[string]any, error) {
	data, mime, err := extractGeminiAudio(output)
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, err
	}
	rate, channels := mimeAudioParams(mime)
	wav := pcmToWav(raw, rate, channels, 16)
	url, err := s.storeAudio(ctx, userID, wav)
	if err != nil {
		return nil, err
	}
	return map[string]any{"url": url, "format": "wav", "mimeType": "audio/wav", "sampleRate": rate, "channels": channels}, nil
}

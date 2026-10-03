package modelquality

import (
	"strings"
)

type Option struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

type Spec struct {
	Scheme          string   `json:"scheme"`
	Options         []Option `json:"options"`
	Supports8K      bool     `json:"supports8K"`
	SupportsUpscale bool     `json:"supportsUpscale"`
	OutputModes     []Option `json:"outputModes"`
}

func Default(capability, modelName string) Spec {
	capability = strings.ToLower(strings.TrimSpace(capability))
	name := strings.ToLower(strings.TrimSpace(modelName))
	spec := Spec{Scheme: "none", OutputModes: []Option{{Key: "native", Label: "原生"}}}
	switch capability {
	case "image":
		if containsAny(name, "gpt-image", "dall-e", "dalle", "flux", "midjourney", "ideogram", "imagen", "seedream", "qwen-image", "recraft", "kolors", "jimeng", "stable-diffusion", "sdxl", "highres", "4k", "2k") {
			spec.Scheme = "resolution"
			spec.Options = []Option{{Key: "1k", Label: "1K"}, {Key: "2k", Label: "2K"}, {Key: "4k", Label: "4K"}}
		} else {
			spec.Scheme = "tier"
			spec.Options = []Option{{Key: "auto", Label: "自动"}, {Key: "low", Label: "低质量"}, {Key: "medium", Label: "中质量"}, {Key: "high", Label: "高质量"}}
		}
	case "video":
		spec.Scheme = "resolution"
		spec.Options = []Option{{Key: "480p", Label: "480p"}, {Key: "720p", Label: "720p"}, {Key: "1080p", Label: "1080p"}, {Key: "2k", Label: "2K"}, {Key: "4k", Label: "4K"}}
		if containsAny(name, "upscale", "super-resolution", "super_resolution", "enhance") {
			spec.SupportsUpscale = true
		}
	}
	if containsAny(name, "upscale", "super-resolution", "super_resolution", "realesrgan", "esrgan", "topaz") {
		spec.SupportsUpscale = true
	}
	return spec
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, candidate) {
			return true
		}
	}
	return false
}

// GuessCapability supplies a deterministic default for freshly synchronized
// model names. Administrators can still override it before saving a channel.
func GuessCapability(modelName string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if containsAny(name, "video", "sora", "veo", "kling", "runway", "pika", "luma", "wan", "hailuo", "pixverse") {
		return "video"
	}
	if containsAny(name, "audio", "tts", "speech", "voice", "music", "sound", "whisper", "eleven") {
		return "audio"
	}
	if containsAny(name, "image", "dall-e", "dalle", "gpt-image", "imagen", "flux", "midjourney", "ideogram", "seedream", "recraft", "qwen-image", "sdxl", "stable-diffusion", "kolors", "jimeng", "doubao") {
		return "image"
	}
	return "text"
}

func Normalize(input Spec, capability, modelName string) Spec {
	base := Default(capability, modelName)
	if input.Scheme != "" {
		base.Scheme = input.Scheme
	}
	if len(input.Options) > 0 {
		if filtered := without8K(input.Options); len(filtered) > 0 {
			base.Options = filtered
		}
	}
	if input.Supports8K {
		base.Supports8K = true
		base.SupportsUpscale = true
	}
	if input.SupportsUpscale {
		base.SupportsUpscale = true
	}
	if len(input.OutputModes) > 0 {
		base.OutputModes = input.OutputModes
	}
	if base.SupportsUpscale {
		found := false
		for _, option := range base.OutputModes {
			if option.Key == "upscale" {
				found = true
				break
			}
		}
		if !found {
			base.OutputModes = append(base.OutputModes, Option{Key: "upscale", Label: "超分"})
		}
	}
	return base
}

func without8K(options []Option) []Option {
	filtered := make([]Option, 0, len(options))
	for _, option := range options {
		if strings.EqualFold(strings.TrimSpace(option.Key), "8k") {
			continue
		}
		filtered = append(filtered, option)
	}
	return filtered
}

func Merge(specs ...Spec) Spec {
	if len(specs) == 0 {
		return Spec{}
	}
	result := specs[0]
	options := map[string]Option{}
	optionOrder := []string{}
	modes := map[string]Option{}
	modeOrder := []string{}
	for _, spec := range specs {
		if result.Scheme == "none" && spec.Scheme != "none" {
			result.Scheme = spec.Scheme
		}
		result.Supports8K = result.Supports8K || spec.Supports8K
		result.SupportsUpscale = result.SupportsUpscale || spec.SupportsUpscale
		for _, option := range spec.Options {
			if strings.EqualFold(strings.TrimSpace(option.Key), "8k") {
				continue
			}
			if _, exists := options[option.Key]; !exists {
				optionOrder = append(optionOrder, option.Key)
			}
			options[option.Key] = option
		}
		for _, option := range spec.OutputModes {
			if _, exists := modes[option.Key]; !exists {
				modeOrder = append(modeOrder, option.Key)
			}
			modes[option.Key] = option
		}
	}
	result.Options = result.Options[:0]
	for _, key := range optionOrder {
		result.Options = append(result.Options, options[key])
	}
	if len(modeOrder) == 0 {
		result.OutputModes = []Option{{Key: "native", Label: "原生"}}
	} else {
		result.OutputModes = result.OutputModes[:0]
		for _, key := range modeOrder {
			result.OutputModes = append(result.OutputModes, modes[key])
		}
	}
	if result.SupportsUpscale {
		found := false
		for _, option := range result.OutputModes {
			if option.Key == "upscale" {
				found = true
				break
			}
		}
		if !found {
			result.OutputModes = append(result.OutputModes, Option{Key: "upscale", Label: "超分"})
		}
	}
	return result
}

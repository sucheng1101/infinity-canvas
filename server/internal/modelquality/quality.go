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
		spec.Scheme = "tier"
		spec.Options = []Option{{Key: "auto", Label: "自动"}, {Key: "low", Label: "低质量"}, {Key: "medium", Label: "中质量"}, {Key: "high", Label: "高质量"}}
		if strings.Contains(name, "dall") || strings.Contains(name, "gpt-image") || strings.Contains(name, "flux") || strings.Contains(name, "midjourney") {
			spec.Scheme = "resolution"
			spec.Options = []Option{{Key: "1k", Label: "1K"}, {Key: "2k", Label: "2K"}, {Key: "4k", Label: "4K"}}
		}
	case "video":
		spec.Scheme = "resolution"
		spec.Options = []Option{{Key: "720p", Label: "720p"}, {Key: "1080p", Label: "1080p"}, {Key: "2k", Label: "2K"}, {Key: "4k", Label: "4K"}}
	}
	return spec
}

func Normalize(input Spec, capability, modelName string) Spec {
	base := Default(capability, modelName)
	if input.Scheme != "" {
		base.Scheme = input.Scheme
	}
	if len(input.Options) > 0 {
		base.Options = input.Options
	}
	if input.Supports8K {
		base.Supports8K = true
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
	if base.Supports8K {
		found := false
		for _, option := range base.Options {
			if option.Key == "8k" {
				found = true
				break
			}
		}
		if !found {
			base.Options = append(base.Options, Option{Key: "8k", Label: "8K"})
		}
	}
	return base
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
	if result.Supports8K {
		found := false
		for _, option := range result.Options {
			if option.Key == "8k" {
				found = true
			}
		}
		if !found {
			result.Options = append(result.Options, Option{Key: "8k", Label: "8K"})
		}
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

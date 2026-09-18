import { parseVideoResolution } from "@/lib/media-size";

type VideoResolutionOption = { value: string; label: string };

// MiniMax H3 只接受这四个分辨率档位，命名与其他渠道不同（768 不带 p、2K/4K 大写）。
const MINIMAX_H3_RESOLUTIONS: VideoResolutionOption[] = [
    { value: "768", label: "768P" },
    { value: "1080p", label: "1080p" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
];

export function isMinimaxH3Model(model: string) {
    const name = model.trim().toLowerCase();
    return name.includes("minimax") && name.includes("h3");
}

export function minimaxH3ResolutionOptions() {
    return MINIMAX_H3_RESOLUTIONS;
}

export function minimaxH3Resolution(value: string) {
    return MINIMAX_H3_RESOLUTIONS.find((option) => option.value === value) || MINIMAX_H3_RESOLUTIONS[1];
}

/** 视频请求里 resolution 的取值：MiniMax H3 用原生档位，其余模型统一拼 p。 */
export function videoResolutionRequestValue(model: string, value: string) {
    return isMinimaxH3Model(model) ? minimaxH3Resolution(value).value : `${parseVideoResolution(value)}p`;
}

/** 分辨率展示标签。 */
export function videoResolutionDisplayLabel(model: string, value: string) {
    return isMinimaxH3Model(model) ? minimaxH3Resolution(value).label : `${parseVideoResolution(value)}p`;
}

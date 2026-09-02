import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";

export type ApiCallFormat = "openai" | "gemini";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
type LegacyCapabilityApiKeys = Partial<Record<ModelCapability, string>>;

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
};

export type ChannelModelApiKey = {
    id: string;
    name: string;
    apiKey: string;
    models: string[];
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    modelApiKeys: ChannelModelApiKey[];
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://codex.helpapis.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const FIXED_CHANNELS = [
    { id: "codex-helpapis", name: "codex.helpapis.com", baseUrl: "https://codex.helpapis.com" },
    { id: "helpapis", name: "helpapis.com", baseUrl: "https://helpapis.com" },
] as const;

function defaultFixedChannels(): ModelChannel[] {
    return FIXED_CHANNELS.map((channel) => ({ ...channel, apiKey: "", modelApiKeys: [], apiFormat: "openai", models: [] }));
}

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: defaultFixedChannels(),
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: defaultFixedChannels().flatMap((channel) => channel.models.map((model) => `${channel.id}${CHANNEL_MODEL_SEPARATOR}${model.name}`)),
    quality: "auto",
    size: "3:4",
    background: "",
    count: "1",
    canvasImageCount: "1",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const requestConfig = resolveModelRequestConfig(config, model);
    return Boolean(model.trim() && requestConfig.baseUrl.trim() && requestConfig.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config:
                        key === "channels" || key === "baseUrl" || key === "apiFormat"
                            ? normalizeAiConfig({
                                  ...state.config,
                                  [key]: value,
                              })
                            : { ...state.config, [key]: value },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 2,
            migrate: (persisted, version) => {
                const state = (persisted || {}) as { config?: Partial<AiConfig>; webdav?: Partial<WebdavSyncConfig> };
                const config = state.config || {};
                return {
                    config: {
                        ...defaultConfig,
                        ...config,
                        size: version < 1 && config.size === "1:1" ? "3:4" : config.size || defaultConfig.size,
                        canvasImageCount: version < 1 && config.canvasImageCount === "3" ? "1" : config.canvasImageCount || defaultConfig.canvasImageCount,
                    },
                    webdav: { ...defaultWebdavSyncConfig, ...state.webdav },
                };
            },
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: normalizeAiConfig(persistedConfig),
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        modelApiKeys: normalizeModelApiKeys(channel?.modelApiKeys),
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function createChannelModelApiKey(key?: Partial<ChannelModelApiKey>): ChannelModelApiKey {
    return { id: key?.id?.trim() || nanoid(), name: key?.name?.trim() || i18n.t("config.channelEditor.newModelApiKey"), apiKey: key?.apiKey || "", models: uniqueModelOptions(key?.models || []) };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        if (channel?.models.some((item) => item.name === decoded.model)) return model;
        const migratedChannel = channels.find((item) => item.models.some((entry) => entry.name === decoded.model));
        return migratedChannel ? encodeChannelModel(migratedChannel.id, decoded.model) : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({
            id: "default",
            name: i18n.t("config.channels.defaultName"),
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            apiFormat: config.apiFormat,
            models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })),
        })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const model = modelOptionName(value || config.model);
    return {
        ...config,
        model,
        baseUrl: channel.baseUrl,
        apiKey: resolveChannelApiKey(channel, model),
        apiFormat: channel.apiFormat,
    };
}

export function resolveChannelApiKey(channel: ModelChannel, model: string) {
    const modelKey = (channel.modelApiKeys || []).find((item) => item.models.includes(model) && item.apiKey.trim());
    return modelKey?.apiKey.trim() || channel.apiKey.trim();
}

export function hasAnyChannelApiKey(channel: ModelChannel) {
    return Boolean(channel.apiKey.trim() || (channel.modelApiKeys || []).some((item) => item.apiKey.trim()));
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    return FIXED_CHANNELS.map((fixed) => {
        const matched = persistedChannels.find((channel) => channel?.id === fixed.id || sameBaseUrl(channel?.baseUrl, fixed.baseUrl));
        const legacyKey = sameBaseUrl(config.baseUrl, fixed.baseUrl) ? config.apiKey : "";
        const models = normalizeChannelModels(matched?.models);
        const rawMatched = matched as (ModelChannel & { capabilityApiKeys?: LegacyCapabilityApiKeys }) | undefined;
        const normalizedModels = models;
        return {
            ...fixed,
            apiKey: matched?.apiKey || legacyKey || "",
            modelApiKeys: normalizeModelApiKeys(rawMatched?.modelApiKeys, rawMatched?.capabilityApiKeys, normalizedModels),
            apiFormat: "openai" as const,
            models: normalizedModels,
        };
    });
}

export function normalizeAiConfig(input: Partial<AiConfig>): AiConfig {
    const config = { ...defaultConfig, ...input };
    if (!Array.isArray(input.channels)) config.channels = [];
    const channels = normalizeChannels(config);
    const base: AiConfig = {
        ...config,
        channelMode: "local",
        baseUrl: channels[0].baseUrl,
        apiKey: channels[0].apiKey,
        apiFormat: "openai",
        channels,
        models: modelOptionsFromChannels(channels),
        audioVoice: config.audioVoice || defaultConfig.audioVoice,
        audioFormat: config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: config.audioInstructions || "",
        reasoningEffort: config.reasoningEffort || "auto",
        videoSeconds: config.videoSeconds || "6",
        vquality: config.vquality || "720",
        videoGenerateAudio: config.videoGenerateAudio || "true",
        videoWatermark: config.videoWatermark || "false",
        canvasImageCount: config.canvasImageCount || "1",
    };
    const pick = (value: string | undefined, capability: ModelCapability) => {
        const normalized = normalizeModelOptionValue(value, channels);
        const options = selectableModelsByCapability(base, capability);
        return options.includes(normalized) ? normalized : options[0] || "";
    };
    const imageModel = pick(config.imageModel || config.model, "image");
    return {
        ...base,
        model: imageModel,
        imageModel,
        videoModel: pick(config.videoModel, "video"),
        textModel: pick(config.textModel || config.model, "text"),
        audioModel: pick(config.audioModel || defaultConfig.audioModel, "audio"),
    };
}

function sameBaseUrl(left: string | undefined, right: string) {
    return (left || "").trim().replace(/\/+$/, "").toLowerCase() === right.toLowerCase();
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" ? apiFormat : "openai";
}

function normalizeModelApiKeys(keys: ChannelModelApiKey[] | undefined, legacyKeys?: LegacyCapabilityApiKeys, models: ChannelModel[] = []): ChannelModelApiKey[] {
    const source = Array.isArray(keys)
        ? keys
        : (["image", "video", "text", "audio"] as ModelCapability[])
              .filter((capability) => legacyKeys?.[capability]?.trim())
              .map((capability) => ({
                  id: `legacy-${capability}`,
                  name: i18n.t(`config.channelEditor.capabilities.${capability}`),
                  apiKey: legacyKeys?.[capability] || "",
                  models: models.filter((model) => model.capability === capability).map((model) => model.name),
              }));
    const usedIds = new Set<string>();
    const assignedModels = new Set<string>();
    return source.map((item) => {
        const id = item.id?.trim() && !usedIds.has(item.id.trim()) ? item.id.trim() : nanoid();
        usedIds.add(id);
        const modelNames = uniqueModelOptions(item.models).filter((model) => {
            if (assignedModels.has(model)) return false;
            assignedModels.add(model);
            return true;
        });
        return { id, name: item.name?.trim() || i18n.t("config.channelEditor.unnamedModelApiKey"), apiKey: item.apiKey || "", models: modelNames };
    });
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

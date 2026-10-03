import { nanoid } from "nanoid";

import { hostedApi, type PublishedModel } from "./hosted";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageToDataUrl } from "@/services/image-storage";
import { getDataUrlByteSize } from "@/lib/image-utils";

type HostedOutput = Record<string, unknown>;
type HostedRequest = {
    capability: "image" | "text" | "video" | "audio";
    preferredModel?: string;
    parameters?: Record<string, unknown>;
    payload: Record<string, unknown>;
    count?: number;
    signal?: AbortSignal;
};

let modelCache: { expiresAt: number; items: PublishedModel[] } | null = null;

export async function executeHostedGeneration(input: HostedRequest): Promise<HostedOutput> {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const resolved = await resolvePublishedModel(input.capability, input.preferredModel, input.signal);
    const model = resolved.model;
    const parameters = input.parameters || {};
    const quote = await hostedApi.quote(model.id, input.capability, parameters, Math.max(1, input.count || 1), input.signal);
    const task = await hostedApi.createGenerationTask({
        quoteId: quote.quoteId,
        modelId: model.id,
        capability: input.capability,
        parameters,
        payload: input.payload,
        channelId: resolved.channelId,
        channelModel: resolved.channelModel,
        signal: input.signal,
    });
    const result = await hostedApi.executeGenerationTask(task.id, input.signal);
    if (result.status !== "succeeded") throw new Error(result.errorMessage || "托管生成失败");
    return result.output || {};
}

export async function hostedImages(config: AiConfig, prompt: string, references: ReferenceImage[] = [], signal?: AbortSignal) {
    const quality = config.quality?.trim();
    const size = config.size?.trim();
    const images = await Promise.all(references.map(async (reference) => compactReferenceImage(await imageToDataUrl(reference))));
    const output = await executeHostedGeneration({
        capability: "image",
        preferredModel: config.model || config.imageModel,
        count: Number(config.count) || 1,
        parameters: { quality, size, outputMode: config.outputMode || "native", count: Number(config.count) || 1 },
        payload: {
            prompt,
            n: Number(config.count) || 1,
            ...(quality ? { quality } : {}),
            ...(size ? { size } : {}),
            ...(config.outputMode ? { output_mode: config.outputMode } : {}),
            ...(config.background?.trim() ? { background: config.background.trim() } : {}),
            ...(images.length ? { images } : {}),
        },
        signal,
    });
    return readImages(output);
}

export async function hostedText(config: AiConfig, messages: unknown[], signal?: AbortSignal) {
    const output = await executeHostedGeneration({
        capability: "text",
        preferredModel: config.model || config.textModel,
        parameters: { inputTokens: messages.reduce<number>((total, item) => total + JSON.stringify(item).length, 0) },
        payload: { messages },
        signal,
    });
    return readText(output);
}

export async function hostedAudio(config: AiConfig, prompt: string, signal?: AbortSignal) {
    const output = await executeHostedGeneration({
        capability: "audio",
        preferredModel: config.model || config.audioModel,
        parameters: { durationSeconds: 1 },
        payload: { input: prompt, voice: config.audioVoice, response_format: config.audioFormat, speed: Number(config.audioSpeed) || 1 },
        signal,
    });
    return readBinary(output, "audio/mpeg");
}

export async function hostedVideo(config: AiConfig, prompt: string, references: ReferenceImage[] = [], signal?: AbortSignal) {
    const images = await Promise.all(references.map(async (reference) => compactReferenceImage(await imageToDataUrl(reference))));
    const output = await executeHostedGeneration({
        capability: "video",
        preferredModel: config.model || config.videoModel,
        parameters: { durationSeconds: Number(config.videoSeconds) || 6, resolution: config.vquality, outputMode: config.outputMode || "native" },
        payload: {
            prompt,
            seconds: Number(config.videoSeconds) || 6,
            size: config.size,
            resolution: config.vquality,
            output_mode: config.outputMode || "native",
            generate_audio: config.videoGenerateAudio === "true",
            ...(images.length ? { images } : {}),
        },
        signal,
    });
    return readVideo(output);
}

/** Creates the hosted video task only; generation is driven by polling so the server task id can survive a refresh. */
export async function createHostedVideoTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], signal?: AbortSignal) {
    const resolved = await resolvePublishedModel("video", config.model || config.videoModel, signal);
    const model = resolved.model;
    const images = await Promise.all(references.map(async (reference) => compactReferenceImage(await imageToDataUrl(reference))));
    const parameters = { durationSeconds: Number(config.videoSeconds) || 6, resolution: config.vquality, outputMode: config.outputMode || "native" };
    const quote = await hostedApi.quote(model.id, "video", parameters, 1, signal);
    const task = await hostedApi.createGenerationTask({
        quoteId: quote.quoteId,
        modelId: model.id,
        capability: "video",
        parameters,
        payload: {
            prompt,
            seconds: Number(config.videoSeconds) || 6,
            size: config.size,
            resolution: config.vquality,
            output_mode: config.outputMode || "native",
            generate_audio: config.videoGenerateAudio === "true",
            ...(images.length ? { images } : {}),
        },
        channelId: resolved.channelId,
        channelModel: resolved.channelModel,
        signal,
    });
    return { id: task.id, model: model.displayName };
}

export async function readHostedVideoTask(task: { id: string; status: string; output?: Record<string, unknown>; errorMessage?: string }) {
    if (task.status === "succeeded") return { status: "completed" as const, result: readVideo(task.output || {}) };
    if (task.status === "failed" || task.status === "cancelled") return { status: "failed" as const, error: task.errorMessage || "托管视频生成失败" };
    return { status: "pending" as const };
}

function readVideo(output: HostedOutput) {
    const binary = readBinaryIfPresent(output, "video/mp4");
    return binary ? { blob: binary } : { url: readUrl(output), mimeType: "video/mp4" };
}

async function resolvePublishedModel(capability: HostedRequest["capability"], preferred?: string, signal?: AbortSignal): Promise<{ model: PublishedModel; channelId?: number; channelModel?: string }> {
    const now = Date.now();
    if (!modelCache || modelCache.expiresAt < now) {
        modelCache = { expiresAt: now + 30_000, items: (await hostedApi.models(undefined, signal)).items };
    }
    const candidates = modelCache.items.filter((item) => item.capability === capability);
    const custom = preferred?.match(/^user-channel:(\d+)::(.+)$/);
    if (custom) {
        const channelId = Number(custom[1]);
        const channelModel = custom[2].trim();
        const channels = (await hostedApi.channels()).items;
        const channel = channels.find((item) => item.id === channelId);
        const model = channel?.models.find((item) => item.name === channelModel && item.capability === capability && item.status !== "hidden");
        if (model) {
            const published = candidates.find((item) => item.sourceModel === channelModel || item.displayName === channelModel);
            if (!published) throw new Error(`公开模型未绑定渠道模型：${channelModel}`);
            return { model: published, channelId, channelModel };
        }
        throw new Error("自定义渠道模型不可用");
    }
    const normalized = preferred?.split("::").pop()?.trim().toLowerCase();
    const exact = candidates.find((item) => item.displayName.toLowerCase() === normalized);
    const selected = exact || candidates[0];
    if (!selected) throw new Error(`管理员暂未发布${capability}模型`);
    return { model: selected };
}

function readImages(output: HostedOutput) {
    const list = output.data || output.images || output.results;
    if (!Array.isArray(list)) throw new Error("托管服务未返回图片");
    return list.map((item) => {
        const value = item as Record<string, unknown>;
        const source = typeof value.b64_json === "string" ? `data:image/png;base64,${value.b64_json}` : typeof value.url === "string" ? value.url : "";
        if (!source) throw new Error("托管服务返回了无效图片");
        return { id: nanoid(), dataUrl: source, actualQuality: typeof value.quality === "string" ? value.quality : undefined };
    });
}

function readText(output: HostedOutput) {
    const choices = output.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const value = message?.content || choices?.[0]?.text || output.output_text || output.text;
    if (typeof value !== "string" || !value.trim()) throw new Error("托管服务未返回文本");
    return value;
}

function readBinaryIfPresent(output: HostedOutput, mimeType: string) {
    if (typeof output.dataBase64 !== "string") return null;
    return base64ToBlob(output.dataBase64, typeof output.contentType === "string" ? output.contentType : mimeType);
}

function readBinary(output: HostedOutput, mimeType: string) {
    const binary = readBinaryIfPresent(output, mimeType);
    if (binary) return binary;
    const source = typeof output.b64_json === "string" ? output.b64_json : typeof output.data === "string" ? output.data : "";
    if (!source) throw new Error("托管服务未返回媒体");
    return base64ToBlob(source.replace(/^data:[^;]+;base64,/, ""), mimeType);
}

function readUrl(output: HostedOutput) {
    const value = output.url || output.video_url || output.result_url;
    if (typeof value !== "string" || !value) throw new Error("托管服务未返回视频");
    return value;
}

function base64ToBlob(value: string, mimeType: string) {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
}

async function compactReferenceImage(dataUrl: string) {
    if (!dataUrl || !dataUrl.startsWith("data:image/") || getDataUrlByteSize(dataUrl) <= 1_500_000) return dataUrl;
    const image = new Image();
    image.src = dataUrl;
    await new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
    });
    if (!image.naturalWidth || !image.naturalHeight) return dataUrl;
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
}

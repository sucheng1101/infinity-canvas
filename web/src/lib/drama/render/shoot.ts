import { executeHostedGeneration } from "@/services/api/hosted-generation";
import type { CharacterCard, DramaShot, SceneCard } from "@/types/drama";
import { buildShotRequest, type ShotGuide } from "@/lib/drama/render/shot-prompt";

type ShotOutput = Record<string, unknown>;

/** 从托管返回里取第一张图：b64 转 dataURL，url 直接用。 */
function firstImage(output: ShotOutput): string {
    const list = output.data || output.images || output.results;
    const item = Array.isArray(list) ? (list[0] as Record<string, unknown> | undefined) : undefined;
    if (item && typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item && typeof item.url === "string" && item.url) return item.url;
    throw new Error("托管服务未返回可用图片，请稍后重试");
}

/** 生成单镜图片，返回 url 或 dataURL；取不到图时抛中文错误。 */
export async function generateShotImage(input: { shot: DramaShot; characters: CharacterCard[]; scene?: SceneCard; guide?: ShotGuide; signal?: AbortSignal }): Promise<string> {
    const request = buildShotRequest(input.shot, input.characters, input.scene, input.guide, "image");
    const output = await executeHostedGeneration({
        capability: "image",
        payload: request.payload,
        parameters: request.parameters,
        count: 1,
        signal: input.signal,
    });
    return firstImage(output);
}

/**
 * 批量出图：并发上限默认 3，单条失败只记入 failed 不中断其余镜头。
 * 收到中止信号后不再派发新镜头，已返回的结果照常汇总。
 */
export async function shootShots(input: {
    shots: DramaShot[];
    characters: CharacterCard[];
    scenes: SceneCard[];
    guideOf?: (shot: DramaShot) => ShotGuide | undefined;
    concurrency?: number;
    onProgress?: (done: number, total: number, shotId: string, error?: string) => void;
    signal?: AbortSignal;
}): Promise<{ succeeded: string[]; failed: Array<{ shotId: string; error: string }> }> {
    const { shots, characters, scenes, guideOf, onProgress, signal } = input;
    const total = shots.length;
    const limit = Math.max(1, Math.min(Math.floor(input.concurrency ?? 3), total || 1));
    const order = new Map(shots.map((shot, index) => [shot.id, index]));
    const succeeded: string[] = [];
    const failed: Array<{ shotId: string; error: string }> = [];
    let cursor = 0;
    let done = 0;

    const runOne = async () => {
        while (cursor < shots.length) {
            if (signal?.aborted) return;
            const shot = shots[cursor++];
            let error: string | undefined;
            try {
                const scene = scenes.find((item) => item.id === shot.sceneId);
                await generateShotImage({ shot, characters, scene, guide: guideOf?.(shot), signal });
                succeeded.push(shot.id);
            } catch (caught) {
                error = signal?.aborted ? "出图已取消" : caught instanceof Error && caught.message ? caught.message : "出图失败";
                failed.push({ shotId: shot.id, error });
            }
            done += 1;
            onProgress?.(done, total, shot.id, error);
            if (signal?.aborted) return;
        }
    };

    await Promise.all(Array.from({ length: limit }, runOne));

    succeeded.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    failed.sort((a, b) => (order.get(a.shotId) ?? 0) - (order.get(b.shotId) ?? 0));
    return { succeeded, failed };
}

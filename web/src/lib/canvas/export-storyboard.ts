import { createZip } from "@/lib/zip";
import { buildDraftMetaInfo, buildJianyingDraft } from "@/lib/canvas/jianying-draft";

export type ExportShot = {
    index: number;
    sceneName: string;
    durationSec: number;
    dialogue?: string;
    prompt?: string;
    imageUrl?: string;
    videoUrl?: string;
    assetRefs?: string[];
};

export type ExportManifest = {
    project: string;
    exportedAt: string;
    totalDurationSec: number;
    shots: Array<{ index: number; scene: string; startSec: number; durationSec: number; dialogue: string; prompt: string; image: string | null; video: string | null; assetRefs: string[] }>;
};

const pad = (value: number, size = 2) => String(Math.max(0, Math.floor(value))).padStart(size, "0");

export function formatSrtTime(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = Math.floor(safe % 60);
    const millis = Math.round((safe - Math.floor(safe)) * 1000);
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

// 字幕按镜头时长累加，只有带台词的镜头才产生一条字幕。
export function buildSrt(shots: ExportShot[]) {
    let cursor = 0;
    const blocks: string[] = [];
    shots.forEach((shot, index) => {
        const start = cursor;
        cursor += Math.max(1, shot.durationSec);
        const dialogue = (shot.dialogue || "").trim();
        if (!dialogue) return;
        blocks.push(`${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(cursor)}\n${dialogue}\n`);
    });
    return blocks.join("\n");
}

export function buildManifest(project: string, shots: ExportShot[], exportedAt = new Date()): ExportManifest {
    let cursor = 0;
    const items = shots.map((shot) => {
        const startSec = cursor;
        const durationSec = Math.max(1, shot.durationSec);
        cursor += durationSec;
        return {
            index: shot.index,
            scene: shot.sceneName,
            startSec,
            durationSec,
            dialogue: (shot.dialogue || "").trim(),
            prompt: (shot.prompt || "").trim(),
            image: shot.imageUrl || null,
            video: shot.videoUrl || null,
            assetRefs: shot.assetRefs || [],
        };
    });
    return { project, exportedAt: exportedAt.toISOString(), totalDurationSec: cursor, shots: items };
}

async function fetchBlob(url: string) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`媒体下载失败：${url}`);
    return response.blob();
}

const extensionOf = (url: string, fallback: string) => {
    const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url);
    return match ? match[1].toLowerCase() : fallback;
};

// 工程包：图、视频、字幕与清单；剪映草稿需要额外的 draft_content.json，另行处理。
export async function exportStoryboardPackage(project: string, shots: ExportShot[]) {
    const manifest = buildManifest(project, shots);
    const files: Array<{ name: string; data: BlobPart }> = [
        { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
        { name: "subtitles.srt", data: buildSrt(shots) },
    ];
    for (const shot of shots) {
        const prefix = `shot-${String(shot.index).padStart(3, "0")}`;
        if (shot.imageUrl) {
            try {
                files.push({ name: `images/${prefix}.${extensionOf(shot.imageUrl, "png")}`, data: await fetchBlob(shot.imageUrl) });
            } catch {
                // 单张素材拿不到不影响整个工程包，清单里仍保留地址。
            }
        }
        if (shot.videoUrl) {
            try {
                files.push({ name: `videos/${prefix}.${extensionOf(shot.videoUrl, "mp4")}`, data: await fetchBlob(shot.videoUrl) });
            } catch {
                // 同上，视频体积大且可能已过期，失败不阻断导出。
            }
        }
    }
    return createZip(files);
}

// 剪映草稿包：只含 draft_content.json 与 draft_meta_info.json，媒体文件由剪映自己解析路径。
export async function exportJianyingDraft(project: string, shots: ExportShot[]) {
    const draft = buildJianyingDraft(shots);
    return createZip([
        { name: "draft_content.json", data: JSON.stringify(draft, null, 2) },
        { name: "draft_meta_info.json", data: JSON.stringify(buildDraftMetaInfo(project, draft), null, 2) },
    ]);
}
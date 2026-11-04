import type { ExportShot } from "@/lib/canvas/export-storyboard";

// 剪映草稿的 draft_content.json 是闭源格式，这里只按公开可观察到的结构生成一个
// 最小可用骨架（素材 + 视频轨 + 字幕轨），未在真实剪映中验证过，导入失败时
// 以工程包（manifest + srt）为准。
const MICROS = 1_000_000;

type Segment = {
    id: string;
    material_id: string;
    target_timerange: { start: number; duration: number };
    source_timerange: { start: number; duration: number };
    speed: number;
    volume: number;
    extra_material_refs: string[];
};

export type JianyingDraft = {
    canvas_config: { width: number; height: number; ratio: "9:16" | "16:9" };
    duration: number;
    materials: {
        videos: Array<{ id: string; path: string; material_name: string; type: string }>;
        texts: Array<{ id: string; content: string; type: string }>;
        audios: [];
    };
    tracks: Array<{ id: string; type: "video" | "text"; segments: Segment[] }>;
    version: number;
    new_version: string;
};

let counter = 0;
const nextId = () => `ic-${(++counter).toString(36)}`;

export function buildJianyingDraft(shots: ExportShot[], options?: { width?: number; height?: number }): JianyingDraft {
    const width = options?.width ?? 1080;
    const height = options?.height ?? 1920;
    const videos: JianyingDraft["materials"]["videos"] = [];
    const texts: JianyingDraft["materials"]["texts"] = [];
    const videoSegments: Segment[] = [];
    const textSegments: Segment[] = [];
    let cursor = 0;

    for (const shot of shots) {
        const duration = Math.max(1, shot.durationSec) * MICROS;
        const timeRange = { start: cursor, duration };
        if (shot.videoUrl) {
            const id = nextId();
            videos.push({ id, path: shot.videoUrl, material_name: shot.videoUrl.split("/").pop() || id, type: "video" });
            videoSegments.push({ id: nextId(), material_id: id, target_timerange: timeRange, source_timerange: { start: 0, duration }, speed: 1, volume: 1, extra_material_refs: [] });
        }
        const dialogue = (shot.dialogue || "").trim();
        if (dialogue) {
            const id = nextId();
            texts.push({ id, content: dialogue, type: "text" });
            textSegments.push({ id: nextId(), material_id: id, target_timerange: timeRange, source_timerange: { start: 0, duration }, speed: 1, volume: 1, extra_material_refs: [] });
        }
        cursor += duration;
    }

    const tracks: JianyingDraft["tracks"] = [];
    if (videoSegments.length) tracks.push({ id: nextId(), type: "video", segments: videoSegments });
    if (textSegments.length) tracks.push({ id: nextId(), type: "text", segments: textSegments });

    return {
        canvas_config: { width, height, ratio: height > width ? "9:16" : "16:9" },
        duration: cursor,
        materials: { videos, texts, audios: [] },
        tracks,
        version: 360000,
        new_version: "110.0.0",
    };
}

// 剪映导入需要 draft_meta_info.json 与 draft_content.json 两个文件。
export function buildDraftMetaInfo(projectName: string, draft: JianyingDraft) {
    return {
        draft_name: projectName,
        draft_id: nextId(),
        draft_root_path: "",
        tm_draft_create: Date.now() * 1000,
        tm_draft_modified: Date.now() * 1000,
        draft_timeline_materials_size: draft.duration,
        draft_fold_path: projectName,
    };
}

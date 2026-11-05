import type { CameraKey, CharacterCard, DramaShot, SceneCard } from "@/types/drama";

/** 首帧引导图：color 是首帧 dataURL，depth 是深度图，后端可能暂不支持，先预留。 */
export type ShotGuide = { color?: string; depth?: string };

/**
 * 从 camera.keys 推导运镜方向：机位与目标的距离变化决定推/拉，位移方向决定移/升/降，只转目标则是摇。
 * keys 不足两个时按固定镜头处理。
 */
function cameraMovement(shot: DramaShot): string {
    const keys = shot.camera.keys;
    if (keys.length < 2) return "固定镜头";
    const first = keys[0];
    const last = keys[keys.length - 1];
    const distance = (key: CameraKey) => Math.hypot(key.position[0] - key.target[0], key.position[1] - key.target[1], key.position[2] - key.target[2]);
    const startDistance = distance(first);
    const endDistance = distance(last);
    if (Math.abs(endDistance - startDistance) > Math.max(0.3, startDistance * 0.15)) return endDistance < startDistance ? "推镜头" : "拉镜头";
    const moveY = last.position[1] - first.position[1];
    const moveFlat = Math.hypot(last.position[0] - first.position[0], last.position[2] - first.position[2]);
    if (Math.abs(moveY) > 0.3 && Math.abs(moveY) >= moveFlat) return moveY > 0 ? "升镜头" : "降镜头";
    if (moveFlat > 0.3) return "移动镜头";
    const turn = Math.hypot(last.target[0] - first.target[0], last.target[2] - first.target[2]);
    if (turn > 0.3) return "摇镜头";
    return "固定镜头";
}

/** 拼一段中文提示词：景别 + 运镜 + 画面内容 + 出场角色 + 场景。 */
export function buildShotPrompt(shot: DramaShot, characters: CharacterCard[], scene?: SceneCard): string {
    const parts = [`${shot.shotSize}镜头，${cameraMovement(shot)}`];
    const content = shot.prompt.trim();
    if (content) parts.push(`画面内容：${content}`);
    const cast = shot.cast
        .map((item) => characters.find((card) => card.id === item.characterId))
        .filter((card): card is CharacterCard => Boolean(card))
        .map((card) => (card.prompt.trim() ? `${card.name}（${card.prompt.trim()}）` : card.name));
    if (cast.length) parts.push(`出场角色：${cast.join("、")}`);
    if (scene) parts.push(`场景：${scene.name}`);
    return `${parts.join("；")}。`;
}

export type ShotRequest = {
    capability: "video" | "image";
    payload: Record<string, unknown>;
    parameters: Record<string, unknown>;
};

/**
 * 组装生成请求。capability 默认 image（出图），传 "video" 时走视频参数。
 * guide.color 只放这一张参考图，避免超过后端的参考图数量上限。
 */
export function buildShotRequest(shot: DramaShot, characters: CharacterCard[], scene?: SceneCard, guide?: ShotGuide, capability: "image" | "video" = "image"): ShotRequest {
    const prompt = buildShotPrompt(shot, characters, scene);
    const images = guide?.color ? [guide.color] : [];
    const guideParameters = guide?.depth ? { guideDepth: guide.depth } : {};
    if (capability === "image") {
        return { capability: "image", payload: { prompt, n: 1, images }, parameters: guideParameters };
    }
    const seconds = Math.max(1, Math.round(shot.durationSec));
    return { capability: "video", payload: { prompt, seconds, images }, parameters: { durationSeconds: seconds, ...guideParameters } };
}

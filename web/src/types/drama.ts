// 短剧工作区的唯一数据契约：子任务 A/B/C/D 都以本文件为准，不要各自另立类型。

export type DramaWorld = "cultivation" | "urban";

export type DramaSceneTemplateId =
    | "empty"
    | "indoor"
    | "street"
    | "palace"
    | "urban_street"
    | "apartment"
    | "office"
    | "shop";

export type DramaSceneTemplate = {
    id: DramaSceneTemplateId;
    name: string;
    world: DramaWorld | "any";
    size: { x: number; z: number };
    // 程序化白模的构件列表，由预演引擎解释成几何体。
    parts: Array<{ kind: "floor" | "wall" | "step" | "box" | "pillar" | "roof"; position: [number, number, number]; size: [number, number, number]; rotationY?: number }>;
};

export type CastPosition = {
    characterId: string;
    position: [number, number, number];
    rotationY: number;
};

export type CameraKey = {
    t: number; // 相对镜头起点的秒数
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
};

export type DramaShotSize = "特写" | "近景" | "中景" | "全景" | "远景";

export type DramaShotStatus = "待预演" | "已预演" | "已出图" | "已出片";

export type DramaShot = {
    id: string;
    sceneId: string;
    /** 镜号，从 1 开始，决定拍摄与导出顺序 */
    index: number;
    shotSize: DramaShotSize;
    durationSec: number;
    dialogue: string;
    prompt: string;
    cast: CastPosition[];
    camera: { lens: number; keys: CameraKey[] };
    status: DramaShotStatus;
    output?: { imageUrl?: string; videoUrl?: string; audioUrl?: string };
};

export type CharacterCard = {
    id: string;
    name: string;
    prompt: string;
    refImages: string[];
    /** OPFS / IndexedDB 里的模型文件 key，可选 */
    modelKey?: string;
    heightCm: number;
    color: string;
};

export type SceneCard = {
    id: string;
    name: string;
    templateId: DramaSceneTemplateId;
    world: DramaWorld;
    size: { x: number; z: number };
    /** 用户导入的 GLB，可选；有则优先于模板 */
    glbKey?: string;
};

export type PropCard = {
    id: string;
    name: string;
    glbKey?: string;
    size: [number, number, number];
};

export type DramaProject = {
    id: string;
    title: string;
    /** 与画布项目共用同一个 id 空间，一个项目两种工作区 */
    canvasProjectId?: string;
    world: DramaWorld;
    createdAt: number;
    updatedAt: number;
    characters: CharacterCard[];
    scenes: SceneCard[];
    props: PropCard[];
    shots: DramaShot[];
    timeline: { fps: number; totalSec: number };
};

/** 备份包 manifest（.icdrama = zip） */
export type DramaBackupManifest = {
    schemaVersion: number;
    app: "infinite-canvas";
    projectId: string;
    exportedAt: string;
    /** 备份只保留场景布局与镜头，不含生成结果 */
    includes: { models: boolean; media: false };
    files: string[];
};

export const DRAMA_SCHEMA_VERSION = 1;

export const SHOT_SIZES: DramaShotSize[] = ["特写", "近景", "中景", "全景", "远景"];

export const CAMERA_PRESETS = ["固定", "推", "拉", "摇", "移", "跟随", "环绕", "升降", "手持", "航拍"] as const;

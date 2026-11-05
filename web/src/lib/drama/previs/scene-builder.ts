// 3D 白模预演引擎 · 场景构建层
// 只负责「数据契约 → three 对象」和「关键帧 → 相机状态」的翻译，不碰 DOM、不跑渲染循环。
// 本文件刻意不 import three：模块由调用方（previs-canvas）动态加载后以参数传入，
// 所以没装 three 时类型检查与单测依然能跑。

import type { CameraKey, CastPosition, CharacterCard, DramaSceneTemplate } from "@/types/drama";

/** 动态加载得到的 three 模块；不引入 @types/three 时统一按 any 处理，避免 three 类型散落全局 */
export type ThreeLike = any;

/** 白模统一材质色 */
export const WHITEBOX_COLOR = "#e7e5e4";
/** 性能边界：单场景几何体上限 */
export const MAX_PARTS = 200;
/** 性能边界：单场景角色上限 */
export const MAX_CHARACTERS = 8;

export type CameraSample = {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 35mm 画幅高度 24mm：由镜头焦距换算垂直视角（度），没有关键帧时兜底 */
export function fovFromLens(lens: number): number {
    if (!Number.isFinite(lens) || lens <= 0) return 40;
    return (2 * Math.atan(24 / (2 * lens)) * 180) / Math.PI;
}

/** 缓动函数：x 为段内进度 0~1 */
function ease(x: number, easing: CameraKey["easing"]): number {
    const p = clamp(x, 0, 1);
    switch (easing) {
        case "easeIn":
            return p * p;
        case "easeOut":
            return 1 - (1 - p) * (1 - p);
        case "easeInOut":
            return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
        default:
            return p;
    }
}

function lerp3(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function sampleOf(key: CameraKey): CameraSample {
    return {
        position: [key.position[0], key.position[1], key.position[2]],
        target: [key.target[0], key.target[1], key.target[2]],
        fov: key.fov,
    };
}

/**
 * 关键帧采样（纯函数，可直接单测）。
 * - 关键帧按 t 升序处理，非法 t 的关键帧会被忽略；
 * - 时间段之外的 t 钳制到首/尾关键帧；NaN 等非法时间按首帧处理；
 * - 每一段使用「段起点关键帧」的 easing 决定节奏；
 * - 没有关键帧时返回默认机位，fov 取 fallbackFov。
 */
export function sampleCamera(keys: CameraKey[], t: number, fallbackFov = 40): CameraSample {
    const sorted = (keys ?? [])
        .filter((key) => key && Number.isFinite(key.t))
        .slice()
        .sort((a, b) => a.t - b.t);
    if (sorted.length === 0) return { position: [0, 1.6, 6], target: [0, 1, 0], fov: fallbackFov };

    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const time = typeof t === "number" && !Number.isNaN(t) ? t : first.t;
    if (time <= first.t) return sampleOf(first);
    if (time >= last.t) return sampleOf(last);

    let index = 0;
    while (index < sorted.length - 2 && sorted[index + 1].t <= time) index += 1;

    const from = sorted[index];
    const to = sorted[index + 1];
    const span = to.t - from.t;
    const k = ease(span <= 0 ? 1 : (time - from.t) / span, from.easing);

    return {
        position: lerp3(from.position, to.position, k),
        target: lerp3(from.target, to.target, k),
        fov: from.fov + (to.fov - from.fov) * k,
    };
}

/**
 * 把模板的 parts 拼成几何体组：统一灰白材质 + 地面网格线。
 * floor/wall/step/box/roof 用长方体，pillar 用圆柱；屋顶半透明，方便俯视看机位与走位。
 */
export function buildWhiteboxScene(THREE: ThreeLike, template: DramaSceneTemplate): ThreeLike {
    const group = new THREE.Group();
    group.name = `whitebox:${template.id}`;

    const material = new THREE.MeshStandardMaterial({ color: WHITEBOX_COLOR, roughness: 0.9, metalness: 0 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: WHITEBOX_COLOR, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });

    const parts = template.parts ?? [];
    if (parts.length > MAX_PARTS) {
        console.warn(`[previs] 模板 ${template.id} 有 ${parts.length} 个构件，超过 ${MAX_PARTS} 上限，已截断渲染`);
    }

    parts.slice(0, MAX_PARTS).forEach((part, index) => {
        const [width, height, depth] = part.size;
        const geometry =
            part.kind === "pillar"
                ? new THREE.CylinderGeometry(Math.max(0.02, Math.min(width, depth) / 2), Math.max(0.02, Math.min(width, depth) / 2), Math.max(0.02, height), 12)
                : new THREE.BoxGeometry(Math.max(0.02, width), Math.max(0.02, height), Math.max(0.02, depth));
        const mesh = new THREE.Mesh(geometry, part.kind === "roof" ? roofMaterial : material);
        mesh.name = `${part.kind}-${index}`;
        mesh.position.set(part.position[0], part.position[1], part.position[2]);
        if (part.rotationY) mesh.rotation.y = part.rotationY;
        group.add(mesh);
    });

    // 地面网格线：按场景尺寸铺，帮助判断距离和走位
    const gridSize = Math.max(4, Math.max(template.size?.x ?? 10, template.size?.z ?? 10));
    const grid = new THREE.GridHelper(gridSize, Math.min(60, Math.round(gridSize)), 0xc9c4bf, 0xdedad6);
    grid.name = "ground-grid";
    grid.position.y = 0.004;
    group.add(grid);

    return group;
}

/** 每个角色一个胶囊体，高度取 heightCm，颜色取 card.color；没有摆位的角色不渲染 */
export function buildCharacters(THREE: ThreeLike, cards: CharacterCard[], cast: CastPosition[]): ThreeLike {
    const group = new THREE.Group();
    group.name = "cast";

    const cardById = new Map((cards ?? []).map((card) => [card.id, card]));
    const placed = (cast ?? []).filter((position) => cardById.has(position.characterId));
    if (placed.length > MAX_CHARACTERS) {
        console.warn(`[previs] 本镜头摆了 ${placed.length} 个角色，超过 ${MAX_CHARACTERS} 上限，只渲染前 ${MAX_CHARACTERS} 个`);
    }

    placed.slice(0, MAX_CHARACTERS).forEach((position) => {
        const card = cardById.get(position.characterId)!;
        const height = clamp((card.heightCm || 170) / 100, 0.3, 3);
        const radius = Math.min(0.32, height * 0.16);
        const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.05, height - radius * 2), 4, 12);
        const material = new THREE.MeshStandardMaterial({ color: card.color || WHITEBOX_COLOR, roughness: 0.85, metalness: 0 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `character:${card.id}`;
        mesh.position.set(position.position[0], position.position[1] + height / 2, position.position[2]);
        mesh.rotation.y = position.rotationY ?? 0;
        group.add(mesh);
    });

    return group;
}

/** 生成一台透视相机，初始状态取首帧关键帧（无关键帧时用焦距换算的 fov） */
export function buildCamera(THREE: ThreeLike, keys: CameraKey[], lens: number): ThreeLike {
    const fallbackFov = fovFromLens(lens);
    const startT = (keys ?? []).filter((key) => Number.isFinite(key.t)).reduce((min, key) => Math.min(min, key.t), Number.POSITIVE_INFINITY);
    const sample = sampleCamera(keys, Number.isFinite(startT) ? startT : 0, fallbackFov);
    const camera = new THREE.PerspectiveCamera(sample.fov, 16 / 9, 0.1, 500);
    camera.name = "previs-camera";
    camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
    camera.lookAt(sample.target[0], sample.target[1], sample.target[2]);
    camera.updateProjectionMatrix();
    return camera;
}

/** 把采样结果写到已有相机上（播放、切换机位、导出首帧都走这里） */
export function applyCameraSample(camera: ThreeLike, sample: CameraSample): void {
    camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
    camera.lookAt(sample.target[0], sample.target[1], sample.target[2]);
    const fov = Number.isFinite(sample.fov) ? sample.fov : camera.fov;
    if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
}

/** 递归释放几何体、材质与材质上的贴图；卸载与切换镜头时必须调用 */
export function disposeObject(root: ThreeLike | null): void {
    if (!root) return;
    root.traverse?.((object: ThreeLike) => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        materials.forEach((material: ThreeLike) => {
            Object.values(material).forEach((value) => {
                if (value && typeof (value as ThreeLike).isTexture === "boolean" && (value as ThreeLike).isTexture) (value as ThreeLike).dispose?.();
            });
            material.dispose?.();
        });
    });
    root.removeFromParent?.();
}

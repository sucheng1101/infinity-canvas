// 3D 白模预演引擎 · 三通道导出
// 用同一台相机分别以普通材质、深度材质、法线材质各渲染一帧，转成 PNG dataURL。
// 分辨率上限 1280x720，避免一次导出吃掉几十 MB 像素内存。

import type { ThreeLike } from "./scene-builder";

/** 三种引导图：彩色首帧、深度图、法线图（均为 dataURL） */
export type GuidePasses = {
    color: string;
    depth: string;
    normal: string;
};

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
const EMPTY_PASSES: GuidePasses = { color: "", depth: "", normal: "" };

/**
 * 渲染三张引导图。
 * 期间会临时改渲染尺寸、像素比和场景 overrideMaterial，结束后原样恢复，
 * 调用方的交互渲染不受影响（要求 renderer 开启 preserveDrawingBuffer 才能稳定读像素）。
 */
export function renderGuidePasses(THREE: ThreeLike, renderer: ThreeLike, scene: ThreeLike, camera: ThreeLike): GuidePasses {
    if (!renderer || !scene || !camera) {
        console.warn("[previs] 渲染器 / 场景 / 相机缺失，跳过导出");
        return { ...EMPTY_PASSES };
    }

    const current = renderer.getSize(new THREE.Vector2());
    const width = Math.max(1, Math.round(current.x));
    const height = Math.max(1, Math.round(current.y));
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const pixelRatio = renderer.getPixelRatio();
    const previousOverride = scene.overrideMaterial ?? null;
    const canvas: HTMLCanvasElement = renderer.domElement;

    const snapshot = () => {
        try {
            return canvas.toDataURL("image/png");
        } catch (error) {
            console.warn("[previs] 读取画布像素失败", error);
            return "";
        }
    };

    try {
        renderer.setPixelRatio(1);
        renderer.setSize(targetWidth, targetHeight, false);

        // 1. 彩色：用场景自身的灰白材质
        renderer.render(scene, camera);
        const color = snapshot();

        // 2. 深度：统一覆盖成 MeshDepthMaterial
        scene.overrideMaterial = new THREE.MeshDepthMaterial();
        renderer.render(scene, camera);
        const depth = snapshot();

        // 3. 法线：统一覆盖成 MeshNormalMaterial
        scene.overrideMaterial = new THREE.MeshNormalMaterial();
        renderer.render(scene, camera);
        const normal = snapshot();

        return { color, depth, normal };
    } finally {
        scene.overrideMaterial = previousOverride;
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        // 恢复成正常画面，避免交互视图停在法线通道上
        renderer.render(scene, camera);
    }
}

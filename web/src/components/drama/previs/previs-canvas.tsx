// 3D 白模预演画布
// three 通过动态 import 懒加载：没装 three 时只提示、不影响其它页面打包。
// 交互用自己实现的简单轨道控制（拖拽旋转 + 滚轮缩放），避免额外依赖。

import { Camera, Download, Loader2, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { renderGuidePasses } from "@/lib/drama/previs/render-passes";
import { applyCameraSample, buildCamera, buildCharacters, buildWhiteboxScene, disposeObject, fovFromLens, sampleCamera, type CameraSample, type ThreeLike } from "@/lib/drama/previs/scene-builder";
import { SCENE_TEMPLATES } from "@/lib/drama/scene-templates";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CameraKey, DramaProject, DramaShot } from "@/types/drama";

export type PrevisCanvasProps = {
    project: DramaProject;
    shot: DramaShot;
    onCameraChange: (keys: CameraKey[]) => void;
    onCapture?: (payload: { color: string; depth: string; normal: string }) => void;
};

type Orbit = { target: ThreeLike; radius: number; azimuth: number; polar: number };

type StageState = {
    renderer: ThreeLike;
    scene: ThreeLike;
    camera: ThreeLike;
    orbit: Orbit;
    whitebox: ThreeLike | null;
    castGroup: ThreeLike | null;
    render: () => void;
    applyOrbit: () => void;
    syncOrbit: () => void;
};

const BUTTON = "pointer-events-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10";

let threePromise: Promise<ThreeLike | null> | null = null;

/** 懒加载 three：只加载一次，失败时返回 null 并提示安装命令 */
function loadThree(): Promise<ThreeLike | null> {
    if (!threePromise) {
        threePromise = // @ts-ignore three 未安装时只缺这一处依赖的类型声明；安装 @types/three 后本注释自动失效
            (import("three") as Promise<ThreeLike>)
                .then((module: ThreeLike) => (module?.WebGLRenderer ? module : (module?.default ?? null)))
                .catch((error: unknown) => {
                    console.warn("[previs] three 加载失败，请在 web 目录执行 npm i three @types/three", error);
                    return null;
                });
    }
    return threePromise;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 把采样结果应用到相机与轨道中心（播放、切机位、导出首帧共用） */
function applySample(state: StageState, sample: CameraSample) {
    applyCameraSample(state.camera, sample);
    state.orbit.target.set(sample.target[0], sample.target[1], sample.target[2]);
    state.syncOrbit();
}

function downloadDataUrl(dataUrl: string, filename: string) {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
}

export function PrevisCanvas({ project, shot, onCameraChange, onCapture }: PrevisCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [THREE, setTHREE] = useState<ThreeLike | null>(null);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        let alive = true;
        loadThree().then((module) => {
            if (!alive) return;
            if (module) setTHREE(module);
            else setMissing(true);
        });
        return () => {
            alive = false;
        };
    }, []);

    if (missing) {
        return (
            <div className="grid h-full min-h-[240px] w-full place-items-center rounded-lg border border-dashed p-4 text-center text-xs" style={{ color: theme.node.muted }}>
                3D 预演引擎未就绪：请在 web 目录执行 npm i three @types/three 后刷新页面
            </div>
        );
    }
    if (!THREE) {
        return (
            <div className="grid h-full min-h-[240px] w-full place-items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                <Loader2 size={16} className="animate-spin" />
                正在加载 3D 引擎…
            </div>
        );
    }
    return <PrevisStage THREE={THREE} project={project} shot={shot} onCameraChange={onCameraChange} onCapture={onCapture} />;
}

function PrevisStage({ THREE, project, shot, onCameraChange, onCapture }: PrevisCanvasProps & { THREE: ThreeLike }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const hostRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<StageState | null>(null);
    const playheadRef = useRef(0);

    const [ready, setReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [clock, setClock] = useState(0);

    const keysRef = useRef(shot.camera.keys);
    keysRef.current = shot.camera.keys;
    const lensRef = useRef(shot.camera.lens);
    lensRef.current = shot.camera.lens;

    const sceneCard = project.scenes.find((item) => item.id === shot.sceneId);
    const sceneSig = sceneCard ? JSON.stringify(sceneCard) : shot.sceneId;
    const castSig = JSON.stringify(shot.cast);
    const keysSig = JSON.stringify(shot.camera.keys);

    // 1. 初始化渲染器 / 场景 / 灯光 / 相机，并挂载鼠标漫游
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        let renderer: ThreeLike;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        } catch (error) {
            console.warn("[previs] WebGL 初始化失败", error);
            return;
        }

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);

        const canvas: HTMLCanvasElement = renderer.domElement;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        canvas.style.touchAction = "none";
        host.appendChild(canvas);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(theme.canvas.background);
        const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b3ad, 1.15);
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
        keyLight.position.set(8, 12, 6);
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
        fillLight.position.set(-8, 6, -6);
        scene.add(hemi, keyLight, fillLight);

        const camera = buildCamera(THREE, keysRef.current, lensRef.current);
        camera.aspect = Math.max(0.2, host.clientWidth / Math.max(1, host.clientHeight));
        camera.updateProjectionMatrix();

        const orbit: Orbit = {
            target: new THREE.Vector3(0, 1, 0),
            radius: Math.max(1, camera.position.length()),
            azimuth: Math.atan2(camera.position.x, camera.position.z),
            polar: Math.PI / 2.4,
        };

        const render = () => renderer.render(scene, camera);

        const applyOrbit = () => {
            const sinPolar = Math.sin(orbit.polar);
            camera.position.set(orbit.target.x + orbit.radius * sinPolar * Math.sin(orbit.azimuth), orbit.target.y + orbit.radius * Math.cos(orbit.polar), orbit.target.z + orbit.radius * sinPolar * Math.cos(orbit.azimuth));
            camera.lookAt(orbit.target);
            render();
        };

        const syncOrbit = () => {
            const offset = camera.position.clone().sub(orbit.target);
            const radius = Math.max(0.5, offset.length());
            orbit.radius = radius;
            orbit.polar = Math.acos(Math.min(1, Math.max(-1, offset.y / radius)));
            orbit.azimuth = Math.atan2(offset.x, offset.z);
        };

        const state: StageState = { renderer, scene, camera, orbit, whitebox: null, castGroup: null, render, applyOrbit, syncOrbit };
        stateRef.current = state;
        syncOrbit();
        applyOrbit();
        setReady(true);

        // 鼠标漫游：左键拖拽旋转、右键拖拽同样旋转、滚轮推拉距离
        let dragging = false;
        let lastX = 0;
        let lastY = 0;

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 && event.button !== 2) return;
            dragging = true;
            lastX = event.clientX;
            lastY = event.clientY;
            canvas.setPointerCapture?.(event.pointerId);
        };
        const onPointerMove = (event: PointerEvent) => {
            if (!dragging) return;
            const deltaX = event.clientX - lastX;
            const deltaY = event.clientY - lastY;
            lastX = event.clientX;
            lastY = event.clientY;
            orbit.azimuth -= deltaX * 0.006;
            orbit.polar = Math.min(Math.PI / 2 - 0.02, Math.max(0.15, orbit.polar - deltaY * 0.006));
            applyOrbit();
        };
        const onPointerUp = (event: PointerEvent) => {
            dragging = false;
            canvas.releasePointerCapture?.(event.pointerId);
        };
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            orbit.radius = Math.min(60, Math.max(0.8, orbit.radius * (event.deltaY > 0 ? 1.1 : 0.9)));
            applyOrbit();
        };
        const onContextMenu = (event: Event) => event.preventDefault();

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        canvas.addEventListener("contextmenu", onContextMenu);

        const observer = new ResizeObserver(() => {
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            render();
        });
        observer.observe(host);

        // 卸载：断监听、释放几何体/材质/贴图、销毁渲染器，避免显存泄漏
        return () => {
            observer.disconnect();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerUp);
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("contextmenu", onContextMenu);
            disposeObject(state.whitebox);
            disposeObject(state.castGroup);
            state.whitebox = null;
            state.castGroup = null;
            scene.clear();
            renderer.dispose();
            renderer.forceContextLoss?.();
            canvas.remove();
            stateRef.current = null;
            setReady(false);
        };
    }, [THREE]);

    // 2. 主题切换时同步背景色
    useEffect(() => {
        const state = stateRef.current;
        if (!state) return;
        if (state.scene.background?.set) state.scene.background.set(theme.canvas.background);
        else state.scene.background = new THREE.Color(theme.canvas.background);
        state.render();
    }, [THREE, theme.canvas.background]);

    // 3. 场景白模 + 角色按镜头数据重建
    useEffect(() => {
        const state = stateRef.current;
        if (!state) return;
        disposeObject(state.whitebox);
        disposeObject(state.castGroup);
        // 模板来自项目模板库；找不到时退回空场模板
        const template = SCENE_TEMPLATES.find((item) => item.id === (sceneCard?.templateId ?? "empty")) ?? SCENE_TEMPLATES[0];
        state.whitebox = buildWhiteboxScene(THREE, template);
        // 场景卡自定义尺寸与模板不一致时按比例拉伸，保证白模和机位走位同一套坐标
        if (sceneCard && (sceneCard.size.x !== template.size.x || sceneCard.size.z !== template.size.z)) {
            state.whitebox.scale.set(sceneCard.size.x / template.size.x, 1, sceneCard.size.z / template.size.z);
        }
        state.castGroup = buildCharacters(THREE, project.characters, shot.cast);
        state.scene.add(state.whitebox, state.castGroup);
        state.render();
    }, [THREE, sceneSig, castSig]);

    // 4. 机位关键帧变化后，回到当前播放头的机位
    useEffect(() => {
        const state = stateRef.current;
        if (!state) return;
        applySample(state, sampleCamera(shot.camera.keys, playheadRef.current, fovFromLens(shot.camera.lens)));
        state.render();
    }, [THREE, keysSig, shot.camera.lens]);

    // 5. 时间轴播放：按 durationSec 循环采样机位
    useEffect(() => {
        if (!playing) return;
        const state = stateRef.current;
        if (!state) return;
        const total = Math.max(0.2, shot.durationSec);
        const startAt = performance.now();
        const from = playheadRef.current >= total - 0.01 ? 0 : playheadRef.current;
        let uiAt = 0;
        let frame = 0;

        const tick = () => {
            const now = performance.now();
            const t = (from + (now - startAt) / 1000) % total;
            playheadRef.current = t;
            applySample(state, sampleCamera(keysRef.current, t, fovFromLens(lensRef.current)));
            if (now - uiAt > 100) {
                uiAt = now;
                setClock(t);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, shot.durationSec]);

    const addKeyAtView = () => {
        const state = stateRef.current;
        if (!state) return;
        const t = round2(playheadRef.current);
        const key: CameraKey = {
            t,
            position: [round2(state.camera.position.x), round2(state.camera.position.y), round2(state.camera.position.z)],
            target: [round2(state.orbit.target.x), round2(state.orbit.target.y), round2(state.orbit.target.z)],
            fov: round2(state.camera.fov),
            easing: "easeInOut",
        };
        const next = [...shot.camera.keys.filter((item) => Math.abs(item.t - t) > 0.05), key].sort((a, b) => a.t - b.t);
        onCameraChange(next);
    };

    const exportPasses = () => {
        const state = stateRef.current;
        if (!state) return;
        setBusy(true);
        const lens = shot.camera.lens;
        const resumeAt = playheadRef.current;
        try {
            // 固定导出首帧
            applySample(state, sampleCamera(shot.camera.keys, 0, fovFromLens(lens)));
            const payload = renderGuidePasses(THREE, state.renderer, state.scene, state.camera);
            if (onCapture) {
                onCapture(payload);
            } else {
                downloadDataUrl(payload.color, `shot-${shot.index}-color.png`);
                downloadDataUrl(payload.depth, `shot-${shot.index}-depth.png`);
                downloadDataUrl(payload.normal, `shot-${shot.index}-normal.png`);
            }
        } finally {
            // 恢复交互视角
            applySample(state, sampleCamera(shot.camera.keys, resumeAt, fovFromLens(lens)));
            state.render();
            setBusy(false);
        }
    };

    return (
        <div className="relative h-full min-h-[320px] w-full overflow-hidden rounded-lg" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <div ref={hostRef} className="absolute inset-0" />

            <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-1 p-2">
                <button type="button" className={BUTTON} onClick={addKeyAtView} disabled={!ready || playing}>
                    <Camera size={13} />
                    从当前视角添加机位
                </button>
                <button type="button" className={BUTTON} onClick={() => setPlaying((value) => !value)} disabled={!ready}>
                    {playing ? <Square size={13} /> : <Play size={13} />}
                    {playing ? "停止预览" : "预览（按时间轴播放）"}
                </button>
                <button type="button" className={BUTTON} onClick={exportPasses} disabled={!ready || busy}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    导出首帧/深度/法线
                </button>
            </div>

            <div className="pointer-events-none absolute bottom-2 left-2 text-[11px]" style={{ color: theme.node.muted }}>
                {shot.shotSize} · {clock.toFixed(1)}s / {shot.durationSec.toFixed(1)}s · 拖拽旋转，滚轮缩放
            </div>
        </div>
    );
}

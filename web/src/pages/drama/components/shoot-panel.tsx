import { App, Button, Empty, Progress, Tag } from "antd";
import { Camera, Image as ImageIcon, Images, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import type { DramaProject, DramaShot, DramaShotStatus } from "@/types/drama";

const BATCH_LIMIT = 3;

const STATUS_COLOR: Record<DramaShotStatus, string> = { 待预演: "default", 已预演: "blue", 已出图: "green", 已出片: "purple" };

const isDone = (shot: DramaShot) => shot.status === "已出图" || shot.status === "已出片";

const reasonOf = (error: unknown) => (error instanceof Error && error.message ? error.message : "出图失败");

export function ShootPanel({ project, onGenerate }: { project: DramaProject; onGenerate: (shot: DramaShot) => void | Promise<void> }) {
    const { message } = App.useApp();
    const [pending, setPending] = useState<string[]>([]);
    const [batching, setBatching] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
    const [errors, setErrors] = useState<Record<string, string>>({});
    // 正在生成的镜头：批量与单镜同时触发时，同一镜只跑一次。
    const running = useRef(new Set<string>());

    // 镜号在同一场次内自增，按「场次顺序 + 镜号」排列，和导出顺序一致。
    const sceneOrder = new Map(project.scenes.map((scene, index) => [scene.id, index]));
    const shots = [...project.shots].sort((a, b) => (sceneOrder.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER) - (sceneOrder.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
    const doneCount = shots.filter(isDone).length;
    const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

    const setError = (shotId: string, reason?: string) =>
        setErrors((prev) => {
            if (!reason) {
                if (!(shotId in prev)) return prev;
                const next = { ...prev };
                delete next[shotId];
                return next;
            }
            return { ...prev, [shotId]: reason };
        });

    // 逐镜生成：await 期间只更新自身行的 loading 与失败记录，不阻塞列表渲染。
    const runOne = async (shot: DramaShot): Promise<boolean> => {
        if (running.current.has(shot.id)) return true;
        running.current.add(shot.id);
        setError(shot.id);
        setPending((items) => (items.includes(shot.id) ? items : [...items, shot.id]));
        try {
            await onGenerate(shot);
            return true;
        } catch (error) {
            setError(shot.id, reasonOf(error));
            return false;
        } finally {
            running.current.delete(shot.id);
            setPending((items) => items.filter((id) => id !== shot.id));
        }
    };

    // 批量出图：固定并发上限 3，每条 await 完再派下一条，进度逐条累加。
    const runBatch = async () => {
        const queue = shots.filter((shot) => !isDone(shot));
        if (queue.length === 0) {
            message.info("所有镜头都已出图");
            return;
        }
        const total = queue.length;
        setErrors({});
        setProgress({ done: 0, total, failed: 0 });
        setBatching(true);
        const workers = Array.from({ length: Math.min(BATCH_LIMIT, total) }, async () => {
            for (let shot = queue.shift(); shot; shot = queue.shift()) {
                const ok = await runOne(shot);
                setProgress((prev) => ({ ...prev, done: prev.done + 1, failed: prev.failed + (ok ? 0 : 1) }));
            }
        });
        try {
            await Promise.all(workers);
        } finally {
            setBatching(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Camera className="size-4" />
                    拍摄
                    <span className="text-xs text-muted-foreground">
                        已出图 {doneCount} / {shots.length}
                    </span>
                </div>
                <Button size="small" type="primary" icon={<Images className="size-3.5" />} loading={batching} onClick={() => void runBatch()}>
                    批量出图
                </Button>
            </div>

            {progress.total > 0 ? (
                <div className="flex items-center gap-3">
                    <Progress className="m-0 flex-1" percent={percent} size="small" showInfo={false} status={batching ? "active" : progress.failed > 0 ? "exception" : "success"} />
                    <span className="shrink-0 text-xs text-muted-foreground">
                        已完成 {progress.done} / 共 {progress.total}
                        {progress.failed > 0 ? ` · 失败 ${progress.failed} 镜` : ""}
                    </span>
                </div>
            ) : null}

            {shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有镜头，先去「分镜」里加几镜" />
            ) : (
                <section className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                    {shots.map((shot: DramaShot) => {
                        const failure = errors[shot.id];
                        const loading = pending.includes(shot.id);
                        const thumbnail = shot.output?.imageUrl;
                        return (
                            <div key={shot.id} className="flex items-center gap-4 border-b border-black/5 px-4 py-3 last:border-b-0 dark:border-white/10">
                                <div className="w-10 shrink-0 text-xs text-muted-foreground">镜 {shot.index}</div>
                                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/10">
                                    {thumbnail ? <img src={thumbnail} alt={`镜 ${shot.index}`} className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">{shot.dialogue || shot.prompt || "（空镜头）"}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                        {project.scenes.find((scene) => scene.id === shot.sceneId)?.name ?? "未分配场次"} · {shot.shotSize} · {shot.durationSec}s · {shot.cast.length} 人
                                    </div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1">
                                    <Tag className="me-0" color={STATUS_COLOR[shot.status] ?? "default"}>
                                        {shot.status}
                                    </Tag>
                                    {failure ? (
                                        <Tag className="me-0 max-w-48 truncate" color="red" title={failure}>
                                            失败：{failure}
                                        </Tag>
                                    ) : null}
                                </div>
                                {failure ? (
                                    <Button size="small" icon={<RotateCcw className="size-3.5" />} loading={loading} disabled={batching} onClick={() => void runOne(shot)}>
                                        重试
                                    </Button>
                                ) : (
                                    <Button size="small" loading={loading} disabled={batching} onClick={() => void runOne(shot)}>
                                        {isDone(shot) ? "重出" : "出图"}
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </section>
            )}
        </div>
    );
}

import { App, Button, Empty, Tag } from "antd";
import { Camera, Image as ImageIcon, Images } from "lucide-react";
import { useState } from "react";

import type { DramaProject, DramaShot } from "@/types/drama";

const BATCH_LIMIT = 3;

const isDone = (shot: DramaShot) => shot.status === "已出图" || shot.status === "已出片";

export function ShootPanel({ project, onGenerate }: { project: DramaProject; onGenerate: (shot: DramaShot) => void | Promise<void> }) {
    const { message } = App.useApp();
    const [pending, setPending] = useState<string[]>([]);
    const [batching, setBatching] = useState(false);

    // 镜号在同一场次内自增，按「场次顺序 + 镜号」排列，和导出顺序一致。
    const sceneOrder = new Map(project.scenes.map((scene, index) => [scene.id, index]));
    const shots = [...project.shots].sort((a, b) => (sceneOrder.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER) - (sceneOrder.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
    const doneCount = shots.filter(isDone).length;

    const runOne = async (shot: DramaShot) => {
        setPending((items) => (items.includes(shot.id) ? items : [...items, shot.id]));
        try {
            await onGenerate(shot);
        } catch (error) {
            message.error(`镜 ${shot.index} 出图失败：${error instanceof Error ? error.message : "未知错误"}`);
        } finally {
            setPending((items) => items.filter((id) => id !== shot.id));
        }
    };

    // 批量出图：固定并发上限 3，逐条调用 onGenerate。
    const runBatch = async () => {
        const queue = shots.filter((shot) => !isDone(shot));
        if (queue.length === 0) {
            message.info("所有镜头都已出图");
            return;
        }
        setBatching(true);
        const workers = Array.from({ length: Math.min(BATCH_LIMIT, queue.length) }, async () => {
            let next = queue.shift();
            while (next) {
                await runOne(next);
                next = queue.shift();
            }
        });
        await Promise.all(workers);
        setBatching(false);
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

            {shots.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有镜头，先去「分镜」里加几镜" />
            ) : (
                <section className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                    {shots.map((shot: DramaShot) => (
                        <div key={shot.id} className="flex items-center gap-4 border-b border-black/5 px-4 py-3 last:border-b-0 dark:border-white/10">
                            <div className="w-10 shrink-0 text-xs text-muted-foreground">镜 {shot.index}</div>
                            <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/10 bg-black/5 dark:border-white/15 dark:bg-white/10">
                                {shot.output?.imageUrl ? <img src={shot.output.imageUrl} alt={`镜 ${shot.index}`} className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm">{shot.dialogue || shot.prompt || "（空镜头）"}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                    {project.scenes.find((scene) => scene.id === shot.sceneId)?.name ?? "未分配场次"} · {shot.shotSize} · {shot.durationSec}s · {shot.cast.length} 人
                                </div>
                            </div>
                            <Tag className="me-0" color={isDone(shot) ? "green" : "default"}>
                                {isDone(shot) ? "已出图" : "待拍"}
                            </Tag>
                            <Button size="small" loading={pending.includes(shot.id)} disabled={batching} onClick={() => void runOne(shot)}>
                                {isDone(shot) ? "重出" : "出图"}
                            </Button>
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}

import { App, Button, Drawer, Empty, Spin, Tag } from "antd";
import { RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { hostedApi, type HostedGenerationTask } from "@/services/api/hosted";

const statusMeta: Record<HostedGenerationTask["status"], { text: string; color: string }> = {
    queued: { text: "排队中", color: "default" },
    running: { text: "生成中", color: "processing" },
    succeeded: { text: "已完成", color: "success" },
    failed: { text: "失败", color: "error" },
    cancelled: { text: "已取消", color: "warning" },
};

const capabilityLabels: Record<string, string> = { image: "图片", video: "视频", text: "文本", audio: "音频" };

type Props = { open: boolean; onClose: () => void };

// 托管生成现在是入队执行，这个抽屉负责让用户看到排队与进度，并能取消。
export function GenerationTaskDrawer({ open, onClose }: Props) {
    const { message } = App.useApp();
    const [items, setItems] = useState<HostedGenerationTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [cancelling, setCancelling] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await hostedApi.generationTasks({ limit: 30 })).items);
        } catch {
            // 抽屉是辅助视图，读取失败不打断用户当前操作。
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void load();
        const timer = window.setInterval(() => void load(), 3000);
        return () => window.clearInterval(timer);
    }, [load, open]);

    const cancel = async (task: HostedGenerationTask) => {
        setCancelling(task.id);
        try {
            await hostedApi.cancelGenerationTask(task.id);
            message.success("已取消并释放额度");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "取消失败");
        } finally {
            setCancelling(null);
        }
    };

    const active = items.filter((item) => item.status === "queued" || item.status === "running").length;

    return (
        <Drawer
            title={`任务中心${active ? `（${active} 个进行中）` : ""}`}
            placement="right"
            size={420}
            open={open}
            onClose={onClose}
            extra={
                <Button size="small" type="text" icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading}>
                    刷新
                </Button>
            }
        >
            {loading && items.length === 0 ? (
                <div className="flex h-40 items-center justify-center">
                    <Spin />
                </div>
            ) : items.length === 0 ? (
                <Empty description="还没有生成任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <div className="space-y-2">
                    {items.map((task) => {
                        const meta = statusMeta[task.status];
                        const running = task.status === "queued" || task.status === "running";
                        return (
                            <div key={task.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-sm">
                                        <Tag className="!m-0">{capabilityLabels[task.capability] || task.capability}</Tag>
                                        <Tag className="!m-0" color={meta.color}>
                                            {meta.text}
                                        </Tag>
                                    </div>
                                    {running ? (
                                        <Button size="small" type="text" danger loading={cancelling === task.id} icon={<X className="size-3.5" />} onClick={() => void cancel(task)}>
                                            取消
                                        </Button>
                                    ) : null}
                                </div>
                                <div className="mt-1 text-xs text-stone-400">{new Date(task.createdAt).toLocaleString()}</div>
                                {task.errorMessage ? <p className="mt-1 text-xs text-red-500">{task.errorMessage}</p> : null}
                            </div>
                        );
                    })}
                </div>
            )}
        </Drawer>
    );
}

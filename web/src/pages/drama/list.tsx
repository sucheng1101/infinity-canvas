import { App, Button, Empty, Popconfirm, Select, Spin, Tag } from "antd";
import { Clapperboard, Film, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useDramaStore } from "@/stores/drama/use-drama-store";
import type { DramaProject, DramaWorld } from "@/types/drama";

const WORLD_OPTIONS: Array<{ value: DramaWorld; label: string }> = [
    { value: "cultivation", label: "修行" },
    { value: "urban", label: "都市" },
];

const formatTime = (time: number) => (time ? new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function DramaListPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { projects, hydrated, createProject, deleteProject } = useDramaStore();
    const [world, setWorld] = useState<DramaWorld>("cultivation");

    const items: DramaProject[] = projects;

    const createDrama = () => {
        const id = createProject(`未命名短剧 ${items.length + 1}`, world);
        navigate(`/drama/${id}`);
    };

    const removeDrama = (project: DramaProject) => {
        deleteProject(project.id);
        message.success(`已删除「${project.title}」`);
    };

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black/10 pb-6 dark:border-white/15">
                    <div>
                        <p className="text-xs text-muted-foreground">SHORT DRAMA</p>
                        <h1 className="mt-2 text-2xl font-semibold">短剧</h1>
                        <p className="mt-1 text-sm text-muted-foreground">定妆 → 分镜 → 预演 → 拍摄 → 成片，全流程在一个工作台里完成。</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Select<DramaWorld> value={world} onChange={setWorld} options={WORLD_OPTIONS} className="w-28" aria-label="世界观" />
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={createDrama}>
                            新建短剧
                        </Button>
                    </div>
                </header>

                {!hydrated ? (
                    <div className="flex h-60 items-center justify-center">
                        <Spin />
                    </div>
                ) : items.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-16" description="还没有短剧，选好世界观后点「新建短剧」">
                        <Button type="primary" icon={<Clapperboard className="size-4" />} onClick={createDrama}>
                            新建短剧
                        </Button>
                    </Empty>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map((project: DramaProject) => (
                            <div
                                key={project.id}
                                onClick={() => navigate(`/drama/${project.id}`)}
                                className="group cursor-pointer rounded-xl border border-black/10 bg-card p-4 transition hover:border-black/25 dark:border-white/15 dark:hover:border-white/30"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-base font-medium">{project.title}</h2>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                            <Tag className="me-0" color={project.world === "cultivation" ? "purple" : "blue"}>
                                                {project.world === "cultivation" ? "修行" : "都市"}
                                            </Tag>
                                            <span className="flex items-center gap-1">
                                                <Film className="size-3.5" />
                                                {project.shots.length} 个镜头
                                            </span>
                                        </div>
                                    </div>
                                    <span onClick={(event) => event.stopPropagation()}>
                                        <Popconfirm title="删除这个短剧？" description="分镜、角色与本地素材都会一并删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeDrama(project)}>
                                            <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} aria-label="删除短剧" />
                                        </Popconfirm>
                                    </span>
                                </div>
                                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                                    <span>
                                        {project.characters.length} 角色 · {project.scenes.length} 场次
                                    </span>
                                    <span>更新于 {formatTime(project.updatedAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

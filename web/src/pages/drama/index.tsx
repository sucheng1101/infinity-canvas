import { App, Button, Empty, Popconfirm } from "antd";
import { Clapperboard, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

// 短剧入口：只列 kind 为 drama 的画布项目，新建后直接打开分镜。
export default function DramaPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const allProjects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const dramas = allProjects.filter((project) => project.kind === "drama");

    const createDrama = () => {
        const id = createProject(`未命名短剧 ${dramas.length + 1}`, { kind: "drama" });
        navigate(`/canvas/${id}?storyboard=1`);
    };

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">SHORT DRAMA</p>
                        <h1 className="mt-3 text-3xl font-semibold">短剧</h1>
                        <p className="mt-2 text-sm text-stone-500">贴剧本 → AI 拆成分镜 → 逐镜出图配音 → 导出工程包。</p>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={createDrama}>
                        新建短剧
                    </Button>
                </header>

                {dramas.length === 0 ? (
                    <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有短剧项目，点「新建短剧」开始">
                        <Button type="primary" icon={<Clapperboard className="size-4" />} onClick={createDrama}>
                            新建短剧
                        </Button>
                    </Empty>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {dramas.map((project) => (
                            <div key={project.id} className="relative">
                                <CanvasProjectCard project={project} />
                                <Popconfirm title="删除这个短剧？" description="分镜与本地图片都会一并删除。" onConfirm={() => useCanvasStore.getState().deleteProjects([project.id])}>
                                    <Button size="small" type="text" danger className="absolute right-2 top-2" icon={<Trash2 className="size-4" />} />
                                </Popconfirm>
                            </div>                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}

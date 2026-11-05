import { App, Button, Empty, Input, Tag } from "antd";
import { Box, Camera, ChevronLeft, Clapperboard, Film, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useDramaStore } from "@/stores/drama/use-drama-store";
import type { DramaProject, DramaShot } from "@/types/drama";
import { CastPanel } from "./components/cast-panel";
import { ShootPanel } from "./components/shoot-panel";
import { ShotTable } from "./components/shot-table";

const STEPS = [
    { key: "cast", label: "定妆", icon: UserRound },
    { key: "shots", label: "分镜", icon: Clapperboard },
    { key: "preview", label: "预演", icon: Box },
    { key: "shoot", label: "拍摄", icon: Camera },
    { key: "final", label: "成片", icon: Film },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export default function DramaWorkbenchPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const { projects, updateProject } = useDramaStore();
    const project = projects.find((item) => item.id === id);
    const [step, setStep] = useState<StepKey>("shots");
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");

    if (!project) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="短剧不存在，可能已被删除" />
                <Button icon={<ChevronLeft className="size-4" />} onClick={() => navigate("/drama")}>
                    返回列表
                </Button>
            </div>
        );
    }

    const commitTitle = () => {
        const title = titleDraft.trim();
        if (title && title !== project.title) updateProject(project.id, { title });
        setEditingTitle(false);
    };

    // 出图逻辑由外层接入，这里只做入口占位。
    const handleGenerate = async (shot: DramaShot) => {
        message.info(`镜 ${shot.index} 的出图流程待接入`);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
            <header className="flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-3 dark:border-white/15 sm:px-6">
                <Button type="text" size="small" icon={<ChevronLeft className="size-4" />} onClick={() => navigate("/drama")}>
                    列表
                </Button>
                <div className="flex min-w-0 items-center gap-2">
                    {editingTitle ? (
                        <Input size="small" autoFocus value={titleDraft} className="max-w-64" onChange={(event) => setTitleDraft(event.target.value)} onBlur={commitTitle} onPressEnter={commitTitle} />
                    ) : (
                        <h1
                            className="truncate text-base font-semibold sm:text-lg"
                            title="双击改名"
                            onDoubleClick={() => {
                                setTitleDraft(project.title);
                                setEditingTitle(true);
                            }}
                        >
                            {project.title}
                        </h1>
                    )}
                    <Tag className="me-0" color={project.world === "cultivation" ? "purple" : "blue"}>
                        {project.world === "cultivation" ? "修行" : "都市"}
                    </Tag>
                </div>
                <div className="ms-auto flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{project.shots.length} 个镜头</span>
                    <Button size="small" onClick={() => navigate(`/canvas/${project.canvasProjectId || project.id}`)}>
                        回画布
                    </Button>
                </div>
            </header>

            <div className="flex min-h-0 flex-1">
                <nav className="flex w-28 shrink-0 flex-col gap-1 border-r border-black/10 p-2 dark:border-white/15 sm:w-32 sm:p-3">
                    {STEPS.map((item) => {
                        const Icon = item.icon;
                        const active = step === item.key;
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setStep(item.key)}
                                className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition", active ? "bg-black/5 font-medium dark:bg-white/10" : "text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10")}
                            >
                                <Icon className="size-4" />
                                {item.label}
                            </button>
                        );
                    })}
                </nav>

                <main className="min-w-0 flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
                        {step === "cast" ? <CastPanel project={project} /> : null}
                        {step === "shots" ? <ShotTable project={project} /> : null}
                        {step === "shoot" ? <ShootPanel project={project} onGenerate={handleGenerate} /> : null}
                        {step === "preview" ? <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description="预演引擎（白模 + 运镜）待接入" /> : null}
                        {step === "final" ? <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description="成片合成与导出待接入" /> : null}
                    </div>
                </main>
            </div>
        </div>
    );
}

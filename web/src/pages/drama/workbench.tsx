import { FileText, Sparkles } from "lucide-react";
import { App, Button, Empty, Input, Select, Tag } from "antd";
import { saveAs } from "file-saver";
import { PrevisCanvas } from "@/components/drama/previs/previs-canvas";
import { exportDramaBackup } from "@/lib/drama/backup";
import { buildStoryboardPrompt, parseStoryboard } from "@/lib/canvas/storyboard-parse";
import { executeHostedGeneration } from "@/services/api/hosted-generation";
import { generateShotImage } from "@/lib/drama/render/shoot";
import { Box, Camera, ChevronLeft, Clapperboard, Film, UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useDramaStore } from "@/stores/drama/use-drama-store";
import type { DramaProject, DramaSceneTemplateId, DramaShot, DramaShotSize } from "@/types/drama";
import { CastPanel } from "./components/cast-panel";
import { ShootPanel } from "./components/shoot-panel";
import { ShotTable } from "./components/shot-table";

const STEPS = [
    { key: "script", label: "剧本", icon: FileText },
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
    const { projects, updateProject, updateShot, addScene, addShot } = useDramaStore();
    const project = projects.find((item) => item.id === id);
    const [step, setStep] = useState<StepKey>("script");
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

    // 单镜出图：走托管图片模型，成功后把状态与结果写回镜头。
    const handleGenerate = async (shot: DramaShot) => {
        try {
            const scene = project.scenes.find((item) => item.id === shot.sceneId);
            const imageUrl = await generateShotImage({ shot, characters: project.characters, scene });
            updateShot(project.id, shot.id, { status: "已出图", output: { ...shot.output, imageUrl } });
            message.success(`镜 ${shot.index} 已出图`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : `镜 ${shot.index} 出图失败`);
            // 继续抛给 ShootPanel：批量出图要靠它标注失败镜头并给出重试，不能静默吞掉。
            throw error;
        }
    };

    // 场景关键词 → 白模模板：先规则匹配，匹配不到落空场，用户再改。
    const templateFor = (text: string): DramaSceneTemplateId => {
        const value = text.toLowerCase();
        if (/殿|宫|朝堂|山门/.test(value)) return "palace";
        if (/办公室|工位|会议室|公司/.test(value)) return "office";
        if (/公寓|卧室|客厅|家中|家里/.test(value)) return "apartment";
        if (/店铺|柜台|便利店|咖啡馆|店内/.test(value)) return "shop";
        if (/街|巷|路|马路|广场/.test(value)) return project.world === "urban" ? "urban_street" : "street";
        if (/室内|房|屋|厅/.test(value)) return "indoor";
        return "empty";
    };

    const [splitting, setSplitting] = useState(false);
    // 剧本 → 场次 + 镜头，一次落库；场景卡按场次描述自动选白模模板。
    const handleSplit = async () => {
        const script = (scriptDraft || project?.script || "").trim();
        if (!script) {
            message.warning("先写剧本或粘一段小说");
            return;
        }
        setSplitting(true);
        try {
            const output = await executeHostedGeneration({ capability: "text", payload: { messages: [{ role: "user", content: buildStoryboardPrompt(script) }] } });
            const raw = typeof output.content === "string" ? output.content : JSON.stringify(output);
            const scenes = parseStoryboard(raw);
            for (const scene of scenes) {
                const sceneId = addScene(project.id, { name: scene.name, templateId: templateFor(`${scene.name} ${scene.summary}`), world: project.world, size: { x: 30, z: 12 } });
                for (const shot of scene.shots) {
                    addShot(project.id, sceneId, { shotSize: (shot.shotSize || "中景") as DramaShotSize, durationSec: shot.durationSec, dialogue: shot.dialogue, prompt: shot.prompt });
                }
            }
            updateProject(project.id, { script });
            setStep("shots");
            message.success(`已拆出 ${scenes.length} 个场次`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "拆分镜失败");
        } finally {
            setSplitting(false);
        }
    };
    const [previsShotId, setPrevisShotId] = useState<string>("");
    const [scriptDraft, setScriptDraft] = useState(project?.script ?? "");
    const [backuping, setBackuping] = useState(false);
    const previsShot = project.shots.find((item) => item.id === previsShotId) ?? project.shots[0];

    const handleBackup = async () => {
        setBackuping(true);
        try {
            const blob = await exportDramaBackup(project);
            saveAs(blob, `${project.title || "drama"}.icdrama.zip`);
            message.success("备份已导出（只含场景与镜头，不含生成结果）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "备份导出失败");
        } finally {
            setBackuping(false);
        }
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
                        {step === "script" ? (
                            <div className="flex h-full min-h-0 flex-col gap-3 p-4">
                                <p className="text-sm text-muted-foreground">先写剧本（也可以粘一段小说）。下一步 AI 会按它拆出场次与镜头。</p>
                                <Input.TextArea
                                    className="min-h-0 flex-1"
                                    value={scriptDraft}
                                    onChange={(event) => setScriptDraft(event.target.value)}
                                    onBlur={() => updateProject(project.id, { script: scriptDraft })}
                                    placeholder="例如：雨夜，女主在长街尽头等人。远处车灯扫过，她抬头，看见熟悉的身影。"
                                />
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">已自动保存到本地，换电脑时随备份一起带走。</span>
                                    <Button type="primary" icon={<Sparkles className="size-4" />} loading={splitting} onClick={() => void handleSplit()}>
                                        AI 拆分镜
                                    </Button>
                                </div>
                            </div>
                        ) : null}{" "}
                        {step === "shoot" ? <ShootPanel project={project} onGenerate={handleGenerate} /> : null}
                        {step === "preview" ? (
                            <div className="flex h-full min-h-0 flex-col gap-2 p-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">镜头</span>
                                    <Select size="small" className="w-64" value={previsShot?.id} onChange={setPrevisShotId} options={project.shots.map((item) => ({ value: item.id, label: `镜 ${item.index} · ${item.shotSize} · ${item.durationSec}s` }))} />
                                </div>
                                {previsShot ? (
                                    <div className="min-h-0 flex-1">
                                        <PrevisCanvas project={project} shot={previsShot} onCameraChange={(keys) => updateShot(project.id, previsShot.id, { camera: { ...previsShot.camera, keys }, status: "已预演" })} />
                                    </div>
                                ) : (
                                    <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description="先到「分镜」建一个镜头" />
                                )}
                            </div>
                        ) : null}
                        {step === "final" ? (
                            <div className="flex flex-col items-center gap-4 py-16">
                                <p className="text-sm text-muted-foreground">导出的是整部短剧的工程备份：场景布局、角色、镜头与机位，不含生成的图片和视频。</p>
                                <Button type="primary" loading={backuping} onClick={() => void handleBackup()}>
                                    导出备份（.icdrama.zip）
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </main>
            </div>
        </div>
    );
}

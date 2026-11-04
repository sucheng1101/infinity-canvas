import { App, Button, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Spin, Tag } from "antd";
import { Download, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { saveAs } from "file-saver";
import { exportJianyingDraft, exportStoryboardPackage, type ExportShot } from "@/lib/canvas/export-storyboard";
import type { ParsedScene } from "@/lib/canvas/storyboard-parse";
import { storyboardApi, type SceneInput, type ShotInput, type StoryboardScene, type StoryboardShot } from "@/services/api/storyboard";

type ShotFormValues = { durationSec: number; shotSize: string; camera: string; dialogue: string; prompt: string };
type SceneFormValues = { name: string; summary: string };

const SHOT_SIZES = ["特写", "近景", "中景", "全景", "远景"];
const CAMERAS = ["固定", "推", "拉", "摇", "移", "跟随", "环绕", "升降", "手持", "航拍"];

const defaultShot: ShotFormValues = { durationSec: 4, shotSize: "中景", camera: "固定", dialogue: "", prompt: "" };
const emptyScene: SceneFormValues = { name: "", summary: "" };

type Props = {
    projectId: string;
    onInsertShot: (shot: StoryboardShot) => void;
    open?: boolean;
    onClose?: () => void;
    // 由调用方按 imageNodeId / videoNodeId 找到画布节点上的媒体地址。
    resolveMedia?: (shot: StoryboardShot) => { imageUrl?: string; videoUrl?: string } | Promise<{ imageUrl?: string; videoUrl?: string }>;
    // 由调用方接文本模型，把剧本拆成分镜后回给面板落库。
    onGenerateFromScript?: (script: string) => Promise<ParsedScene[]>;
};

const selectOptions = (values: string[]) => values.map((value) => ({ value, label: value }));

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

// 分镜抽屉：场次分组展示镜头，增删改直接落库，镜头落画布交给调用方。
export function StoryboardPanel({ projectId, onInsertShot, open, onClose, resolveMedia, onGenerateFromScript }: Props) {
    const { message } = App.useApp();
    const [scenes, setScenes] = useState<StoryboardScene[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selfOpen, setSelfOpen] = useState(true);
    const [sceneForm] = Form.useForm<SceneFormValues>();
    const [shotForm] = Form.useForm<ShotFormValues>();
    const [sceneOpen, setSceneOpen] = useState(false);
    const [sceneTarget, setSceneTarget] = useState<StoryboardScene | null>(null);
    const [shotOpen, setShotOpen] = useState(false);
    const [shotTarget, setShotTarget] = useState<{ sceneId: string; shot?: StoryboardShot } | null>(null);
    const visible = open ?? selfOpen;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setScenes((await storyboardApi.scenes(projectId)).items);
        } catch (error) {
            message.error(errorText(error, "分镜读取失败"));
        } finally {
            setLoading(false);
        }
    }, [message, projectId]);

    useEffect(() => {
        if (visible) void load();
    }, [load, visible]);

    useEffect(() => {
        if (sceneOpen) sceneForm.setFieldsValue(sceneTarget ? { name: sceneTarget.name, summary: sceneTarget.summary } : emptyScene);
    }, [sceneForm, sceneOpen, sceneTarget]);

    useEffect(() => {
        if (!shotOpen) return;
        const shot = shotTarget?.shot;
        shotForm.setFieldsValue(shot ? { durationSec: shot.durationSec, shotSize: shot.shotSize || defaultShot.shotSize, camera: shot.camera || defaultShot.camera, dialogue: shot.dialogue || "", prompt: shot.prompt || "" } : defaultShot);
    }, [shotForm, shotOpen, shotTarget]);

    const close = () => {
        setSelfOpen(false);
        onClose?.();
    };

    const openSceneForm = (scene?: StoryboardScene) => {
        setSceneTarget(scene ?? null);
        setSceneOpen(true);
    };

    const openShotForm = (sceneId: string, shot?: StoryboardShot) => {
        setShotTarget({ sceneId, shot });
        setShotOpen(true);
    };

    const submitScene = async () => {
        const values = await sceneForm.validateFields().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const input: SceneInput = { name: values.name.trim(), summary: values.summary?.trim() || "" };
            if (sceneTarget) await storyboardApi.updateScene(sceneTarget.id, input);
            else await storyboardApi.createScene(projectId, input);
            message.success(sceneTarget ? "场次已更新" : "场次已创建");
            setSceneOpen(false);
            await load();
        } catch (error) {
            message.error(errorText(error, "场次保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const submitShot = async () => {
        const values = await shotForm.validateFields().catch(() => null);
        if (!values || !shotTarget) return;
        setSaving(true);
        try {
            const input: ShotInput = { durationSec: values.durationSec, shotSize: values.shotSize, camera: values.camera, dialogue: values.dialogue?.trim() || "", prompt: values.prompt?.trim() || "" };
            if (shotTarget.shot) await storyboardApi.updateShot(shotTarget.shot.id, input);
            else await storyboardApi.createShot(shotTarget.sceneId, input);
            message.success(shotTarget.shot ? "镜头已更新" : "镜头已添加");
            setShotOpen(false);
            await load();
        } catch (error) {
            message.error(errorText(error, "镜头保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const removeScene = async (scene: StoryboardScene) => {
        try {
            await storyboardApi.removeScene(scene.id);
            message.success("场次已删除");
            await load();
        } catch (error) {
            message.error(errorText(error, "场次删除失败"));
        }
    };

    const removeShot = async (shot: StoryboardShot) => {
        try {
            await storyboardApi.removeShot(shot.id);
            message.success("镜头已删除");
            await load();
        } catch (error) {
            message.error(errorText(error, "镜头删除失败"));
        }
    };

    const [exporting, setExporting] = useState(false);
    const exportPackage = async (mode: "package" | "draft" = "package") => {
        const flat: ExportShot[] = [];
        for (const scene of scenes) {
            for (const shot of scene.shots) {
                const media = resolveMedia ? await resolveMedia(shot) : undefined;
                flat.push({
                    index: flat.length + 1,
                    sceneName: scene.name,
                    durationSec: shot.durationSec,
                    dialogue: shot.dialogue,
                    prompt: shot.prompt,
                    imageUrl: media?.imageUrl,
                    videoUrl: media?.videoUrl,
                    assetRefs: shot.assetRefs,
                });
            }
        }
        if (flat.length === 0) {
            message.warning("还没有镜头可以导出");
            return;
        }
        setExporting(true);
        try {
            const blob = mode === "draft" ? await exportJianyingDraft(projectId, flat) : await exportStoryboardPackage(projectId, flat);
            saveAs(blob, mode === "draft" ? `jianying-${projectId}.zip` : `storyboard-${projectId}.zip`);
            message.success(mode === "draft" ? `已导出剪映草稿（${flat.length} 个镜头）` : `已导出 ${flat.length} 个镜头的工程包`);
        } catch (error) {
            message.error(errorText(error, "导出失败"));
        } finally {
            setExporting(false);
        }
    };
    const [scriptOpen, setScriptOpen] = useState(false);
    const [scriptText, setScriptText] = useState("");
    const [generating, setGenerating] = useState(false);
    const generateFromScript = async () => {
        if (!onGenerateFromScript) return;
        if (!scriptText.trim()) {
            message.warning("先把剧本贴进来");
            return;
        }
        setGenerating(true);
        try {
            const parsed = await onGenerateFromScript(scriptText);
            for (const scene of parsed) {
                const created = await storyboardApi.createScene(projectId, { name: scene.name, summary: scene.summary });
                for (const shot of scene.shots) {
                    await storyboardApi.createShot(created.id, { durationSec: shot.durationSec, shotSize: shot.shotSize, camera: shot.camera, dialogue: shot.dialogue, prompt: shot.prompt });
                }
            }
            setScriptOpen(false);
            setScriptText("");
            await load();
            message.success(`已生成 ${parsed.length} 个场次`);
        } catch (error) {
            message.error(errorText(error, "生成分镜失败"));
        } finally {
            setGenerating(false);
        }
    };
    return (
        <Drawer
            title="分镜"
            placement="right"
            size={420}
            open={visible}
            onClose={close}
            extra={
                <div className="flex items-center gap-2">
                    <Button size="small" icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportPackage("package")}>
                        导出工程包
                    </Button>
                    <Button size="small" type="primary" icon={<Plus className="size-4" />} onClick={() => openSceneForm()}>
                        新增场次
                    </Button>
                </div>
            }
        >
            {loading && scenes.length === 0 ? (
                <div className="flex h-40 items-center justify-center">
                    <Spin />
                </div>
            ) : scenes.length === 0 ? (
                <Empty description="还没有场次，先新增一个" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <div className="space-y-4">
                    {scenes.map((scene) => (
                        <section key={scene.id} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
                            <header className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium">{scene.name}</span>
                                        <Tag className="!m-0">{scene.shots.length} 个镜头</Tag>
                                    </div>
                                    {scene.summary ? <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-60">{scene.summary}</p> : null}
                                </div>
                                <div className="flex shrink-0 items-center">
                                    <Button size="small" type="text" onClick={() => openShotForm(scene.id)}>
                                        加镜头
                                    </Button>
                                    <Button size="small" type="text" onClick={() => openSceneForm(scene)}>
                                        编辑
                                    </Button>
                                    <Popconfirm title="删除该场次？" description="场次下的镜头会一并删除。" onConfirm={() => void removeScene(scene)}>
                                        <Button size="small" type="text" danger>
                                            删除
                                        </Button>
                                    </Popconfirm>
                                </div>
                            </header>

                            {scene.shots.length === 0 ? (
                                <p className="mt-2 text-xs opacity-50">还没有镜头</p>
                            ) : (
                                <div className="mt-2 space-y-2">
                                    {scene.shots.map((shot, index) => (
                                        <div key={shot.id} className="rounded-md border border-black/5 px-2 py-1.5 dark:border-white/10">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                                                    <span className="font-semibold tabular-nums">{index + 1}</span>
                                                    <span className="opacity-60">{shot.durationSec}s</span>
                                                    <span className="opacity-30">·</span>
                                                    <span className="truncate opacity-60">
                                                        {shot.shotSize || "未设景别"} · {shot.camera || "未设运镜"}
                                                    </span>
                                                </div>
                                                <div className="flex shrink-0 items-center">
                                                    <Button size="small" type="text" onClick={() => openShotForm(scene.id, shot)}>
                                                        编辑
                                                    </Button>
                                                    <Popconfirm title="删除该镜头？" onConfirm={() => void removeShot(shot)}>
                                                        <Button size="small" type="text" danger>
                                                            删除
                                                        </Button>
                                                    </Popconfirm>
                                                    <Button size="small" type="text" onClick={() => onInsertShot(shot)}>
                                                        落到画布
                                                    </Button>
                                                </div>
                                            </div>
                                            {shot.dialogue ? <p className="mt-1 line-clamp-1 text-xs opacity-70">台词：{shot.dialogue}</p> : null}
                                            {shot.prompt ? <p className="mt-0.5 line-clamp-2 text-xs opacity-50">提示词：{shot.prompt}</p> : null}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            )}

            <Modal title={sceneTarget ? "编辑场次" : "新增场次"} open={sceneOpen} onCancel={() => setSceneOpen(false)} onOk={() => void submitScene()} confirmLoading={saving} okText="保存">
                <Form form={sceneForm} layout="vertical" className="mt-4">
                    <Form.Item name="name" label="场次名称" rules={[{ required: true, message: "请填写场次名称" }]}>
                        <Input placeholder="例如：第一场 · 雨夜街头" />
                    </Form.Item>
                    <Form.Item name="summary" label="场次摘要">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder="这场戏的时间、地点与情绪" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal title={shotTarget?.shot ? "编辑镜头" : "新增镜头"} open={shotOpen} onCancel={() => setShotOpen(false)} onOk={() => void submitShot()} confirmLoading={saving} okText="保存" width={520}>
                <Form form={shotForm} layout="vertical" className="mt-4">
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item name="durationSec" label="时长（秒）" rules={[{ required: true, message: "请填写时长" }]}>
                            <InputNumber className="w-full" min={1} max={600} precision={0} />
                        </Form.Item>
                        <Form.Item name="shotSize" label="景别">
                            <Select options={selectOptions(SHOT_SIZES)} />
                        </Form.Item>
                        <Form.Item name="camera" label="运镜">
                            <Select options={selectOptions(CAMERAS)} />
                        </Form.Item>
                    </div>
                    <Form.Item name="dialogue" label="台词">
                        <Input placeholder="这一镜的台词或旁白" />
                    </Form.Item>
                    <Form.Item name="prompt" label="提示词">
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} placeholder="画面描述，例如：中景，雨夜霓虹街头，女主撑伞回头" />
                    </Form.Item>
                </Form>
            </Modal>
            <Modal title="从剧本生成分镜" open={scriptOpen} onCancel={() => setScriptOpen(false)} onOk={() => void generateFromScript()} confirmLoading={generating} okText="生成并保存" width={640}>
                <p className="mb-2 text-xs text-stone-500">会调用当前文本模型把剧本拆成场次与镜头，结果直接写入分镜；生成后可以逐条修改。</p>
                <Input.TextArea autoSize={{ minRows: 8, maxRows: 16 }} value={scriptText} onChange={(event) => setScriptText(event.target.value)} placeholder="把剧本、分场或故事梗概贴进来" />
            </Modal>        </Drawer>
    );
}

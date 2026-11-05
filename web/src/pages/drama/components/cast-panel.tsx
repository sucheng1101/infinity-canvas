import { App, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Tag } from "antd";
import { Boxes, MapPin, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";

import { SCENE_TEMPLATES } from "@/lib/drama/scene-templates";
import { randomId } from "@/lib/utils";
import { useDramaStore } from "@/stores/drama/use-drama-store";
import type { CharacterCard, DramaProject, DramaSceneTemplate, DramaSceneTemplateId, PropCard, SceneCard } from "@/types/drama";

type EditorKind = "character" | "scene" | "prop";

type Draft = {
    name: string;
    prompt?: string;
    heightCm?: number;
    color?: string;
    templateId?: DramaSceneTemplateId;
    sizeX?: number;
    sizeY?: number;
    sizeZ?: number;
};

const TEMPLATES: DramaSceneTemplate[] = SCENE_TEMPLATES;

export function CastPanel({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const { addCharacter, updateCharacter, removeCharacter, addScene, updateScene, removeScene, updateProject } = useDramaStore();
    const [editor, setEditor] = useState<{ kind: EditorKind; id?: string } | null>(null);

    const templates = TEMPLATES.filter((item) => item.world === "any" || item.world === project.world);
    const editorTitle = editor?.kind === "character" ? (editor.id ? "编辑角色" : "新增角色") : editor?.kind === "scene" ? (editor.id ? "编辑场景" : "新增场景") : editor?.id ? "编辑道具" : "新增道具";

    const openCharacter = (card?: CharacterCard) => {
        form.setFieldsValue(card ? { name: card.name, prompt: card.prompt, heightCm: card.heightCm, color: card.color } : { name: "", prompt: "", heightCm: 170, color: "#9ca3af" });
        setEditor({ kind: "character", id: card?.id });
    };

    const openScene = (card?: SceneCard) => {
        // 编辑时按全量模板解析，避免世界观过滤后找不到模板而把场景换成别的模板。
        const template = card ? TEMPLATES.find((item) => item.id === card.templateId) : templates[0];
        form.setFieldsValue({ name: card?.name ?? template?.name ?? "", templateId: card?.templateId ?? template?.id });
        setEditor({ kind: "scene", id: card?.id });
    };

    const openProp = (card?: PropCard) => {
        form.setFieldsValue(card ? { name: card.name, sizeX: card.size[0], sizeY: card.size[1], sizeZ: card.size[2] } : { name: "", sizeX: 0.6, sizeY: 0.6, sizeZ: 0.6 });
        setEditor({ kind: "prop", id: card?.id });
    };

    const submit = async () => {
        if (!editor) return;
        const values = (await form.validateFields().catch(() => null)) as Draft | null;
        if (!values) return;
        const { kind, id } = editor;

        if (kind === "character") {
            const patch = { name: values.name, prompt: values.prompt ?? "", heightCm: values.heightCm ?? 170, color: values.color ?? "#9ca3af" };
            if (id) updateCharacter(project.id, id, patch);
            else addCharacter(project.id, patch);
        }

        if (kind === "scene") {
            const template = TEMPLATES.find((item) => item.id === values.templateId) ?? templates[0];
            const patch = { name: values.name || template?.name || "新场景", templateId: template?.id ?? "empty", size: template ? { ...template.size } : { x: 6, z: 6 } };
            if (id) updateScene(project.id, id, patch);
            else addScene(project.id, { ...patch, world: project.world });
        }

        if (kind === "prop") {
            const size: [number, number, number] = [values.sizeX ?? 0.6, values.sizeY ?? 0.6, values.sizeZ ?? 0.6];
            const nextProps = id ? project.props.map((item) => (item.id === id ? { ...item, name: values.name, size } : item)) : [...project.props, { id: randomId(), name: values.name, size }];
            updateProject(project.id, { props: nextProps });
        }

        setEditor(null);
        message.success("已保存");
    };

    return (
        <div className="flex flex-col gap-8">
            <section>
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <UserRound className="size-4" />
                        角色
                        <span className="text-xs text-muted-foreground">{project.characters.length}</span>
                    </div>
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => openCharacter()}>
                        新增角色
                    </Button>
                </div>
                {project.characters.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有角色，先给主角定妆" />
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {project.characters.map((card: CharacterCard) => (
                            <div key={card.id} className="rounded-xl border border-black/10 bg-card p-3 dark:border-white/15">
                                <div className="flex items-start gap-3">
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-medium text-white" style={{ backgroundColor: card.color }}>
                                        {card.name.slice(0, 1) || "角"}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="truncate text-sm font-medium">{card.name}</span>
                                            <span className="flex shrink-0 items-center">
                                                <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="编辑角色" onClick={() => openCharacter(card)} />
                                                <Popconfirm title="删除这个角色？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeCharacter(project.id, card.id)}>
                                                    <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除角色" />
                                                </Popconfirm>
                                            </span>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{card.prompt || "未填写固定描述"}</p>
                                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                            <span>{card.heightCm} cm</span>
                                            <span className="flex items-center gap-1">
                                                <span className="inline-block size-2.5 rounded-full border border-black/10 dark:border-white/20" style={{ backgroundColor: card.color }} />
                                                {card.color}
                                            </span>
                                            <span>参考图 {card.refImages.length} 张</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <MapPin className="size-4" />
                        场景
                        <span className="text-xs text-muted-foreground">{project.scenes.length}</span>
                    </div>
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => openScene()} disabled={templates.length === 0}>
                        新增场景
                    </Button>
                </div>
                {project.scenes.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有场景，从模板里挑一个" />
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {project.scenes.map((card: SceneCard) => (
                            <div key={card.id} className="rounded-xl border border-black/10 bg-card p-3 dark:border-white/15">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium">{card.name}</span>
                                            <Tag className="me-0" color="default">
                                                {TEMPLATES.find((item) => item.id === card.templateId)?.name ?? card.templateId}
                                            </Tag>
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            {card.size.x} × {card.size.z} m · {card.world === "cultivation" ? "修行" : "都市"}
                                        </div>
                                    </div>
                                    <span className="flex shrink-0 items-center">
                                        <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="编辑场景" onClick={() => openScene(card)} />
                                        <Popconfirm title="删除这个场景？" description="场景里的镜头会一并删除。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeScene(project.id, card.id)}>
                                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除场景" />
                                        </Popconfirm>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section>
                <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <Boxes className="size-4" />
                        道具
                        <span className="text-xs text-muted-foreground">{project.props.length}</span>
                    </div>
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => openProp()}>
                        新增道具
                    </Button>
                </div>
                {project.props.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有道具" />
                ) : (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {project.props.map((card: PropCard) => (
                            <div key={card.id} className="rounded-xl border border-black/10 bg-card p-3 dark:border-white/15">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{card.name}</div>
                                        <div className="mt-2 text-xs text-muted-foreground">
                                            {card.size[0]} × {card.size[1]} × {card.size[2]} m
                                        </div>
                                    </div>
                                    <span className="flex shrink-0 items-center">
                                        <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="编辑道具" onClick={() => openProp(card)} />
                                        <Popconfirm title="删除这个道具？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => updateProject(project.id, { props: project.props.filter((item) => item.id !== card.id) })}>
                                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除道具" />
                                        </Popconfirm>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <Modal forceRender open={Boolean(editor)} title={editorTitle} okText="保存" cancelText="取消" onOk={submit} onCancel={() => setEditor(null)} destroyOnHidden={false}>
                <Form form={form} layout="vertical" className="pt-2">
                    {editor?.kind === "character" ? (
                        <>
                            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写角色名称" }]}>
                                <Input placeholder="例如：沈砚" maxLength={24} />
                            </Form.Item>
                            <Form.Item name="prompt" label="固定描述">
                                <Input.TextArea rows={3} placeholder="外貌、服饰、气质，会拼进出图提示词" maxLength={400} showCount />
                            </Form.Item>
                            <div className="grid grid-cols-2 gap-3">
                                <Form.Item name="heightCm" label="身高 (cm)">
                                    <InputNumber min={50} max={260} step={1} className="w-full" />
                                </Form.Item>
                                <Form.Item name="color" label="标识色">
                                    <Input type="color" className="h-8 w-full p-1" />
                                </Form.Item>
                            </div>
                        </>
                    ) : null}

                    {editor?.kind === "scene" ? (
                        <>
                            <Form.Item name="templateId" label="场景模板" rules={[{ required: true, message: "请选择场景模板" }]}>
                                <Select
                                    options={templates.map((item) => ({ value: item.id, label: `${item.name} · ${item.size.x}×${item.size.z}m` }))}
                                    onChange={(value: DramaSceneTemplateId) => {
                                        const template = templates.find((item) => item.id === value);
                                        if (template) form.setFieldsValue({ name: template.name });
                                    }}
                                />
                            </Form.Item>
                            <Form.Item name="name" label="场景名" rules={[{ required: true, message: "请填写场景名" }]}>
                                <Input placeholder="例如：废弃祠堂" maxLength={24} />
                            </Form.Item>
                        </>
                    ) : null}

                    {editor?.kind === "prop" ? (
                        <>
                            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写道具名称" }]}>
                                <Input placeholder="例如：青铜灯" maxLength={24} />
                            </Form.Item>
                            <div className="grid grid-cols-3 gap-3">
                                <Form.Item name="sizeX" label="宽 (m)">
                                    <InputNumber min={0.05} step={0.1} className="w-full" />
                                </Form.Item>
                                <Form.Item name="sizeY" label="高 (m)">
                                    <InputNumber min={0.05} step={0.1} className="w-full" />
                                </Form.Item>
                                <Form.Item name="sizeZ" label="深 (m)">
                                    <InputNumber min={0.05} step={0.1} className="w-full" />
                                </Form.Item>
                            </div>
                        </>
                    ) : null}
                </Form>
            </Modal>
        </div>
    );
}

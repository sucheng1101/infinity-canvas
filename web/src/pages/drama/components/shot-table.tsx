import { App, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { ArrowDown, ArrowUp, Clapperboard, MapPin, Pencil, Plus, Rows3, Trash2 } from "lucide-react";
import { useState } from "react";

import { useDramaStore } from "@/stores/drama/use-drama-store";
import { SHOT_SIZES, type DramaProject, type DramaShot, type DramaShotSize, type DramaShotStatus } from "@/types/drama";

const STATUS_COLOR: Record<DramaShotStatus, string> = { 待预演: "default", 已预演: "blue", 已出图: "green", 已出片: "purple" };
const STATUS_OPTIONS = Object.keys(STATUS_COLOR).map((value) => ({ value, label: value }));

type Draft = { sceneId: string; shotSize: DramaShotSize; durationSec: number; dialogue: string; prompt: string; status: DramaShotStatus };

export function ShotTable({ project }: { project: DramaProject }) {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const { addShot, updateShot, removeShot, reorderShots } = useDramaStore();
    const [editor, setEditor] = useState<{ id?: string } | null>(null);

    const shots = [...project.shots].sort((a, b) => a.index - b.index);
    const groups = project.scenes.map((scene) => ({ scene, shots: shots.filter((shot) => shot.sceneId === scene.id) }));
    const orphans = shots.filter((shot) => !project.scenes.some((scene) => scene.id === shot.sceneId));

    const openEditor = (shot?: DramaShot) => {
        if (!shot && project.scenes.length === 0) {
            message.warning("请先在「定妆」里添加场景");
            return;
        }
        form.setFieldsValue(
            shot
                ? { sceneId: shot.sceneId, shotSize: shot.shotSize, durationSec: shot.durationSec, dialogue: shot.dialogue, prompt: shot.prompt, status: shot.status }
                : { sceneId: project.scenes[0]?.id, shotSize: "中景", durationSec: 3, dialogue: "", prompt: "", status: "待预演" },
        );
        setEditor({ id: shot?.id });
    };

    const submit = async () => {
        const values = (await form.validateFields().catch(() => null)) as Draft | null;
        if (!values) return;
        if (editor?.id) {
            updateShot(project.id, editor.id, { shotSize: values.shotSize, durationSec: values.durationSec, dialogue: values.dialogue ?? "", prompt: values.prompt ?? "", status: values.status });
        } else {
            addShot(project.id, values.sceneId, { shotSize: values.shotSize, durationSec: values.durationSec, dialogue: values.dialogue ?? "", prompt: values.prompt ?? "", status: values.status });
        }
        setEditor(null);
        message.success("已保存");
    };

    // 同场次内上下移动：把场次内的新顺序交给 store 重排镜号。
    const move = (shot: DramaShot, delta: -1 | 1) => {
        const ids = shots.filter((item) => item.sceneId === shot.sceneId).map((item) => item.id);
        const at = ids.indexOf(shot.id);
        const to = at + delta;
        if (at < 0 || to < 0 || to >= ids.length) return;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        reorderShots(project.id, shot.sceneId, ids);
    };

    const addBatch = () => {
        const sceneId = project.scenes[0]?.id;
        if (!sceneId) {
            message.warning("请先在「定妆」里添加场景");
            return;
        }
        for (let step = 0; step < 5; step += 1) addShot(project.id, sceneId, {});
        message.success("已新增 5 条空镜头");
    };

    const columns: TableProps<DramaShot>["columns"] = [
        { title: "镜号", dataIndex: "index", width: 72, render: (value: number) => <span className="font-medium">{value}</span> },
        { title: "景别", dataIndex: "shotSize", width: 80 },
        { title: "时长", dataIndex: "durationSec", width: 80, render: (value: number) => `${value}s` },
        { title: "台词", dataIndex: "dialogue", ellipsis: true, render: (value: string) => value || <span className="text-muted-foreground">—</span> },
        { title: "出场角色", width: 96, render: (_: unknown, shot: DramaShot) => `${shot.cast.length} 人` },
        { title: "状态", dataIndex: "status", width: 96, render: (value: DramaShotStatus) => <Tag color={STATUS_COLOR[value]}>{value}</Tag> },
        {
            title: "操作",
            width: 168,
            render: (_: unknown, shot: DramaShot) => {
                const siblings = shots.filter((item) => item.sceneId === shot.sceneId);
                const at = siblings.findIndex((item) => item.id === shot.id);
                return (
                    <Space size={0}>
                        <Button type="text" size="small" icon={<ArrowUp className="size-3.5" />} aria-label="上移" disabled={at <= 0} onClick={() => move(shot, -1)} />
                        <Button type="text" size="small" icon={<ArrowDown className="size-3.5" />} aria-label="下移" disabled={at >= siblings.length - 1} onClick={() => move(shot, 1)} />
                        <Button type="text" size="small" icon={<Pencil className="size-3.5" />} aria-label="编辑镜头" onClick={() => openEditor(shot)} />
                        <Popconfirm title="删除这个镜头？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => removeShot(project.id, shot.id)}>
                            <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} aria-label="删除镜头" />
                        </Popconfirm>
                    </Space>
                );
            },
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Clapperboard className="size-4" />
                    分镜
                    <span className="text-xs text-muted-foreground">
                        {shots.length} 个镜头 · {project.scenes.length} 个场次
                    </span>
                </div>
                <Space>
                    <Button size="small" icon={<Rows3 className="size-3.5" />} onClick={addBatch}>
                        批量新增 5 条
                    </Button>
                    <Button size="small" type="primary" icon={<Plus className="size-3.5" />} onClick={() => openEditor()}>
                        新增镜头
                    </Button>
                </Space>
            </div>

            {project.scenes.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有场次，先去「定妆」里添加场景" />
            ) : (
                groups.map((group) => (
                    <section key={group.scene.id} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                        <div className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 dark:border-white/15">
                            <div className="flex items-center gap-2 text-sm font-medium">
                                <MapPin className="size-4" />
                                {group.scene.name}
                                <span className="text-xs text-muted-foreground">{group.shots.length} 镜</span>
                            </div>
                        </div>
                        <Table<DramaShot> size="small" rowKey="id" pagination={false} dataSource={group.shots} columns={columns} locale={{ emptyText: "本场次还没有镜头" }} />
                    </section>
                ))
            )}

            {orphans.length > 0 ? (
                <section className="overflow-hidden rounded-xl border border-black/10 dark:border-white/15">
                    <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2.5 text-sm font-medium dark:border-white/15">
                        <MapPin className="size-4" />
                        未分配场次
                        <span className="text-xs text-muted-foreground">{orphans.length} 镜</span>
                    </div>
                    <Table<DramaShot> size="small" rowKey="id" pagination={false} dataSource={orphans} columns={columns} />
                </section>
            ) : null}

            <Modal forceRender open={Boolean(editor)} title={editor?.id ? "编辑镜头" : "新增镜头"} okText="保存" cancelText="取消" onOk={submit} onCancel={() => setEditor(null)}>
                <Form form={form} layout="vertical" className="pt-2">
                    <Form.Item name="sceneId" label="场次" rules={[{ required: true, message: "请选择场次" }]} extra={editor?.id ? "镜头不支持跨场次移动" : undefined}>
                        <Select options={project.scenes.map((scene) => ({ value: scene.id, label: scene.name }))} placeholder="选择场次" disabled={Boolean(editor?.id)} />
                    </Form.Item>
                    <div className="grid grid-cols-3 gap-3">
                        <Form.Item name="shotSize" label="景别">
                            <Select options={SHOT_SIZES.map((size) => ({ value: size, label: size }))} />
                        </Form.Item>
                        <Form.Item name="durationSec" label="时长 (秒)">
                            <InputNumber min={0.5} step={0.5} className="w-full" />
                        </Form.Item>
                        <Form.Item name="status" label="状态">
                            <Select options={STATUS_OPTIONS} />
                        </Form.Item>
                    </div>
                    <Form.Item name="dialogue" label="台词">
                        <Input.TextArea rows={2} placeholder="这一镜的台词或旁白" maxLength={200} />
                    </Form.Item>
                    <Form.Item name="prompt" label="画面提示词">
                        <Input.TextArea rows={2} placeholder="这一镜的画面描述" maxLength={400} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

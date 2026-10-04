import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, type AdminSubscriptionPlan } from "@/services/api/admin";
import type { PublishedModel } from "@/services/api/hosted";

type Props = { models: PublishedModel[] };

const cycleLabels: Record<string, string> = { daily: "日卡", weekly: "周卡", monthly: "月卡", quarterly: "季卡", yearly: "年卡" };

export function SubscriptionManagement({ models }: Props) {
    const { message } = App.useApp();
    const [plans, setPlans] = useState<AdminSubscriptionPlan[]>([]);
    const [editor, setEditor] = useState<AdminSubscriptionPlan | null>(null);
    const [creating, setCreating] = useState(false);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            setPlans((await adminApi.subscriptionPlans()).items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "订阅配置读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const planPayload = (values: Record<string, unknown>) => {
        const source = Array.isArray(values.quotas) ? values.quotas as Array<Record<string, unknown>> : [];
        const quotas: Array<Record<string, unknown>> = [];
        const indexes = new Map<number, number>();
        for (const item of source) {
            const publishedModelId = Number(item.publishedModelId || 0);
            if (!publishedModelId) continue;
            const normalized = {
                publishedModelId,
                imageCount: Math.max(0, Number(item.imageCount || 0)),
                videoSeconds: Math.max(0, Number(item.videoSeconds || 0)),
                textTokens: Math.max(0, Number(item.textTokens || 0)),
            };
            const existing = indexes.get(publishedModelId);
            if (existing === undefined) {
                indexes.set(publishedModelId, quotas.length);
                quotas.push(normalized);
            } else {
                quotas[existing] = normalized;
            }
        }
        return {
            name: String(values.name || "").trim(),
            cycle: String(values.cycle || "monthly"),
            durationDays: Math.max(1, Number(values.durationDays || 0)),
            priceQuota: Math.max(0, Number(values.priceQuota || 0)),
            customChannelLimit: Math.max(1, Number(values.customChannelLimit || 1)),
            sortOrder: Number(values.sortOrder || 0),
            status: values.enabled === false ? "hidden" : "active",
            quotas,
        };
    };

    const save = async (values: Record<string, unknown>) => {
        try {
            const payload = planPayload(values);
            if (!payload.name || !payload.cycle || payload.durationDays <= 0) {
                message.error("请完整填写套餐名称、周期和有效天数");
                return;
            }
            await adminApi.saveSubscriptionPlan(payload, editor?.id);
            setEditor(null);
            setCreating(false);
            await load();
            message.success("订阅套餐已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "订阅套餐保存失败");
        }
    };

    const closeEditor = () => { setEditor(null); setCreating(false); };
    const current = editor;

    return <>
        <Card title="订阅管理" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => { setEditor(null); setCreating(true); }}>新增订阅</Button>}>
            <Table loading={loading} rowKey="id" pagination={false} dataSource={plans} scroll={{ x: 980 }} columns={[
                { title: "套餐", width: 180, render: (_: unknown, item: AdminSubscriptionPlan) => <div><div className="font-medium">{item.name}</div><div className="text-xs text-stone-500">{cycleLabels[item.cycle] || item.cycle} · {item.durationDays} 天</div></div> },
                { title: "订阅售价", width: 130, render: (_: unknown, item: AdminSubscriptionPlan) => <Tag color="blue">{item.priceQuota.toLocaleString()} 积分</Tag> },
                { title: "模型额度", render: (_: unknown, item: AdminSubscriptionPlan) => <Space size={[4, 4]} wrap>{item.quotas.map((quota) => <Tag key={quota.publishedModelId}>{models.find((model) => model.id === quota.publishedModelId)?.displayName || quota.modelName || quota.publishedModelId} · 图{quota.imageCount} / 秒{quota.videoSeconds} / Token{quota.textTokens}</Tag>)}</Space> },
                { title: "自定义渠道", width: 150, render: (_: unknown, item: AdminSubscriptionPlan) => item.customChannelEnabled ? <Tag color="green">自动解锁 {item.customChannelLimit} 个</Tag> : <Tag>未开启</Tag> },
                { title: "启用", width: 90, render: (_: unknown, item: AdminSubscriptionPlan) => <Switch checked={item.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(enabled) => { void adminApi.saveSubscriptionPlan(planPayload({ ...item, enabled }), item.id).then(load).catch((error) => message.error(error instanceof Error ? error.message : "订阅状态更新失败")); }} /> },
                { title: "操作", width: 100, render: (_: unknown, item: AdminSubscriptionPlan) => <Button type="link" icon={<Pencil className="size-3.5" />} onClick={() => { setEditor(item); setCreating(false); }}>编辑</Button> },
            ]} />
            <div className="mt-3 text-xs text-stone-500">订阅售价独立于按次售价；购买订阅后会自动获得对应额度，并自动解锁自定义渠道。</div>
        </Card>

        <Modal open={creating || current !== null} centered width={600} title={current ? "编辑订阅套餐" : "新增订阅套餐"} footer={null} destroyOnClose onCancel={closeEditor}>
            <Form layout="vertical" initialValues={{ ...current, enabled: current ? current.status === "active" : true, customChannelLimit: current?.customChannelLimit || 1, quotas: current?.quotas || [{}] }} onFinish={save}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Form.Item name="name" label="套餐名称" rules={[{ required: true, message: "请输入套餐名称" }]}><Input placeholder="月卡" /></Form.Item>
                    <Form.Item name="cycle" label="周期" rules={[{ required: true, message: "请选择周期" }]}><Select options={Object.entries(cycleLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
                    <Form.Item name="durationDays" label="有效天数" rules={[{ required: true, message: "请输入有效天数" }]}><InputNumber className="w-full" min={1} /></Form.Item>
                    <Form.Item name="priceQuota" label="订阅售价（积分）" rules={[{ required: true, message: "请输入订阅售价" }]}><InputNumber className="w-full" min={0} /></Form.Item>
                    <Form.Item name="customChannelLimit" label="自定义渠道数量" extra="购买订阅后自动解锁，无需单独购买解锁方案"><InputNumber className="w-full" min={1} /></Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch checkedChildren="开" unCheckedChildren="关" /></Form.Item>
                </div>
                <Form.List name="quotas">{(fields, { add, remove }) => <div className="space-y-3">
                    <div className="text-sm font-medium">模型额度</div>
                    {fields.map((field) => <div key={field.key} className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Form.Item {...field} name={[field.name, "publishedModelId"]} label="模型" rules={[{ required: true, message: "请选择模型" }]}><Select options={models.map((model) => ({ value: model.id, label: `${model.displayName} · ${model.capability}` }))} /></Form.Item>
                            <Form.Item {...field} name={[field.name, "imageCount"]} label="生图张数"><InputNumber className="w-full" min={0} /></Form.Item>
                            <Form.Item {...field} name={[field.name, "videoSeconds"]} label="视频秒数"><InputNumber className="w-full" min={0} /></Form.Item>
                            <Form.Item {...field} name={[field.name, "textTokens"]} label="文本 Token"><InputNumber className="w-full" min={0} /></Form.Item>
                        </div>
                        <Button type="link" danger onClick={() => remove(field.name)}>移除模型额度</Button>
                    </div>)}
                    <Button type="dashed" block onClick={() => add()}>增加模型额度</Button>
                </div>}</Form.List>
                <div className="mt-5 flex justify-end gap-2"><Button onClick={closeEditor}>取消</Button><Button type="primary" htmlType="submit">保存订阅</Button></div>
            </Form>
        </Modal>
    </>;
}

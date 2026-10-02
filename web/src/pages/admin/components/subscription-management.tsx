import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, type AdminChannelUnlockPlan, type AdminModelCostPricing, type AdminSubscriptionPlan } from "@/services/api/admin";
import type { AdminChannel } from "@/services/api/admin";
import type { PublishedModel } from "@/services/api/hosted";

type Props = { models: PublishedModel[]; channels: AdminChannel[] };

export function SubscriptionManagement({ models, channels }: Props) {
    const { message, modal } = App.useApp();
    const [plans, setPlans] = useState<AdminSubscriptionPlan[]>([]);
    const [unlockPlans, setUnlockPlans] = useState<AdminChannelUnlockPlan[]>([]);
    const [costs, setCosts] = useState<AdminModelCostPricing[]>([]);
    const [editor, setEditor] = useState<{ type: "plan" | "unlock" | "cost"; item?: any }>();
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const [planResult, unlockResult, costResult] = await Promise.all([adminApi.subscriptionPlans(), adminApi.channelUnlockPlans(), adminApi.modelCostPricing()]);
            setPlans(planResult.items);
            setUnlockPlans(unlockResult.items);
            setCosts(costResult.items);
        } catch (error) { message.error(error instanceof Error ? error.message : "订阅配置读取失败"); }
        finally { setLoading(false); }
    };
    useEffect(() => { void load(); }, []);

    const save = async (values: any) => {
        try {
            if (editor?.type === "plan") await adminApi.saveSubscriptionPlan({ ...values, quotas: values.quotas || [], status: values.enabled ? "active" : "hidden" }, editor.item?.id);
            if (editor?.type === "unlock") await adminApi.saveChannelUnlockPlan({ ...values, status: values.enabled ? "active" : "hidden" }, editor.item?.id);
            if (editor?.type === "cost") {
                const submit = { ...values, confirmWarning: false };
                try { await adminApi.saveModelCostPricing({ ...submit, status: values.enabled ? "active" : "hidden" }, editor.item?.id); }
                catch (error) {
                    if (!(error instanceof Error) || !error.message.includes("确认")) throw error;
                    await new Promise<void>((resolve, reject) => modal.confirm({ title: "售价低于渠道成本", content: "继续保存会产生负利润，请确认该定价确实符合运营策略。", okText: "确认保存", cancelText: "取消", onOk: async () => { try { await adminApi.saveModelCostPricing({ ...submit, status: values.enabled ? "active" : "hidden", confirmWarning: true }, editor.item?.id); resolve(); } catch (e) { reject(e); } }, onCancel: () => reject(new Error("已取消保存")) }));
                }
            }
            setEditor(undefined); await load(); message.success("已保存");
        } catch (error) { if (error instanceof Error && error.message === "已取消保存") return; message.error(error instanceof Error ? error.message : "保存失败"); }
    };

    const current = editor?.item;
    return <Space direction="vertical" className="w-full" size="large">
        <Card title="订阅套餐" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ type: "plan" })}>新增订阅</Button>}>
            <Table loading={loading} rowKey="id" pagination={false} dataSource={plans} columns={[
                { title: "套餐", render: (_: unknown, item: AdminSubscriptionPlan) => <div><div className="font-medium">{item.name}</div><div className="text-xs text-stone-500">{item.cycle} · {item.durationDays} 天</div></div> },
                { title: "价格", render: (_: unknown, item: AdminSubscriptionPlan) => `${item.priceQuota.toLocaleString()} 积分` },
                { title: "模型额度", render: (_: unknown, item: AdminSubscriptionPlan) => item.quotas.map((quota) => <Tag key={quota.publishedModelId}>{models.find((model) => model.id === quota.publishedModelId)?.displayName || quota.publishedModelId} · 图{quota.imageCount} / 秒{quota.videoSeconds} / Token{quota.textTokens}</Tag>) },
                { title: "启用", render: (_: unknown, item: AdminSubscriptionPlan) => <Switch checked={item.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(enabled) => void adminApi.saveSubscriptionPlan({ ...item, status: enabled ? "active" : "hidden" }, item.id).then(load)} /> },
                { title: "操作", render: (_: unknown, item: AdminSubscriptionPlan) => <Button type="link" icon={<Pencil className="size-3.5" />} onClick={() => setEditor({ type: "plan", item })}>编辑</Button> },
            ]} />
        </Card>
        <Card title="自定义渠道月度解锁" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ type: "unlock" })}>新增解锁方案</Button>}>
            <Table loading={loading} rowKey="id" pagination={false} dataSource={unlockPlans} columns={[
                { title: "方案", dataIndex: "name" }, { title: "费用", render: (_: unknown, item: AdminChannelUnlockPlan) => `${item.priceQuota.toLocaleString()} 积分` }, { title: "有效期", render: (_: unknown, item: AdminChannelUnlockPlan) => `${item.durationDays} 天` }, { title: "渠道数", dataIndex: "channelLimit" },
                { title: "状态", render: (_: unknown, item: AdminChannelUnlockPlan) => <Switch checked={item.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(enabled) => void adminApi.saveChannelUnlockPlan({ ...item, status: enabled ? "active" : "hidden" }, item.id).then(load)} /> },
                { title: "操作", render: (_: unknown, item: AdminChannelUnlockPlan) => <Button type="link" onClick={() => setEditor({ type: "unlock", item })}>编辑</Button> },
            ]} />
        </Card>
        <Card title="渠道模型成本与售价" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ type: "cost" })}>新增成本价</Button>}>
            <Table loading={loading} rowKey="id" pagination={false} dataSource={costs} columns={[
                { title: "模型", render: (_: unknown, item: AdminModelCostPricing) => models.find((model) => model.id === item.publishedModelId)?.displayName || item.publishedModelId },
                { title: "渠道 / 上游", render: (_: unknown, item: AdminModelCostPricing) => `${channels.find((channel) => channel.id === item.channelId)?.name || item.channelId} / ${item.upstreamModel}` },
                { title: "计费单位", dataIndex: "billingUnit" }, { title: "成本", render: (_: unknown, item: AdminModelCostPricing) => `${item.costPerUnit} 积分` }, { title: "售价", render: (_: unknown, item: AdminModelCostPricing) => `${item.sellPerUnit} 积分` }, { title: "利润率", render: (_: unknown, item: AdminModelCostPricing) => `${(item.profitMargin * 100).toFixed(1)}%` },
                { title: "启用", render: (_: unknown, item: AdminModelCostPricing) => <Switch checked={item.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(enabled) => void adminApi.saveModelCostPricing({ ...item, status: enabled ? "active" : "hidden", confirmWarning: true }, item.id).then(load)} /> },
                { title: "操作", render: (_: unknown, item: AdminModelCostPricing) => <Button type="link" onClick={() => setEditor({ type: "cost", item })}>编辑</Button> },
            ]} />
        </Card>
        {editor ? <Modal open title={editor.type === "plan" ? "订阅套餐" : editor.type === "unlock" ? "渠道解锁方案" : "渠道模型成本价"} footer={null} onCancel={() => setEditor(undefined)}>
            <Form layout="vertical" initialValues={{ ...current, enabled: current?.status !== "hidden" }} onFinish={save}>
                {editor.type === "plan" && <>
                    <Form.Item name="name" label="套餐名称" rules={[{ required: true }]}><Input placeholder="月卡" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3"><Form.Item name="cycle" label="周期" rules={[{ required: true }]}><Select options={[{ value: "daily", label: "日卡" }, { value: "weekly", label: "周卡" }, { value: "monthly", label: "月卡" }, { value: "quarterly", label: "季卡" }, { value: "yearly", label: "年卡" }]} /></Form.Item><Form.Item name="durationDays" label="有效天数" rules={[{ required: true }]}><InputNumber className="w-full" min={1} /></Form.Item></div>
                    <Form.Item name="priceQuota" label="价格（积分）" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item>
                    <Form.List name="quotas" initialValue={current?.quotas || [{}]}>{(fields, { add, remove }) => <>{fields.map((field) => <div key={field.key} className="mb-3 rounded-lg border border-stone-200 p-3"><div className="grid grid-cols-2 gap-3"><Form.Item {...field} name={[field.name, "publishedModelId"]} label="模型" rules={[{ required: true }]}><Select options={models.map((model) => ({ value: model.id, label: `${model.displayName} · ${model.capability}` }))} /></Form.Item><Form.Item {...field} name={[field.name, "imageCount"]} label="生图张数"><InputNumber className="w-full" min={0} /></Form.Item><Form.Item {...field} name={[field.name, "videoSeconds"]} label="视频秒数"><InputNumber className="w-full" min={0} /></Form.Item><Form.Item {...field} name={[field.name, "textTokens"]} label="文本 Token"><InputNumber className="w-full" min={0} /></Form.Item></div><Button type="link" danger onClick={() => remove(field.name)}>移除模型额度</Button></div>)}<Button type="dashed" block onClick={() => add()}>增加模型额度</Button></>}</Form.List>
                    <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch checkedChildren="开" unCheckedChildren="关" /></Form.Item>
                </>}
                {editor.type === "unlock" && <><Form.Item name="name" label="方案名称" rules={[{ required: true }]}><Input placeholder="自定义渠道月卡" /></Form.Item><Form.Item name="priceQuota" label="解锁费用（积分）" rules={[{ required: true }]}><InputNumber className="w-full" min={1} /></Form.Item><div className="grid grid-cols-2 gap-3"><Form.Item name="durationDays" label="有效天数" rules={[{ required: true }]}><InputNumber className="w-full" min={1} /></Form.Item><Form.Item name="channelLimit" label="渠道数量" rules={[{ required: true }]}><InputNumber className="w-full" min={1} /></Form.Item></div><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch checkedChildren="开" unCheckedChildren="关" /></Form.Item></>}
                {editor.type === "cost" && <><Form.Item name="publishedModelId" label="公开模型" rules={[{ required: true }]}><Select options={models.map((model) => ({ value: model.id, label: model.displayName }))} /></Form.Item><Form.Item name="channelId" label="渠道" rules={[{ required: true }]}><Select options={channels.map((channel) => ({ value: channel.id, label: channel.name }))} /></Form.Item><Form.Item name="upstreamModel" label="上游模型" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="billingUnit" label="计费单位" rules={[{ required: true }]}><Select options={[{ value: "image", label: "按张" }, { value: "second", label: "按秒" }, { value: "token", label: "按 Token" }, { value: "request", label: "按次" }]} /></Form.Item><div className="grid grid-cols-2 gap-3"><Form.Item name="costPerUnit" label="渠道成本（积分）" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item><Form.Item name="sellPerUnit" label="用户售价（积分）" rules={[{ required: true }]}><InputNumber className="w-full" min={0} /></Form.Item></div><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch checkedChildren="开" unCheckedChildren="关" /></Form.Item></>}
                <Button type="primary" htmlType="submit" block>保存</Button>
            </Form>
        </Modal> : null}
    </Space>;
}


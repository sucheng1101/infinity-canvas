import { App, Button, Card, Empty, Form, Input, Modal, Space, Spin, Table, Tag } from "antd";
import { Check, Copy, Pencil, Plus, RadioTower, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { hostedApi, type ChannelUnlockPlan, type UserChannel, type UserChannelEntitlement } from "@/services/api/hosted";

type FormValues = { name: string; provider: string; baseUrl: string; apiKey?: string; models?: string };

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<UserChannel[]>([]);
    const [entitlement, setEntitlement] = useState<UserChannelEntitlement>();
    const [loading, setLoading] = useState(true);
    const [editor, setEditor] = useState<UserChannel>();
    const [open, setOpen] = useState(false);
    const [testing, setTesting] = useState<number>();
    const [unlockPlans, setUnlockPlans] = useState<ChannelUnlockPlan[]>([]);

    const load = async () => {
        setLoading(true);
        try {
            const [result, unlockResult] = await Promise.all([hostedApi.channels(), hostedApi.channelUnlockPlans()]);
            setItems(result.items);
            setEntitlement(result.entitlement);
            setUnlockPlans(unlockResult.items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const save = async (values: FormValues) => {
        const models = String(values.models || "").split(/[\n,]/).map((value) => value.trim()).filter(Boolean).map((value) => {
            const [name, capability = "text"] = value.split("|").map((item) => item.trim());
            return { name, capability, status: "active" };
        });
        try {
            if (editor) await hostedApi.updateChannel(editor.id, { ...values, models });
            else await hostedApi.createChannel({ ...values, models });
            setOpen(false);
            setEditor(undefined);
            await load();
            message.success("渠道已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道保存失败");
        }
    };

    const remove = (item: UserChannel) => {
        modal.confirm({ title: "停用这个渠道？", content: item.name, okText: "停用", cancelText: "取消", onOk: async () => { await hostedApi.deleteChannel(item.id); await load(); message.success("渠道已停用"); } });
    };

    const test = async (item: UserChannel) => {
        setTesting(item.id);
        try {
            await hostedApi.testChannel(item.id);
            message.success("渠道连接正常");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道测试失败");
        } finally {
            setTesting(undefined);
        }
    };

    const unlock = async (plan: ChannelUnlockPlan) => {
        try { await hostedApi.unlockChannels(plan.id); message.success("自定义渠道已按月解锁"); await load(); }
        catch (error) { message.error(error instanceof Error ? error.message : "渠道解锁失败"); }
    };

    return <main className="h-full overflow-y-auto bg-[#f7f7f5] px-5 py-8 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-8"><div className="mx-auto max-w-6xl"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-orange-600">MY CHANNELS</div><h1 className="text-3xl font-semibold tracking-[-.04em]">我的渠道</h1><p className="mt-2 text-sm text-stone-500">连接你自己的 OpenAI 兼容服务，密钥只对当前账号生效。</p></div><Button type="primary" icon={<Plus className="size-4" />} disabled={!entitlement?.enabled || (entitlement.used >= entitlement.channelLimit)} onClick={() => { setEditor(undefined); setOpen(true); }}>添加渠道</Button></div>
        <Card className="mb-6 !border-orange-200 !bg-orange-50/70"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="font-medium">自定义渠道权益</div><div className="mt-1 text-sm text-stone-600">{entitlement?.enabled ? `已使用 ${entitlement.used} / ${entitlement.channelLimit} 个渠道` : "按月解锁后即可添加自己的渠道"}</div></div><Space>{entitlement?.expiresAt ? <Tag color="orange">有效期至 {new Date(entitlement.expiresAt).toLocaleDateString()}</Tag> : null}{!entitlement?.enabled ? unlockPlans.map((plan) => <Button key={plan.id} type="primary" onClick={() => void unlock(plan)}>{plan.name} · {plan.priceQuota} 积分</Button>) : null}</Space></div></Card>
        {loading ? <div className="flex min-h-64 items-center justify-center"><Spin /></div> : items.length ? <Card><Table rowKey="id" dataSource={items} pagination={false} columns={[{ title: "渠道", render: (_, item) => <div><div className="font-medium">{item.name}</div><div className="text-xs text-stone-500">{item.provider} · {item.baseUrl}</div></div> }, { title: "模型", render: (_, item) => item.models.length ? item.models.map((model) => <Tag key={model.name}>{model.name} · {model.capability}</Tag>) : "-" }, { title: "密钥", render: (_, item) => item.apiKeySet ? <Tag color="success">已配置</Tag> : <Tag>未配置</Tag> }, { title: "状态", render: (_, item) => item.lastError ? <Tag color="error">连接异常</Tag> : <Tag color="success">{item.status === "active" ? "启用" : "停用"}</Tag> }, { title: "操作", render: (_, item) => <Space><Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard?.writeText(`user-channel:${item.id}::${item.models[0]?.name || ""}`).then(() => message.success("调用标识已复制"))}>复制调用标识</Button><Button size="small" icon={<RadioTower className="size-3.5" />} loading={testing === item.id} onClick={() => void test(item)}>测试</Button><Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => { setEditor(item); setOpen(true); }}>编辑</Button><Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(item)}>停用</Button></Space> }]} /></Card> : <Card><Empty description={entitlement?.enabled ? "还没有自定义渠道" : "当前套餐未开通自定义渠道"} /></Card>}
        <Modal open={open} title={editor ? "编辑渠道" : "添加渠道"} footer={null} onCancel={() => { setOpen(false); setEditor(undefined); }}><Form layout="vertical" initialValues={editor ? { ...editor, models: editor.models.map((item) => `${item.name}|${item.capability}`).join("\n") } : { provider: "openai" }} key={editor?.id || "new"} onFinish={save}><Form.Item name="name" label="渠道名称" rules={[{ required: true }]}><Input placeholder="例如：我的 OpenAI" /></Form.Item><Form.Item name="provider" label="协议" rules={[{ required: true }]}><Input placeholder="openai-compatible" /></Form.Item><Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}><Input placeholder="https://api.example.com/v1" /></Form.Item><Form.Item name="apiKey" label="API Key" extra={editor?.apiKeySet ? "留空保持当前密钥" : undefined}><Input.Password /></Form.Item><Form.Item name="models" label="模型列表" extra="格式：模型名|能力；能力支持 text / image / video / audio"><Input.TextArea rows={4} placeholder="gpt-4o|text\ndall-e-3|image" /></Form.Item><Button type="primary" htmlType="submit" block icon={<Check className="size-4" />}>保存渠道</Button></Form></Modal>
    </div></main>;
}

import { App, Button, Card, Empty, Form, Input, Modal, Space, Spin, Table, Tag } from "antd";
import { Check, Copy, Pencil, Plus, RadioTower, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";

import { hostedApi, type ChannelUnlockPlan, type UserChannel, type UserChannelEntitlement } from "@/services/api/hosted";

type FormValues = { name: string; provider: string; baseUrl: string; apiKey?: string; models?: string };

export default function ChannelsPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const channelsQuery = useQuery({ queryKey: ["user-channels"], queryFn: () => hostedApi.channels() });
    const unlockPlansQuery = useQuery({ queryKey: ["channel-unlock-plans"], queryFn: () => hostedApi.channelUnlockPlans() });
    const [items, setItems] = useState<UserChannel[]>([]);
    const [entitlement, setEntitlement] = useState<UserChannelEntitlement>();
    const [editor, setEditor] = useState<UserChannel>();
    const [open, setOpen] = useState(false);
    const [testing, setTesting] = useState<number>();
    const [unlockPlans, setUnlockPlans] = useState<ChannelUnlockPlan[]>([]);
    const loading = channelsQuery.isLoading;

    // Queries own fetching and caching; local copies keep table editing simple.
    useEffect(() => {
        if (!channelsQuery.data) return;
        setItems(channelsQuery.data.items);
        setEntitlement(channelsQuery.data.entitlement);
    }, [channelsQuery.data]);
    useEffect(() => {
        if (unlockPlansQuery.data) setUnlockPlans(unlockPlansQuery.data.items);
    }, [unlockPlansQuery.data]);
    useEffect(() => {
        const error = channelsQuery.error ?? unlockPlansQuery.error;
        if (error) message.error(error instanceof Error ? error.message : t("channelsPage.loadFailed"));
    }, [channelsQuery.error, message, t, unlockPlansQuery.error]);

    const load = async () => {
        await Promise.all([channelsQuery.refetch(), unlockPlansQuery.refetch()]);
    };

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
            message.success(t("channelsPage.saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("channelsPage.saveFailed"));
        }
    };

    const remove = (item: UserChannel) => {
        modal.confirm({ title: t("channelsPage.confirmDeactivateTitle"), content: item.name, okText: t("channelsPage.deactivate"), cancelText: t("channelsPage.cancel"), onOk: async () => { await hostedApi.deleteChannel(item.id); await load(); message.success(t("channelsPage.deactivated")); } });
    };

    const test = async (item: UserChannel) => {
        setTesting(item.id);
        try {
            await hostedApi.testChannel(item.id);
            message.success(t("channelsPage.testOk"));
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("channelsPage.testFailed"));
        } finally {
            setTesting(undefined);
        }
    };

    const unlock = async (plan: ChannelUnlockPlan) => {
        try { await hostedApi.unlockChannels(plan.id); message.success(t("channelsPage.unlockOk")); await load(); }
        catch (error) { message.error(error instanceof Error ? error.message : t("channelsPage.unlockFailed")); }
    };

    return <main className="h-full overflow-y-auto bg-[#f7f7f5] px-5 py-8 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-8"><div className="mx-auto max-w-6xl"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-orange-600">MY CHANNELS</div><h1 className="text-3xl font-semibold tracking-[-.04em]">{t("channelsPage.title")}</h1><p className="mt-2 text-sm text-stone-500">{t("channelsPage.subtitle")}</p></div><Button type="primary" icon={<Plus className="size-4" />} disabled={!entitlement?.enabled || (entitlement.used >= entitlement.channelLimit)} onClick={() => { setEditor(undefined); setOpen(true); }}>{t("channelsPage.add")}</Button></div>
        <Card className="mb-6 !border-orange-200 !bg-orange-50/70"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="font-medium">{t("channelsPage.entitlementTitle")}</div><div className="mt-1 text-sm text-stone-600">{entitlement?.enabled ? t("channelsPage.used", { used: entitlement.used, limit: entitlement.channelLimit }) : t("channelsPage.unlockHint")}</div></div><Space>{entitlement?.expiresAt ? <Tag color="orange">{t("channelsPage.validUntil", { date: new Date(entitlement.expiresAt).toLocaleDateString() })}</Tag> : null}{!entitlement?.enabled ? unlockPlans.map((plan) => <Button key={plan.id} type="primary" onClick={() => void unlock(plan)}>{t("channelsPage.planButton", { name: plan.name, quota: plan.priceQuota })}</Button>) : null}</Space></div></Card>
        {loading ? <div className="flex min-h-64 items-center justify-center"><Spin /></div> : items.length ? <Card><Table rowKey="id" dataSource={items} pagination={false} columns={[{ title: t("channelsPage.colChannel"), render: (_, item) => <div><div className="font-medium">{item.name}</div><div className="text-xs text-stone-500">{item.provider} · {item.baseUrl}</div></div> }, { title: t("channelsPage.colModels"), render: (_, item) => item.models.length ? item.models.map((model) => <Tag key={model.name}>{model.name} · {model.capability}</Tag>) : "-" }, { title: t("channelsPage.colKey"), render: (_, item) => item.apiKeySet ? <Tag color="success">{t("channelsPage.keySet")}</Tag> : <Tag>{t("channelsPage.keyMissing")}</Tag> }, { title: t("channelsPage.colStatus"), render: (_, item) => item.lastError ? <Tag color="error">{t("channelsPage.connectionError")}</Tag> : <Tag color="success">{item.status === "active" ? t("channelsPage.active") : t("channelsPage.inactive")}</Tag> }, { title: t("channelsPage.colActions"), render: (_, item) => <Space><Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard?.writeText(`user-channel:${item.id}::${item.models[0]?.name || ""}`).then(() => message.success(t("channelsPage.copied")))}>{t("channelsPage.copyToken")}</Button><Button size="small" icon={<RadioTower className="size-3.5" />} loading={testing === item.id} onClick={() => void test(item)}>{t("channelsPage.test")}</Button><Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => { setEditor(item); setOpen(true); }}>{t("channelsPage.edit")}</Button><Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(item)}>{t("channelsPage.deactivate")}</Button></Space> }]} /></Card> : <Card><Empty description={entitlement?.enabled ? t("channelsPage.emptyEnabled") : t("channelsPage.emptyDisabled")} /></Card>}
        <Modal open={open} title={editor ? t("channelsPage.modalEdit") : t("channelsPage.modalAdd")} footer={null} onCancel={() => { setOpen(false); setEditor(undefined); }}><Form layout="vertical" initialValues={editor ? { ...editor, models: editor.models.map((item) => `${item.name}|${item.capability}`).join("\n") } : { provider: "openai" }} key={editor?.id || "new"} onFinish={save}><Form.Item name="name" label={t("channelsPage.nameLabel")} rules={[{ required: true }]}><Input placeholder={t("channelsPage.namePlaceholder")} /></Form.Item><Form.Item name="provider" label={t("channelsPage.providerLabel")} rules={[{ required: true }]}><Input placeholder="openai-compatible" /></Form.Item><Form.Item name="baseUrl" label={t("channelsPage.baseUrlLabel")} rules={[{ required: true }]}><Input placeholder="https://api.example.com/v1" /></Form.Item><Form.Item name="apiKey" label={t("channelsPage.apiKeyLabel")} extra={editor?.apiKeySet ? t("channelsPage.apiKeyKeep") : undefined}><Input.Password /></Form.Item><Form.Item name="models" label={t("channelsPage.modelsLabel")} extra={t("channelsPage.modelsExtra")}><Input.TextArea rows={4} placeholder="gpt-4o|text\ndall-e-3|image" /></Form.Item><Button type="primary" htmlType="submit" block icon={<Check className="size-4" />}>{t("channelsPage.save")}</Button></Form></Modal>
    </div></main>;
}
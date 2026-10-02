import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import { Activity, Boxes, CircleDollarSign, LayoutDashboard, Mail, RefreshCw, Route, Save, Settings2, SlidersHorizontal, Users, ScrollText, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { adminApi, type AdminChannel, type AdminModelCostPricing, type AdminRoute, type EmailSettings, type InvitationSettings, type PaymentSettings, type PricingVersion } from "@/services/api/admin";
import type { PublishedModel, RechargeProduct } from "@/services/api/hosted";
import { useAuthStore } from "@/stores/use-auth-store";
import { AdminChannelEditorDrawer } from "./components/channel-editor-drawer";
import { ChannelManagement } from "./components/channel-management";
import { PricingManagement } from "./components/pricing-management";
import { UsageLogManagement } from "./components/usage-log-management";
import { UserManagement } from "./components/user-management";
import { SubscriptionManagement } from "./components/subscription-management";
import { OperationsManagement } from "./components/operations-management";

const statusOptions = [
    { value: "active", label: "启用" },
    { value: "hidden", label: "隐藏" },
];
const jsonValue = (value: unknown) => JSON.stringify(value || {});
const recommendedPricingType = (capability?: string) => capability === "image" ? "per_unit" : capability === "video" ? "per_second" : capability === "text" ? "per_token" : "fixed";
const modelVariantOptions = (model?: PublishedModel) => {
    if (!model) return [];
    const quality = model.qualitySpec?.options || [];
    const modes = model.qualitySpec?.outputModes || [];
    const items = [...quality, ...modes];
    return Array.from(new Map(items.map((item) => [item.key, item])).values());
};

function RouteEditorFields({ channels, models }: { channels: AdminChannel[]; models: PublishedModel[] }) {
    const form = Form.useFormInstance();
    const channelId = Form.useWatch("channelId", form);
    const publishedModelId = Form.useWatch("publishedModelId", form);
    const channel = channels.find((item) => item.id === channelId);
    const capability = models.find((item) => item.id === publishedModelId)?.capability;
    const boundModels = new Set(channel?.modelApiKeys.flatMap((item) => item.models) || []);
    const options = (channel?.status === "active" ? channel.models : []).filter((item) => item.status !== "hidden" && boundModels.has(item.name) && (!capability || item.capability === capability)).map((item) => ({ value: item.name, label: item.name }));

    useEffect(() => {
        const current = form.getFieldValue("upstreamModel");
        if (current && !options.some((item) => item.value === current)) form.setFieldValue("upstreamModel", undefined);
    }, [channelId, form, publishedModelId]);

    return (
        <>
            <Form.Item name="publishedModelId" label="公开模型" rules={[{ required: true }]}>
                <Select options={models.map((value) => ({ value: value.id, label: value.displayName }))} />
            </Form.Item>
            <Form.Item name="channelId" label="渠道" rules={[{ required: true }]}>
                <Select options={channels.map((value) => ({ value: value.id, label: value.name }))} />
            </Form.Item>
            <Form.Item name="upstreamModel" label="上游模型" rules={[{ required: true }]} extra={channelId && publishedModelId && !options.length ? "该渠道没有绑定相同能力的可用模型" : undefined}>
                <Select showSearch optionFilterProp="label" options={options} placeholder="选择渠道模型" />
            </Form.Item>
        </>
    );
}

export default function AdminPage() {
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [models, setModels] = useState<PublishedModel[]>([]);
    const [channels, setChannels] = useState<AdminChannel[]>([]);
    const [modelCosts, setModelCosts] = useState<AdminModelCostPricing[]>([]);
    const [routes, setRoutes] = useState<AdminRoute[]>([]);
    const [pricing, setPricing] = useState<PricingVersion[]>([]);
    const [products, setProducts] = useState<RechargeProduct[]>([]);
    const [invitation, setInvitation] = useState<InvitationSettings>();
    const [payment, setPayment] = useState<PaymentSettings>();
    const [email, setEmail] = useState<EmailSettings>();
    const [testEmail, setTestEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [modal, setModal] = useState<{ type: string; item?: any }>();
    const [channelEditor, setChannelEditor] = useState<AdminChannel | null>();
    const [activeSection, setActiveSection] = useState("overview");

    const load = async () => {
        setLoading(true);
        try {
            const modelResult = await adminApi.models();
            const [channelResult, routeResult, pricingResult, productResult, invitationResult, paymentResult, emailResult, costResult] = await Promise.all([
                adminApi.channels(),
                adminApi.routes(),
                adminApi.pricing(),
                adminApi.products(),
                adminApi.invitation(),
                adminApi.payment(),
                adminApi.email(),
                adminApi.modelCostPricing(),
            ]);
            setModels(modelResult.items);
            setChannels(channelResult.items);
            setRoutes(routeResult.items);
            setPricing(pricingResult.items);
            setProducts(productResult.items);
            setInvitation(invitationResult);
            setPayment(paymentResult);
            setEmail(emailResult);
            setModelCosts(costResult.items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "管理数据读取失败");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void load();
    }, []);

    if (user?.role !== "admin") return <Navigate to="/app" replace />;

    const save = async (values: Record<string, any>) => {
        try {
            const type = modal?.type;
            if (["model", "route"].includes(type || "")) {
                const key = type === "model" ? "publicConfig" : "settings";
                if (typeof values[key] === "string") values[key] = JSON.parse(values[key] || "{}");
            }
            if (type === "model") modal?.item ? await adminApi.updateModel(modal.item.id, values) : await adminApi.createModel(values);
            if (type === "route") modal?.item ? await adminApi.updateRoute(modal.item.id, values) : await adminApi.createRoute(values);
            if (type === "pricing") {
                const created = await adminApi.createPricing({
                    publishedModelId: values.publishedModelId,
                    currency: "POINTS",
                    formula: {
                        type: values.pricingType,
                        unitAmount: values.unitAmount,
                        ...(values.baseAmount ? { baseAmount: values.baseAmount } : {}),
                        ...(values.minimumAmount ? { minimumAmount: values.minimumAmount } : {}),
                        ...(values.inputTokenAmount ? { inputTokenAmount: values.inputTokenAmount } : {}),
                        ...(values.outputTokenAmount ? { outputTokenAmount: values.outputTokenAmount } : {}),
                        ...(values.cachedTokenAmount ? { cachedTokenAmount: values.cachedTokenAmount } : {}),
                        ...(Array.isArray(values.variants) && values.variants.length ? { variants: values.variants.filter((item: any) => item?.key).map((item: any) => ({ key: item.key, label: item.label || item.key, unitAmount: Number(item.unitAmount || 0) })) } : {}),
                    },
                });
                if (values.enabled) await adminApi.publishPricing(created.id);
            }
            if (type === "product") {
                await adminApi.saveProduct(
                    {
                        name: values.name,
                        payAmountFen: Math.round(Number(values.payAmountYuan) * 100),
                        quotaAmount: Math.round(Number(values.payAmountYuan) * 100),
                        giftQuota: values.giftQuota || 0,
                        customChannelEnabled: Boolean(values.customChannelEnabled),
                        customChannelLimit: Number(values.customChannelLimit || 0),
                        customChannelDays: Number(values.customChannelDays || 0),
                        status: values.enabled ? "active" : "hidden",
                        sortOrder: values.sortOrder || 0,
                    },
                    modal?.item?.id,
                );
            }
            if (type === "quota") await adminApi.adjustQuota({ ...values, idempotencyKey: crypto.randomUUID() });
            setModal(undefined);
            await load();
            message.success("已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };

    const hide = async (kind: "model" | "channel" | "route", id: number) => {
        try {
            await { model: adminApi.hideModel, channel: adminApi.hideChannel, route: adminApi.hideRoute }[kind](id);
            await load();
            message.success("已隐藏");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "操作失败");
        }
    };

    const toggleRoute = async (row: AdminRoute) => {
        try {
            await adminApi.updateRoute(row.id, { ...row, status: row.status === "active" ? "hidden" : "active" });
            await load();
            message.success(row.status === "active" ? "渠道路由已禁用" : "渠道路由已启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "路由状态更新失败");
        }
    };

    const saveChannel = async (values: Parameters<typeof adminApi.createChannel>[0], costs: Array<{ id?: number; publishedModelId: number; upstreamModel: string; billingUnit: string; costPerUnit: number; sellPerUnit: number; status: "active" | "hidden" }>) => {
        try {
            const saved = channelEditor ? await adminApi.updateChannel(channelEditor.id, values) : await adminApi.createChannel(values);
            for (const item of costs) {
                const existing = modelCosts.find((cost) => cost.channelId === saved.id && cost.upstreamModel === item.upstreamModel);
                await adminApi.saveModelCostPricing({ ...item, channelId: saved.id, confirmWarning: true }, item.id || existing?.id);
            }
            const submittedModels = new Set(costs.map((item) => item.upstreamModel));
            for (const existing of modelCosts.filter((item) => item.channelId === saved.id && !submittedModels.has(item.upstreamModel) && item.status === "active")) {
                await adminApi.saveModelCostPricing({ ...existing, status: "hidden", confirmWarning: true }, existing.id);
            }
            setChannelEditor(undefined);
            await load();
            message.success("渠道已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道保存失败");
        }
    };

    const channelInput = (channel: AdminChannel, status: "active" | "hidden") => ({
        name: channel.name,
        provider: channel.provider,
        baseUrl: channel.baseUrl,
        modelApiKeys: channel.modelApiKeys.map((item) => ({ id: item.id, name: item.name, apiKey: "", models: item.models })),
        models: channel.models,
        settings: channel.settings,
        status,
        sortOrder: channel.sortOrder,
    });

    const toggleChannel = async (channel: AdminChannel, enabled: boolean) => {
        try {
            await adminApi.updateChannel(channel.id, channelInput(channel, enabled ? "active" : "hidden"));
            await load();
            message.success(enabled ? "渠道已启用" : "渠道已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道状态更新失败");
        }
    };

    const toggleModel = async (model: PublishedModel, enabled: boolean) => {
        const hasRoute = routes.some((route) => route.publishedModelId === model.id && route.available);
        const hasPricing = pricing.some((item) => item.publishedModelId === model.id && item.status === "active");
        if (enabled && (!hasRoute || !hasPricing)) {
            message.warning(`请先完成${!hasRoute ? "可用渠道路由" : ""}${!hasRoute && !hasPricing ? "和" : ""}${!hasPricing ? "启用定价" : ""}`);
            return;
        }
        try {
            await adminApi.updateModel(model.id, { ...model, status: enabled ? "active" : "hidden" });
            await load();
            message.success(enabled ? "模型已对用户开放" : "模型已停止对用户开放");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型状态更新失败");
        }
    };

    const togglePricing = async (model: PublishedModel, enabled: boolean, item?: PricingVersion) => {
        try {
            if (enabled) {
                if (!item) {
                    setModal({ type: "pricing", item: { model } });
                    return;
                }
                await adminApi.publishPricing(item.id);
            } else if (item?.status === "active") {
                await adminApi.retirePricing(item.id);
            }
            await load();
            message.success(enabled ? `${model.displayName} 定价已启用` : `${model.displayName} 定价已停用`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "定价状态更新失败");
        }
    };

    const toggleProduct = async (product: RechargeProduct, enabled: boolean) => {
        try {
            await adminApi.saveProduct({ ...product, status: enabled ? "active" : "hidden" }, product.id);
            await load();
            message.success(enabled ? "充值套餐已启用" : "充值套餐已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "套餐状态更新失败");
        }
    };

    const editor = () => {
        const type = modal?.type;
        const item = modal?.item;
        const initial =
            type === "model"
                ? { ...item, publicConfig: jsonValue(item?.publicConfig) }
                : type === "route"
                  ? { ...item, settings: jsonValue(item?.settings) }
                  : type === "pricing"
                    ? {
                          publishedModelId: item?.model?.id,
                          pricingType: item?.pricing?.formula?.type || recommendedPricingType(item?.model?.capability),
                          unitAmount: Number(item?.pricing?.formula?.unitAmount || 1),
                          baseAmount: Number(item?.pricing?.formula?.baseAmount || 0),
                          minimumAmount: Number(item?.pricing?.formula?.minimumAmount || 0),
                          inputTokenAmount: Number(item?.pricing?.formula?.inputTokenAmount || 0),
                          outputTokenAmount: Number(item?.pricing?.formula?.outputTokenAmount || 0),
                          cachedTokenAmount: Number(item?.pricing?.formula?.cachedTokenAmount || 0),
                          variants: Array.isArray(item?.pricing?.formula?.variants) ? item.pricing.formula.variants : modelVariantOptions(item?.model).map((variant) => ({ key: variant.key, label: variant.label, unitAmount: 1 })),
                          enabled: item?.pricing ? item.pricing.status === "active" : true,
                      }
                    : type === "product"
                      ? { ...item, payAmountYuan: item ? item.payAmountFen / 100 : undefined, enabled: item ? item.status === "active" : true, customChannelEnabled: item?.customChannelEnabled || false, customChannelLimit: item?.customChannelLimit || 0, customChannelDays: item?.customChannelDays || 0 }
                      : {};
        return (
            <Modal open onCancel={() => setModal(undefined)} title={type === "model" ? "模型" : type === "route" ? "模型渠道调度" : type === "pricing" ? "新增定价" : type === "product" ? "充值套餐" : "积分调整"} footer={null}>
                <Form layout="vertical" initialValues={initial} onFinish={save}>
                    {type === "model" && (
                        <>
                            <Form.Item name="capability" label="能力" rules={[{ required: true }]}>
                                <Select options={["image", "text", "audio", "video"].map((value) => ({ value, label: value }))} />
                            </Form.Item>
                            <Form.Item name="displayName" label="展示名称" rules={[{ required: true }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="publicConfig" label="公开配置">
                                <Input.TextArea rows={4} />
                            </Form.Item>
                            <Form.Item name="status" label="状态">
                                <Select options={statusOptions} />
                            </Form.Item>
                            <Form.Item name="sortOrder" label="排序">
                                <InputNumber />
                            </Form.Item>
                        </>
                    )}
                    {type === "route" && (
                        <>
                            <RouteEditorFields channels={channels} models={models} />
                            <Form.Item name="priority" label="优先级">
                                <InputNumber min={0} />
                            </Form.Item>
                            <Form.Item name="weight" label="同优先级权重" extra="同一优先级内按权重分配请求比例">
                                <InputNumber min={1} />
                            </Form.Item>
                            <Form.Item name="status" label="状态">
                                <Select options={statusOptions} />
                            </Form.Item>
                            <Form.Item name="settings" label="路由设置">
                                <Input.TextArea rows={3} />
                            </Form.Item>
                        </>
                    )}
                    {type === "pricing" && (
                        <>
                            <Form.Item name="publishedModelId" label="选择模型" rules={[{ required: true, message: "请选择模型" }]}>
                                <Select showSearch optionFilterProp="label" options={models.map((value) => ({ value: value.id, label: `${value.displayName} · ${value.capability}` }))} />
                            </Form.Item>
                            <Form.Item name="pricingType" label="计费方式" rules={[{ required: true }]}>
                                <Select options={[{ value: "fixed", label: "固定价格（每次请求）" }, { value: "per_unit", label: "按生成数量" }, { value: "per_second", label: "按秒" }, { value: "per_token", label: "按 Token" }]} />
                            </Form.Item>
                            <Form.Item name="unitAmount" label="单价（积分）" rules={[{ required: true, message: "请填写单价" }]}>
                                <InputNumber className="w-full" min={1} precision={0} />
                            </Form.Item>
                            <div className="grid grid-cols-2 gap-4">
                                <Form.Item name="baseAmount" label="基础积分">
                                    <InputNumber className="w-full" min={0} precision={0} />
                                </Form.Item>
                                <Form.Item name="minimumAmount" label="最低消费积分">
                                    <InputNumber className="w-full" min={0} precision={0} />
                                </Form.Item>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">建议：生图按张计费，视频按秒计费，文本按 Token 计费。文本可分别填写输入、输出和缓存 Token 单价。</div>
                            <div className="grid grid-cols-3 gap-3"><Form.Item name="inputTokenAmount" label="输入 Token"><InputNumber className="w-full" min={0} precision={0} /></Form.Item><Form.Item name="outputTokenAmount" label="输出 Token"><InputNumber className="w-full" min={0} precision={0} /></Form.Item><Form.Item name="cachedTokenAmount" label="缓存 Token"><InputNumber className="w-full" min={0} precision={0} /></Form.Item></div>
                            <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-800">
                                <div className="mb-2 text-sm font-medium">质量 / 输出方式价格</div>
                                <div className="mb-3 text-xs text-stone-500">8K 只有在渠道模型能力开启时才会出现在用户侧；原生与超分可以分别定价。</div>
                                <Form.List name="variants">
                                    {(fields, { add, remove }) => <>
                                        {fields.map((field) => <div key={field.key} className="mb-2 grid grid-cols-[1fr_1fr_120px_auto] gap-2">
                                            <Form.Item {...field} name={[field.name, "key"]} noStyle><Input placeholder="key，如 4k / upscale" /></Form.Item>
                                            <Form.Item {...field} name={[field.name, "label"]} noStyle><Input placeholder="显示名称" /></Form.Item>
                                            <Form.Item {...field} name={[field.name, "unitAmount"]} noStyle><InputNumber className="w-full" min={0} precision={0} placeholder="积分" /></Form.Item>
                                            <Button type="text" danger onClick={() => remove(field.name)}>移除</Button>
                                        </div>)}
                                        <Button type="dashed" block onClick={() => add({ unitAmount: 1 })}>增加质量价格</Button>
                                    </>}
                                </Form.List>
                            </div>
                            <Form.Item name="enabled" label="保存后启用" valuePropName="checked">
                                <Switch checkedChildren="开" unCheckedChildren="关" />
                            </Form.Item>
                        </>
                    )}
                    {type === "product" && (
                        <>
                            <Form.Item name="name" label="套餐名称" rules={[{ required: true }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="payAmountYuan" label="支付金额（元）" rules={[{ required: true }]}>
                                <InputNumber className="w-full" min={1} precision={2} prefix="¥" />
                            </Form.Item>
                            <Form.Item label="基础积分"><Input disabled value="按 1 元 = 100 积分自动计算" /></Form.Item>
                            <Form.Item name="giftQuota" label="赠送积分">
                                <InputNumber min={0} />
                            </Form.Item>
                            <Form.Item name="customChannelEnabled" valuePropName="checked" label="自定义渠道权益"><Switch checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>
                            <div className="grid grid-cols-2 gap-4"><Form.Item name="customChannelLimit" label="渠道数量"><InputNumber className="w-full" min={0} /></Form.Item><Form.Item name="customChannelDays" label="权益天数"><InputNumber className="w-full" min={0} placeholder="0 表示长期" /></Form.Item></div>
                            <Form.Item name="enabled" label="启用套餐" valuePropName="checked">
                                <Switch checkedChildren="开" unCheckedChildren="关" />
                            </Form.Item>
                            <Form.Item name="sortOrder" label="排序">
                                <InputNumber />
                            </Form.Item>
                        </>
                    )}
                    {type === "quota" && (
                        <>
                            <Form.Item name="userId" label="用户 ID" rules={[{ required: true }]}>
                                <InputNumber min={1} />
                            </Form.Item>
                            <Form.Item name="delta" label="积分变动（负数为扣减）" rules={[{ required: true }]}>
                                <InputNumber />
                            </Form.Item>
                            <Form.Item name="source" label="来源">
                                <Input placeholder="admin" />
                            </Form.Item>
                            <Form.Item name="reason" label="备注">
                                <Input.TextArea rows={2} />
                            </Form.Item>
                        </>
                    )}
                    <Button type="primary" htmlType="submit" icon={<Save className="size-4" />} block>
                        保存
                    </Button>
                </Form>
            </Modal>
        );
    };

    const saveInvitation = async (values: InvitationSettings) => {
        try {
            setInvitation(await adminApi.saveInvitation(values));
            message.success("邀请奖励已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const savePayment = async (values: PaymentSettings) => {
        try {
            setPayment(await adminApi.savePayment(values));
            message.success("支付配置已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const saveEmail = async (values: EmailSettings) => {
        try {
            setEmail(await adminApi.saveEmail({ ...values, allowedDomains: values.allowedDomains || [], blockedDomains: values.blockedDomains || [] }));
            message.success("邮箱配置已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    };
    const sendTestEmail = async () => {
        try {
            await adminApi.testEmail(testEmail.trim());
            message.success("测试邮件已发送");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "测试邮件发送失败");
        }
    };

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] px-4 py-4 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-6">
            <div className="w-full">
                <div className="mb-4 flex items-center justify-between border-b border-stone-200 pb-4 dark:border-stone-800">
                    <div>
                        <h1 className="text-xl font-semibold tracking-[-.03em]">运营控制台</h1>
                        <p className="mt-1 text-xs text-stone-500">模型、渠道、计费和账户管理</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                    <aside className="w-full shrink-0 rounded-2xl border border-stone-200 bg-white/80 p-3 dark:border-stone-800 dark:bg-stone-950/70 lg:sticky lg:top-4 lg:w-60">
                        <div className="space-y-5">
                            <div>
                                <div className="mb-1 px-3 text-xs font-medium text-stone-400">运营中心</div>
                                <div className="space-y-1">
                                    {[
                                        { key: "overview", label: "总览", icon: LayoutDashboard },
                                        { key: "users", label: "用户管理", icon: Users },
                                        { key: "usage", label: "使用日志", icon: ScrollText },
                                    ].map(({ key, label, icon: Icon }) => (
                                        <Button key={key} type={activeSection === key ? "primary" : "text"} block className="!justify-start" icon={<Icon className="size-4" />} onClick={() => setActiveSection(key)}>
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="mb-1 px-3 text-xs font-medium text-stone-400">模型服务</div>
                                <div className="space-y-1">
                                    {[
                                        { key: "models", label: "模型目录", icon: Boxes },
                                        { key: "channels", label: "渠道管理", icon: Route },
                                        { key: "pricing", label: "定价与充值", icon: CircleDollarSign },
                                        { key: "subscriptions", label: "订阅与成本", icon: CircleDollarSign },
                                    ].map(({ key, label, icon: Icon }) => (
                                        <Button key={key} type={activeSection === key ? "primary" : "text"} block className="!justify-start" icon={<Icon className="size-4" />} onClick={() => setActiveSection(key)}>
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="mb-1 px-3 text-xs font-medium text-stone-400">财务与系统</div>
                                <div className="space-y-1">
                                    {[
                                        { key: "operations", label: "账户与支付", icon: WalletCards },
                                        { key: "email", label: "邮箱与注册", icon: Mail },
                                        { key: "settings", label: "系统设置", icon: Settings2 },
                                    ].map(({ key, label, icon: Icon }) => (
                                        <Button key={key} type={activeSection === key ? "primary" : "text"} block className="!justify-start" icon={<Icon className="size-4" />} onClick={() => key === "settings" ? navigate("/admin/settings") : setActiveSection(key)}>
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </aside>
                    <section className="min-w-0 flex-1">
                <Tabs
                    activeKey={activeSection}
                    onChange={setActiveSection}
                    styles={{ header: { display: "none" } }}
                    items={[
                        {
                            key: "overview",
                            label: "总览",
                            children: (
                                <Space direction="vertical" className="w-full" size="large">
                                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                        <Card size="small"><div className="text-sm text-stone-500">用户模型</div><div className="mt-2 text-2xl font-semibold">{models.length}</div><div className="mt-1 text-xs text-stone-400">{models.filter((model) => model.status === "active").length} 个已开放</div></Card>
                                        <Card size="small"><div className="text-sm text-stone-500">活跃渠道</div><div className="mt-2 text-2xl font-semibold">{channels.filter((channel) => channel.status === "active").length}</div><div className="mt-1 text-xs text-stone-400">共 {channels.length} 个渠道</div></Card>
                                        <Card size="small"><div className="text-sm text-stone-500">可用路由</div><div className="mt-2 text-2xl font-semibold">{routes.filter((route) => route.available).length}</div><div className="mt-1 text-xs text-stone-400">共 {routes.length} 条路由</div></Card>
                                        <Card size="small"><div className="text-sm text-stone-500">启用定价</div><div className="mt-2 text-2xl font-semibold">{pricing.filter((item) => item.status === "active").length}</div><div className="mt-1 text-xs text-stone-400">充值套餐 {products.filter((product) => product.status === "active").length} 个</div></Card>
                                    </div>
                                    <Card title="运营状态" extra={<Button type="link" icon={<RefreshCw className="size-4" />} onClick={() => void load()}>刷新数据</Button>}>
                                        <div className="grid gap-4 md:grid-cols-3">
                                            <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-900"><div className="flex items-center gap-2 text-sm font-medium"><Activity className="size-4 text-emerald-500" />渠道服务</div><div className="mt-2 text-xs text-stone-500">{channels.filter((channel) => channel.status === "active").length ? "已有启用渠道" : "等待配置渠道"}</div></div>
                                            <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-900"><div className="flex items-center gap-2 text-sm font-medium"><SlidersHorizontal className="size-4 text-orange-500" />模型发布</div><div className="mt-2 text-xs text-stone-500">{models.filter((model) => model.status === "active").length} 个模型对用户开放</div></div>
                                            <div className="rounded-xl bg-stone-50 p-4 dark:bg-stone-900"><div className="flex items-center gap-2 text-sm font-medium"><Settings2 className="size-4 text-blue-500" />后台配置</div><div className="mt-2 text-xs text-stone-500">从左侧选择模块开始管理</div></div>
                                        </div>
                                    </Card>
                                </Space>
                            ),
                        },
                        {
                            key: "users",
                            label: "用户管理",
                            children: <UserManagement loading={loading} />,
                        },
                        {
                            key: "usage",
                            label: "使用日志",
                            children: <UsageLogManagement />,
                        },
                        {
                            key: "operations",
                            label: "订单与财务",
                            children: <OperationsManagement />,
                        },
                        {
                            key: "models",
                            label: "模型目录",
                            children: (
                                <Card title="用户模型目录" extra={<div className="text-xs text-stone-500">开放前必须同时具备可用路由和启用定价</div>}>
                                    <Table
                                        rowKey="id"
                                        loading={loading}
                                        dataSource={models}
                                        pagination={false}
                                        columns={[
                                            { title: "模型", dataIndex: "displayName", render: (value) => <span className="font-medium">{value}</span> },
                                            { title: "能力", dataIndex: "capability", render: (value) => <Tag>{value}</Tag> },
                                            {
                                                title: "渠道路由",
                                                render: (_, model) => {
                                                    const modelRoutes = routes.filter((route) => route.publishedModelId === model.id);
                                                    const available = modelRoutes.filter((route) => route.available).length;
                                                    return <span>{available} / {modelRoutes.length} 可用</span>;
                                                },
                                            },
                                            {
                                                title: "定价",
                                                render: (_, model) => {
                                                    const active = pricing.find((item) => item.publishedModelId === model.id && item.status === "active");
                                                    return active ? <Tag color="success">{Number(active.formula.unitAmount || 0)} 积分</Tag> : <Tag color="warning">未启用</Tag>;
                                                },
                                            },
                                            {
                                                title: "用户可用状态",
                                                render: (_, model) => {
                                                    const routeReady = routes.some((route) => route.publishedModelId === model.id && route.available);
                                                    const priceReady = pricing.some((item) => item.publishedModelId === model.id && item.status === "active");
                                                    const ready = model.status === "active" && routeReady && priceReady;
                                                    const label = ready ? "可用" : model.status !== "active" ? "目录已停用" : !routeReady ? "缺少可用路由" : "定价未启用";
                                                    return <Tag color={ready ? "success" : "warning"}>{label}</Tag>;
                                                },
                                            },
                                            {
                                                title: "开放给用户",
                                                width: 130,
                                                render: (_, model) => <Switch checked={model.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(checked) => void toggleModel(model, checked)} />,
                                            },
                                            {
                                                title: "操作",
                                                width: 100,
                                                render: (_, row) => (
                                                    <Button type="link" onClick={() => setModal({ type: "model", item: row })}>编辑</Button>
                                                ),
                                            },
                                        ]}
                                    />
                                </Card>
                            ),
                        },
                        {
                            key: "channels",
                            label: "渠道管理",
                            children: <ChannelManagement channels={channels} routes={routes} loading={loading} onAddChannel={() => setChannelEditor(null)} onEditChannel={setChannelEditor} onToggleChannel={toggleChannel} onAddRoute={() => setModal({ type: "route" })} onEditRoute={(route) => setModal({ type: "route", item: route })} onToggleRoute={toggleRoute} onDeleteRoute={(route) => hide("route", route.id)} />,
                        },
                        {
                            key: "pricing",
                            label: "定价与充值",
                            children: <PricingManagement models={models} pricing={pricing} products={products} loading={loading} onEditPricing={(model, item) => setModal({ type: "pricing", item: { model, pricing: item } })} onTogglePricing={togglePricing} onEditProduct={(product) => setModal({ type: "product", item: product })} onToggleProduct={toggleProduct} />,
                        },
                        {
                            key: "subscriptions",
                            label: "订阅与成本",
                            children: <SubscriptionManagement models={models} channels={channels} />,
                        },
                        {
                            key: "account-payment",
                            label: "账户与支付",
                            children: (
                                <Space direction="vertical" className="w-full" size="large">
                                    <Card title="邀请奖励">
                                        <Form layout="inline" initialValues={invitation} key={JSON.stringify(invitation)} onFinish={saveInvitation}>
                                            <Form.Item name="open" label="开启" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="inviterQuota" label="邀请人积分">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="inviteeQuota" label="新用户积分">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Button type="primary" htmlType="submit">
                                                保存
                                            </Button>
                                        </Form>
                                    </Card>
                                    <Card title="支付设置">
                                        <Form layout="vertical" initialValues={payment} key={JSON.stringify(payment)} onFinish={savePayment}>
                                            <Form.Item name="enabled" label="启用支付" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="gatewayUrl" label="网关地址">
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="callbackUrl" label="异步回调地址" extra="必须是支付网关可以访问到的账户服务地址，例如 https://example.com">
                                                <Input placeholder="https://example.com" />
                                            </Form.Item>
                                            <Form.Item name="partnerId" label="商户号">
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="key" label="密钥">
                                                <Input.Password placeholder="留空保持当前密钥" />
                                            </Form.Item>
                                            <Form.Item name="payMethods" label="支付方式">
                                                <Select mode="tags" options={[{ value: "alipay" }, { value: "wxpay" }]} />
                                            </Form.Item>
                                            <Button type="primary" htmlType="submit" icon={<Settings2 className="size-4" />}>
                                                保存支付配置
                                            </Button>
                                        </Form>
                                    </Card>
                                    <Card
                                        title="积分调整"
                                        extra={
                                            <Button type="primary" onClick={() => setModal({ type: "quota" })}>
                                                调整用户积分
                                            </Button>
                                        }
                                    >
                                        <p className="text-sm text-stone-500">使用用户 ID 直接增加或扣减积分，所有操作都会写入积分流水。</p>
                                    </Card>
                                </Space>
                            ),
                        },
                        {
                            key: "email",
                            label: "邮箱与注册",
                            children: (
                                <Card title="邮箱与注册">
                                    <Form
                                        layout="vertical"
                                        initialValues={{ ...email, allowedDomains: email?.allowedDomains?.join("\n"), blockedDomains: email?.blockedDomains?.join("\n") }}
                                        key={JSON.stringify(email)}
                                        onFinish={(values) =>
                                            saveEmail({
                                                ...values,
                                                allowedDomains: String(values.allowedDomains || "")
                                                    .split(/[,\n]/)
                                                    .map((value) => value.trim())
                                                    .filter(Boolean),
                                                blockedDomains: String(values.blockedDomains || "")
                                                    .split(/[,\n]/)
                                                    .map((value) => value.trim())
                                                    .filter(Boolean),
                                            })
                                        }
                                    >
                                        <Space wrap>
                                            <Form.Item name="enabled" label="启用邮箱服务" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="registrationEnabled" label="开放用户注册" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="verificationRequired" label="注册需要邮箱验证" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="domainRestrictionEnabled" label="限制邮箱域名" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="aliasRestrictionEnabled" label="限制邮箱别名" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Space>
                                        <Space wrap className="w-full">
                                            <Form.Item name="smtpHost" label="SMTP 地址" className="min-w-64">
                                                <Input placeholder="smtp.example.com" />
                                            </Form.Item>
                                            <Form.Item name="smtpPort" label="端口">
                                                <InputNumber min={1} max={65535} />
                                            </Form.Item>
                                            <Form.Item name="smtpUsername" label="用户名" className="min-w-52">
                                                <Input />
                                            </Form.Item>
                                            <Form.Item name="smtpPassword" label="密码" className="min-w-52">
                                                <Input.Password placeholder="留空保留当前密码" />
                                            </Form.Item>
                                            <Form.Item name="smtpFrom" label="发件人" className="min-w-64">
                                                <Input placeholder="no-reply@example.com" />
                                            </Form.Item>
                                            <Form.Item name="smtpSSLEnabled" label="SMTP SSL" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="smtpForceAuthLogin" label="强制 AUTH LOGIN" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Space>
                                        <Form.Item name="allowedDomains" label="允许邮箱域名" extra="每行或逗号分隔；启用域名限制后必须填写">
                                            <Input.TextArea rows={2} placeholder="example.com" />
                                        </Form.Item>
                                        <Form.Item name="blockedDomains" label="禁止邮箱域名" extra="每行或逗号分隔，命中后始终拒绝">
                                            <Input.TextArea rows={2} placeholder="disposable.example" />
                                        </Form.Item>
                                        <Space wrap>
                                            <Button type="primary" htmlType="submit" icon={<Save className="size-4" />}>
                                                保存邮箱配置
                                            </Button>
                                            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="测试收件邮箱" className="min-w-64" />
                                            <Button onClick={() => void sendTestEmail()} disabled={!testEmail.trim()}>
                                                发送测试邮件
                                            </Button>
                                        </Space>
                                    </Form>
                                </Card>
                            ),
                        },
                    ]}
                />
                    </section>
                </div>
                {modal && editor()}
                <AdminChannelEditorDrawer open={channelEditor !== undefined} channel={channelEditor || null} models={models} costs={modelCosts} onSave={saveChannel} onClose={() => setChannelEditor(undefined)} />
            </div>
        </main>
    );
}

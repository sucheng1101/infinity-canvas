import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag, Tooltip } from "antd";
import { Plus, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { adminApi, type AdminChannel, type AdminRoute, type EmailSettings, type InvitationSettings, type PaymentSettings, type PricingVersion } from "@/services/api/admin";
import type { PublishedModel, RechargeProduct } from "@/services/api/hosted";
import { useAuthStore } from "@/stores/use-auth-store";
import { AdminChannelEditorDrawer } from "./components/channel-editor-drawer";

const statusOptions = [
    { value: "active", label: "启用" },
    { value: "hidden", label: "隐藏" },
];
const jsonValue = (value: unknown) => JSON.stringify(value || {});

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
    const { message } = App.useApp();
    const [models, setModels] = useState<PublishedModel[]>([]);
    const [channels, setChannels] = useState<AdminChannel[]>([]);
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

    const routeGroups = Array.from(
        routes.reduce((groups, route) => {
            const group = groups.get(route.publishedModelId) || { id: route.publishedModelId, model: route.publishedModel, routes: [] as AdminRoute[] };
            group.routes.push(route);
            groups.set(route.publishedModelId, group);
            return groups;
        }, new Map<number, { id: number; model: string; routes: AdminRoute[] }>()).values(),
    );

    const load = async () => {
        setLoading(true);
        try {
            const modelResult = await adminApi.models();
            const [channelResult, routeResult, pricingResult, productResult, invitationResult, paymentResult, emailResult] = await Promise.all([
                adminApi.channels(),
                adminApi.routes(),
                adminApi.pricing(),
                adminApi.products(),
                adminApi.invitation(),
                adminApi.payment(),
                adminApi.email(),
            ]);
            setModels(modelResult.items);
            setChannels(channelResult.items);
            setRoutes(routeResult.items);
            setPricing(pricingResult.items);
            setProducts(productResult.items);
            setInvitation(invitationResult);
            setPayment(paymentResult);
            setEmail(emailResult);
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
            if (type === "pricing") await adminApi.createPricing({ ...values, formula: JSON.parse(values.formula || "{}") });
            if (type === "product") await adminApi.saveProduct(values, modal?.item?.id);
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

    const saveChannel = async (values: Parameters<typeof adminApi.createChannel>[0]) => {
        try {
            if (channelEditor) await adminApi.updateChannel(channelEditor.id, values);
            else await adminApi.createChannel(values);
            setChannelEditor(undefined);
            await load();
            message.success("渠道已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道保存失败");
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
                    ? { currency: "CNY", formula: '{"type":"fixed","unitAmount":1}' }
                    : type === "product"
                      ? item
                      : {};
        return (
            <Modal open onCancel={() => setModal(undefined)} title={type === "model" ? "模型" : type === "route" ? "模型渠道调度" : type === "pricing" ? "新增定价" : type === "product" ? "充值套餐" : "额度调整"} footer={null}>
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
                            <Form.Item name="publishedModelId" label="公开模型" rules={[{ required: true }]}>
                                <Select options={models.map((value) => ({ value: value.id, label: value.displayName }))} />
                            </Form.Item>
                            <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="formula" label="计费公式" rules={[{ required: true }]}>
                                <Input.TextArea rows={5} />
                            </Form.Item>
                        </>
                    )}
                    {type === "product" && (
                        <>
                            <Form.Item name="name" label="套餐名称" rules={[{ required: true }]}>
                                <Input />
                            </Form.Item>
                            <Form.Item name="payAmountFen" label="支付金额（分）" rules={[{ required: true }]}>
                                <InputNumber min={100} />
                            </Form.Item>
                            <Form.Item name="quotaAmount" label="额度" rules={[{ required: true }]}>
                                <InputNumber min={1} />
                            </Form.Item>
                            <Form.Item name="giftQuota" label="赠送额度">
                                <InputNumber min={0} />
                            </Form.Item>
                            <Form.Item name="status" label="状态">
                                <Select options={statusOptions} />
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
                            <Form.Item name="delta" label="额度变动（负数为扣减）" rules={[{ required: true }]}>
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
        <main className="h-full overflow-y-auto bg-[#f7f7f5] px-5 py-8 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-8">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-orange-600">ADMIN CONSOLE</div>
                        <h1 className="text-3xl font-semibold tracking-[-.04em]">运营控制台</h1>
                        <p className="mt-2 text-sm text-stone-500">统一维护模型、渠道、定价与账户额度。</p>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>
                        刷新
                    </Button>
                </div>
                <Tabs
                    items={[
                        {
                            key: "models",
                            label: "模型目录",
                            children: (
                                <Card>
                                    <Table
                                        rowKey="id"
                                        dataSource={models}
                                        columns={[
                                            { title: "名称", dataIndex: "displayName" },
                                            { title: "能力", dataIndex: "capability" },
                                            { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "active" ? "green" : "default"}>{v === "active" ? "启用" : "隐藏"}</Tag> },
                                            {
                                                title: "操作",
                                                render: (_, row) => (
                                                    <Space>
                                                        <Button type="link" onClick={() => setModal({ type: "model", item: row })}>
                                                            编辑
                                                        </Button>
                                                        <Button danger type="link" icon={<Trash2 className="size-4" />} onClick={() => void hide("model", row.id)}>
                                                            删除
                                                        </Button>
                                                    </Space>
                                                ),
                                            },
                                        ]}
                                    />
                                </Card>
                            ),
                        },
                        {
                            key: "channels",
                            label: "渠道与路由",
                            children: (
                                <Space direction="vertical" className="w-full" size="large">
                                    <Card
                                        title="渠道"
                                        extra={
                                            <Button icon={<Plus className="size-4" />} onClick={() => setChannelEditor(null)}>
                                                新增渠道
                                            </Button>
                                        }
                                    >
                                        <Table
                                            rowKey="id"
                                            dataSource={channels}
                                            columns={[
                                                { title: "名称", dataIndex: "name" },
                                                { title: "协议", render: () => "OpenAI" },
                                                { title: "地址", dataIndex: "baseUrl" },
                                                { title: "专用 Key", render: (_, row) => (row.modelApiKeys.length ? `${row.modelApiKeys.length} 个` : "未设置") },
                                                {
                                                    title: "模型",
                                                    render: (_, row) => (
                                                        <Tooltip title={row.models.length ? row.models.map((item) => `${item.name}（${item.capability}）`).join("、") : "暂无模型"}>
                                                            <span className="cursor-help">{row.models.length} 个</span>
                                                        </Tooltip>
                                                    ),
                                                },
                                                {
                                                    title: "操作",
                                                    render: (_, row) => (
                                                        <Space>
                                                            <Button type="link" onClick={() => setChannelEditor(row)}>
                                                                编辑
                                                            </Button>
                                                            <Button danger type="link" onClick={() => void hide("channel", row.id)}>
                                                                隐藏
                                                            </Button>
                                                        </Space>
                                                    ),
                                                },
                                            ]}
                                        />
                                    </Card>
                                    <Card
                                        title="模型路由"
                                        extra={
                                            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ type: "route" })}>
                                                新增路由
                                            </Button>
                                        }
                                    >
                                        <Table
                                            rowKey="id"
                                            dataSource={routeGroups}
                                            columns={[
                                                { title: "公开模型", dataIndex: "model", width: 180 },
                                                {
                                                    title: "渠道优先级与权重",
                                                    render: (_, group) => (
                                                        <Space direction="vertical" className="w-full" size={8}>
                                                            {[...group.routes].sort((a, b) => a.priority - b.priority || a.id - b.id).map((row) => (
                                                                <div key={row.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-stone-100 pb-2 last:border-0 last:pb-0 dark:border-stone-800">
                                                                    <Space size={6} wrap>
                                                                        <Tag>优先级 {row.priority}</Tag>
                                                                        <span>{row.channelName} · {row.upstreamModel}</span>
                                                                        <Tag color={row.available ? "green" : row.status === "hidden" ? "default" : "orange"}>
                                                                            {row.available ? "可用" : row.status === "hidden" ? "已禁用" : "渠道未就绪"}
                                                                        </Tag>
                                                                    </Space>
                                                                    <span className="text-xs text-stone-500">权重 {row.weight} · 同级比例 {row.weightPercent.toFixed(1)}%</span>
                                                                    <Space size="small">
                                                                        <Button type="link" onClick={() => setModal({ type: "route", item: row })}>编辑</Button>
                                                                        <Button type="link" onClick={() => void toggleRoute(row)}>{row.status === "active" ? "禁用" : "启用"}</Button>
                                                                        <Button danger type="link" onClick={() => void hide("route", row.id)}>删除</Button>
                                                                    </Space>
                                                                </div>
                                                            ))}
                                                        </Space>
                                                    ),
                                                },
                                            ]}
                                        />
                                    </Card>
                                </Space>
                            ),
                        },
                        {
                            key: "pricing",
                            label: "定价与充值",
                            children: (
                                <Space direction="vertical" className="w-full" size="large">
                                    <Card
                                        title="模型定价"
                                        extra={
                                            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ type: "pricing" })}>
                                                新增定价
                                            </Button>
                                        }
                                    >
                                        <Table
                                            rowKey="id"
                                            dataSource={pricing}
                                            columns={[
                                                { title: "模型", dataIndex: "publishedModel" },
                                                { title: "版本", dataIndex: "version" },
                                                { title: "公式", dataIndex: "formula", render: jsonValue },
                                                { title: "状态", dataIndex: "status" },
                                                {
                                                    title: "操作",
                                                    render: (_, row) => (
                                                        <Space>
                                                            {row.status === "draft" && (
                                                                <Button
                                                                    type="link"
                                                                    onClick={async () => {
                                                                        await adminApi.publishPricing(row.id);
                                                                        await load();
                                                                    }}
                                                                >
                                                                    发布
                                                                </Button>
                                                            )}
                                                            {row.status === "active" && (
                                                                <Button
                                                                    type="link"
                                                                    onClick={async () => {
                                                                        await adminApi.retirePricing(row.id);
                                                                        await load();
                                                                    }}
                                                                >
                                                                    停用
                                                                </Button>
                                                            )}
                                                        </Space>
                                                    ),
                                                },
                                            ]}
                                        />
                                    </Card>
                                    <Card
                                        title="充值套餐"
                                        extra={
                                            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ type: "product" })}>
                                                新增套餐
                                            </Button>
                                        }
                                    >
                                        <Table
                                            rowKey="id"
                                            dataSource={products}
                                            columns={[
                                                { title: "名称", dataIndex: "name" },
                                                { title: "金额（分）", dataIndex: "payAmountFen" },
                                                { title: "额度", dataIndex: "quotaAmount" },
                                                { title: "赠送", dataIndex: "giftQuota" },
                                                { title: "状态", dataIndex: "status" },
                                                {
                                                    title: "操作",
                                                    render: (_, row) => (
                                                        <Button type="link" onClick={() => setModal({ type: "product", item: row })}>
                                                            编辑
                                                        </Button>
                                                    ),
                                                },
                                            ]}
                                        />
                                    </Card>
                                </Space>
                            ),
                        },
                        {
                            key: "operations",
                            label: "账户与支付",
                            children: (
                                <Space direction="vertical" className="w-full" size="large">
                                    <Card title="邀请奖励">
                                        <Form layout="inline" initialValues={invitation} key={JSON.stringify(invitation)} onFinish={saveInvitation}>
                                            <Form.Item name="open" label="开启" valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                            <Form.Item name="inviterQuota" label="邀请人额度">
                                                <InputNumber min={0} />
                                            </Form.Item>
                                            <Form.Item name="inviteeQuota" label="新用户额度">
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
                                        title="额度调整"
                                        extra={
                                            <Button type="primary" onClick={() => setModal({ type: "quota" })}>
                                                调整用户额度
                                            </Button>
                                        }
                                    >
                                        <p className="text-sm text-stone-500">使用用户 ID 直接增加或扣减额度，所有操作都会写入额度流水。</p>
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
                {modal && editor()}
                <AdminChannelEditorDrawer open={channelEditor !== undefined} channel={channelEditor || null} onSave={saveChannel} onClose={() => setChannelEditor(undefined)} />
            </div>
        </main>
    );
}

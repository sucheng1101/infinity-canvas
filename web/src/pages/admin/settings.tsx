import { App, Button, Card, Checkbox, Descriptions, Form, Input, InputNumber, Select, Space, Spin, Switch, Table, Tag } from "antd";
import { ArrowLeft, CheckCircle2, RefreshCw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { adminApi, type EmailSettings, type PaymentSettings, type SecurityAccess, type SystemRelease } from "@/services/api/admin";
import { useAuthStore } from "@/stores/use-auth-store";

const emptyEmail: EmailSettings = { enabled: false, verificationRequired: false, registrationEnabled: true, domainRestrictionEnabled: false, aliasRestrictionEnabled: false, smtpHost: "", smtpPort: 587, smtpUsername: "", smtpFrom: "", smtpSSLEnabled: true, smtpForceAuthLogin: false, allowedDomains: [], blockedDomains: [] };
const emptyPayment: PaymentSettings = { enabled: false, gatewayUrl: "", partnerId: "", payMethods: ["alipay", "wxpay"], callbackUrl: "" };
type Panel = "system" | "email" | "payment" | "version" | "security";

export default function AdminSettingsPage() {
    const user = useAuthStore((state) => state.user);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [activePanel, setActivePanel] = useState<Panel>("system");
    const [email, setEmail] = useState<EmailSettings>(emptyEmail);
    const [payment, setPayment] = useState<PaymentSettings>(emptyPayment);
    const [release, setRelease] = useState<SystemRelease>();
    const [security, setSecurity] = useState<SecurityAccess>();
    const [loading, setLoading] = useState(false);
    const [checking, setChecking] = useState(false);
    const loaded = useRef(new Set<Panel>());

    const loadPanel = async (panel: Panel, force = false) => {
        if (!force && loaded.current.has(panel)) return;
        if (panel === "system") {
            loaded.current.add(panel);
            return;
        }
        setLoading(true);
        try {
            if (panel === "email") setEmail({ ...emptyEmail, ...(await adminApi.email()) });
            if (panel === "payment") setPayment({ ...emptyPayment, ...(await adminApi.payment()), key: undefined });
            if (panel === "version") {
                setRelease(await adminApi.systemRelease());
            }
            if (panel === "security") setSecurity(await adminApi.securityAccess());
            loaded.current.add(panel);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "系统设置读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user?.role === "admin") void loadPanel(activePanel);
    }, [user?.role, activePanel]);

    if (user?.role !== "admin") return <Navigate to="/app" replace />;

    const saveEmail = async (values: EmailSettings) => {
        try {
            const next = await adminApi.saveEmail({ ...values, allowedDomains: values.allowedDomains || [], blockedDomains: values.blockedDomains || [] });
            setEmail({ ...emptyEmail, ...next });
            message.success("邮箱设置已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "邮箱设置保存失败"); }
    };

    const savePayment = async (values: PaymentSettings) => {
        try {
            const next = await adminApi.savePayment(values);
            setPayment({ ...emptyPayment, ...next, key: undefined });
            message.success("支付设置已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "支付设置保存失败"); }
    };

    const checkRelease = async () => {
        setChecking(true);
        try { setRelease(await adminApi.checkSystemRelease()); message.success("版本信息已刷新"); }
        catch (error) { message.error(error instanceof Error ? error.message : "版本检查失败"); }
        finally { setChecking(false); }
    };

    const requestUpdate = async () => {
        if (!release?.latestVersion) return;
        try { setRelease(await adminApi.requestSystemUpdate(release.latestVersion)); message.success("更新任务已创建"); }
        catch (error) { message.error(error instanceof Error ? error.message : "更新任务创建失败"); }
    };

    const saveSecurity = async (ipLoggingEnabled: boolean) => {
        try {
            const settings = await adminApi.saveSecuritySettings({ ipLoggingEnabled });
            setSecurity((current) => current ? { ...current, settings } : current);
            message.success("安全访问设置已保存");
        } catch (error) { message.error(error instanceof Error ? error.message : "安全访问设置保存失败"); }
    };

    const addBlock = async (values: { value: string; reason?: string }) => {
        try {
            const block = await adminApi.createIPBlock(values);
            setSecurity((current) => current ? { ...current, blocks: [block, ...current.blocks] } : current);
            message.success("IP 黑名单已添加");
        } catch (error) { message.error(error instanceof Error ? error.message : "IP 黑名单添加失败"); }
    };

    const refresh = () => void loadPanel(activePanel, true);
    const navItems: Array<{ key: Panel; label: string }> = [
        { key: "system", label: "系统信息" },
        { key: "email", label: "邮箱与注册" },
        { key: "payment", label: "支付与积分" },
        { key: "version", label: "版本管理" },
        { key: "security", label: "安全与访问" },
    ];

    const panel = activePanel === "system" ? <Card title="系统信息" extra={<Button icon={<RefreshCw className="size-4" />} onClick={refresh}>刷新</Button>}><Descriptions bordered column={{ xs: 1, md: 2 }} items={[{ key: "points", label: "积分换算", children: "1 元 = 100 积分（固定）" }, { key: "billing", label: "计费模式", children: "生图按张、视频按秒、文本按 Token" }, { key: "quality", label: "质量能力", children: "按模型与渠道开放低 / 中 / 高、1K / 2K / 4K / 8K 及原生 / 超分" }]} /></Card>
        : activePanel === "email" ? <Card title="邮箱与注册" extra={<Button icon={<RefreshCw className="size-4" />} onClick={refresh}>刷新</Button>}><Form layout="vertical" initialValues={email} key={JSON.stringify(email)} onFinish={saveEmail}><Space wrap className="mb-4"><Form.Item name="enabled" valuePropName="checked" noStyle><Checkbox>启用邮箱服务</Checkbox></Form.Item><Form.Item name="registrationEnabled" valuePropName="checked" noStyle><Checkbox>开放用户注册</Checkbox></Form.Item><Form.Item name="verificationRequired" valuePropName="checked" noStyle><Checkbox>注册需要邮箱验证</Checkbox></Form.Item><Form.Item name="domainRestrictionEnabled" valuePropName="checked" noStyle><Checkbox>启用邮箱域名白名单</Checkbox></Form.Item><Form.Item name="aliasRestrictionEnabled" valuePropName="checked" noStyle><Checkbox>启用邮箱别名限制</Checkbox></Form.Item></Space><Form.Item name="allowedDomains" label="允许的邮箱域名" extra="开启白名单后，仅允许这些域名注册"><Select mode="tags" tokenSeparators={[",", " "]} placeholder="例如 qq.com、example.com" /></Form.Item><Form.Item name="blockedDomains" label="禁止的邮箱域名"><Select mode="tags" tokenSeparators={[",", " "]} placeholder="例如 disposable.example" /></Form.Item><div className="grid gap-4 md:grid-cols-2"><Form.Item name="smtpHost" label="SMTP 服务器"><Input /></Form.Item><Form.Item name="smtpPort" label="SMTP 端口"><InputNumber className="w-full" min={1} max={65535} /></Form.Item><Form.Item name="smtpUsername" label="SMTP 账户"><Input /></Form.Item><Form.Item name="smtpFrom" label="发件邮箱"><Input /></Form.Item><Form.Item name="smtpPassword" label="SMTP 密码"><Input.Password placeholder="留空保持原密码" /></Form.Item><Form.Item name="smtpSSLEnabled" valuePropName="checked" label="SMTP SSL"><Checkbox>启用 SSL</Checkbox></Form.Item><Form.Item name="smtpForceAuthLogin" valuePropName="checked" label="认证方式"><Checkbox>强制 AUTH LOGIN</Checkbox></Form.Item></div><Button type="primary" htmlType="submit" icon={<Save className="size-4" />}>保存邮箱设置</Button></Form></Card>
        : activePanel === "payment" ? <Card title="支付与积分" extra={<Button icon={<RefreshCw className="size-4" />} onClick={refresh}>刷新</Button>}><Form layout="vertical" initialValues={payment} key={JSON.stringify(payment)} onFinish={savePayment}><Form.Item name="enabled" valuePropName="checked"><Checkbox>启用在线支付</Checkbox></Form.Item><div className="grid gap-4 md:grid-cols-2"><Form.Item name="gatewayUrl" label="支付网关"><Input /></Form.Item><Form.Item name="partnerId" label="商户号"><Input /></Form.Item><Form.Item name="key" label="支付密钥"><Input.Password placeholder="留空保持原密钥" /></Form.Item><Form.Item name="callbackUrl" label="回调地址"><Input /></Form.Item></div><Form.Item name="payMethods" label="支付方式"><Select mode="multiple" options={[{ value: "alipay", label: "支付宝" }, { value: "wxpay", label: "微信支付" }]} /></Form.Item><div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">积分换算固定为 1 元 = 100 积分，充值套餐按支付金额自动计算基础积分。</div><Button type="primary" htmlType="submit" icon={<Save className="size-4" />}>保存支付设置</Button></Form></Card>
        : activePanel === "version" ? <Card title="版本管理" extra={<Button icon={<RefreshCw className="size-4" />} loading={checking} onClick={() => void checkRelease()}>检查更新</Button>}><div className="grid gap-4 md:grid-cols-3"><Card size="small"><div className="text-xs text-stone-500">当前运行版本</div><div className="mt-2 text-xl font-semibold">{release?.currentVersion || "dev"}</div></Card><Card size="small"><div className="text-xs text-stone-500">官方仓库版本</div><div className="mt-2 text-xl font-semibold">{release?.latestVersion || "-"}</div><div className="mt-1 break-all text-xs text-stone-400">{release?.sourceUrl || "官方仓库"}</div></Card><Card size="small"><div className="text-xs text-stone-500">任务状态</div><div className="mt-2">{release?.updateJob ? <Tag color="processing">{release.updateJob.status}</Tag> : <Tag>暂无任务</Tag>}</div></Card></div><div className="mt-5 flex flex-wrap items-center gap-3">{release?.hasUpdate ? <Button type="primary" onClick={() => void requestUpdate()}>创建更新任务</Button> : <Tag icon={<CheckCircle2 className="size-3.5" />} color="success">当前已是最新版本</Tag>}<span className="text-xs text-stone-500">更新任务会记录目标版本，执行前完成备份和健康检查。</span></div><div className="mt-6 max-h-96 overflow-auto rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs leading-6 dark:border-stone-800 dark:bg-stone-900"><pre className="whitespace-pre-wrap">{release?.changelog || "暂无更新说明"}</pre></div></Card>
        : <Card title="安全与访问" extra={<Space><Button icon={<RefreshCw className="size-4" />} onClick={refresh}>刷新</Button><Switch checked={security?.settings.ipLoggingEnabled ?? true} checkedChildren="记录 IP" unCheckedChildren="关闭记录" onChange={(checked) => void saveSecurity(checked)} /></Space>}><div className="mb-6 grid gap-4 lg:grid-cols-2"><Card size="small" title="新增 IP 黑名单"><Form layout="vertical" onFinish={addBlock}><Form.Item name="value" label="IP 或 CIDR 网段" rules={[{ required: true }]}><Input placeholder="例如 203.0.113.8 或 203.0.113.0/24" /></Form.Item><Form.Item name="reason" label="备注"><Input placeholder="异常访问" /></Form.Item><Button type="primary" htmlType="submit">添加黑名单</Button></Form></Card><Card size="small" title="当前会话"><Table size="small" rowKey="id" pagination={{ pageSize: 5 }} dataSource={security?.sessions || []} columns={[{ title: "用户", dataIndex: "userId" }, { title: "IP", dataIndex: "ip" }, { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "操作", render: (_, item) => <Button size="small" onClick={() => void adminApi.revokeSession(item.id).then(() => { setSecurity((current) => current ? { ...current, sessions: current.sessions.filter((session) => session.id !== item.id) } : current); message.success("会话已撤销"); })}>撤销</Button> }]} /></Card></div><Card size="small" className="mb-6" title="IP 黑名单"><Table size="small" rowKey="id" pagination={false} dataSource={security?.blocks || []} columns={[{ title: "地址", dataIndex: "value" }, { title: "备注", dataIndex: "reason" }, { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "操作", render: (_, item) => <Button size="small" danger onClick={() => void adminApi.deleteIPBlock(item.id).then(() => { setSecurity((current) => current ? { ...current, blocks: current.blocks.filter((block) => block.id !== item.id) } : current); message.success("IP 黑名单已移除"); })}>移除</Button> }]} /></Card><div className="grid gap-4 lg:grid-cols-2"><Card size="small" title="最近访问事件"><Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={security?.events || []} columns={[{ title: "事件", dataIndex: "eventType" }, { title: "IP", dataIndex: "ip" }, { title: "结果", dataIndex: "success", render: (value: boolean) => <Tag color={value ? "success" : "error"}>{value ? "成功" : "失败"}</Tag> }, { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }, { title: "详情", dataIndex: "detail" }]} /></Card><Card size="small" title="管理员审计"><Table size="small" rowKey="id" pagination={{ pageSize: 8 }} dataSource={security?.audits || []} columns={[{ title: "动作", dataIndex: "action" }, { title: "资源", render: (_, item) => `${item.resourceType} / ${item.resourceId}` }, { title: "管理员", dataIndex: "operatorId" }, { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }]} /></Card></div></Card>;

    return <main className="h-full overflow-y-auto bg-[#f7f7f5] text-stone-950 dark:bg-[#11110f] dark:text-stone-100"><div className="border-b border-stone-200 bg-white/85 px-6 py-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/80"><Button type="text" icon={<ArrowLeft className="size-4" />} onClick={() => navigate("/admin")}>返回运营台</Button></div><div className="flex min-h-[calc(100%-65px)]"><aside className="w-56 shrink-0 border-r border-stone-200 bg-white/65 p-3 dark:border-stone-800 dark:bg-stone-950/55"><div className="mb-3 px-3 text-xs font-semibold text-stone-400">配置</div><nav className="space-y-1">{navItems.map((item) => <button key={item.key} type="button" onClick={() => setActivePanel(item.key)} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${activePanel === item.key ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-900 dark:text-stone-100" : "text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-900/60"}`}>{item.label}</button>)}</nav></aside><section className="min-w-0 flex-1 p-5 sm:p-8">{loading ? <div className="flex min-h-80 items-center justify-center"><Spin /></div> : panel}</section></div></main>;
}

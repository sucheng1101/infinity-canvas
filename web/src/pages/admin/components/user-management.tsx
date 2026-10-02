import { App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, Tag } from "antd";
import { Plus, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, type AdminUser, type AdminUserDetail } from "@/services/api/admin";

type Props = { loading?: boolean };
type Editor = { mode: "create" | "edit"; user?: AdminUser } | null;

const statusLabels: Record<AdminUser["status"], string> = { active: "启用", pending: "待验证", blocked: "停用" };

export function UserManagement({ loading: parentLoading }: Props) {
    const { message } = App.useApp();
    const [items, setItems] = useState<AdminUser[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ q: "", status: "", role: "", groupName: "" });
    const [loading, setLoading] = useState(false);
    const [editor, setEditor] = useState<Editor>(null);
    const [selected, setSelected] = useState<AdminUser | null>(null);
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);
    const [quotaUser, setQuotaUser] = useState<AdminUser | null>(null);
    const [passwordUser, setPasswordUser] = useState<AdminUser | null>(null);

    const load = async (nextPage = page) => {
        setLoading(true);
        try {
            const result = await adminApi.users({ ...filters, page: nextPage, pageSize: 20 });
            setItems(result.items);
            setTotal(result.total);
            setPage(result.page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "用户列表读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load(1);
    }, [filters.q, filters.status, filters.role, filters.groupName]);

    const openDetail = async (user: AdminUser) => {
        setSelected(user);
        try {
            setDetail(await adminApi.user(user.id));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "用户详情读取失败");
        }
    };

    const saveEditor = async (values: Record<string, unknown>) => {
        try {
            if (editor?.mode === "edit" && editor.user) await adminApi.updateUser(editor.user.id, values);
            else await adminApi.createUser(values);
            setEditor(null);
            await load();
            message.success("用户信息已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "用户保存失败");
        }
    };

    const changeStatus = async (user: AdminUser, checked: boolean) => {
        try {
            await adminApi.updateUserStatus(user.id, checked ? "active" : "blocked");
            await load();
            message.success(checked ? "用户已启用" : "用户已停用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "用户状态更新失败");
        }
    };

    const adjustQuota = async (values: { delta: number; reason: string }) => {
        if (!quotaUser) return;
        try {
            await adminApi.adjustUserQuota(quotaUser.id, values);
            setQuotaUser(null);
            await load();
            message.success("积分已调整");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分调整失败");
        }
    };

    const resetPassword = async (values: { newPassword?: string }) => {
        if (!passwordUser) return;
        try {
            const result = await adminApi.resetUserPassword(passwordUser.id, values.newPassword);
            setPasswordUser(null);
            message.success(`密码已重置：${result.temporaryPassword}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码重置失败");
        }
    };

    return (
        <Card
            title="用户管理"
            extra={
                <Space>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading || parentLoading} onClick={() => void load()}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ mode: "create" })}>
                        新建用户
                    </Button>
                </Space>
            }
        >
            <Space wrap className="mb-4 w-full">
                <Input.Search className="w-64" allowClear placeholder="搜索用户名、邮箱、显示名称" value={filters.q} onChange={(event) => setFilters((value) => ({ ...value, q: event.target.value }))} onSearch={() => void load(1)} />
                <Select allowClear className="w-32" placeholder="状态" value={filters.status || undefined} onChange={(value) => setFilters((state) => ({ ...state, status: value || "" }))} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} />
                <Select allowClear className="w-32" placeholder="角色" value={filters.role || undefined} onChange={(value) => setFilters((state) => ({ ...state, role: value || "" }))} options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} />
                <Input className="w-36" allowClear placeholder="分组" value={filters.groupName} onChange={(event) => setFilters((state) => ({ ...state, groupName: event.target.value }))} />
            </Space>
            <Table
                rowKey="id"
                loading={loading || parentLoading}
                dataSource={items}
                pagination={{ current: page, pageSize: 20, total, showSizeChanger: false, onChange: (next) => void load(next) }}
                columns={[
                    { title: "用户", render: (_, user) => <Space><UserRound className="size-4 text-stone-400" /><div><div className="font-medium">{user.displayName || user.username}</div><div className="text-xs text-stone-500">{user.email}</div></div></Space> },
                    { title: "分组", dataIndex: "groupName", render: (value) => value || <span className="text-stone-400">未分组</span> },
                    { title: "角色", dataIndex: "role", render: (value) => value === "admin" ? <Tag color="orange" icon={<ShieldCheck className="size-3" />}>管理员</Tag> : <Tag>普通用户</Tag> },
                    { title: "积分", render: (_, user) => <span>{user.quota.available.toLocaleString()}</span> },
                    { title: "注册时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                    { title: "状态", render: (_, user) => <Switch size="small" checked={user.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(checked) => void changeStatus(user, checked)} /> },
                    { title: "操作", render: (_, user) => <Space size="small"><Button type="link" onClick={() => void openDetail(user)}>详情</Button><Button type="link" onClick={() => setEditor({ mode: "edit", user })}>编辑</Button><Button type="link" onClick={() => setQuotaUser(user)}>积分</Button><Button type="link" onClick={() => setPasswordUser(user)}>重置密码</Button></Space> },
                ]}
            />

            {editor && <Drawer open width={440} title={editor.mode === "create" ? "新建用户" : "编辑用户"} onClose={() => setEditor(null)}>
                <Form id="admin-user-form" layout="vertical" initialValues={editor.user || { status: "active", role: "user" }} onFinish={saveEditor}>
                    {editor.mode === "create" && <><Form.Item name="username" label="用户名" rules={[{ required: true, min: 3 }]}><Input /></Form.Item><Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}><Input /></Form.Item><Form.Item name="password" label="初始密码" rules={[{ required: true, min: 8 }]}><Input.Password /></Form.Item></>}
                    <Form.Item name="displayName" label="显示名称"><Input /></Form.Item>
                    <Form.Item name="groupName" label="用户分组"><Input placeholder="例如：设计团队" /></Form.Item>
                    <Form.Item name="role" label="角色"><Select options={[{ value: "user", label: "普通用户" }, { value: "admin", label: "管理员" }]} /></Form.Item>
                    <Form.Item name="status" label="状态"><Select options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
                    <Form.Item name="remark" label="备注"><Input.TextArea rows={4} /></Form.Item>
                    <Button type="primary" htmlType="submit" block>保存用户</Button>
                </Form>
            </Drawer>}

            {quotaUser && <Drawer open width={400} title={`调整积分 · ${quotaUser.username}`} onClose={() => setQuotaUser(null)}>
                <Form layout="vertical" onFinish={adjustQuota}><Form.Item name="delta" label="积分变动（负数为扣减）" rules={[{ required: true }]}><InputNumber className="w-full" /></Form.Item><Form.Item name="reason" label="调整原因" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item><Button type="primary" htmlType="submit" block>提交调整</Button></Form>
            </Drawer>}

            {passwordUser && <Drawer open width={400} title={`重置密码 · ${passwordUser.username}`} onClose={() => setPasswordUser(null)}><Form layout="vertical" onFinish={resetPassword}><Form.Item name="newPassword" label="新密码" extra="留空将自动生成临时密码"><Input.Password /></Form.Item><Button type="primary" htmlType="submit" block>重置密码</Button></Form></Drawer>}

            <Drawer open={Boolean(selected)} width={560} title="用户详情" onClose={() => { setSelected(null); setDetail(null); }}>
                {detail && <><Descriptions bordered size="small" column={1} items={[{ label: "用户名", children: detail.user.username }, { label: "邮箱", children: detail.user.email }, { label: "状态", children: statusLabels[detail.user.status] }, { label: "可用积分", children: detail.user.quota.available.toLocaleString() }, { label: "注册时间", children: new Date(detail.user.createdAt).toLocaleString() }, { label: "最近登录", children: detail.user.lastLoginAt ? new Date(detail.user.lastLoginAt).toLocaleString() : "暂无记录" }]} /><div className="mt-6 font-medium">最近积分流水</div><Table className="mt-2" size="small" rowKey="id" dataSource={detail.ledger} pagination={false} columns={[{ title: "变动", dataIndex: "delta", render: (value: number) => <span className={Number(value) < 0 ? "text-red-500" : "text-emerald-600"}>{Number(value) > 0 ? `+${value}` : value}</span> }, { title: "余额", dataIndex: "balanceAfter" }, { title: "原因", dataIndex: "reason" }, { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() }]} /><div className="mt-6 font-medium">最近使用记录</div><Table className="mt-2" size="small" rowKey="id" dataSource={detail.usage} pagination={false} scroll={{ x: 700 }} columns={[{ title: "模型", dataIndex: "publishedModel" }, { title: "状态", dataIndex: "status" }, { title: "IP", dataIndex: "ip", render: (value: string) => value || "-" }, { title: "质量", render: (_, item) => `${item.requestedQuality || "-"} / ${item.actualQuality || "-"}` }, { title: "积分", dataIndex: "chargedQuota" }, { title: "时间", dataIndex: "startedAt", render: (value: string) => new Date(value).toLocaleString() }]} /></>}
            </Drawer>
        </Card>
    );
}

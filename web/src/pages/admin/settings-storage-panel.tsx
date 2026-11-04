import { App, Button, Drawer, Form, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import { Pencil, Plus, RefreshCw, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminApi, type StorageProvider, type StorageProviderInput } from "@/services/api/admin";

const emptyForm: StorageProviderInput = {
    name: "",
    driver: "local",
    enabled: true,
    isDefault: false,
    endpoint: "",
    region: "auto",
    bucket: "",
    publicBase: "",
    usePathStyle: true,
    localDir: "",
    sortOrder: 0,
};

const toInput = (row: StorageProvider): StorageProviderInput => ({
    name: row.name,
    driver: row.driver,
    enabled: row.enabled,
    isDefault: row.isDefault,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    publicBase: row.publicBase,
    usePathStyle: row.usePathStyle,
    localDir: row.localDir,
    sortOrder: row.sortOrder,
});

export function StorageProviderPanel() {
    const { message } = App.useApp();
    const [rows, setRows] = useState<StorageProvider[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<StorageProvider>();
    const [form] = Form.useForm<StorageProviderInput>();
    const driver = Form.useWatch("driver", form);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setRows((await adminApi.storageProviders()).items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "存储配置读取失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(undefined);
        form.setFieldsValue(emptyForm);
        setOpen(true);
    };

    const openEdit = (row: StorageProvider) => {
        setEditing(row);
        form.setFieldsValue({ ...toInput(row), accessKey: "", secretKey: "" });
        setOpen(true);
    };

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) await adminApi.updateStorageProvider(editing.id, values);
            else await adminApi.createStorageProvider(values);
            message.success(editing ? "存储配置已更新" : "存储配置已创建");
            setOpen(false);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const test = async (row: StorageProvider) => {
        try {
            await adminApi.testStorageProvider(row.id);
            message.success(`${row.name} 连接正常`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "连接测试失败");
        }
    };

    const remove = async (row: StorageProvider) => {
        try {
            await adminApi.deleteStorageProvider(row.id);
            message.success("存储配置已删除");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    const makeDefault = async (row: StorageProvider) => {
        try {
            await adminApi.updateStorageProvider(row.id, { ...toInput(row), isDefault: true });
            message.success(`已设为默认：${row.name}`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "设置默认失败");
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-stone-500">在这里配置存储后，用户可在「个人设置」里选择自己使用的存储；未配置默认值时使用管理员默认项。</p>
                <Space>
                    <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        新增存储
                    </Button>
                </Space>
            </div>
            <Table
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={rows}
                pagination={false}
                columns={[
                    {
                        title: "名称",
                        dataIndex: "name",
                        render: (_, row) => (
                            <Space size={6}>
                                <span>{row.name}</span>
                                {row.isDefault ? <Tag color="orange">默认</Tag> : null}
                                {row.enabled ? null : <Tag>已停用</Tag>}
                            </Space>
                        ),
                    },
                    { title: "驱动", dataIndex: "driver", width: 90, render: (value: string) => (value === "s3" ? "S3 兼容" : "本地磁盘") },
                    {
                        title: "位置",
                        render: (_, row) => (row.driver === "s3" ? `${row.endpoint} / ${row.bucket}` : row.localDir || "默认目录"),
                    },
                    {
                        title: "凭证",
                        width: 190,
                        render: (_, row) => (row.driver === "s3" ? row.accessKeyMask || "未配置" : "—"),
                    },
                    {
                        title: "就绪",
                        width: 80,
                        render: (_, row) => <Tag color={row.ready ? "success" : "warning"}>{row.ready ? "可用" : "待补全"}</Tag>,
                    },
                    {
                        title: "操作",
                        width: 260,
                        render: (_, row) => (
                            <Space size={4}>
                                <Button size="small" type="text" icon={<Pencil className="size-4" />} onClick={() => openEdit(row)}>
                                    编辑
                                </Button>
                                <Button size="small" type="text" icon={<Wifi className="size-4" />} onClick={() => void test(row)}>
                                    测试
                                </Button>
                                {row.isDefault ? null : (
                                    <Button size="small" type="text" onClick={() => void makeDefault(row)}>
                                        设为默认
                                    </Button>
                                )}
                                <Popconfirm title="删除该存储配置？" description="引用它的用户会回到管理员默认项。" onConfirm={() => void remove(row)}>
                                    <Button size="small" type="text" danger>
                                        删除
                                    </Button>
                                </Popconfirm>
                            </Space>
                        ),
                    },
                ]}
            />

            <Drawer
                title={editing ? "编辑存储" : "新增存储"}
                size={520}
                open={open}
                onClose={() => setOpen(false)}
                extra={
                    <Space>
                        <Button onClick={() => setOpen(false)}>取消</Button>
                        <Button type="primary" loading={saving} onClick={() => void submit()}>
                            保存
                        </Button>
                    </Space>
                }
            >
                <Form form={form} layout="vertical" initialValues={emptyForm}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                        <Input placeholder="例如：MinIO 主存储" />
                    </Form.Item>
                    <Form.Item name="driver" label="驱动" rules={[{ required: true }]}>
                        <Select
                            options={[
                                { value: "local", label: "本地磁盘（经 /api/v1/files 提供）" },
                                { value: "s3", label: "S3 兼容（MinIO / R2 / OSS / COS / B2 / AWS）" },
                            ]}
                        />
                    </Form.Item>
                    {driver === "s3" ? (
                        <>
                            <Form.Item name="endpoint" label="Endpoint" rules={[{ required: true, message: "请填写 Endpoint" }]}>
                                <Input placeholder="https://oss-cn-hangzhou.aliyuncs.com" />
                            </Form.Item>
                            <Form.Item name="region" label="Region">
                                <Input placeholder="auto" />
                            </Form.Item>
                            <Form.Item name="bucket" label="Bucket" rules={[{ required: true, message: "请填写 Bucket" }]}>
                                <Input placeholder="infinite-canvas" />
                            </Form.Item>
                            <Form.Item name="accessKey" label="Access Key" extra={editing?.accessKeyMask ? `已保存：${editing.accessKeyMask}，留空表示不修改` : undefined}>
                                <Input placeholder="AK" autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="secretKey" label="Secret Key" extra={editing?.secretKeyMask ? `已保存：${editing.secretKeyMask}，留空表示不修改` : undefined}>
                                <Input.Password placeholder="SK" autoComplete="off" />
                            </Form.Item>
                            <Form.Item name="publicBase" label="公网访问前缀" extra="留空则用 Endpoint/Bucket 拼接；有 CDN 时填 CDN 地址">
                                <Input placeholder="https://cdn.example.com/assets" />
                            </Form.Item>
                            <Form.Item name="usePathStyle" label="使用 path-style" valuePropName="checked" extra="MinIO / R2 / OSS / COS 需要开启">
                                <Switch />
                            </Form.Item>
                        </>
                    ) : (
                        <Form.Item name="localDir" label="本地目录" extra="留空使用服务端 STORAGE_LOCAL_DIR">
                            <Input placeholder="data/uploads" />
                        </Form.Item>
                    )}
                    <Form.Item name="sortOrder" label="排序">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="isDefault" label="设为默认" valuePropName="checked" extra="用户未选择时使用该存储">
                        <Switch />
                    </Form.Item>
                </Form>
            </Drawer>
        </div>
    );
}

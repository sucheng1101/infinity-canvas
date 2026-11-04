import { App, Button, Empty, Form, Image, Input, Modal, Popconfirm, Segmented, Select, Space, Spin, Tag, Upload } from "antd";
import { Plus, Search, Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { assetsApi, type AssetItem, type AssetKind } from "@/services/api/assets";

const kindLabels: Record<AssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    media: "素材",
};

type Filter = AssetKind | "all";

export default function AssetLibraryPage() {
    const { message } = App.useApp();
    const [items, setItems] = useState<AssetItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState<string | null>(null);
    const [form] = Form.useForm<{ name: string; kind: AssetKind; prompt?: string; tags?: string[] }>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await assetsApi.list({ kind: filter === "all" ? undefined : filter, q: keyword.trim() || undefined, pageSize: 100 });
            setItems(data.items);
            setTotal(data.total);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "资产读取失败");
        } finally {
            setLoading(false);
        }
    }, [filter, keyword, message]);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await assetsApi.create({ ...values, license: "own" });
            message.success("资产已创建");
            setOpen(false);
            form.resetFields();
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建失败");
        } finally {
            setSaving(false);
        }
    };

    const upload = async (asset: AssetItem, file: File) => {
        setUploading(asset.id);
        try {
            await assetsApi.uploadImage(asset.id, file);
            message.success(`${asset.name} 已添加参考图`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploading(null);
        }
        return false;
    };

    const remove = async (asset: AssetItem) => {
        try {
            await assetsApi.remove(asset.id);
            message.success("资产已删除");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败");
        }
    };

    return (
        <div className="h-full overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
            <div className="mx-auto max-w-6xl">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <div className="text-xs font-medium uppercase tracking-[.22em] text-orange-600">ASSET LIBRARY</div>
                        <h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">资产库</h1>
                        <p className="mt-1 text-sm text-stone-500">角色、场景与道具在这里统一维护，可跨项目复用参考图。</p>
                    </div>
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            form.setFieldsValue({ kind: "character", name: "", prompt: "", tags: [] });
                            setOpen(true);
                        }}
                    >
                        新增资产
                    </Button>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索资产名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="max-w-xs" />
                    <Segmented
                        value={filter}
                        onChange={(value) => setFilter(value as Filter)}
                        options={[
                            { value: "all", label: "全部" },
                            ...(Object.keys(kindLabels) as AssetKind[]).map((kind) => ({ value: kind, label: kindLabels[kind] })),
                        ]}
                    />
                    <span className="text-xs text-stone-400">共 {total} 项</span>
                </div>

                {loading ? (
                    <div className="flex h-60 items-center justify-center">
                        <Spin />
                    </div>
                ) : items.length === 0 ? (
                    <Empty className="mt-16" description="还没有资产，先建一个角色卡试试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {items.map((asset) => (
                            <div key={asset.id} className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
                                <div className="relative flex h-36 items-center justify-center bg-stone-50 dark:bg-stone-900">
                                    {asset.images[0] ? (
                                        <Image src={asset.images[0].url} alt={asset.name} className="h-full w-full object-cover" preview={{ mask: null }} />
                                    ) : (
                                        <span className="text-xs text-stone-400">暂无参考图</span>
                                    )}
                                </div>
                                <div className="flex flex-1 flex-col gap-2 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="truncate text-sm font-medium">{asset.name}</span>
                                        <Tag className="!m-0">{kindLabels[asset.kind]}</Tag>
                                    </div>
                                    <p className="line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{asset.prompt || "未填写描述"}</p>
                                    <div className="mt-auto flex items-center justify-between">
                                        <Upload accept="image/*" showUploadList={false} beforeUpload={(file) => upload(asset, file as File)}>
                                            <Button size="small" type="text" loading={uploading === asset.id} icon={<UploadIcon className="size-3.5" />}>
                                                加参考图
                                            </Button>
                                        </Upload>
                                        <Space size={2}>
                                            <span className="text-[11px] text-stone-400">{asset.images.length} 张</span>
                                            <Popconfirm title="删除该资产？" description="参考图会一并删除。" onConfirm={() => void remove(asset)}>
                                                <Button size="small" type="text" danger>
                                                    删除
                                                </Button>
                                            </Popconfirm>
                                        </Space>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Modal title="新增资产" open={open} onCancel={() => setOpen(false)} onOk={() => void create()} confirmLoading={saving} okText="创建">
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
                        <Select options={(Object.keys(kindLabels) as AssetKind[]).map((kind) => ({ value: kind, label: kindLabels[kind] }))} />
                    </Form.Item>
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                        <Input placeholder="例如：女主 · 古风" />
                    </Form.Item>
                    <Form.Item name="prompt" label="固化描述" extra="写清楚外观，后续分镜会复用它保持一致性">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：20 岁女性，黑长直，米白襦裙，冷白肤色" />
                    </Form.Item>
                    <Form.Item name="tags" label="标签">
                        <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="回车添加标签" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}

import { App, Button, Checkbox, Drawer, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

import { ModelScriptEditor } from "@/components/layout/model-script-editor";
import { adminApi, type AdminChannel, type AdminChannelInput, type AdminChannelModel, type AdminModelCostPricing } from "@/services/api/admin";
import type { PublishedModel } from "@/services/api/hosted";
import { guessCapability, type ModelCapability } from "@/stores/use-config-store";

type DraftKey = {
    localId: string;
    id?: number;
    name: string;
    apiKey: string;
    apiKeySet: boolean;
    models: string[];
};

type DraftChannel = {
    name: string;
    provider: string;
    baseUrl: string;
    originalBaseUrl: string;
    modelApiKeys: DraftKey[];
    models: AdminChannelModel[];
    settings: Record<string, unknown>;
    status: "active" | "hidden";
    sortOrder: number;
};

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type QualitySpec = NonNullable<AdminChannelModel["qualitySpec"]>;
type ChannelModelCost = { id?: number; publishedModelId: number; billingUnit: string; costPerUnit: number; sellPerUnit: number; status: "active" | "hidden" };

const capabilityOptions = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];

const qualityOptions = (capability: ModelCapability, scheme: string, supports8K = false) => {
    if (scheme === "none") return [];
    const options = scheme === "tier"
        ? [{ key: "auto", label: "自动" }, { key: "low", label: "低质量" }, { key: "medium", label: "中质量" }, { key: "high", label: "高质量" }]
        : capability === "video"
            ? [{ key: "720p", label: "720p" }, { key: "1080p", label: "1080p" }, { key: "2k", label: "2K" }, { key: "4k", label: "4K" }]
            : [{ key: "1k", label: "1K" }, { key: "2k", label: "2K" }, { key: "4k", label: "4K" }];
    return supports8K ? [...options, { key: "8k", label: "8K" }] : options;
};

function createDraft(channel: AdminChannel | null): DraftChannel {
    if (!channel) {
        return { name: "", provider: "openai", baseUrl: "", originalBaseUrl: "", modelApiKeys: [], models: [], settings: {}, status: "active", sortOrder: 0 };
    }
    return {
        name: channel.name,
        provider: channel.provider || "openai",
        baseUrl: channel.baseUrl,
        originalBaseUrl: channel.baseUrl,
        modelApiKeys: (channel.modelApiKeys || []).map((item) => ({ localId: String(item.id), id: item.id, name: item.name, apiKey: "", apiKeySet: item.apiKeySet, models: item.models || [] })),
        models: channel.models || [],
        settings: channel.settings || {},
        status: channel.status,
        sortOrder: channel.sortOrder,
    };
}

export function AdminChannelEditorDrawer({ open, channel, models, costs, onSave, onClose }: { open: boolean; channel: AdminChannel | null; models: PublishedModel[]; costs: AdminModelCostPricing[]; onSave: (input: AdminChannelInput, modelCosts: Array<ChannelModelCost & { upstreamModel: string }>) => Promise<void>; onClose: () => void }) {
    const { message, modal } = App.useApp();
    const [draft, setDraft] = useState<DraftChannel>(() => createDraft(channel));
    const [saving, setSaving] = useState(false);
    const [fetchingAll, setFetchingAll] = useState(false);
    const [fetchingKeyId, setFetchingKeyId] = useState("");
    const [keyModelTargetId, setKeyModelTargetId] = useState("");
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [modelEditor, setModelEditor] = useState<AdminChannelModel | null>(null);
    const [modelCapability, setModelCapability] = useState<ModelCapability>("text");
    const [modelQualitySpec, setModelQualitySpec] = useState<QualitySpec>({});
    const [modelCost, setModelCost] = useState<ChannelModelCost | null>(null);
    const [configuredCosts, setConfiguredCosts] = useState<Record<string, ChannelModelCost>>({});

    useEffect(() => {
        if (!open) return;
        setDraft(createDraft(channel));
        setKeyModelTargetId("");
        setAvailableModels([]);
        setSelectedModels([]);
        setScriptTarget(null);
        setModelEditor(null);
        setModelQualitySpec({});
        const initialCosts: Record<string, ChannelModelCost> = {};
        (channel ? costs.filter((item) => item.channelId === channel.id) : []).forEach((item) => {
            initialCosts[item.upstreamModel] = { id: item.id, publishedModelId: item.publishedModelId, billingUnit: item.billingUnit, costPerUnit: item.costPerUnit, sellPerUnit: item.sellPerUnit, status: item.status === "hidden" ? "hidden" : "active" };
        });
        setConfiguredCosts(initialCosts);
        setModelCost(null);
    }, [channel, costs, open]);

    const patch = (value: Partial<DraftChannel>) => setDraft((current) => ({ ...current, ...value }));
    const setKeys = (modelApiKeys: DraftKey[]) => patch({ modelApiKeys });
    const setModels = (models: AdminChannelModel[]) => patch({ models });
    const targetKey = draft.modelApiKeys.find((item) => item.localId === keyModelTargetId) || null;
    const duplicateKeyIds = new Set(draft.modelApiKeys.filter((item) => item.apiKey.trim() && draft.modelApiKeys.some((other) => other.localId !== item.localId && other.apiKey.trim() === item.apiKey.trim())).map((item) => item.localId));

    const patchKey = (localId: string, value: Partial<DraftKey>) => setKeys(draft.modelApiKeys.map((item) => (item.localId === localId ? { ...item, ...value } : item)));
    const removeModel = (name: string) => {
        setModels(draft.models.filter((model) => model.name !== name));
        setKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.models.filter((model) => model !== name) })));
        setConfiguredCosts((current) => { const next = { ...current }; delete next[name]; return next; });
    };
    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const setModelStatus = (name: string, status: "active" | "hidden") => setModels(draft.models.map((model) => (model.name === name ? { ...model, status } : model)));
    const setQualitySpec = (name: string, qualitySpec: QualitySpec) => setModels(draft.models.map((model) => (model.name === name ? { ...model, qualitySpec } : model)));
    const defaultBillingUnit = (capability: string) => capability === "image" ? "image" : capability === "video" ? "second" : capability === "text" ? "token" : "request";
    const findPublishedModel = (name: string) => models.find((item) => item.sourceModel === name || item.displayName === name);
    const openModelEditor = (item: AdminChannelModel) => {
        setModelEditor(item);
        setModelCapability(item.capability);
        setModelQualitySpec(item.qualitySpec || {});
        const published = findPublishedModel(item.name);
        setModelCost(configuredCosts[item.name] || { publishedModelId: published?.id || 0, billingUnit: defaultBillingUnit(item.capability), costPerUnit: 0, sellPerUnit: Number(published?.priceSummary?.unitAmount || 0), status: "active" });
    };

    const readKeyModels = async (item: DraftKey) => {
        if (!draft.baseUrl.trim()) throw new Error("请先填写 Base URL");
        if (!item.apiKey.trim() && !item.id) throw new Error("请先填写模型专用 Key");
        if (!item.apiKey.trim() && item.id && draft.baseUrl.trim().replace(/\/+$/, "") !== draft.originalBaseUrl.trim().replace(/\/+$/, "")) throw new Error("更换 Base URL 后请重新输入该模型专用 Key");
        return (await adminApi.fetchChannelModels({ baseUrl: draft.baseUrl, apiKey: item.apiKey.trim() || undefined, keyId: item.apiKey.trim() ? undefined : item.id })).items;
    };

    const openKeyModels = async (item: DraftKey) => {
        setFetchingKeyId(item.localId);
        try {
            const items = await readKeyModels(item);
            setAvailableModels(Array.from(new Set([...items, ...item.models])).sort((a, b) => a.localeCompare(b)));
            setSelectedModels(item.models);
            setKeyModelTargetId(item.localId);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "渠道模型读取失败");
        } finally {
            setFetchingKeyId("");
        }
    };

    const applyKeyModels = (localId: string, names: string[]) => {
        const selected = new Set(names);
        setKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.localId === localId ? names : item.models.filter((name) => !selected.has(name)) })));
        const known = new Map(draft.models.map((model) => [model.name, model]));
        setModels(Array.from(new Set([...draft.models.map((model) => model.name), ...names])).map((name) => known.get(name) || { name, capability: guessCapability(name) }));
    };

    const fetchAllModels = async () => {
        if (!draft.modelApiKeys.length) {
            message.error("请先添加至少一个模型专用 Key");
            return;
        }
        if (duplicateKeyIds.size) {
            message.error("模型专用 Key 不能重复");
            return;
        }
        setFetchingAll(true);
        const successful: Array<{ key: DraftKey; models: string[] }> = [];
        for (const key of draft.modelApiKeys) {
            try {
                successful.push({ key, models: await readKeyModels(key) });
            } catch {
                // Continue syncing the remaining keys and report the combined result.
            }
        }
        const assigned = new Set<string>();
        const modelApiKeys = draft.modelApiKeys.map((key) => {
            const result = successful.find((item) => item.key.localId === key.localId);
            const models = (result?.models || []).filter((name) => {
                if (assigned.has(name)) return false;
                assigned.add(name);
                return true;
            });
            return { ...key, models };
        });
        const known = new Map(draft.models.map((model) => [model.name, model]));
        setKeys(modelApiKeys);
        setModels(Array.from(assigned).map((name) => known.get(name) || { name, capability: guessCapability(name) }));
        const failed = draft.modelApiKeys.length - successful.length;
        if (failed) message.warning(`已同步 ${successful.length} 个 Key，${failed} 个失败`);
        else message.success(`已同步 ${successful.length} 个 Key 的模型`);
        setFetchingAll(false);
    };

    const save = async () => {
        if (!draft.name.trim() || !draft.baseUrl.trim()) {
            message.error("请填写渠道名称和 Base URL");
            return;
        }
        if (!draft.modelApiKeys.length) {
            message.error("请至少添加一个模型专用 Key");
            return;
        }
        if (duplicateKeyIds.size) {
            message.error("模型专用 Key 不能重复");
            return;
        }
        const baseUrlChanged = draft.baseUrl.trim().replace(/\/+$/, "") !== draft.originalBaseUrl.trim().replace(/\/+$/, "");
        const invalidKey = draft.modelApiKeys.find((item) => !item.name.trim() || (!item.apiKey.trim() && (!item.apiKeySet || baseUrlChanged)));
        if (invalidKey) {
            message.error(baseUrlChanged ? "更换 Base URL 后请重新输入所有模型专用 Key" : "请填写每个 Key 的名称和密钥");
            return;
        }
        const costsToSave = Object.entries(configuredCosts).map(([upstreamModel, item]) => ({ ...item, upstreamModel })).filter((item) => item.publishedModelId > 0);
        const lossMaking = costsToSave.filter((item) => item.sellPerUnit < item.costPerUnit);
        if (lossMaking.length) {
            const confirmed = await new Promise<boolean>((resolve) => modal.confirm({ title: "售价低于渠道成本", content: `有 ${lossMaking.length} 个渠道模型的售价低于成本，保存后会产生负利润。仍要保存吗？`, okText: "确认保存", cancelText: "返回修改", onOk: () => resolve(true), onCancel: () => resolve(false) }));
            if (!confirmed) return;
        }
        setSaving(true);
        try {
            await onSave({
                name: draft.name.trim(),
                provider: draft.provider,
                baseUrl: draft.baseUrl.trim(),
                modelApiKeys: draft.modelApiKeys.map((item) => ({ ...(item.id ? { id: item.id } : {}), name: item.name.trim(), apiKey: item.apiKey.trim(), models: item.models })),
                models: draft.models,
                settings: draft.settings,
                status: draft.status,
                sortOrder: draft.sortOrder,
            }, costsToSave);
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Drawer
                open={open}
                size={720}
                title={channel ? "编辑渠道" : "新增渠道"}
                onClose={onClose}
                styles={{ body: { paddingTop: 16 } }}
                extra={
                    <Space>
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" loading={saving} onClick={() => void save()}>
                            保存
                        </Button>
                    </Space>
                }
            >
                <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">渠道名称</span>
                        <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="例如：主图渠道" />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">协议</span>
                        <Input value="OpenAI 兼容" readOnly />
                    </label>
                    <label className="block md:col-span-2">
                        <span className="mb-1 block text-sm font-medium">Base URL</span>
                        <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://example.com" />
                    </label>
                </div>

                <div className="mt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold">模型专用 Key</div>
                            <div className="mt-0.5 text-xs text-stone-500">每个模型只绑定一个 Key；同步会更新模型列表，已保存密钥不会回显。</div>
                        </div>
                        <Space size="small" wrap>
                            <Button size="small" loading={fetchingAll} icon={<RefreshCw className="size-3.5" />} onClick={() => void fetchAllModels()}>
                                获取全部 Key 的模型
                            </Button>
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setKeys([...draft.modelApiKeys, { localId: nanoid(), name: `模型 Key ${draft.modelApiKeys.length + 1}`, apiKey: "", apiKeySet: false, models: [] }])}>
                                添加模型专用 Key
                            </Button>
                        </Space>
                    </div>
                    <div className="mt-3 space-y-3">
                        {draft.modelApiKeys.map((item) => (
                            <div key={item.localId} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_auto]">
                                    <Input value={item.name} onChange={(event) => patchKey(item.localId, { name: event.target.value })} prefix={<KeyRound className="size-3.5 text-stone-400" />} />
                                    <div>
                                        <Input.Password
                                            status={duplicateKeyIds.has(item.localId) ? "error" : undefined}
                                            value={item.apiKey}
                                            onChange={(event) => patchKey(item.localId, { apiKey: event.target.value })}
                                            placeholder={item.apiKeySet ? "留空保持已保存密钥" : "sk-..."}
                                        />
                                        {duplicateKeyIds.has(item.localId) ? <div className="mt-1 text-xs text-red-500">模型专用 Key 不能重复</div> : null}
                                    </div>
                                    <div className="flex gap-1">
                                        <Button loading={fetchingKeyId === item.localId} disabled={!item.apiKey.trim() && !item.id} onClick={() => void openKeyModels(item)}>
                                            选择模型
                                        </Button>
                                        <Button danger type="text" icon={<Trash2 className="size-3.5" />} aria-label="删除 Key" onClick={() => setKeys(draft.modelApiKeys.filter((key) => key.localId !== item.localId))} />
                                    </div>
                                </div>
                                <div className="mt-2 text-xs text-stone-500">{item.models.length ? `已绑定 ${item.models.length} 个模型：${item.models.join(", ")}` : "尚未绑定模型"}</div>
                            </div>
                        ))}
                        {!draft.modelApiKeys.length ? <div className="rounded-lg border border-dashed border-stone-200 px-3 py-5 text-center text-sm text-stone-500 dark:border-stone-800">尚未添加模型专用 Key</div> : null}
                    </div>
                </div>

                <div className="mt-6 mb-3">
                    <div className="text-sm font-semibold">渠道模型</div>
                    <div className="mt-0.5 text-xs text-stone-500">共 {draft.models.length} 个模型；能力决定它可以绑定的公开模型类型。</div>
                </div>
                <Table
                    size="small"
                    rowKey="name"
                    pagination={false}
                    scroll={{ x: 520 }}
                    dataSource={draft.models}
                    locale={{ emptyText: "同步 Key 后在这里配置模型能力" }}
                    columns={[
                        { title: "模型", dataIndex: "name", ellipsis: true },
                        { title: "能力", dataIndex: "capability", width: 90, render: (value: string) => capabilityOptions.find((option) => option.value === value)?.label || value },
                        { title: "状态", dataIndex: "status", width: 90, render: (value: string) => <Tag color={value === "hidden" ? "default" : "green"}>{value === "hidden" ? "已禁用" : "启用"}</Tag> },
                        {
                            title: "操作",
                            width: 220,
                            render: (_, item: AdminChannelModel) => (
                                <Space size="small">
                                    <Button size="small" type="link" onClick={() => openModelEditor(item)}>编辑</Button>
                                    <Button size="small" type="link" onClick={() => setModelStatus(item.name, item.status === "hidden" ? "active" : "hidden")}>{item.status === "hidden" ? "启用" : "禁用"}</Button>
                                    <Button size="small" danger type="link" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(item.name)}>删除</Button>
                                </Space>
                            ),
                        },
                    ]}
                />

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">状态</span>
                        <Select
                            className="w-full"
                            value={draft.status}
                            options={[
                                { value: "active", label: "启用" },
                                { value: "hidden", label: "隐藏" },
                            ]}
                            onChange={(status) => patch({ status })}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">排序</span>
                        <InputNumber className="w-full" value={draft.sortOrder} onChange={(sortOrder) => patch({ sortOrder: sortOrder || 0 })} />
                    </label>
                </div>
            </Drawer>

            <Modal
                open={Boolean(modelEditor)}
                title="编辑渠道模型"
                onCancel={() => setModelEditor(null)}
                onOk={() => {
                    if (modelEditor) {
                        setCapability(modelEditor.name, modelCapability);
                        setQualitySpec(modelEditor.name, modelQualitySpec);
                        if (modelCost && modelCost.publishedModelId > 0) setConfiguredCosts((current) => ({ ...current, [modelEditor.name]: modelCost }));
                    }
                    setModelEditor(null);
                }}
                okText="保存"
            >
                <div className="space-y-4">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">模型名称</span>
                        <Input value={modelEditor?.name || ""} disabled />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">能力</span>
                        <Select className="w-full" value={modelCapability} options={capabilityOptions} onChange={setModelCapability} />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">官方质量标准</span>
                        <Select className="w-full" value={modelQualitySpec.scheme || "tier"} onChange={(scheme) => setModelQualitySpec((current) => ({ ...current, scheme, options: qualityOptions(modelCapability, scheme, Boolean(current.supports8K)) }))} options={[{ value: "tier", label: "低 / 中 / 高" }, { value: "resolution", label: "1K / 2K / 4K / 8K" }, { value: "none", label: "不区分质量" }]} />
                    </label>
                    <div className="flex flex-wrap gap-4 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                        <Checkbox checked={Boolean(modelQualitySpec.supports8K)} onChange={(event) => setModelQualitySpec((current) => ({ ...current, supports8K: event.target.checked, options: qualityOptions(modelCapability, current.scheme || "tier", event.target.checked) }))}>开放 8K</Checkbox>
                        <Checkbox checked={Boolean(modelQualitySpec.supportsUpscale)} onChange={(event) => setModelQualitySpec((current) => ({ ...current, supportsUpscale: event.target.checked }))}>开放超分</Checkbox>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="mb-2 text-sm font-medium">渠道模型成本与售价</div>
                        <div className="mb-3 text-xs text-stone-500">售价沿用公开模型基础定价，可按渠道填写成本；成本高于售价保存时会再次确认。</div>
                        <div className="space-y-3">
                            <label className="block"><span className="mb-1 block text-sm">公开模型</span><Select className="w-full" value={modelCost?.publishedModelId || undefined} options={models.filter((item) => item.capability === modelCapability).map((item) => ({ value: item.id, label: item.displayName }))} onChange={(publishedModelId) => setModelCost((current) => ({ ...(current || { billingUnit: defaultBillingUnit(modelCapability), costPerUnit: 0, sellPerUnit: 0, status: "active" }), publishedModelId }))} placeholder="选择公开模型" /></label>
                            <label className="block"><span className="mb-1 block text-sm">计费单位</span><Select className="w-full" value={modelCost?.billingUnit || defaultBillingUnit(modelCapability)} options={[{ value: "image", label: "按张" }, { value: "second", label: "按秒" }, { value: "token", label: "按 Token" }, { value: "request", label: "按次" }]} onChange={(billingUnit) => setModelCost((current) => ({ ...(current || { publishedModelId: 0, costPerUnit: 0, sellPerUnit: 0, status: "active" }), billingUnit }))} /></label>
                            <div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1 block text-sm">渠道成本（积分）</span><InputNumber className="w-full" min={0} value={modelCost?.costPerUnit} onChange={(costPerUnit) => setModelCost((current) => ({ ...(current || { publishedModelId: 0, billingUnit: defaultBillingUnit(modelCapability), sellPerUnit: 0, status: "active" }), costPerUnit: Number(costPerUnit || 0) }))} /></label><label className="block"><span className="mb-1 block text-sm">用户售价（积分）</span><InputNumber className="w-full" min={0} value={modelCost?.sellPerUnit} onChange={(sellPerUnit) => setModelCost((current) => ({ ...(current || { publishedModelId: 0, billingUnit: defaultBillingUnit(modelCapability), costPerUnit: 0, status: "active" }), sellPerUnit: Number(sellPerUnit || 0) }))} /></label></div>
                            <Checkbox checked={modelCost?.status === "active"} onChange={(event) => setModelCost((current) => current ? { ...current, status: event.target.checked ? "active" : "hidden" } : current)}>启用该渠道成本价</Checkbox>
                        </div>
                    </div>
                    <Button onClick={() => modelEditor && setScriptTarget({ name: modelEditor.name, capability: modelCapability, value: modelEditor.script || "" })}>
                        {modelEditor?.script ? "编辑调用脚本" : "配置调用脚本"}
                    </Button>
                </div>
            </Modal>

            <Modal
                open={Boolean(targetKey)}
                title={targetKey ? `选择“${targetKey.name}”可用的模型` : "选择模型"}
                onOk={() => {
                    if (targetKey) applyKeyModels(targetKey.localId, selectedModels);
                    setKeyModelTargetId("");
                }}
                onCancel={() => setKeyModelTargetId("")}
            >
                <Select mode="multiple" className="w-full" value={selectedModels} options={availableModels.map((name) => ({ value: name, label: name }))} onChange={setSelectedModels} placeholder="选择这个 Key 负责的模型" optionFilterProp="label" />
            </Modal>

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => {
                    if (!scriptTarget) return;
                    setScript(scriptTarget.name, script);
                    setModelEditor((current) => current?.name === scriptTarget.name ? { ...current, script } : current);
                }}
                onClose={() => setScriptTarget(null)}
            />
        </>
    );
}

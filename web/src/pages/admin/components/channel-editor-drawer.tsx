import { App, Button, Drawer, Input, InputNumber, Modal, Segmented, Select, Space } from "antd";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";

import { ModelScriptEditor } from "@/components/layout/model-script-editor";
import { adminApi, type AdminChannel, type AdminChannelInput, type AdminChannelModel } from "@/services/api/admin";
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

const capabilityOptions = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];

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

export function AdminChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: AdminChannel | null; onSave: (input: AdminChannelInput) => Promise<void>; onClose: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<DraftChannel>(() => createDraft(channel));
    const [saving, setSaving] = useState(false);
    const [fetchingAll, setFetchingAll] = useState(false);
    const [fetchingKeyId, setFetchingKeyId] = useState("");
    const [keyModelTargetId, setKeyModelTargetId] = useState("");
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [selectedModels, setSelectedModels] = useState<string[]>([]);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);

    useEffect(() => {
        if (!open) return;
        setDraft(createDraft(channel));
        setKeyModelTargetId("");
        setAvailableModels([]);
        setSelectedModels([]);
        setScriptTarget(null);
    }, [channel, open]);

    const patch = (value: Partial<DraftChannel>) => setDraft((current) => ({ ...current, ...value }));
    const setKeys = (modelApiKeys: DraftKey[]) => patch({ modelApiKeys });
    const setModels = (models: AdminChannelModel[]) => patch({ models });
    const targetKey = draft.modelApiKeys.find((item) => item.localId === keyModelTargetId) || null;
    const duplicateKeyIds = new Set(
        draft.modelApiKeys
            .filter((item) => item.apiKey.trim() && draft.modelApiKeys.some((other) => other.localId !== item.localId && other.apiKey.trim() === item.apiKey.trim()))
            .map((item) => item.localId),
    );

    const patchKey = (localId: string, value: Partial<DraftKey>) => setKeys(draft.modelApiKeys.map((item) => (item.localId === localId ? { ...item, ...value } : item)));
    const removeModel = (name: string) => {
        setModels(draft.models.filter((model) => model.name !== name));
        setKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.models.filter((model) => model !== name) })));
    };
    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));

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
            });
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
                        <Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>
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
                            <Button size="small" loading={fetchingAll} icon={<RefreshCw className="size-3.5" />} onClick={() => void fetchAllModels()}>获取全部 Key 的模型</Button>
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setKeys([...draft.modelApiKeys, { localId: nanoid(), name: `模型 Key ${draft.modelApiKeys.length + 1}`, apiKey: "", apiKeySet: false, models: [] }])}>添加模型专用 Key</Button>
                        </Space>
                    </div>
                    <div className="mt-3 space-y-3">
                        {draft.modelApiKeys.map((item) => (
                            <div key={item.localId} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_auto]">
                                    <Input value={item.name} onChange={(event) => patchKey(item.localId, { name: event.target.value })} prefix={<KeyRound className="size-3.5 text-stone-400" />} />
                                    <div>
                                        <Input.Password status={duplicateKeyIds.has(item.localId) ? "error" : undefined} value={item.apiKey} onChange={(event) => patchKey(item.localId, { apiKey: event.target.value })} placeholder={item.apiKeySet ? "留空保持已保存密钥" : "sk-..."} />
                                        {duplicateKeyIds.has(item.localId) ? <div className="mt-1 text-xs text-red-500">模型专用 Key 不能重复</div> : null}
                                    </div>
                                    <div className="flex gap-1">
                                        <Button loading={fetchingKeyId === item.localId} disabled={!item.apiKey.trim() && !item.id} onClick={() => void openKeyModels(item)}>选择模型</Button>
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
                <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                    {draft.models.length ? draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>{model.name}</span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>{model.script ? "脚本已配置" : "调用脚本"}</Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    )) : <div className="px-2 py-8 text-center text-sm text-stone-500">同步 Key 后在这里配置模型能力</div>}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">状态</span>
                        <Select className="w-full" value={draft.status} options={[{ value: "active", label: "启用" }, { value: "hidden", label: "隐藏" }]} onChange={(status) => patch({ status })} />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium">排序</span>
                        <InputNumber className="w-full" value={draft.sortOrder} onChange={(sortOrder) => patch({ sortOrder: sortOrder || 0 })} />
                    </label>
                </div>
            </Drawer>

            <Modal
                open={Boolean(targetKey)}
                title={targetKey ? `选择“${targetKey.name}”可用的模型` : "选择模型"}
                onOk={() => {
                    if (targetKey) applyKeyModels(targetKey.localId, selectedModels);
                    setKeyModelTargetId("");
                }}
                onCancel={() => setKeyModelTargetId("")}
            >
                <Select
                    mode="multiple"
                    className="w-full"
                    value={selectedModels}
                    options={availableModels.map((name) => ({ value: name, label: name }))}
                    onChange={setSelectedModels}
                    placeholder="选择这个 Key 负责的模型"
                    optionFilterProp="label"
                />
            </Modal>

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </>
    );
}

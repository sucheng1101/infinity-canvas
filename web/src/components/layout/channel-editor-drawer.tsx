import { App, Button, Drawer, Input, Segmented, Space } from "antd";
import { KeyRound, ListPlus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createChannelModelApiKey, guessCapability, normalizeChannelModels, type ChannelModel, type ChannelModelApiKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { fetchChannelModels } from "@/services/api/image";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [keyModelTargetId, setKeyModelTargetId] = useState("");
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [fetchingAll, setFetchingAll] = useState(false);
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });
    const setModelApiKeys = (modelApiKeys: ChannelModelApiKey[]) => patch({ modelApiKeys });
    const keyModelTarget = draft.modelApiKeys.find((item) => item.id === keyModelTargetId) || null;

    const applySelection = (names: string[]) => {
        const selected = new Set(names);
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
        setModelApiKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.models.filter((name) => selected.has(name)) })));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => {
        setModels(draft.models.filter((model) => model.name !== name));
        setModelApiKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.models.filter((model) => model !== name) })));
    };
    const patchModelApiKey = (id: string, value: Partial<ChannelModelApiKey>) => setModelApiKeys(draft.modelApiKeys.map((item) => (item.id === id ? { ...item, ...value } : item)));
    const applyKeyModels = (id: string, names: string[]) => {
        const selected = new Set(names);
        setModelApiKeys(draft.modelApiKeys.map((item) => ({ ...item, models: item.id === id ? names : item.models.filter((name) => !selected.has(name)) })));
        const known = new Set(draft.models.map((model) => model.name));
        setModels([...draft.models, ...names.filter((name) => !known.has(name)).map((name) => ({ name, capability: guessCapability(name) }))]);
    };

    const fetchAllKeyModels = async () => {
        const keys = draft.modelApiKeys.filter((item) => item.apiKey.trim());
        if (!keys.length) {
            message.error(t("config.channelEditor.fetchAllMissingKey"));
            return;
        }
        setFetchingAll(true);
        const successful: Array<{ item: ChannelModelApiKey; models: string[] }> = [];
        for (const item of keys) {
            try {
                successful.push({ item, models: await fetchChannelModels({ ...draft, apiKey: item.apiKey }) });
            } catch {
                // Continue with the remaining keys and report the failed count together.
            }
        }
        const failed = keys.length - successful.length;
        const assignedModels = new Set<string>();
        const modelApiKeys = draft.modelApiKeys.map((item) => {
            const result = successful.find((entry) => entry.item.id === item.id);
            const models = result
                ? Array.from(new Set(result.models)).filter((name) => {
                      if (assignedModels.has(name)) return false;
                      assignedModels.add(name);
                      return true;
                  })
                : [];
            return { ...item, models };
        });
        setModelApiKeys(modelApiKeys);
        setModels(Array.from(assignedModels).map((name) => draft.models.find((model) => model.name === name) || { name, capability: guessCapability(name) }));
        if (failed) message.warning(t("config.channelEditor.fetchAllPartial", { success: successful.length, failed }));
        else message.success(t("config.channelEditor.fetchAllSuccess", { count: successful.length }));
        setFetchingAll(false);
    };

    const save = () => {
        onSave({ ...draft, models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            size={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} readOnly />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Input value="OpenAI" readOnly />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} readOnly />
                </label>
                <div className="rounded-lg border border-dashed border-stone-200 px-3 py-2 text-xs text-stone-500 dark:border-stone-800 md:col-span-2">{t("config.channelEditor.noGeneralApiKeyDescription")}</div>
            </div>

            <div className="mt-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <div className="text-sm font-semibold">{t("config.channelEditor.modelApiKeys")}</div>
                        <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelApiKeysDescription")}</div>
                    </div>
                    <Space size="small" wrap>
                        <Button size="small" loading={fetchingAll} icon={<RefreshCw className="size-3.5" />} onClick={() => void fetchAllKeyModels()}>{t("config.channelEditor.fetchAllModels")}</Button>
                        <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => setModelApiKeys([...draft.modelApiKeys, createChannelModelApiKey()])}>{t("config.channelEditor.addModelApiKey")}</Button>
                    </Space>
                </div>
                <div className="mt-3 space-y-3">
                    {draft.modelApiKeys.map((item) => (
                        <div key={item.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_auto]">
                                <Input value={item.name} onChange={(event) => patchModelApiKey(item.id, { name: event.target.value })} placeholder={t("config.channelEditor.modelApiKeyName")} prefix={<KeyRound className="size-3.5 text-stone-400" />} />
                                <Input.Password value={item.apiKey} onChange={(event) => patchModelApiKey(item.id, { apiKey: event.target.value })} placeholder="sk-..." />
                                <div className="flex gap-1">
                                    <Button disabled={!item.apiKey.trim()} onClick={() => setKeyModelTargetId(item.id)}>{t("config.channelEditor.selectKeyModels")}</Button>
                                    <Button danger type="text" icon={<Trash2 className="size-3.5" />} aria-label={t("common.delete")} onClick={() => setModelApiKeys(draft.modelApiKeys.filter((key) => key.id !== item.id))} />
                                </div>
                            </div>
                            <div className="mt-2 text-xs text-stone-500">{item.models.length ? t("config.channelEditor.boundModels", { count: item.models.length, models: item.models.join(", ") }) : t("config.channelEditor.noBoundModels")}</div>
                        </div>
                    ))}
                    {!draft.modelApiKeys.length ? <div className="rounded-lg border border-dashed border-stone-200 px-3 py-5 text-center text-sm text-stone-500 dark:border-stone-800">{t("config.channelEditor.noModelApiKeys")}</div> : null}
                </div>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} hideFetch onConfirm={applySelection} onClose={() => setSelectOpen(false)} />
            <ModelSelectModal
                open={Boolean(keyModelTarget)}
                channel={draft}
                apiKey={keyModelTarget?.apiKey}
                title={t("config.channelEditor.selectKeyModelsTitle", { name: keyModelTarget?.name || "" })}
                selectedNames={keyModelTarget?.models || []}
                onConfirm={(names) => keyModelTarget && applyKeyModels(keyModelTarget.id, names)}
                onClose={() => setKeyModelTargetId("")}
            />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}

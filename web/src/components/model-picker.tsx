import { useEffect, useId, useMemo, useState } from "react";
import { Cpu, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { decodeChannelModel, encodeChannelModel, modelOptionName, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
    showChannel?: boolean;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig, showChannel = true }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const [openPicker, setOpenPicker] = useState<"channel" | "model" | null>(null);
    const decoded = decodeChannelModel(value || "");
    const channels = useMemo(() => config.channels.map((channel) => ({ channel, models: channel.models.filter((model) => !capability || model.capability === capability) })), [capability, config.channels]);
    const currentChannel = channels.find(({ channel }) => channel.id === decoded?.channelId) || channels.find(({ models }) => models.some((model) => model.name === modelOptionName(value || ""))) || channels[0];
    const channelId = currentChannel?.channel.id || "";
    const models = currentChannel?.models || [];
    const currentModel = decoded?.channelId === channelId ? decoded.model : models.some((model) => model.name === modelOptionName(value || "")) ? modelOptionName(value || "") : "";
    const allModels = useMemo(() => channels.flatMap(({ channel, models: channelModels }) => channelModels.map((model) => ({ channel, model }))), [channels]);
    const currentCombinedModel = decoded && allModels.some(({ channel, model }) => channel.id === decoded.channelId && model.name === decoded.model) ? value || "" : allModels.find(({ model }) => model.name === modelOptionName(value || "")) ? encodeChannelModel(allModels.find(({ model }) => model.name === modelOptionName(value || ""))!.channel.id, modelOptionName(value || "")) : "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpenPicker(null);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    const setPickerOpen = (picker: "channel" | "model", open: boolean) => {
        if (open) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        setOpenPicker(open ? picker : null);
    };

    const selectChannel = (nextChannelId: string) => {
        const next = channels.find(({ channel }) => channel.id === nextChannelId);
        const nextModel = next?.models[0];
        if (nextModel) onChange(encodeChannelModel(nextChannelId, nextModel.name));
        else onMissingConfig?.();
    };

    if (!showChannel) {
        return (
            <Select
                open={openPicker === "model"}
                value={currentCombinedModel}
                onOpenChange={(open) => {
                    if (open && !allModels.length) onMissingConfig?.();
                    setPickerOpen("model", open);
                }}
                onValueChange={onChange}
            >
                <SelectTrigger className={cn("canvas-composer-model-picker h-8 min-w-0 max-w-full justify-start gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm", fullWidth ? "w-full" : "w-fit", !fullWidth && "max-w-[16rem]")} title={currentModel || pickerPlaceholder} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <ModelIcon model={currentModel} />
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentModel || pickerPlaceholder}</span>
                </SelectTrigger>
                <SelectContent data-canvas-no-zoom className="z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl" position="popper" align="start" side="bottom" sideOffset={6} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                    {allModels.length ? allModels.map(({ channel, model }) => {
                        const encoded = encodeChannelModel(channel.id, model.name);
                        return <SelectItem key={encoded} value={encoded} textValue={`${model.name} ${channel.name}`}><ModelLabel model={model.name} channelName={channel.name} /></SelectItem>;
                    }) : <SelectItem value="__empty__" disabled>{emptyModelLabel(config, capability)}</SelectItem>}
                </SelectContent>
            </Select>
        );
    }

    return (
        <div className={cn("flex min-w-0 items-center gap-1.5", fullWidth ? "w-full" : "max-w-full", className)}>
            <Select open={openPicker === "channel"} value={channelId} onOpenChange={(open) => setPickerOpen("channel", open)} onValueChange={selectChannel}>
                <SelectTrigger className={cn("canvas-composer-model-picker h-8 min-w-0 max-w-[9.5rem] justify-start gap-1.5 rounded-full border border-input bg-transparent px-2.5 text-sm font-normal shadow-sm", fullWidth && "w-[42%]")} title={currentChannel?.channel.name || t("settingsPanels.model.channel")} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Server className="size-3.5 shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate text-left">{currentChannel?.channel.name || t("settingsPanels.model.channel")}</span>
                </SelectTrigger>
                <SelectContent data-canvas-no-zoom className="z-[1200] w-64 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl" position="popper" align="start" side="bottom" sideOffset={6} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                    {channels.map(({ channel, models: channelModels }) => (
                        <SelectItem key={channel.id} value={channel.id} textValue={channel.name}>
                            <span className="flex min-w-0 items-center gap-2"><Server className="size-4 shrink-0 opacity-70" /><span className="min-w-0 flex-1 truncate">{channel.name}</span><span className="text-xs text-muted-foreground">{channelModels.length}</span></span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select
                open={openPicker === "model"}
                value={currentModel}
                onOpenChange={(open) => {
                    if (open && !models.length) onMissingConfig?.();
                    setPickerOpen("model", open);
                }}
                onValueChange={(model) => onChange(encodeChannelModel(channelId, model))}
            >
                <SelectTrigger className={cn("canvas-composer-model-picker h-8 min-w-[8rem] max-w-full flex-1 justify-start gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm", !fullWidth && "w-fit max-w-[12rem]")} title={currentModel || pickerPlaceholder} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <ModelIcon model={currentModel} />
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{currentModel || pickerPlaceholder}</span>
                </SelectTrigger>
                <SelectContent data-canvas-no-zoom className="z-[1200] w-72 max-w-[calc(100vw-24px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl" position="popper" align="start" side="bottom" sideOffset={6} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                    {models.length ? models.map((model) => <SelectItem key={model.name} value={model.name} textValue={model.name}><ModelLabel model={model.name} /></SelectItem>) : <SelectItem value="__empty__" disabled>{emptyModelLabel(config, capability)}</SelectItem>}
                </SelectContent>
            </Select>
        </div>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ model, channelName }: { model: string; channelName?: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="min-w-0 truncate">{modelOptionName(model)}</span>
            {channelName ? <span className="shrink-0 text-xs text-muted-foreground">({channelName})</span> : null}
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}

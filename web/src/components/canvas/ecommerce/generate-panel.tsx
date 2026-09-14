import { useState } from "react";
import { Button, Input } from "antd";
import { Play, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { PromptChatTarget } from "@/components/canvas/ecommerce/prompt-chat-panel";

export function GeneratePanel({ getBrief, onClose, getTargets, getReferencesFor, onApply, onGenerateOne, onGenerateAll }: {
    getBrief: () => string;
    onClose: () => void;
    getTargets: () => PromptChatTarget[];
    getReferencesFor: (key: string) => string[];
    onApply: (updates: Array<{ key: string; prompt: string }>) => void;
    onGenerateOne: (key: string, prompt: string) => void;
    onGenerateAll: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [brief] = useState(() => getBrief());
    const [targets, setTargets] = useState<PromptChatTarget[]>(() => getTargets());
    const update = (key: string, prompt: string) => setTargets((prev) => prev.map((item) => (item.key === key ? { ...item, prompt } : item)));

    return (
        <div className="absolute bottom-[76px] right-4 z-[60] flex max-h-[600px] w-[22rem] flex-col overflow-hidden rounded-xl border shadow-xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}>
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium" style={{ borderColor: theme.toolbar.border }}>
                <span>生成套图</span>
                <button type="button" onClick={onClose} className="cursor-pointer opacity-60 hover:opacity-100" aria-label="关闭生成面板">
                    <X className="size-4" />
                </button>
            </div>
            <div className="thin-scrollbar flex-1 space-y-2.5 overflow-y-auto p-3">
                {brief ? (
                    <p className="rounded-md px-2 py-1.5 text-xs leading-5 opacity-80" style={{ background: theme.toolbar.itemHover }}>
                        {brief}
                        <span className="ml-1 opacity-60">（完整方案见画布「商品资料」节点）</span>
                    </p>
                ) : null}
                {targets.map((target) => {
                    const references = getReferencesFor(target.key);
                    return (
                        <div key={target.key} className="rounded-lg border p-2" style={{ borderColor: theme.toolbar.border }}>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                                <p className="text-xs font-semibold">{target.label}</p>
                                <Button
                                    size="small"
                                    icon={<Play className="size-3" />}
                                    onClick={() => {
                                        onApply([{ key: target.key, prompt: target.prompt }]);
                                        onGenerateOne(target.key, target.prompt);
                                    }}
                                >
                                    生成
                                </Button>
                            </div>
                            {references.length ? (
                                <div className="mb-1.5 flex flex-wrap gap-1">
                                    {references.map((url, index) => (
                                        <img key={index} src={url} alt={`${target.label}参考图 ${index + 1}`} className="size-10 rounded border object-cover" style={{ borderColor: theme.toolbar.border }} />
                                    ))}
                                </div>
                            ) : null}
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={target.prompt} onChange={(event) => update(target.key, event.target.value)} className="!text-xs" />
                        </div>
                    );
                })}
            </div>
            <div className="border-t p-2" style={{ borderColor: theme.toolbar.border }}>
                <Button
                    type="primary"
                    block
                    icon={<Play className="size-4" />}
                    onClick={() => {
                        onApply(targets.map(({ key, prompt }) => ({ key, prompt })));
                        onGenerateAll();
                    }}
                >
                    一键生成三图 + QA 检查
                </Button>
            </div>
        </div>
    );
}

import { useState } from "react";
import { Button, Input } from "antd";
import { Send, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { requestImageQuestion } from "@/services/api/image";

export type PromptChatTarget = { key: string; label: string; prompt: string };

type ChatMessage = { role: "user" | "assistant"; content: string };

export function PromptChatPanel({ onClose, getTargets, onApply }: { onClose: () => void; getTargets: () => PromptChatTarget[]; onApply: (updates: Array<{ key: string; prompt: string }>) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    const send = async () => {
        const requirement = input.trim();
        if (!requirement || loading) return;
        if (!effectiveConfig.textModel && !effectiveConfig.model) {
            setMessages((prev) => [...prev, { role: "assistant", content: "请先在配置的偏好设置中选择默认文本模型" }]);
            return;
        }
        const targets = getTargets();
        if (!targets.length) {
            setMessages((prev) => [...prev, { role: "assistant", content: "画布上没有找到生成配置节点" }]);
            return;
        }
        const history = messages.filter((item) => item.role === "user").map((item, index) => `${index + 1}. ${item.content}`).join("\n");
        setInput("");
        setMessages((prev) => [...prev, { role: "user", content: requirement }]);
        setLoading(true);
        try {
            const current = targets.map((target) => `【${target.label}】${target.prompt}`).join("\n");
            const answer = await requestImageQuestion(
                { ...effectiveConfig, model: "" },
                [{
                    role: "user",
                    content: `你是电商图片提示词助手。以下是当前三类商品图的提示词：\n${current}\n\n${history ? `历史调整要求：\n${history}\n` : ""}本次调整要求：${requirement}\n\n请输出调整后的完整提示词：只修改与要求相关的部分，未涉及的提示词原样保留，保持实拍质感描述。严格按以下格式输出：\n【主图】提示词\n【卖点图】提示词\n【场景图】提示词`,
                }],
                () => {},
            );
            const pick = (label: string) => new RegExp(`【${label}】\\s*([\\s\\S]*?)(?=【|$)`).exec(answer)?.[1]?.trim() || "";
            const updates = targets.map((target) => ({ key: target.key, prompt: pick(target.label) || target.prompt }));
            onApply(updates);
            setMessages((prev) => [...prev, { role: "assistant", content: "已更新对应节点的提示词，点「生成套图」即可重新生成" }]);
        } catch (error) {
            setMessages((prev) => [...prev, { role: "assistant", content: `调整失败：${error instanceof Error ? error.message : String(error)}` }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="absolute bottom-[76px] right-4 z-[60] flex h-[420px] w-80 flex-col overflow-hidden rounded-xl border shadow-xl backdrop-blur" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}>
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium" style={{ borderColor: theme.toolbar.border }}>
                <span>AI 改词</span>
                <button type="button" onClick={onClose} className="cursor-pointer opacity-60 hover:opacity-100" aria-label="关闭 AI 改词">
                    <X className="size-4" />
                </button>
            </div>
            <div className="thin-scrollbar flex-1 space-y-2 overflow-y-auto p-3 text-xs">
                {messages.length === 0 ? (
                    <p className="opacity-60">描述要调整的内容，例如「主图换成夜晚灯光氛围，突出热气」。AI 会直接更新对应节点的提示词，改完点「生成套图」重新生成。</p>
                ) : (
                    messages.map((item, index) => (
                        <div key={index} className={item.role === "user" ? "text-right" : ""}>
                            <span className="inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-2 py-1 text-left" style={item.role === "user" ? { background: theme.toolbar.itemHover } : { border: `1px solid ${theme.toolbar.border}` }}>
                                {item.content}
                            </span>
                        </div>
                    ))
                )}
                {loading ? <p className="opacity-60">正在调整…</p> : null}
            </div>
            <div className="flex items-center gap-2 border-t p-2" style={{ borderColor: theme.toolbar.border }}>
                <Input size="small" value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={() => void send()} placeholder="例如：主图换成夜景氛围" disabled={loading} />
                <Button size="small" type="primary" loading={loading} onClick={() => void send()} aria-label="发送调整要求" title="发送">
                    <Send className="size-3.5" />
                </Button>
            </div>
        </div>
    );
}

import { App, Button, Input, Modal } from "antd";
import { useState } from "react";

import { executeHostedGeneration } from "@/services/api/hosted-generation";

type Props = {
    open: boolean;
    onClose: () => void;
    onGenerated: (url: string) => void;
};

// 配音：把台词送进语音模型，拿到 WAV 地址后交给画布建音频节点。
export function AudioGenerateDialog({ open, onClose, onGenerated }: Props) {
    const { message } = App.useApp();
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);

    const generate = async () => {
        const input = text.trim();
        if (!input) {
            message.warning("先填要念的台词");
            return;
        }
        setLoading(true);
        try {
            const output = await executeHostedGeneration({ capability: "audio", payload: { input } });
            const url = typeof output.url === "string" ? output.url : "";
            if (!url) throw new Error("语音模型没有返回音频地址");
            onGenerated(url);
            setText("");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "配音失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal title="生成配音" open={open} onCancel={onClose} onOk={() => void generate()} confirmLoading={loading} okText="生成" width={560}>
            <p className="mb-2 text-xs text-stone-500">调用托管语音模型，生成后会在画布上落一个音频节点；本地直连模式不支持配音。</p>
            <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} value={text} onChange={(event) => setText(event.target.value)} placeholder="贴入台词或旁白" />
            <div className="mt-2 text-right">
                <Button type="link" size="small" onClick={() => setText("你好，这是一段测试配音。")}>
                    填入示例
                </Button>
            </div>
        </Modal>
    );
}

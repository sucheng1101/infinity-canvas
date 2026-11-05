import { useState } from "react";
import { Alert, Button, Input, Modal, Segmented } from "antd";
import { Copy, Images } from "lucide-react";

import { useCopyText } from "@/hooks/use-copy-text";
import { buildGridPrompt, gridCells, type GridLayout } from "@/lib/canvas/storyboard-grid";

export type StoryboardGridShot = { prompt: string; dialogue?: string };

type Props = {
    open: boolean;
    onClose: () => void;
    shots: StoryboardGridShot[];
    onGenerate: (prompt: string, layout: GridLayout) => void;
};

const layoutOptions: { label: string; value: GridLayout }[] = [
    { label: "4 宫格", value: 4 },
    { label: "6 宫格", value: 6 },
    { label: "9 宫格", value: 9 },
];

// 多宫格分镜：把多个镜头合成一张宫格图，提示词随宫格数实时重算。
export function StoryboardGridDialog({ open, onClose, shots, onGenerate }: Props) {
    const [layout, setLayout] = useState<GridLayout>(4);
    const copyText = useCopyText();
    const { cols, rows } = gridCells(layout);
    const enough = shots.length >= layout;
    const prompt = buildGridPrompt(shots, layout);

    return (
        <Modal
            title="多宫格分镜"
            open={open}
            onCancel={onClose}
            width={640}
            centered
            destroyOnHidden
            footer={[
                <Button key="copy" icon={<Copy className="size-4" />} disabled={shots.length === 0} onClick={() => copyText(prompt, "提示词已复制")}>
                    复制提示词
                </Button>,
                <Button key="generate" type="primary" icon={<Images className="size-4" />} disabled={!enough} onClick={() => onGenerate(prompt, layout)}>
                    生成分镜图
                </Button>,
            ]}
        >
            <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm opacity-60">宫格</span>
                    <Segmented value={layout} options={layoutOptions} onChange={(value) => setLayout(Number(value) as GridLayout)} />
                    <span className="text-xs opacity-50">
                        {rows} 行 × {cols} 列
                    </span>
                </div>
                {enough ? (
                    <p className="text-xs leading-5 opacity-55">
                        取前 {layout} 个镜头合成一张 {layout} 宫格图，提示词可以复制出去自己再改。
                    </p>
                ) : (
                    <Alert type="warning" showIcon message={`镜头不足：${layout} 宫格需要 ${layout} 个镜头，当前只有 ${shots.length} 个`} />
                )}
                <Input.TextArea value={prompt} readOnly autoSize={{ minRows: 8, maxRows: 14 }} className="!text-xs" />
            </div>
        </Modal>
    );
}

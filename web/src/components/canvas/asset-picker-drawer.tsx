import { App, Drawer, Empty, Input, Segmented, Spin, Tag } from "antd";
import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { setAssetDragData } from "@/lib/canvas/asset-drag";
import { assetsApi, type AssetItem, type AssetKind } from "@/services/api/assets";

const kindLabels: Record<AssetKind, string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    media: "素材",
};

type Filter = AssetKind | "all";

type Props = { open: boolean; onClose: () => void; onPick: (asset: AssetItem) => void };

export function AssetPickerDrawer({ open, onClose, onPick }: Props) {
    const { message } = App.useApp();
    const [items, setItems] = useState<AssetItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [keyword, setKeyword] = useState("");
    const [filter, setFilter] = useState<Filter>("all");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setItems((await assetsApi.list({ kind: filter === "all" ? undefined : filter, q: keyword.trim() || undefined, pageSize: 100 })).items);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "资产读取失败");
        } finally {
            setLoading(false);
        }
    }, [filter, keyword, message]);

    useEffect(() => {
        if (!open) return;
        void load();
    }, [load, open]);

    return (
        <Drawer title="从资产库选择" placement="right" size={420} open={open} onClose={onClose}>
            <div className="flex flex-wrap items-center gap-2">
                <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索资产名称" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="min-w-40 flex-1" />
                <Segmented size="small" value={filter} onChange={(value) => setFilter(value as Filter)} options={[{ value: "all", label: "全部" }, ...(Object.keys(kindLabels) as AssetKind[]).map((kind) => ({ value: kind, label: kindLabels[kind] }))]} />
            </div>
            <p className="mt-2 text-xs text-stone-400">点击卡片选中，或直接拖到画布上。</p>

            {loading ? (
                <div className="flex h-40 items-center justify-center">
                    <Spin />
                </div>
            ) : items.length === 0 ? (
                <Empty className="mt-12" description="没有匹配的资产" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <div className="mt-3 grid grid-cols-2 gap-3">
                    {items.map((asset) => (
                        <div
                            key={asset.id}
                            role="button"
                            tabIndex={0}
                            draggable
                            onClick={() => onPick(asset)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") onPick(asset);
                            }}
                            onDragStart={(event) => setAssetDragData(event.dataTransfer, { id: asset.id, name: asset.name, imageUrl: asset.images[0]?.url, prompt: asset.prompt })}
                            className="cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white transition hover:border-stone-400 hover:shadow-md active:cursor-grabbing dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
                        >
                            <div className="flex h-24 items-center justify-center overflow-hidden bg-stone-50 dark:bg-stone-800">
                                {asset.images[0] ? <img src={asset.images[0].url} alt={asset.name} draggable={false} className="h-full w-full object-cover" /> : <span className="text-xs text-stone-400">{kindLabels[asset.kind]}</span>}
                            </div>
                            <div className="flex items-center justify-between gap-2 p-2.5">
                                <span className="line-clamp-1 text-xs font-medium">{asset.name}</span>
                                <Tag className="m-0 shrink-0 text-[10px]">{kindLabels[asset.kind]}</Tag>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Drawer>
    );
}

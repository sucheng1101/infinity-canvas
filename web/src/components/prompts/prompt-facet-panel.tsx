import { App, Button, Empty, Input, Segmented, Tag } from "antd";
import { Copy, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { promptFacets } from "@/data/prompt-facets";
import { PROMPT_FACET_CATEGORIES, searchFacets } from "@/lib/prompt-facet";
import { useCopyText } from "@/hooks/use-copy-text";
import { cn } from "@/lib/utils";
import { usePromptFacetStore } from "@/stores/use-prompt-facet-store";
import { usePromptTargetStore } from "@/stores/use-prompt-target-store";
import type { PromptFacet, PromptFacetCategory } from "@/types/prompt-facet";

const categoryLabels: Record<PromptFacetCategory, string> = {
    style: "风格",
    camera: "镜头",
    lighting: "光线",
    composition: "构图",
    color: "色彩",
    material: "材质",
    mood: "氛围",
};

type Filter = PromptFacetCategory | "all" | "collected";

export function PromptFacetPanel() {
    const { message } = App.useApp();
    const copyText = useCopyText();
    const collected = usePromptFacetStore((state) => state.collected);
    const toggle = usePromptFacetStore((state) => state.toggle);
    const [keyword, setKeyword] = useState("");
    const [filter, setFilter] = useState<Filter>("all");

    const items = useMemo(() => {
        const base = filter === "collected" ? promptFacets.filter((facet) => collected.includes(facet.id)) : searchFacets(promptFacets, "", filter === "all" ? undefined : filter);
        if (!keyword.trim()) return base;
        return searchFacets(base, keyword);
    }, [collected, filter, keyword]);

    const insert = (facet: PromptFacet) => {
        const inserted = usePromptTargetStore.getState().insert(facet.en);
        if (inserted) {
            message.success(`已插入：${facet.zh}`);
            return;
        }
        copyText(facet.en, "已复制词条（先点开画布节点或输入框即可直接插入）");
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
                <Input
                    allowClear
                    prefix={<Search className="size-4 text-stone-400" />}
                    placeholder="搜索中文、英文或别名，例如「电影感」「orbit」"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    className="max-w-md"
                />
                <Segmented
                    value={filter}
                    onChange={(value) => setFilter(value as Filter)}
                    options={[
                        { value: "all", label: `全部 ${promptFacets.length}` },
                        ...PROMPT_FACET_CATEGORIES.map((category) => ({ value: category, label: categoryLabels[category] })),
                        { value: "collected", label: `我的收藏 ${collected.length}` },
                    ]}
                />
            </div>

            <div className="mt-4 flex-1 overflow-y-auto pb-8">
                {items.length === 0 ? (
                    <Empty description="没有匹配的词条" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {items.map((facet) => {
                            const starred = collected.includes(facet.id);
                            return (
                                <div
                                    key={facet.id}
                                    className="group flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 transition hover:border-stone-300 hover:shadow-sm dark:border-stone-800 dark:bg-stone-950"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{facet.zh}</span>
                                                <Tag className="!m-0">{categoryLabels[facet.category]}</Tag>
                                            </div>
                                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{facet.en}</p>
                                        </div>
                                        <button
                                            type="button"
                                            aria-label={starred ? "取消收藏" : "收藏"}
                                            onClick={() => toggle(facet.id)}
                                            className={cn("shrink-0 rounded-md p-1 transition hover:bg-black/5 dark:hover:bg-white/10", starred ? "text-orange-500" : "text-stone-400")}
                                        >
                                            <Star className="size-4" fill={starred ? "currentColor" : "none"} />
                                        </button>
                                    </div>
                                    <div className="mt-auto flex items-center justify-between">
                                        <span className="truncate text-[11px] text-stone-400">{facet.aliases.slice(0, 3).join(" · ")}</span>
                                        <Button size="small" type="text" icon={<Copy className="size-3.5" />} onClick={() => insert(facet)}>
                                            插入
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

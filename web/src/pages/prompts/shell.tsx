import { Segmented } from "antd";
import { useState } from "react";

import { PromptFacetPanel } from "@/components/prompts/prompt-facet-panel";
import PromptsPage from "@/pages/prompts/index";

type View = "facet" | "community";

// 灵感页两个入口：结构化词库（本地、可插入画布）与社区来源（远程聚合）。
export function PromptsShell() {
    const [view, setView] = useState<View>("facet");
    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <div className="flex justify-center border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                <Segmented
                    value={view}
                    onChange={(value) => setView(value as View)}
                    options={[
                        { value: "facet", label: "词库" },
                        { value: "community", label: "社区来源" },
                    ]}
                />
            </div>
            <div className="min-h-0 flex-1">
                {view === "facet" ? (
                    <div className="mx-auto h-full max-w-7xl px-4 py-6 sm:px-6">
                        <PromptFacetPanel />
                    </div>
                ) : (
                    <PromptsPage />
                )}
            </div>
        </div>
    );
}

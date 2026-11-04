import { create } from "zustand";
import { persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";

// 只有「我收藏的词条 id」需要持久化，词条本身是随代码一起打包的静态数据。
type PromptFacetStore = {
    collected: string[];
    toggle: (id: string) => void;
    isCollected: (id: string) => boolean;
};

export const usePromptFacetStore = create<PromptFacetStore>()(
    persist(
        (set, get) => ({
            collected: [],
            toggle: (id) =>
                set((state) => ({
                    collected: state.collected.includes(id) ? state.collected.filter((item) => item !== id) : [id, ...state.collected],
                })),
            isCollected: (id) => get().collected.includes(id),
        }),
        {
            name: "prompt-facet-store",
            storage: localForageStorage as never,
        },
    ),
);

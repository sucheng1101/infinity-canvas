import { create } from "zustand";

// 画布节点编辑器、工作台输入框在聚焦时注册自己，词库就能把词条插到「当前正在编辑的地方」。
type InsertTarget = {
    label: string;
    insert: (text: string) => void;
};

type PromptTargetStore = {
    target: InsertTarget | null;
    register: (target: InsertTarget) => void;
    unregister: (label: string) => void;
    insert: (text: string) => boolean;
};

export const usePromptTargetStore = create<PromptTargetStore>((set, get) => ({
    target: null,
    register: (target) => set({ target }),
    unregister: (label) => {
        // 只注销自己，避免后聚焦的输入框被先失焦的注销掉。
        if (get().target?.label !== label) return;
        set({ target: null });
    },
    insert: (text) => {
        const target = get().target;
        if (!target) return false;
        target.insert(text);
        return true;
    },
}));

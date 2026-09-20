import { create } from "zustand";

import { authApi, type AuthUser } from "@/services/api/auth";

type AuthState = {
    status: "idle" | "loading" | "authenticated" | "anonymous";
    user: AuthUser | null;
    bootstrap: () => Promise<void>;
    setUser: (user: AuthUser) => void;
    logout: () => Promise<void>;
};

let bootstrapPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set) => ({
    status: "idle",
    user: null,
    bootstrap: async () => {
        if (bootstrapPromise) return bootstrapPromise;
        set({ status: "loading" });
        bootstrapPromise = authApi
            .me()
            .then(({ user }) => set({ status: "authenticated", user }))
            .catch(() => set({ status: "anonymous", user: null }))
            .finally(() => {
                bootstrapPromise = null;
            });
        return bootstrapPromise;
    },
    setUser: (user) => set({ status: "authenticated", user }),
    logout: async () => {
        await authApi.logout().catch(() => undefined);
        set({ status: "anonymous", user: null });
    },
}));

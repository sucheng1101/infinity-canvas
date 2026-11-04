import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const CANVAS_STORAGE_ERROR_EVENT = "infinite-canvas:storage-error";

// Storage failures used to be swallowed, which silently lost canvas edits.
// Announce them so the app can tell the user instead of failing quietly.
export function reportCanvasStorageError(reason: "read" | "write", error: unknown) {
    console.error(`canvas storage ${reason} failed`, error);
    window.dispatchEvent(new CustomEvent(CANVAS_STORAGE_ERROR_EVENT, { detail: reason }));
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch (error) {
            try {
                window.localStorage.setItem(name, value);
            } catch (fallbackError) {
                reportCanvasStorageError("write", fallbackError ?? error);
            }
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};

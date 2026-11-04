import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { CANVAS_STORAGE_ERROR_EVENT } from "@/lib/localforage-storage";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        const onStorageError = (event: Event) => {
            const reason = (event as CustomEvent<"read" | "write">).detail;
            message.error(t(reason === "read" ? "common.storageReadFailed" : "common.storageWriteFailed"));
        };
        window.addEventListener(CANVAS_STORAGE_ERROR_EVENT, onStorageError);
        return () => window.removeEventListener(CANVAS_STORAGE_ERROR_EVENT, onStorageError);
    }, [message, t]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, "").toLowerCase();
        const targetIndex = baseUrl ? config.channels.findIndex((channel) => channel.baseUrl.toLowerCase() === normalizedBaseUrl) : 0;
        if (targetIndex < 0) {
            openConfigDialog(false);
            return;
        }
        updateConfig(
            "channels",
            config.channels.map((channel, index) => (index === targetIndex && apiKey ? { ...channel, apiKey } : channel)),
        );
        openConfigDialog(false);
        message.success(t("config.importedDirectConfig"));
    }, [config.channels, message, openConfigDialog, t, updateConfig]);

    return <>{children}</>;
}

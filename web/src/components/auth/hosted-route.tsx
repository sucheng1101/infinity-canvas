import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { isHostedMode } from "@/lib/app-mode";
import { useAuthStore } from "@/stores/use-auth-store";

export function HostedRoute() {
    const location = useLocation();
    const status = useAuthStore((state) => state.status);
    const bootstrap = useAuthStore((state) => state.bootstrap);

    useEffect(() => {
        if (isHostedMode && status === "idle") void bootstrap();
    }, [bootstrap, status]);

    if (!isHostedMode) return <Outlet />;
    if (status === "idle" || status === "loading") {
        return (
            <div className="grid h-dvh place-items-center bg-background text-foreground">
                <div className="flex items-center gap-3 text-sm text-stone-500 dark:text-stone-400">
                    <LoaderCircle className="size-4 animate-spin" /> 正在确认登录状态
                </div>
            </div>
        );
    }
    if (status !== "authenticated") return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
    return <Outlet />;
}

export function HostedGuestRoute() {
    const status = useAuthStore((state) => state.status);
    const bootstrap = useAuthStore((state) => state.bootstrap);

    useEffect(() => {
        if (isHostedMode && status === "idle") void bootstrap();
    }, [bootstrap, status]);

    if (!isHostedMode) return <Outlet />;
    if (status === "authenticated") return <Navigate to="/app" replace />;
    return <Outlet />;
}

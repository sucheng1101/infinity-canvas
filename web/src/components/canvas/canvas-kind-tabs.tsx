import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

// Both list pages share one switcher so "画布" reads as a single place with two kinds of project.
export function CanvasKindTabs() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const tabs = [
        { path: "/canvas", label: t("canvas.kindTabs.free") },
        { path: "/projects", label: t("canvas.kindTabs.ecommerce") },
    ];
    return (
        <div className="mt-3 inline-flex items-center gap-1 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-900">
            {tabs.map((tab) => {
                const active = pathname === tab.path || pathname.startsWith(`${tab.path}/`);
                return (
                    <Link
                        key={tab.path}
                        to={tab.path}
                        className={cn("rounded-md px-3 py-1 text-xs transition", active ? "bg-white font-medium text-stone-950 shadow-sm dark:bg-stone-800 dark:text-stone-100" : "text-stone-500 hover:text-stone-950 dark:text-stone-400 dark:hover:text-stone-100")}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </div>
    );
}

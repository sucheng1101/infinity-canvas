import { Drawer } from "antd";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { accountMenuItems, adminMenuItem, isAccountPath, navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useAuthStore } from "@/stores/use-auth-store";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    activeToolSlug?: NavigationToolSlug;
    onClose: () => void;
};

const linkClass = (active: boolean) =>
    cn(
        "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
        active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
    );

export function MobileNavDrawer({ open, activeToolSlug, onClose }: MobileNavDrawerProps) {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const user = useAuthStore((state) => state.user);
    const accountActive = isAccountPath(pathname);
    const accountItems = [...accountMenuItems, ...(user?.role === "admin" ? [adminMenuItem] : [])];

    return (
        <Drawer title={t("topNav.navigation")} placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationTools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                        <Link key={tool.slug} to={`/${tool.slug}`} onClick={onClose} className={linkClass(tool.slug === activeToolSlug)}>
                            <Icon className="size-5" />
                            <span>{t(`navigation.${tool.slug}`)}</span>
                        </Link>
                    );
                })}
            </div>
            <div className="mt-6 border-t border-stone-200 pt-4 dark:border-stone-800">
                <div className={cn("px-3 pb-2 text-xs font-medium uppercase tracking-wide", accountActive ? "text-stone-900 dark:text-stone-100" : "text-stone-400")}>{t("topNav.account.title")}</div>
                <div className="space-y-1">
                    {accountItems.map((item) => (
                        <Link key={item.path} to={item.path} onClick={onClose} className={linkClass(pathname === item.path)}>
                            <item.icon className="size-5" />
                            <span>{t(`topNav.account.${item.key}`)}</span>
                        </Link>
                    ))}
                </div>
            </div>
        </Drawer>
    );
}

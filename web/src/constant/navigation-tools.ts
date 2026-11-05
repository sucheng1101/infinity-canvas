import { Clapperboard, FileText, Images, Maximize2, ScrollText, Settings2, ShieldCheck, Sparkles, Store, Wallet } from "lucide-react";

// Top-level creative entries, ordered as the user journey: create → canvases → materials → inspiration.
export const navigationTools = [
    { slug: "workbench", icon: Sparkles },
    { slug: "canvas", icon: Maximize2 },
    { slug: "drama", icon: Clapperboard },
    { slug: "assets", icon: Images },
    { slug: "prompts", icon: FileText },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

// Account entries live in the "我的" dropdown instead of competing for top-level space.
export const accountMenuItems = [
    { key: "wallet", path: "/assets/wallet", icon: Wallet },
    { key: "usage", path: "/assets/usage", icon: ScrollText },
    { key: "channels", path: "/channels", icon: Store },
    { key: "settings", path: "/assets/settings", icon: Settings2 },
] as const;

// /assets is the materials entry, so only its account sub paths belong to the account group.
const accountPaths = ["/assets/wallet", "/assets/usage", "/assets/settings", "/channels", "/admin"];

export function isAccountPath(pathname: string) {
    return accountPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const adminMenuItem = { key: "admin", path: "/admin", icon: ShieldCheck } as const;

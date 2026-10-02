import { FileText, Images, LayoutDashboard, Maximize2, Sparkles, Store } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        icon: Maximize2,
    },
    {
        slug: "workbench",
        icon: Sparkles,
    },
    {
        slug: "projects",
        icon: LayoutDashboard,
    },
    {
        slug: "prompts",
        icon: FileText,
    },
    {
        slug: "model-plaza",
        icon: Store,
    },
    {
        slug: "assets",
        icon: Images,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

import { FileText, Images, LayoutDashboard, Maximize2, Settings2, Sparkles } from "lucide-react";

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
        slug: "assets",
        icon: Images,
    },
    {
        slug: "config",
        icon: Settings2,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];

import { BarChart3, Images, Settings2, WalletCards, ScrollText } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";

const items = [
    { key: "/assets", label: "资产管理", icon: Images, end: true },
    { key: "/assets/dashboard", label: "数据看板", icon: BarChart3 },
    { key: "/assets/usage", label: "使用日志", icon: ScrollText },
    { key: "/assets/wallet", label: "钱包管理", icon: WalletCards },
    { key: "/assets/settings", label: "个人设置", icon: Settings2 },
];

export default function AssetCenterLayout() {
    const { pathname } = useLocation();

    return (
        <main className="h-full overflow-hidden bg-[#f7f7f5] text-stone-950 dark:bg-[#11110f] dark:text-stone-100">
            <div className="flex h-full min-h-0">
                <aside className="hidden w-56 shrink-0 border-r border-stone-200 bg-white/75 px-3 py-5 dark:border-stone-800 dark:bg-stone-950/60 md:block">
                    <div className="mb-5 px-3">
                        <div className="text-lg font-semibold tracking-[-.03em]">我的资产</div>
                        <div className="mt-1 text-xs text-stone-400">管理内容、用量与账户</div>
                    </div>
                    <nav className="space-y-1">
                        {items.map((item) => {
                            const Icon = item.icon;
                            const active = item.end ? pathname === item.key : pathname.startsWith(item.key);
                            return (
                                <Link
                                    key={item.key}
                                    to={item.key}
                                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? "bg-stone-950 font-medium text-white shadow-sm dark:bg-white dark:text-stone-950" : "text-stone-500 hover:bg-stone-100 hover:text-stone-950 dark:hover:bg-stone-900 dark:hover:text-stone-100"}`}
                                >
                                    <Icon className="size-4" />
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>
                </aside>
                <section className="min-w-0 flex-1 overflow-hidden">
                    <div className="border-b border-stone-200 bg-white/70 px-4 py-3 dark:border-stone-800 dark:bg-stone-950/40 md:hidden">
                        <div className="flex gap-2 overflow-x-auto">
                            {items.map((item) => <Link key={item.key} to={item.key} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${pathname === item.key ? "bg-stone-950 text-white dark:bg-white dark:text-stone-950" : "text-stone-500"}`}>{item.label}</Link>)}
                        </div>
                    </div>
                    <Outlet />
                </section>
            </div>
        </main>
    );
}

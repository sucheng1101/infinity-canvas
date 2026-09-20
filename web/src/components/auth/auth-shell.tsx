import { ArrowLeft, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { UserStatusActions } from "@/components/layout/user-status-actions";

export function AuthShell({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
    return (
        <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(249,115,22,.13),transparent_26%),radial-gradient(circle_at_88%_82%,rgba(120,113,108,.12),transparent_28%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(120,113,108,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(120,113,108,.12)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:linear-gradient(to_right,black,transparent_58%)]" />
            <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8">
                <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold text-stone-900 dark:text-stone-100">
                    <span className="grid size-8 place-items-center rounded-lg bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950"><Layers3 className="size-4" /></span>
                    无限画布
                </Link>
                <UserStatusActions showConfig={false} />
            </header>

            <div className="relative z-10 mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl lg:grid-cols-[1.05fr_.95fr]">
                <section className="hidden flex-col justify-between px-12 py-16 lg:flex xl:px-20">
                    <div>
                        <Link to="/" className="inline-flex items-center gap-2 text-sm text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"><ArrowLeft className="size-4" /> 返回首页</Link>
                    </div>
                    <div className="max-w-xl pb-10">
                        <div className="mb-8 flex items-center gap-3 text-xs font-medium uppercase tracking-[.22em] text-orange-600 dark:text-orange-400"><span className="h-px w-10 bg-current" /> 创作从一个想法开始</div>
                        <h2 className="text-balance text-5xl font-semibold leading-[1.08] tracking-[-.04em] text-stone-950 dark:text-stone-50">无需密钥，<br />登录即可开始创作。</h2>
                        <div className="mt-10 grid gap-5 text-sm text-stone-600 dark:text-stone-400 sm:grid-cols-2">
                            <div className="flex gap-3"><Sparkles className="mt-0.5 size-4 shrink-0 text-orange-500" /><span>图片、视频、音频与文本模型由平台统一配置</span></div>
                            <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-orange-500" /><span>项目与素材继续保存在当前浏览器本地</span></div>
                        </div>
                    </div>
                    <p className="text-xs text-stone-400 dark:text-stone-600">INFINITE CANVAS · HOSTED EDITION</p>
                </section>

                <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:border-l lg:border-stone-200/80 lg:px-16 dark:lg:border-stone-800">
                    <div className="w-full max-w-md">
                        <div className="mb-8">
                            <div className="mb-3 text-xs font-medium uppercase tracking-[.2em] text-orange-600 dark:text-orange-400">{eyebrow}</div>
                            <h1 className="text-3xl font-semibold tracking-[-.035em] text-stone-950 dark:text-stone-50">{title}</h1>
                            <p className="mt-3 text-sm leading-6 text-stone-500 dark:text-stone-400">{description}</p>
                        </div>
                        {children}
                    </div>
                </section>
            </div>
        </main>
    );
}

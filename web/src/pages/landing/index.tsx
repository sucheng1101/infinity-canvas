import { ArrowRight, AudioLines, Image as ImageIcon, Layers3, Play, Type, Video } from "lucide-react";
import { Link } from "react-router-dom";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/use-auth-store";

const capabilities = [
    { icon: ImageIcon, label: "图片生成" },
    { icon: Video, label: "视频创作" },
    { icon: Type, label: "智能文案" },
    { icon: AudioLines, label: "音频生成" },
];

export default function LandingPage() {
    const status = useAuthStore((state) => state.status);
    const bootstrap = useAuthStore((state) => state.bootstrap);
    useEffect(() => { if (status === "idle") void bootstrap(); }, [bootstrap, status]);
    const authenticated = status === "authenticated";

    return (
        <main className="min-h-dvh overflow-x-hidden bg-[#f7f7f5] text-stone-950 dark:bg-[#111110] dark:text-stone-50">
            <header className="fixed inset-x-0 top-0 z-30 border-b border-black/5 bg-[#f7f7f5]/85 backdrop-blur-xl dark:border-white/10 dark:bg-[#111110]/85">
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
                    <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold"><span className="grid size-8 place-items-center rounded-lg bg-stone-950 text-white dark:bg-stone-100 dark:text-stone-950"><Layers3 className="size-4" /></span>无限画布</Link>
                    <div className="flex items-center gap-2"><UserStatusActions showConfig={false} />{authenticated ? <Link to="/app" className="inline-flex h-9 items-center bg-stone-950 px-4 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">进入创作空间</Link> : <><Link to="/login" className="hidden px-3 py-2 text-sm sm:block">登录</Link><Link to="/register" className="inline-flex h-9 items-center bg-stone-950 px-4 text-sm font-medium text-white dark:bg-stone-100 dark:text-stone-950">免费开始</Link></>}</div>
                </div>
            </header>

            <section className="relative min-h-[92dvh] overflow-hidden pt-16">
                <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(120,113,108,.15)_1px,transparent_1px),linear-gradient(90deg,rgba(120,113,108,.15)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
                <div className="relative mx-auto flex min-h-[calc(92dvh-4rem)] max-w-7xl flex-col px-5 pt-[10vh] sm:px-8 lg:pt-[12vh]">
                    <div className="max-w-4xl">
                        <p className="mb-5 flex items-center gap-3 text-xs font-medium uppercase tracking-[.2em] text-orange-600 dark:text-orange-400"><span className="h-px w-8 bg-current" /> 一站式 AI 创作空间</p>
                        <h1 className="text-balance text-[clamp(3rem,8vw,7.5rem)] font-semibold leading-[.9] tracking-[-.055em]">无限画布</h1>
                        <p className="mt-7 max-w-2xl text-balance text-lg leading-8 text-stone-600 sm:text-xl dark:text-stone-400">登录、选择模型、开始创作。图片、视频、文本与音频能力由平台统一管理，你只需要关注额度和结果。</p>
                        <div className="mt-9 flex flex-wrap items-center gap-3">{authenticated ? <Link to="/app" className="inline-flex h-12 items-center gap-2 bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-black dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white">进入创作空间 <ArrowRight className="size-4" /></Link> : <><Link to="/register" className="inline-flex h-12 items-center gap-2 bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-black dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white">创建免费账号 <ArrowRight className="size-4" /></Link><Link to="/login" className="inline-flex h-12 items-center px-5 text-sm font-medium">已有账号，登录</Link></>}</div>
                    </div>

                    <div className="relative mt-auto translate-y-16 overflow-hidden border border-stone-200 bg-[#1b1b19] shadow-[0_40px_100px_rgba(28,25,23,.22)] dark:border-stone-800">
                        <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-white"><div className="flex items-center gap-2 text-sm font-medium"><Layers3 className="size-4" /> 新建创作</div><div className="text-xs text-white/50">可用额度 128.60</div></div>
                        <div className="grid min-h-[300px] md:grid-cols-[180px_1fr_260px]">
                            <div className="hidden border-r border-white/10 p-4 md:block"><p className="mb-4 text-[11px] uppercase tracking-[.18em] text-white/35">创作能力</p>{capabilities.map(({ icon: Icon, label }, index) => <div key={label} className={`mb-1 flex h-9 items-center gap-2 px-2 text-xs ${index === 0 ? "bg-white/10 text-white" : "text-white/45"}`}><Icon className="size-3.5" />{label}</div>)}</div>
                            <div className="relative min-h-[300px] overflow-hidden bg-[radial-gradient(circle_at_48%_42%,rgba(249,115,22,.30),transparent_27%),linear-gradient(135deg,#252522,#111110)]"><div className="absolute left-[16%] top-[20%] h-36 w-48 border border-white/15 bg-white/5 p-3"><div className="h-full bg-[linear-gradient(135deg,#ea580c,#fbbf24_52%,#334155)] opacity-80" /></div><div className="absolute left-[48%] top-[43%] w-52 border border-orange-400/70 bg-[#222] p-3 text-white"><div className="mb-3 flex items-center justify-between text-[11px]"><span>图片生成</span><span className="text-white/40">4:3 · 高清</span></div><div className="h-14 border border-white/10 p-2 text-[10px] leading-4 text-white/45">一组具有电影质感的产品视觉，柔和自然光...</div><button className="mt-3 flex h-8 w-full items-center justify-center gap-2 bg-orange-500 text-[11px] font-medium text-white"><Play className="size-3" />开始生成</button></div></div>
                            <div className="hidden border-l border-white/10 p-4 text-white md:block"><p className="text-[11px] uppercase tracking-[.18em] text-white/35">模型与参数</p><p className="mt-5 text-xs text-white/50">图像模型</p><div className="mt-2 border border-white/10 px-3 py-2 text-xs">视觉创作 Pro</div><p className="mt-5 text-xs text-white/50">本次预计</p><p className="mt-2 text-2xl font-medium">0.42</p><p className="mt-1 text-[11px] text-white/35">约可再生成 306 张</p></div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="border-t border-stone-200 bg-white pb-24 pt-28 dark:border-stone-800 dark:bg-[#171716]"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-xs font-medium uppercase tracking-[.2em] text-orange-600 dark:text-orange-400">专注创作本身</p><h2 className="mt-4 text-4xl font-semibold tracking-[-.04em]">少一点配置，<br />多一点完成。</h2></div><div className="grid gap-px overflow-hidden border border-stone-200 bg-stone-200 sm:grid-cols-2 dark:border-stone-800 dark:bg-stone-800">{capabilities.map(({ icon: Icon, label }, index) => <div key={label} className="bg-white p-7 dark:bg-[#171716]"><Icon className="size-5 text-orange-500" /><h3 className="mt-6 text-base font-medium">{label}</h3><p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">{index === 0 ? "从灵感、参考图到最终成片，都在同一块画布中完成。" : index === 1 ? "选择已发布模型与参数，任务状态清晰可见。" : index === 2 ? "生成、改写和整理内容，直接连接到创作流程。" : "生成的音频素材可以继续加入画布组合使用。"}</p></div>)}</div></div></div></section>
        </main>
    );
}

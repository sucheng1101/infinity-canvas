import { App, Button, Drawer, Empty, Input, Segmented, Skeleton, Tag } from "antd";
import { ArrowUpRight, Boxes, CheckCircle2, CircleDollarSign, Gauge, Search, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { hostedApi, type PublishedModel } from "@/services/api/hosted";

type Capability = "all" | "image" | "video" | "text" | "audio";
const capabilityMeta: Record<string, { label: string; accent: string; icon: typeof Boxes }> = {
    image: { label: "生图", accent: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300", icon: Sparkles },
    video: { label: "视频", accent: "text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300", icon: Zap },
    text: { label: "文本", accent: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300", icon: Boxes },
    audio: { label: "音频", accent: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300", icon: Gauge },
};

function capabilityLabel(value: string) { return capabilityMeta[value]?.label || value; }
function billingLabel(type?: string) { return type === "per_unit" ? "按张 / 次" : type === "per_second" ? "按秒" : type === "per_token" ? "按 Token" : "按次"; }
function configText(model: PublishedModel, keys: string[]) { const config = model.publicConfig || {}; const value = keys.map((key) => config[key]).find((item) => typeof item === "string" || typeof item === "number"); return value === undefined ? "" : String(value); }
function modelDescription(model: PublishedModel) { return configText(model, ["description", "summary", "intro"]) || "面向创作工作流的托管模型，价格透明，调用稳定。"; }
function priceText(amount: number, mode: "points" | "cny") { return mode === "points" ? `${amount.toLocaleString()} 积分` : `¥${(amount / 100).toFixed(2)}`; }

function priceSummary(model: PublishedModel, mode: "points" | "cny") {
    const summary = model.priceSummary;
    if (!summary) return { primary: "暂未定价", secondary: "管理员正在完善价格", variants: [] as Array<{ key: string; label?: string; unitAmount?: number }> };
    const variants = (summary.variants || []).filter((item) => typeof item.unitAmount === "number");
    return { primary: priceText(Number(summary.unitAmount || 0), mode), secondary: `${billingLabel(summary.type)} · 1 元 = 100 积分`, variants };
}

function ModelCard({ model, priceMode, onOpen }: { model: PublishedModel; priceMode: "points" | "cny"; onOpen: () => void }) {
    const meta = capabilityMeta[model.capability] || capabilityMeta.text;
    const Icon = meta.icon;
    const price = priceSummary(model, priceMode);
    const spec = model.qualitySpec;
    return <button type="button" onClick={onOpen} className="group flex min-h-[248px] flex-col rounded-2xl border border-stone-200/80 bg-white p-5 text-left shadow-[0_10px_30px_rgba(28,25,23,0.04)] transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_18px_40px_rgba(28,25,23,0.10)] dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700">
        <div className="flex items-start justify-between gap-4"><div className={`flex size-11 items-center justify-center rounded-2xl ${meta.accent}`}><Icon className="size-5" /></div><ArrowUpRight className="size-4 text-stone-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-stone-600" /></div>
        <div className="mt-5 flex items-center gap-2"><h3 className="min-w-0 truncate text-base font-semibold tracking-[-.02em]">{model.displayName}</h3><Tag bordered={false} className="m-0 shrink-0 rounded-full px-2 py-0.5 text-[11px]">{meta.label}</Tag></div>
        <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-stone-500 dark:text-stone-400">{modelDescription(model)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-y border-stone-100 py-3 dark:border-stone-800"><div><div className="text-[11px] text-stone-400">起步价格</div><div className="mt-1 text-lg font-semibold tracking-[-.03em]">{price.primary}</div><div className="mt-0.5 text-[11px] text-stone-400">{price.secondary}</div></div><div className="border-l border-stone-100 pl-3 dark:border-stone-800"><div className="text-[11px] text-stone-400">质量标准</div><div className="mt-1 text-sm font-medium">{spec?.scheme === "resolution" ? "分辨率" : spec?.scheme === "tier" ? "低 / 中 / 高" : "统一规格"}</div><div className="mt-1 flex flex-wrap gap-1">{spec?.supports8K ? <Tag color="gold">8K</Tag> : null}{spec?.supportsUpscale ? <Tag color="blue">超分</Tag> : null}</div></div></div>
        <div className="mt-auto flex min-h-6 flex-wrap items-center gap-1.5 pt-3"><span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="size-3.5" />已开放</span>{price.variants.slice(0, 3).map((variant) => <Tag key={variant.key} bordered={false} className="m-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">{variant.label || variant.key} {priceText(Number(variant.unitAmount || 0), priceMode)}</Tag>)}</div>
    </button>;
}

function ModelDetails({ model, priceMode }: { model: PublishedModel; priceMode: "points" | "cny" }) {
    const meta = capabilityMeta[model.capability] || capabilityMeta.text;
    const Icon = meta.icon;
    const price = priceSummary(model, priceMode);
    const spec = model.qualitySpec;
    return <div className="space-y-6 pb-8"><div className="flex items-start gap-4"><div className={`flex size-12 items-center justify-center rounded-2xl ${meta.accent}`}><Icon className="size-6" /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">{model.displayName}</h2><Tag bordered={false}>{meta.label}</Tag></div><p className="mt-2 text-sm leading-6 text-stone-500">{modelDescription(model)}</p></div></div><div className="rounded-2xl bg-stone-950 p-5 text-white"><div className="text-xs text-white/60">当前公开价格</div><div className="mt-2 text-3xl font-semibold">{price.primary}</div><div className="mt-1 text-xs text-white/60">{price.secondary}</div></div><section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-emerald-500" />质量与输出能力</div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">质量选项</div><div className="mt-2 flex flex-wrap gap-2">{spec?.options?.length ? spec.options.map((option) => <Tag key={option.key}>{option.label}</Tag>) : <span className="text-sm">统一规格</span>}</div></div><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">输出方式</div><div className="mt-2 flex flex-wrap gap-2">{spec?.outputModes?.map((option) => <Tag key={option.key} color={option.key === "upscale" ? "blue" : undefined}>{option.label}</Tag>)}</div><div className="mt-2 text-xs text-stone-500">{spec?.supports8K ? "已开放 8K（按渠道能力提供）" : "8K 暂未开放"}</div></div></div></section><section><div className="mb-3 text-sm font-semibold">价格变体</div><div className="divide-y divide-stone-100 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">{price.variants.length ? price.variants.map((variant) => <div key={variant.key} className="flex items-center justify-between px-4 py-3 text-sm"><span>{variant.label || variant.key}</span><strong>{priceText(Number(variant.unitAmount || 0), priceMode)}</strong></div>) : <div className="px-4 py-3 text-sm text-stone-500">暂无独立质量价格</div>}</div></section></div>;
}

export default function ModelPlazaPage() {
    const { message } = App.useApp();
    const [models, setModels] = useState<PublishedModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [capability, setCapability] = useState<Capability>("all");
    const [priceMode, setPriceMode] = useState<"points" | "cny">("points");
    const [selected, setSelected] = useState<PublishedModel>();
    useEffect(() => { let active = true; void hostedApi.models().then((result) => { if (active) setModels(result.items); }).catch((error) => { if (active) message.error(error instanceof Error ? error.message : "模型目录读取失败"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [message]);
    const visibleModels = useMemo(() => { const normalized = query.trim().toLowerCase(); return models.filter((model) => (capability === "all" || model.capability === capability) && (!normalized || `${model.displayName} ${model.capability} ${modelDescription(model)}`.toLowerCase().includes(normalized))); }, [capability, models, query]);
    return <main className="h-full overflow-y-auto bg-[#f5f6f8] text-stone-950 dark:bg-[#11110f] dark:text-stone-100"><div className="mx-auto max-w-[1600px] px-5 pb-12 pt-5 sm:px-8"><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-[-.04em]">模型广场</h1><p className="mt-1 text-sm text-stone-500">已开放模型的价格、质量标准和性能概览</p></div><div className="flex items-center gap-2"><div className="hidden items-center gap-1 text-xs text-stone-400 sm:flex"><CircleDollarSign className="size-4 text-emerald-500" />统一换算：1 元 = 100 积分</div><Segmented size="small" value={priceMode} onChange={(value) => setPriceMode(value as "points" | "cny")} options={[{ label: "积分", value: "points" }, { label: "人民币", value: "cny" }]} /></div></div><div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]"><aside className="self-start rounded-2xl border border-stone-200/80 bg-white/75 p-3 backdrop-blur lg:sticky lg:top-4 dark:border-stone-800 dark:bg-stone-950/70"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">筛选</span><Button type="link" size="small" onClick={() => { setQuery(""); setCapability("all"); }}>重置</Button></div><div className="space-y-1">{(["all", "text", "image", "video", "audio"] as Capability[]).map((item) => <button key={item} type="button" onClick={() => setCapability(item)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${capability === item ? "bg-stone-950 font-medium text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"}`}><span>{item === "all" ? "全部模型" : capabilityLabel(item)}</span><span className="text-xs opacity-60">{item === "all" ? models.length : models.filter((model) => model.capability === item).length}</span></button>)}</div></aside><section className="min-w-0"><div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white/75 p-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/70"><Input allowClear prefix={<Search className="size-4 text-stone-400" />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称或能力" className="min-w-[200px] flex-1 border-0 bg-transparent shadow-none" /><span className="text-xs text-stone-400">共 {visibleModels.length} 个模型</span></div>{loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950"><Skeleton active paragraph={{ rows: 5 }} /></div>)}</div> : visibleModels.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleModels.map((model) => <ModelCard key={model.id} model={model} priceMode={priceMode} onOpen={() => setSelected(model)} />)}</div> : <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 py-24 dark:border-stone-700 dark:bg-stone-950/60"><Empty description="没有匹配的模型" /></div>}</section></div></div><Drawer open={Boolean(selected)} onClose={() => setSelected(undefined)} width={460} title="模型详情" destroyOnHidden>{selected ? <ModelDetails model={selected} priceMode={priceMode} /> : null}</Drawer></main>;
}

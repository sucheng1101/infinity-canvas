import { App, Button, Drawer, Empty, Input, Skeleton, Tag } from "antd";
import { ArrowUpRight, Boxes, CheckCircle2, CircleDollarSign, Clock3, Gauge, Search, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { hostedApi, type PublishedModel } from "@/services/api/hosted";

type Capability = "all" | "image" | "video" | "text" | "audio";
type ModelConfig = Record<string, unknown>;

const capabilityMeta: Record<Exclude<Capability, "all">, { label: string; accent: string; icon: typeof Boxes }> = {
    image: { label: "生图", accent: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300", icon: Sparkles },
    video: { label: "视频", accent: "text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300", icon: Zap },
    text: { label: "文本", accent: "text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300", icon: Boxes },
    audio: { label: "音频", accent: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300", icon: Gauge },
};

const toConfig = (value: unknown): ModelConfig => (value && typeof value === "object" && !Array.isArray(value) ? value as ModelConfig : {});
const textValue = (config: ModelConfig, keys: string[]) => keys.map((key) => config[key]).find((value) => typeof value === "string" || typeof value === "number") as string | number | undefined;
const stringValue = (config: ModelConfig, keys: string[]) => {
    const value = textValue(config, keys);
    return value === undefined ? "" : String(value);
};
const tagsValue = (config: ModelConfig) => {
    const value = config.tags;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string").slice(0, 4);
};

function capabilityLabel(capability: string) {
    return capabilityMeta[capability as Exclude<Capability, "all">]?.label || capability;
}

function billingLabel(type?: string) {
    if (type === "per_unit") return "按张计费";
    if (type === "per_second") return "按秒计费";
    if (type === "per_token") return "按 Token 计费";
    return "按次计费";
}

function priceLabel(model: PublishedModel) {
    const summary = model.priceSummary;
    if (!summary) return { primary: "暂未定价", secondary: "管理员正在完善价格" };
    const amount = Number(summary.unitAmount || 0);
    const currency = String(summary.currency || "CNY");
    const primary = currency === "CNY" ? `¥${(amount / 100).toFixed(2)}` : `${amount} ${currency}`;
    return { primary, secondary: `${amount.toLocaleString()} 积分 · ${billingLabel(String(summary.type || ""))}` };
}

function modelPerformance(model: PublishedModel) {
    const config = toConfig(model.publicConfig);
    const description = stringValue(config, ["description", "summary", "intro"]);
    const performance = stringValue(config, ["performance", "speed", "quality"]) || (model.performance?.averageTps ? `${model.performance.averageTps.toFixed(1)} TPS` : "");
    const latency = stringValue(config, ["latency", "latencyMs", "ttft"]) || (model.performance?.averageLatency ? `${Math.round(model.performance.averageLatency)} ms` : "");
    const context = stringValue(config, ["contextWindow", "context", "maxTokens"]);
    const tags = tagsValue(config);
    return {
        config,
        description: description || "面向创作工作流优化的托管模型，价格透明，调用稳定。",
        performance: performance || (model.capability === "text" ? "响应稳定" : model.capability === "image" ? "高质量输出" : "流畅生成"),
        latency,
        context,
        tags,
        successRate: model.performance?.successRate,
        requests: model.performance?.requests,
    };
}

function ModelCard({ model, onOpen }: { model: PublishedModel; onOpen: () => void }) {
    const meta = capabilityMeta[model.capability as Exclude<Capability, "all">];
    const Icon = meta?.icon || Boxes;
    const price = priceLabel(model);
    const info = modelPerformance(model);
    return (
        <button type="button" onClick={onOpen} className="group flex min-h-[246px] flex-col rounded-2xl border border-stone-200/80 bg-white p-5 text-left shadow-[0_10px_30px_rgba(28,25,23,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_18px_40px_rgba(28,25,23,0.10)] dark:border-stone-800 dark:bg-stone-950 dark:hover:border-stone-700">
            <div className="flex items-start justify-between gap-4">
                <div className={`flex size-11 items-center justify-center rounded-2xl ${meta?.accent || "bg-stone-100 text-stone-600"}`}>
                    <Icon className="size-5" />
                </div>
                <ArrowUpRight className="size-4 text-stone-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-stone-600 dark:text-stone-700 dark:group-hover:text-stone-300" />
            </div>
            <div className="mt-5 flex items-center gap-2">
                <h3 className="min-w-0 truncate text-base font-semibold tracking-[-.02em] text-stone-950 dark:text-stone-100">{model.displayName}</h3>
                <Tag bordered={false} className="m-0 shrink-0 rounded-full px-2 py-0.5 text-[11px]">{capabilityLabel(model.capability)}</Tag>
            </div>
            <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-stone-500 dark:text-stone-400">{info.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 border-y border-stone-100 py-3 dark:border-stone-800">
                <div>
                    <div className="text-[11px] text-stone-400">起步价格</div>
                    <div className="mt-1 text-lg font-semibold tracking-[-.03em] text-stone-950 dark:text-stone-100">{price.primary}</div>
                    <div className="mt-0.5 text-[11px] text-stone-400">{price.secondary}</div>
                </div>
                <div className="border-l border-stone-100 pl-3 dark:border-stone-800">
                    <div className="text-[11px] text-stone-400">性能概览</div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-stone-800 dark:text-stone-200"><Gauge className="size-3.5 text-emerald-500" />{info.performance}</div>
                    {info.latency ? <div className="mt-1 text-[11px] text-stone-400">响应 {info.latency}</div> : null}
                </div>
            </div>
            <div className="mt-auto flex min-h-6 flex-wrap items-center gap-1.5 pt-3">
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />已开放</span>
                {info.tags.map((tag) => <Tag key={tag} bordered={false} className="m-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500 dark:bg-stone-900 dark:text-stone-400">{tag}</Tag>)}
            </div>
        </button>
    );
}

function ModelDetails({ model }: { model: PublishedModel }) {
    const info = modelPerformance(model);
    const price = priceLabel(model);
    const meta = capabilityMeta[model.capability as Exclude<Capability, "all">];
    const Icon = meta?.icon || Boxes;
    return (
        <div className="space-y-6 pb-8">
            <div className="flex items-start gap-4">
                <div className={`flex size-12 items-center justify-center rounded-2xl ${meta?.accent || "bg-stone-100 text-stone-600"}`}><Icon className="size-6" /></div>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-[-.03em]">{model.displayName}</h2><Tag bordered={false} className="m-0 rounded-full">{capabilityLabel(model.capability)}</Tag></div><p className="mt-2 text-sm leading-6 text-stone-500">{info.description}</p></div>
            </div>
            <div className="rounded-2xl bg-stone-950 p-5 text-white dark:bg-stone-100 dark:text-stone-950"><div className="text-xs text-white/60 dark:text-stone-500">当前公开价格</div><div className="mt-2 text-3xl font-semibold tracking-[-.05em]">{price.primary}</div><div className="mt-1 text-xs text-white/60 dark:text-stone-500">{price.secondary}</div></div>
            <section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-emerald-500" />性能概览</div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">响应表现</div><div className="mt-1 font-medium">{info.performance}</div></div><div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">可用状态</div><div className="mt-1 flex items-center gap-1.5 font-medium text-emerald-600"><CheckCircle2 className="size-4" />稳定可用</div></div>{info.latency ? <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">参考延迟</div><div className="mt-1 flex items-center gap-1.5 font-medium"><Clock3 className="size-4 text-stone-400" />{info.latency}</div></div> : null}{typeof info.successRate === "number" ? <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">近 24 小时成功率</div><div className="mt-1 font-medium text-emerald-600">{info.successRate.toFixed(1)}%{info.requests ? <span className="ml-1 text-xs font-normal text-stone-400">· {info.requests} 次请求</span> : null}</div></div> : null}{info.context ? <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><div className="text-xs text-stone-400">上下文能力</div><div className="mt-1 font-medium">{info.context}</div></div> : null}</div></section>
            {info.tags.length ? <section><div className="mb-3 text-sm font-semibold">适用标签</div><div className="flex flex-wrap gap-2">{info.tags.map((tag) => <Tag key={tag} bordered={false} className="m-0 rounded-full bg-stone-100 px-3 py-1 dark:bg-stone-900">{tag}</Tag>)}</div></section> : null}
            <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 text-xs leading-5 text-stone-500 dark:border-stone-800">模型价格由平台统一发布，实际扣费以生成前报价为准。模型能力和可用渠道由运营团队持续维护。</div>
        </div>
    );
}

export default function ModelPlazaPage() {
    const { message } = App.useApp();
    const [models, setModels] = useState<PublishedModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [capability, setCapability] = useState<Capability>("all");
    const [selected, setSelected] = useState<PublishedModel>();

    useEffect(() => {
        let active = true;
        setLoading(true);
        void hostedApi.models().then((result) => { if (active) setModels(result.items); }).catch((error) => { if (active) message.error(error instanceof Error ? error.message : "模型目录读取失败"); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [message]);

    const visibleModels = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return models.filter((model) => {
            if (capability !== "all" && model.capability !== capability) return false;
            if (!normalized) return true;
            const info = modelPerformance(model);
            return `${model.displayName} ${model.capability} ${info.description} ${info.tags.join(" ")}`.toLowerCase().includes(normalized);
        });
    }, [capability, models, query]);

    return (
        <main className="h-full overflow-y-auto bg-[#f5f6f8] text-stone-950 dark:bg-[#11110f] dark:text-stone-100">
            <div className="min-h-full bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_32%),radial-gradient(circle_at_15%_20%,rgba(244,114,182,0.10),transparent_28%)]">
                <div className="mx-auto max-w-[1600px] px-5 pb-12 pt-6 sm:px-8">
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                        <div><div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-blue-600">MODEL PLAZA</div><h1 className="text-3xl font-semibold tracking-[-.05em] sm:text-4xl">模型广场</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500 dark:text-stone-400">查看当前已开放模型的价格与性能，选择适合你工作流的生成能力。</p></div>
                        <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white/70 px-3 py-2 text-xs text-stone-500 backdrop-blur dark:border-stone-800 dark:bg-stone-950/70"><CircleDollarSign className="size-4 text-emerald-500" />统一价格 · 1 元 = 100 积分</div>
                    </div>
                    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                        <aside className="self-start rounded-2xl border border-stone-200/80 bg-white/75 p-4 backdrop-blur lg:sticky lg:top-5 dark:border-stone-800 dark:bg-stone-950/70">
                            <div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold">筛选</span><Button type="link" size="small" onClick={() => { setQuery(""); setCapability("all"); }}>重置</Button></div>
                            <div className="space-y-1.5">{(["all", "text", "image", "video", "audio"] as Capability[]).map((item) => <button key={item} type="button" onClick={() => setCapability(item)} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${capability === item ? "bg-stone-950 font-medium text-white dark:bg-stone-100 dark:text-stone-950" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900"}`}><span>{item === "all" ? "全部模型" : capabilityLabel(item)}</span><span className="text-xs opacity-60">{item === "all" ? models.length : models.filter((model) => model.capability === item).length}</span></button>)}</div>
                            <div className="mt-6 border-t border-stone-100 pt-5 text-xs leading-5 text-stone-400 dark:border-stone-800">模型广场只展示已发布且当前可用的模型。价格、计费单位和模型状态以后台配置为准。</div>
                        </aside>
                        <section className="min-w-0">
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white/75 p-3 backdrop-blur dark:border-stone-800 dark:bg-stone-950/70"><Input allowClear prefix={<Search className="size-4 text-stone-400" />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称、能力或标签" className="min-w-[240px] flex-1 border-0 bg-transparent shadow-none" /><div className="text-xs text-stone-400">共 {visibleModels.length} 个模型</div></div>
                            {loading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950"><Skeleton active paragraph={{ rows: 5 }} /></div>)}</div> : visibleModels.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleModels.map((model) => <ModelCard key={model.id} model={model} onOpen={() => setSelected(model)} />)}</div> : <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 py-24 dark:border-stone-700 dark:bg-stone-950/60"><Empty description="没有匹配的模型" /></div>}
                        </section>
                    </div>
                </div>
            </div>
            <Drawer open={Boolean(selected)} onClose={() => setSelected(undefined)} width={460} title="模型详情" destroyOnHidden>{selected ? <ModelDetails model={selected} /> : null}</Drawer>
        </main>
    );
}

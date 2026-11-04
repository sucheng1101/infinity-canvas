import { App, Button, Card, Col, Row, Skeleton, Statistic, Tag } from "antd";
import { ArrowRight, Coins, Images, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { hostedApi, type UserUsageResult } from "@/services/api/hosted";
import { useQuota } from "@/hooks/use-quota";

export default function AssetDashboardPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const quotaQuery = useQuota();
    const quota = quotaQuery.data;
    const [usage, setUsage] = useState<UserUsageResult>();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void hostedApi.usageLogs({ page: 1, pageSize: 5 }).then(setUsage).catch((error) => message.error(error instanceof Error ? error.message : "数据看板读取失败")).finally(() => setLoading(false));
    }, [message]);

    if (loading) return <div className="p-7"><Skeleton active paragraph={{ rows: 8 }} /></div>;
    return <div className="h-full overflow-y-auto px-4 py-5 sm:px-7 sm:py-7"><div className="mx-auto max-w-7xl"><div className="mb-6 flex items-end justify-between gap-4"><div><div className="text-xs font-medium uppercase tracking-[.22em] text-orange-600">ASSET INSIGHTS</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">数据看板</h1><p className="mt-1 text-sm text-stone-500">快速了解积分余额与最近使用情况</p></div><Button type="link" icon={<ArrowRight className="size-4" />} iconPlacement="end" onClick={() => navigate("/assets/usage")}>查看完整日志</Button></div><Row gutter={[16, 16]}><Col xs={24} sm={12} lg={6}><Card><Statistic title="可用积分" value={quota?.available || 0} prefix={<Coins className="size-4 text-orange-500" />} /></Card></Col><Col xs={24} sm={12} lg={6}><Card><Statistic title="预留积分" value={quota?.reserved || 0} /></Card></Col><Col xs={24} sm={12} lg={6}><Card><Statistic title="近期调用" value={usage?.stats.total || 0} prefix={<ScrollText className="size-4 text-blue-500" />} /></Card></Col><Col xs={24} sm={12} lg={6}><Card><Statistic title="生成成功" value={usage?.stats.succeeded || 0} prefix={<Images className="size-4 text-emerald-500" />} /></Card></Col></Row><Card className="mt-4" title="最近使用"><div className="divide-y divide-stone-100 dark:divide-stone-800">{usage?.items.length ? usage.items.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="font-medium">{item.project || "生成任务"}</div><div className="mt-1 text-xs text-stone-400">{new Date(item.startedAt).toLocaleString("zh-CN")} · {item.durationMs || 0} ms</div></div><div className="flex items-center gap-3"><Tag color={item.status === "succeeded" ? "success" : item.status === "failed" ? "error" : "processing"}>{item.status === "succeeded" ? "成功" : item.status === "failed" ? "失败" : "进行中"}</Tag><span className="text-sm font-medium text-orange-600">{item.chargedQuota || 0} 积分</span></div></div>) : <div className="py-10 text-center text-sm text-stone-400">暂无使用记录</div>}</div></Card></div></div>;
}

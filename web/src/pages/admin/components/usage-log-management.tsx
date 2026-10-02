import { App, Card, Descriptions, Drawer, Input, Select, Space, Statistic, Table, Tag, Button } from "antd";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, type AdminUsageLog, type AdminUsageResult } from "@/services/api/admin";

const emptyResult: AdminUsageResult = { items: [], total: 0, page: 1, pageSize: 20, stats: { total: 0, succeeded: 0, failed: 0, running: 0, chargedQuota: 0, totalTokens: 0, averageDurationMs: 0 } };

export function UsageLogManagement() {
    const { message } = App.useApp();
    const [result, setResult] = useState<AdminUsageResult>(emptyResult);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({ q: "", user: "", model: "", channel: "", status: "" });
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<AdminUsageLog | null>(null);

    const load = async (nextPage = page) => {
        setLoading(true);
        try {
            const data = await adminApi.usageLogs({ ...filters, page: nextPage, pageSize: 20 });
            setResult(data);
            setPage(data.page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "使用日志读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load(1);
    }, [filters.user, filters.model, filters.channel, filters.status]);

    useEffect(() => {
        const timer = window.setInterval(() => void load(), 30000);
        return () => window.clearInterval(timer);
    }, [page, filters]);

    const statusTag = (status: AdminUsageLog["status"]) => <Tag color={status === "succeeded" ? "success" : status === "failed" ? "error" : "processing"}>{status === "succeeded" ? "成功" : status === "failed" ? "失败" : "进行中"}</Tag>;

    return (
        <Card title="使用日志" extra={<Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>刷新</Button>}>
            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Card size="small"><Statistic title="调用总数" value={result.stats.total} /></Card>
                <Card size="small"><Statistic title="成功" value={result.stats.succeeded} valueStyle={{ color: "#16a34a" }} /></Card>
                <Card size="small"><Statistic title="失败" value={result.stats.failed} valueStyle={{ color: "#dc2626" }} /></Card>
                <Card size="small"><Statistic title="消耗额度" value={result.stats.chargedQuota} /></Card>
                <Card size="small"><Statistic title="平均耗时" value={Math.round(result.stats.averageDurationMs)} suffix="ms" /></Card>
            </div>
            <Space wrap className="mb-4 w-full">
                <Input.Search className="w-64" allowClear placeholder="模型、渠道、Request ID" value={filters.q} onChange={(event) => setFilters((value) => ({ ...value, q: event.target.value }))} onSearch={() => void load(1)} />
                <Input className="w-40" allowClear placeholder="用户" value={filters.user} onChange={(event) => setFilters((value) => ({ ...value, user: event.target.value }))} />
                <Input className="w-40" allowClear placeholder="模型" value={filters.model} onChange={(event) => setFilters((value) => ({ ...value, model: event.target.value }))} />
                <Input className="w-40" allowClear placeholder="渠道" value={filters.channel} onChange={(event) => setFilters((value) => ({ ...value, channel: event.target.value }))} />
                <Select allowClear className="w-32" placeholder="状态" value={filters.status || undefined} onChange={(value) => setFilters((state) => ({ ...state, status: value || "" }))} options={[{ value: "succeeded", label: "成功" }, { value: "failed", label: "失败" }, { value: "running", label: "进行中" }]} />
            </Space>
            <Table
                rowKey="id"
                loading={loading}
                dataSource={result.items}
                pagination={{ current: page, pageSize: 20, total: result.total, showSizeChanger: false, onChange: (next) => void load(next) }}
                columns={[
                    { title: "时间", dataIndex: "startedAt", render: (value) => new Date(value).toLocaleString() },
                    { title: "用户", render: (_, item) => <div><div>{item.username || item.userId}</div><div className="text-xs text-stone-400">ID {item.userId}</div></div> },
                    { title: "模型", render: (_, item) => <div><div className="font-medium">{item.publishedModel || "未命名模型"}</div><div className="text-xs text-stone-500">{item.upstreamModel || "-"}</div></div> },
                    { title: "渠道", render: (_, item) => item.channelName || "-" },
                    { title: "状态", dataIndex: "status", render: statusTag },
                    { title: "Token", render: (_, item) => item.totalTokens.toLocaleString() },
                    { title: "耗时", render: (_, item) => `${item.durationMs} ms` },
                    { title: "详情", render: (_, item) => <Button type="link" onClick={() => setSelected(item)}>查看</Button> },
                ]}
            />
            <Drawer open={Boolean(selected)} width={640} title="使用日志详情" onClose={() => setSelected(null)}>
                {selected && <><Descriptions bordered size="small" column={2} items={[{ label: "Request ID", children: selected.requestId || "-" }, { label: "Task ID", children: selected.taskId }, { label: "用户", children: selected.username || selected.userId }, { label: "模型", children: selected.publishedModel || selected.upstreamModel }, { label: "渠道", children: selected.channelName || "-" }, { label: "状态", children: statusTag(selected.status) }, { label: "输入 Token", children: selected.inputTokens }, { label: "输出 Token", children: selected.outputTokens }, { label: "缓存 Token", children: selected.cachedTokens }, { label: "扣费额度", children: selected.chargedQuota }, { label: "IP", children: selected.ip || "-" }, { label: "错误", children: selected.errorMessage || "-" }]} /><div className="mt-5 grid gap-4 md:grid-cols-2"><Card size="small" title="请求摘要"><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selected.requestSummary || {}, null, 2)}</pre></Card><Card size="small" title="响应摘要"><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(selected.responseSummary || {}, null, 2)}</pre></Card></div></>}
            </Drawer>
        </Card>
    );
}

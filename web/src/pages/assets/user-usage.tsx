import { App, Button, Card, DatePicker, Descriptions, Modal, Pagination, Statistic, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { hostedApi, type UserUsageLog, type UserUsageResult } from "@/services/api/hosted";

const todayRange = (): [Dayjs, Dayjs] => [dayjs().startOf("day"), dayjs().endOf("day")];
const presets = [
    { label: "今天", value: todayRange },
    { label: "近 7 天", value: () => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
    { label: "近 30 天", value: () => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
];
const empty: UserUsageResult = { items: [], total: 0, page: 1, pageSize: 20, stats: { total: 0, succeeded: 0, failed: 0, running: 0, chargedQuota: 0, totalTokens: 0, averageDurationMs: 0 } };

const formatUnits = (item: UserUsageLog) => item.billingUnit === "token" ? `${item.totalTokens.toLocaleString()} Token` : `${item.billedUnits || 0} ${item.billingUnit || "次"}`;

export default function UserUsagePage() {
    const { message } = App.useApp();
    const initial = todayRange();
    const [range, setRange] = useState<[Dayjs, Dayjs]>(initial);
    const [result, setResult] = useState<UserUsageResult>(empty);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<UserUsageLog | null>(null);

    const load = async (nextPage = page, nextRange = range) => {
        setLoading(true);
        try {
            const data = await hostedApi.usageLogs({ page: nextPage, pageSize: 20, from: nextRange[0].toISOString(), to: nextRange[1].add(1, "millisecond").toISOString() });
            setResult(data);
            setPage(data.page);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "使用日志读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(1); }, []);

    const status = (value: UserUsageLog["status"]) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "processing"}>{value === "succeeded" ? "成功" : value === "failed" ? "失败" : "进行中"}</Tag>;

    return (
        <div className="h-full overflow-y-auto px-4 py-5 sm:px-7 sm:py-7">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                    <div><div className="text-xs font-medium uppercase tracking-[.22em] text-orange-600">USAGE LOG</div><h1 className="mt-2 text-2xl font-semibold tracking-[-.04em]">使用日志</h1><p className="mt-1 text-sm text-stone-500">查看你的生成用量、耗时与积分消耗</p></div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void load()}>刷新</Button>
                </div>
                <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Card size="small"><Statistic title="调用次数" value={result.stats.total} /></Card>
                    <Card size="small"><Statistic title="消耗积分" value={result.stats.chargedQuota} /></Card>
                    <Card size="small"><Statistic title="Token" value={result.stats.totalTokens} /></Card>
                    <Card size="small"><Statistic title="平均耗时" value={Math.round(result.stats.averageDurationMs)} suffix="ms" /></Card>
                </div>
                <Card>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium">记录明细</span><DatePicker.RangePicker value={range} showTime={{ format: "HH:mm:ss" }} format="YYYY-MM-DD HH:mm:ss" presets={presets.map((item) => ({ label: item.label, value: item.value() }))} onChange={(values) => { const next = values?.[0] && values?.[1] ? [values[0], values[1]] as [Dayjs, Dayjs] : todayRange(); setRange(next); void load(1, next); }} /></div>
                    <Table rowKey="id" loading={loading} dataSource={result.items} pagination={false} scroll={{ x: 900 }} columns={[
                        { title: "时间", dataIndex: "startedAt", render: (value: string) => new Date(value).toLocaleString("zh-CN") },
                        { title: "项目", dataIndex: "project", render: (value: string, item: UserUsageLog) => <div><div className="font-medium">{value || "生成任务"}</div><div className="text-xs text-stone-400">{item.capability}</div></div> },
                        { title: "耗时", dataIndex: "durationMs", render: (value: number) => `${value || 0} ms` },
                        { title: "Token / 用量", render: (_: unknown, item: UserUsageLog) => formatUnits(item) },
                        { title: "费用", dataIndex: "chargedQuota", render: (value: number) => <span className={value > 0 ? "font-medium text-orange-600" : "text-stone-500"}>{value || 0} 积分</span> },
                        { title: "状态", dataIndex: "status", render: status },
                        { title: "详情", render: (_: unknown, item: UserUsageLog) => <Button type="link" onClick={() => setSelected(item)}>查看</Button> },
                    ]} />
                    <div className="mt-4 flex justify-end"><Pagination current={page} pageSize={20} total={result.total} showSizeChanger={false} onChange={(next) => void load(next)} /></div>
                </Card>
                <Modal open={Boolean(selected)} title="使用详情" footer={null} onCancel={() => setSelected(null)} centered>
                    {selected ? <Descriptions bordered size="small" column={1} items={[{ label: "项目", children: selected.project }, { label: "时间", children: new Date(selected.startedAt).toLocaleString("zh-CN") }, { label: "耗时", children: `${selected.durationMs || 0} ms` }, { label: "Token / 用量", children: formatUnits(selected) }, { label: "费用", children: `${selected.chargedQuota || 0} 积分` }, { label: "状态", children: status(selected.status) }, ...(selected.errorMessage ? [{ label: "提示", children: selected.errorMessage }] : [])]} /> : null}
                </Modal>
            </div>
        </div>
    );
}

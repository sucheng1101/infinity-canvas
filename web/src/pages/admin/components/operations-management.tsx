import { Card, DatePicker, Input, Select, Space, Statistic, Table, Tag } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import { adminApi, type AdminAuditLog, type AdminFinanceSummary, type AdminGeneration, type AdminOrder } from "@/services/api/admin";

const todayRange = () => [dayjs().startOf("day"), dayjs().endOf("day")] as [Dayjs, Dayjs];
const datePresets = [
    { label: "今天", value: todayRange },
    { label: "近 7 天", value: () => [dayjs().subtract(6, "day").startOf("day"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
    { label: "本周", value: () => [dayjs().startOf("week"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
    { label: "近 30 天", value: () => [dayjs().subtract(29, "day").startOf("day"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
    { label: "本月", value: () => [dayjs().startOf("month"), dayjs().endOf("day")] as [Dayjs, Dayjs] },
];

const money = (fen: number) => `¥${(Number(fen || 0) / 100).toFixed(2)}`;
const points = (value: number) => `${Number(value || 0).toLocaleString()} 积分`;

export function OperationsManagement() {
    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [generations, setGenerations] = useState<AdminGeneration[]>([]);
    const [audits, setAudits] = useState<AdminAuditLog[]>([]);
    const [finance, setFinance] = useState<AdminFinanceSummary>();
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState<string>();
    const initialRange = todayRange();
    const [rangeValue, setRangeValue] = useState(initialRange);
    const [range, setRange] = useState<[string, string]>([initialRange[0].toISOString(), initialRange[1].add(1, "millisecond").toISOString()]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const params = { query, status, from: range?.[0], to: range?.[1] };
            const [orderResult, generationResult, auditResult, summary] = await Promise.all([adminApi.orders(params), adminApi.generations({ query, status }), adminApi.auditLogs({ query }), adminApi.financeSummary({ from: range?.[0], to: range?.[1] })]);
            setOrders(orderResult.items);
            setGenerations(generationResult.items);
            setAudits(auditResult.items);
            setFinance(summary);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    return (
        <Space direction="vertical" size="large" className="w-full">
            <Card title="财务概览" extra={<Space><Input.Search allowClear placeholder="搜索订单、用户或任务" onSearch={(value) => { setQuery(value); void load(); }} className="w-56" /><Select allowClear placeholder="任务/订单状态" className="w-36" value={status} onChange={(value) => { setStatus(value); setTimeout(() => void load(), 0); }} options={["paid", "quota_credited", "succeeded", "failed", "running", "cancelled"].map((value) => ({ value, label: value }))} /><DatePicker.RangePicker value={rangeValue} showTime={{ format: "HH:mm:ss" }} format="YYYY-MM-DD HH:mm:ss" presets={datePresets.map((item) => ({ label: item.label, value: item.value() }))} onChange={(values) => { const next = values?.[0] && values?.[1] ? [values[0], values[1]] as [Dayjs, Dayjs] : todayRange(); setRangeValue(next); setRange([next[0].toISOString(), next[1].add(1, "millisecond").toISOString()]); setTimeout(() => void load(), 0); }} /></Space>}>
                <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                    <Statistic title="充值订单" value={finance?.rechargeOrders || 0} />
                    <Statistic title="充值金额" value={money(finance?.rechargeFen || 0)} />
                    <Statistic title="调用次数" value={finance?.usageCount || 0} />
                    <Statistic title="收入积分" value={points(finance?.revenueQuota || 0)} />
                    <Statistic title="成本积分" value={points(finance?.costQuota || 0)} />
                    <Statistic title="利润积分" value={points(finance?.profitQuota || 0)} />
                </div>
            </Card>
            <Card title="订单管理" loading={loading}>
                <Table rowKey={(item) => `${item.kind}-${item.id}`} dataSource={orders} pagination={{ pageSize: 10 }} scroll={{ x: 980 }} columns={[
                    { title: "类型", dataIndex: "kind", render: (value: string) => <Tag color={value === "recharge" ? "blue" : "purple"}>{value === "recharge" ? "充值" : "运营订单"}</Tag> },
                    { title: "订单号", dataIndex: "orderNo" },
                    { title: "用户", render: (_, item) => item.username || item.userId },
                    { title: "商品", dataIndex: "productName" },
                    { title: "支付金额", dataIndex: "payAmountFen", render: (value: number) => value ? money(value) : "—" },
                    { title: "积分/扣除", dataIndex: "amount", render: (value: number) => points(value) },
                    { title: "状态", dataIndex: "status", render: (value: string) => <Tag>{value}</Tag> },
                    { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                ]} />
            </Card>
            <Card title="任务诊断" loading={loading}>
                <Table rowKey="id" dataSource={generations} pagination={{ pageSize: 10 }} scroll={{ x: 1060 }} columns={[
                    { title: "任务 ID", dataIndex: "id", ellipsis: true },
                    { title: "用户", render: (_, item) => item.username || item.userId },
                    { title: "模型", dataIndex: "modelName" },
                    { title: "能力", dataIndex: "capability" },
                    { title: "渠道", render: (_, item) => item.channelName ? `${item.channelName} / ${item.channelModel || ""}` : "默认路由" },
                    { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "succeeded" ? "success" : value === "failed" ? "error" : "processing"}>{value}</Tag> },
                    { title: "扣除", dataIndex: "settledAmount", render: (value: number) => points(value) },
                    { title: "错误", dataIndex: "errorMessage", ellipsis: true },
                    { title: "创建时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                ]} />
            </Card>
            <Card title="管理员审计" loading={loading}>
                <Table rowKey="id" dataSource={audits} pagination={{ pageSize: 10 }} columns={[
                    { title: "动作", dataIndex: "action" },
                    { title: "资源", render: (_, item) => `${item.resourceType} / ${item.resourceId}` },
                    { title: "操作人", render: (_, item) => item.operatorName || item.operatorId || "系统" },
                    { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                ]} />
            </Card>
        </Space>
    );
}

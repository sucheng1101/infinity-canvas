import { App, Button, Card, Space, Switch, Table, Tag, Tooltip } from "antd";
import { Pencil, Plus, RadioTower, Route } from "lucide-react";
import { useState } from "react";

import { adminApi, type AdminChannel, type AdminRoute, type ChannelTestResult } from "@/services/api/admin";

const capabilityLabels: Record<string, string> = { image: "生图", video: "视频", text: "文本", audio: "音频" };

type Props = {
    channels: AdminChannel[];
    routes: AdminRoute[];
    loading: boolean;
    onAddChannel: () => void;
    onEditChannel: (channel: AdminChannel) => void;
    onToggleChannel: (channel: AdminChannel, enabled: boolean) => Promise<void>;
    onAddRoute: () => void;
    onEditRoute: (route: AdminRoute) => void;
    onToggleRoute: (route: AdminRoute) => Promise<void>;
    onDeleteRoute: (route: AdminRoute) => Promise<void>;
};

export function ChannelManagement({ channels, routes, loading, onAddChannel, onEditChannel, onToggleChannel, onAddRoute, onEditRoute, onToggleRoute, onDeleteRoute }: Props) {
    const { message } = App.useApp();
    const [testing, setTesting] = useState<number>();
    const [results, setResults] = useState<Record<number, ChannelTestResult>>({});

    const testChannel = async (channel: AdminChannel) => {
        setTesting(channel.id);
        try {
            const result = await adminApi.testChannel(channel.id);
            setResults((current) => ({ ...current, [channel.id]: result }));
            message.success(`${channel.name}：${result.message}`);
        } catch (error) {
            setResults((current) => ({ ...current, [channel.id]: { ok: false, latencyMs: 0, modelCount: 0, message: "连接失败" } }));
            message.error(error instanceof Error ? error.message : "渠道测试失败");
        } finally {
            setTesting(undefined);
        }
    };

    return (
        <Card
            title="渠道管理"
            extra={
                <Space wrap>
                    <Button icon={<Route className="size-4" />} onClick={onAddRoute}>新增模型路由</Button>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={onAddChannel}>添加渠道</Button>
                </Space>
            }
        >
            <Table
                rowKey="id"
                loading={loading}
                dataSource={channels}
                pagination={false}
                scroll={{ x: 1100 }}
                expandable={{
                    rowExpandable: (channel) => routes.some((route) => route.channelId === channel.id),
                    expandedRowRender: (channel) => {
                        const channelRoutes = routes.filter((route) => route.channelId === channel.id);
                        return (
                            <Table
                                rowKey="id"
                                size="small"
                                pagination={false}
                                dataSource={channelRoutes}
                                columns={[
                                    { title: "公开模型", dataIndex: "publishedModel" },
                                    { title: "上游模型", dataIndex: "upstreamModel" },
                                    { title: "优先级", dataIndex: "priority", width: 90 },
                                    { title: "权重", dataIndex: "weight", width: 90 },
                                    { title: "同级比例", dataIndex: "weightPercent", width: 100, render: (value: number) => `${value.toFixed(1)}%` },
                                    { title: "可用性", width: 110, render: (_, route) => <Tag color={route.available ? "green" : "orange"}>{route.available ? "可调度" : "未就绪"}</Tag> },
                                    {
                                        title: "启用",
                                        width: 90,
                                        render: (_, route) => <Switch size="small" checked={route.status === "active"} onChange={() => void onToggleRoute(route)} />,
                                    },
                                    {
                                        title: "操作",
                                        width: 150,
                                        render: (_, route) => (
                                            <Space size="small">
                                                <Button type="link" size="small" onClick={() => onEditRoute(route)}>编辑</Button>
                                                <Button danger type="link" size="small" onClick={() => void onDeleteRoute(route)}>移除</Button>
                                            </Space>
                                        ),
                                    },
                                ]}
                            />
                        );
                    },
                }}
                columns={[
                    {
                        title: "名称",
                        dataIndex: "name",
                        width: 180,
                        render: (name, channel) => (
                            <div className="min-w-0">
                                <div className="font-medium">{name}</div>
                                <Tooltip title={channel.baseUrl}><div className="max-w-44 truncate text-xs text-stone-500">{channel.baseUrl}</div></Tooltip>
                            </div>
                        ),
                    },
                    {
                        title: "分组",
                        width: 190,
                        render: (_, channel) => {
                            const capabilities = Array.from(new Set(channel.models.map((model) => model.capability)));
                            return capabilities.length ? <Space size={[4, 4]} wrap>{capabilities.map((capability) => <Tag key={capability}>{capabilityLabels[capability] || capability}</Tag>)}</Space> : <span className="text-stone-400">未绑定模型</span>;
                        },
                    },
                    { title: "类型", width: 110, render: () => <Tag color="green">OpenAI</Tag> },
                    {
                        title: "状态",
                        width: 110,
                        render: (_, channel) => <Switch checked={channel.status === "active"} checkedChildren="启用" unCheckedChildren="停用" onChange={(checked) => void onToggleChannel(channel, checked)} />,
                    },
                    {
                        title: "测试结果",
                        width: 130,
                        render: (_, channel) => {
                            if (testing === channel.id) return <Tag color="processing">测试中</Tag>;
                            const result = results[channel.id];
                            if (!result) return <Tag>未测试</Tag>;
                            return <Tooltip title={result.ok ? `读取到 ${result.modelCount} 个模型` : result.message}><Tag color={result.ok ? "success" : "error"}>{result.ok ? `${result.latencyMs} ms` : "失败"}</Tag></Tooltip>;
                        },
                    },
                    {
                        title: "模型 / Key",
                        width: 130,
                        render: (_, channel) => <span>{channel.models.filter((model) => model.status !== "hidden").length} / {channel.modelApiKeys.length}</span>,
                    },
                    {
                        title: "优先级 / 权重",
                        width: 160,
                        render: (_, channel) => {
                            const channelRoutes = routes.filter((route) => route.channelId === channel.id && route.status === "active");
                            if (!channelRoutes.length) return <span className="text-stone-400">未配置路由</span>;
                            return <Tooltip title={channelRoutes.map((route) => `${route.publishedModel}：优先级 ${route.priority}，权重 ${route.weight}`).join("；")}><span className="cursor-help">P{Math.min(...channelRoutes.map((route) => route.priority))} / W{channelRoutes.reduce((total, route) => total + route.weight, 0)}</span></Tooltip>;
                        },
                    },
                    {
                        title: "操作",
                        fixed: "right",
                        width: 190,
                        render: (_, channel) => (
                            <Space size="small">
                                <Button size="small" loading={testing === channel.id} icon={<RadioTower className="size-3.5" />} onClick={() => void testChannel(channel)}>测试</Button>
                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEditChannel(channel)}>编辑</Button>
                            </Space>
                        ),
                    },
                ]}
            />
            <div className="mt-3 text-xs text-stone-500">展开渠道行可管理该渠道承载的模型路由；优先级数字越小越优先，同一优先级按权重分配请求。</div>
        </Card>
    );
}

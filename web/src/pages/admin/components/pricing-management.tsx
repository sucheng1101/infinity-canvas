import { Button, Card, Space, Switch, Table, Tag } from "antd";
import { Pencil, Plus } from "lucide-react";

import type { PricingVersion } from "@/services/api/admin";
import type { PublishedModel, RechargeProduct } from "@/services/api/hosted";

const capabilityLabels: Record<string, string> = { image: "生图", video: "视频", text: "文本", audio: "音频" };
const pricingTypeLabels: Record<string, string> = { fixed: "固定价格", per_unit: "按数量", per_second: "按秒", per_token: "按 Token" };

type Props = {
    models: PublishedModel[];
    pricing: PricingVersion[];
    products: RechargeProduct[];
    loading: boolean;
    onEditPricing: (model?: PublishedModel, pricing?: PricingVersion) => void;
    onTogglePricing: (model: PublishedModel, enabled: boolean, pricing?: PricingVersion) => Promise<void>;
    onEditProduct: (product?: RechargeProduct) => void;
    onToggleProduct: (product: RechargeProduct, enabled: boolean) => Promise<void>;
};

export function PricingManagement({ models, pricing, products, loading, onEditPricing, onTogglePricing, onEditProduct, onToggleProduct }: Props) {
    const priceRows = models.map((model) => {
        const versions = pricing.filter((item) => item.publishedModelId === model.id).sort((a, b) => b.version - a.version);
        return { model, active: versions.find((item) => item.status === "active"), latest: versions[0] };
    });

    return (
        <Space direction="vertical" className="w-full" size="large">
            <Card title="模型定价" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => onEditPricing()}>设置模型价格</Button>}>
                <Table
                    rowKey={(row) => row.model.id}
                    loading={loading}
                    pagination={false}
                    dataSource={priceRows}
                    columns={[
                        { title: "模型", render: (_, row) => <div><div className="font-medium">{row.model.displayName}</div><Tag className="mt-1">{capabilityLabels[row.model.capability] || row.model.capability}</Tag></div> },
                        { title: "计费方式", render: (_, row) => row.active || row.latest ? pricingTypeLabels[String((row.active || row.latest)?.formula.type)] || String((row.active || row.latest)?.formula.type || "-") : <span className="text-stone-400">未设置</span> },
                        { title: "单价（积分）", render: (_, row) => { const formula = (row.active || row.latest)?.formula; const variants = Array.isArray(formula?.variants) ? formula.variants as Array<{ key?: string; unitAmount?: number }> : []; return formula ? <div><div>{Number(formula.unitAmount || 0).toLocaleString()}</div>{variants.length ? <div className="mt-1 flex flex-wrap gap-1">{variants.slice(0, 4).map((variant) => <Tag key={variant.key}>{variant.key}: {Number(variant.unitAmount || 0).toLocaleString()}</Tag>)}{variants.length > 4 ? <Tag>+{variants.length - 4}</Tag> : null}</div> : null}</div> : "-"; } },
                        { title: "版本", render: (_, row) => row.active || row.latest ? `v${(row.active || row.latest)?.version}` : "-" },
                        { title: "状态", render: (_, row) => row.active ? <Tag color="success">已启用</Tag> : row.latest?.status === "draft" ? <Tag color="warning">草稿</Tag> : <Tag>未定价</Tag> },
                        {
                            title: "启用",
                            width: 110,
                            render: (_, row) => <Switch checked={Boolean(row.active)} checkedChildren="开" unCheckedChildren="关" onChange={(checked) => void onTogglePricing(row.model, checked, row.active || row.latest)} />,
                        },
                        { title: "操作", width: 110, render: (_, row) => <Button type="link" icon={<Pencil className="size-3.5" />} onClick={() => onEditPricing(row.model, row.active || row.latest)}>设置价格</Button> },
                    ]}
                />
                <div className="mt-3 text-xs text-stone-500">只有渠道路由正常、模型目录启用且定价开关开启的模型，才会出现在用户模型选择器中。</div>
            </Card>

            <Card title="充值套餐" extra={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => onEditProduct()}>添加充值套餐</Button>}>
                <Table
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    dataSource={products}
                    columns={[
                        { title: "套餐名称", dataIndex: "name", render: (value) => <span className="font-medium">{value}</span> },
                        { title: "支付金额", dataIndex: "payAmountFen", render: (value) => `¥${(value / 100).toFixed(2)}` },
                        { title: "到账积分", dataIndex: "quotaAmount", render: (value) => Number(value).toLocaleString() },
                        { title: "赠送积分", dataIndex: "giftQuota", render: (value) => Number(value).toLocaleString() },
                        { title: "排序", dataIndex: "sortOrder" },
                        { title: "启用", width: 110, render: (_, product) => <Switch checked={product.status === "active"} checkedChildren="开" unCheckedChildren="关" onChange={(checked) => void onToggleProduct(product, checked)} /> },
                        { title: "操作", width: 100, render: (_, product) => <Button type="link" icon={<Pencil className="size-3.5" />} onClick={() => onEditProduct(product)}>编辑</Button> },
                    ]}
                />
            </Card>
        </Space>
    );
}

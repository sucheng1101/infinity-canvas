import { App, Button, Card, Col, Empty, List, Progress, Radio, Row, Skeleton, Statistic, Tag } from "antd";
import { ArrowUpRight, Coins, Copy, Gift, History, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { hostedApi, type InvitationSelf, type QuotaLedger, type QuotaSummary, type RechargeProduct, type SubscriptionPlan, type UserSubscription } from "@/services/api/hosted";

const formatQuota = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
const formatMoney = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const ledgerLabel = (item: QuotaLedger) => {
    if (item.reason?.trim()) return item.reason;
    if (item.businessType === "generation_settlement") return "生成扣费";
    if (item.businessType === "subscription_purchase") return "订阅购买";
    if (item.businessType === "custom_channel_unlock") return "自定义渠道解锁";
    if (item.source === "recharge") return "充值到账";
    if (item.source === "invitation") return "邀请奖励";
    if (item.source === "admin") return "管理员调整";
    return "积分变动";
};

function submitCheckout(url: string, params: Record<string, string>) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    Object.entries(params).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
    form.remove();
}

export default function BillingPage() {
    const { message } = App.useApp();
    const [quota, setQuota] = useState<QuotaSummary>();
    const [ledger, setLedger] = useState<QuotaLedger[]>([]);
    const [products, setProducts] = useState<RechargeProduct[]>([]);
    const [invitation, setInvitation] = useState<InvitationSelf>();
    const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
    const [subscription, setSubscription] = useState<UserSubscription>();
    const [loading, setLoading] = useState(true);
    const [buying, setBuying] = useState<number>();
    const [paymentMethod, setPaymentMethod] = useState("alipay");

    const load = async () => {
        setLoading(true);
        try {
            const [quotaResult, ledgerResult, productsResult, invitationResult, subscriptionResult, currentSubscription] = await Promise.all([
                hostedApi.quota(),
                hostedApi.ledger(),
                hostedApi.products(),
                hostedApi.invitation(),
                hostedApi.subscriptionPlans(),
                hostedApi.subscription(),
            ]);
            setQuota(quotaResult);
            setLedger(ledgerResult.items);
            setProducts(productsResult.items);
            setInvitation(invitationResult);
            setSubscriptionPlans(subscriptionResult.items);
            setSubscription(currentSubscription);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "账户信息读取失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const status = params.get("payment");
        if (!status) return;
        if (status === "success") message.success("支付成功，积分已到账");
        if (status === "pending") message.info("支付结果确认中，请稍后刷新账户");
        if (status === "fail") message.error("支付未完成，请检查订单状态");
        params.delete("payment");
        const query = params.toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }, [message]);

    const balancePercent = useMemo(() => {
        if (!quota || quota.balance <= 0) return 0;
        return Math.min(100, Math.round((quota.available / quota.balance) * 100));
    }, [quota]);

    const buy = async (product: RechargeProduct) => {
        setBuying(product.id);
        try {
            const result = await hostedApi.createOrder(product.id, paymentMethod);
            submitCheckout(result.checkout.url, result.checkout.params);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "充值订单创建失败");
        } finally {
            setBuying(undefined);
        }
    };

    const buySubscription = async (plan: SubscriptionPlan) => {
        try {
            const result = await hostedApi.purchaseSubscription(plan.id);
            setSubscription(result);
            message.success("订阅已开通");
            await load();
        } catch (error) { message.error(error instanceof Error ? error.message : "订阅购买失败"); }
    };

    const copyInviteCode = async () => {
        if (!invitation?.inviteCode) return;
        const link = `${window.location.origin}/register?invite=${encodeURIComponent(invitation.inviteCode)}`;
        await navigator.clipboard.writeText(link);
        message.success("邀请链接已复制");
    };

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] px-5 py-8 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-8">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-orange-600 dark:text-orange-400">ACCOUNT CENTER</div>
                        <h1 className="text-3xl font-semibold tracking-[-.04em]">积分与充值</h1>
                        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">只关心可用积分，模型与渠道由平台统一维护。</p>
                    </div>
                    <Button icon={<History className="size-4" />} onClick={() => void load()} loading={loading}>刷新账户</Button>
                </div>

                {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : (
                    <>
                        <Row gutter={[16, 16]}>
                            <Col xs={24} lg={15}>
                                <Card className="overflow-hidden !border-0 !bg-stone-950 !text-white !shadow-[0_20px_60px_rgba(28,25,23,.18)]">
                                    <div className="relative overflow-hidden p-2">
                                        <div className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full bg-orange-400/25 blur-3xl" />
                                        <div className="relative flex items-start justify-between">
                                            <div>
                                                <div className="flex items-center gap-2 text-sm text-stone-300"><WalletCards className="size-4 text-orange-300" /> 平台积分</div>
                                                <div className="mt-6 text-5xl font-semibold tracking-[-.06em]">{formatQuota(quota?.available || 0)}</div>
                                                <div className="mt-2 text-sm text-stone-400">可用积分 · 已预留 {formatQuota(quota?.reserved || 0)}</div>
                                            </div>
                                            <div className="rounded-full border border-white/10 bg-white/10 p-3"><Coins className="size-5 text-orange-300" /></div>
                                        </div>
                                        <div className="relative mt-9">
                                            <div className="mb-2 flex justify-between text-xs text-stone-400"><span>当前可用率</span><span>{balancePercent}%</span></div>
                                            <Progress percent={balancePercent} showInfo={false} strokeColor="#fb923c" trailColor="rgba(255,255,255,.12)" />
                                        </div>
                                    </div>
                                </Card>
                            </Col>
                            <Col xs={24} lg={9}>
                                <Card className="h-full !border-stone-200 !bg-white/70 dark:!border-stone-800 dark:!bg-stone-900/50">
                                    <div className="flex items-center gap-2 text-sm font-medium"><Gift className="size-4 text-orange-500" /> 邀请奖励</div>
                                    <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">邀请朋友注册并完成验证，双方都可以获得管理员配置的积分奖励。</p>
                                    <div className="mt-5 flex items-center gap-2">
                                        <div className="flex-1 min-w-0 truncate rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2 font-mono text-sm dark:border-stone-700 dark:bg-stone-950">{invitation?.inviteCode ? `${window.location.origin}/register?invite=${encodeURIComponent(invitation.inviteCode)}` : "暂未生成"}</div>
                                        <Button icon={<Copy className="size-4" />} onClick={() => void copyInviteCode()} disabled={!invitation?.inviteCode}>复制链接</Button>
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 gap-3">
                                        <Statistic title="已邀请" value={invitation?.counts.invited || 0} prefix={<UsersRound className="mr-1 inline size-4" />} />
                                        <Statistic title="奖励次数" value={invitation?.counts.rewarded || 0} />
                                    </div>
                                </Card>
                            </Col>
                        </Row>

                        <section className="mt-8">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">选择积分套餐</h2><span className="text-xs text-stone-400">支付后积分自动到账</span></div><Radio.Group value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} optionType="button" buttonStyle="solid" options={[{ label: "支付宝", value: "alipay" }, { label: "微信支付", value: "wxpay" }]} /></div>
                            {products.length ? <Row gutter={[16, 16]}>{products.map((product) => (
                                <Col key={product.id} xs={24} sm={12} lg={8}>
                                    <Card className="h-full !border-stone-200 !bg-white transition duration-300 hover:-translate-y-1 hover:!border-orange-300 hover:shadow-lg dark:!border-stone-800 dark:!bg-stone-900">
                                        <div className="flex items-start justify-between"><div><div className="text-base font-semibold">{product.name}</div><div className="mt-2 text-3xl font-semibold tracking-[-.05em]">{formatMoney(product.payAmountFen)}</div></div><Tag color="orange">推荐</Tag></div>
                                        <div className="mt-5 space-y-2 text-sm text-stone-500 dark:text-stone-400"><div className="flex justify-between"><span>基础积分</span><strong className="text-stone-800 dark:text-stone-200">{formatQuota(product.quotaAmount)}</strong></div>{product.giftQuota > 0 ? <div className="flex justify-between"><span>赠送积分</span><strong className="text-orange-600">+{formatQuota(product.giftQuota)}</strong></div> : null}{product.customChannelEnabled && (product.customChannelLimit || 0) > 0 ? <div className="flex justify-between"><span>自定义渠道</span><strong className="text-stone-800 dark:text-stone-200">{product.customChannelLimit} 个{product.customChannelDays ? ` · ${product.customChannelDays} 天` : " · 长期"}</strong></div> : null}</div>
                                        <Button type="primary" block className="mt-6" icon={<ArrowUpRight className="size-4" />} loading={buying === product.id} onClick={() => void buy(product)}>立即充值</Button>
                                    </Card>
                                </Col>
                            ))}</Row> : <Card><Empty description="管理员还没有发布充值套餐" /></Card>}
                        </section>

                        <section className="mt-8">
                            <div className="mb-4"><h2 className="text-xl font-semibold">订阅套餐</h2><span className="text-xs text-stone-400">订阅额度按具体模型记录：生图按张、视频按秒、文本按 Token；额度用完后自动使用积分。</span></div>
                            {subscription?.active ? <Card className="mb-4 !border-emerald-200 !bg-emerald-50/70"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">当前订阅：{subscription.subscription?.plan.name}</div><div className="mt-1 text-sm text-stone-600">有效期至 {subscription.subscription?.expiresAt ? new Date(subscription.subscription.expiresAt).toLocaleDateString() : "-"}</div></div><Tag color="success">已开通</Tag></div></Card> : null}
                            {subscriptionPlans.length ? <Row gutter={[16, 16]}>{subscriptionPlans.map((plan) => <Col key={plan.id} xs={24} sm={12} lg={8}><Card className="h-full !border-stone-200 dark:!border-stone-800"><div className="flex items-start justify-between"><div><div className="font-semibold">{plan.name}</div><div className="mt-2 text-3xl font-semibold">{formatQuota(plan.priceQuota)} <span className="text-sm font-normal text-stone-400">积分</span></div></div><Tag color="blue">{plan.durationDays} 天</Tag></div><div className="mt-4 space-y-2 text-xs text-stone-500">{plan.quotas.map((quota) => <div key={quota.publishedModelId} className="rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-950"><div className="font-medium text-stone-700 dark:text-stone-200">{quota.modelName || `模型 #${quota.publishedModelId}`}</div><div>生图 {quota.imageCount} 张 · 视频 {quota.videoSeconds} 秒 · 文本 {formatQuota(quota.textTokens)} Token</div></div>)}</div><Button type="primary" block className="mt-5" onClick={() => void buySubscription(plan)}>立即订阅</Button></Card></Col>)}</Row> : <Card><Empty description="暂无可购买订阅套餐" /></Card>}
                        </section>

                        <section className="mt-8">
                            <h2 className="mb-4 text-xl font-semibold">积分流水</h2>
                            <Card className="!border-stone-200 !bg-white dark:!border-stone-800 dark:!bg-stone-900">
                                <List
                                    dataSource={ledger}
                                    locale={{ emptyText: "暂无积分流水" }}
                                    renderItem={(item) => <List.Item><div><div className="text-sm font-medium">{ledgerLabel(item)}</div><div className="mt-1 text-xs text-stone-400">{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.businessType}</div></div><div className={item.delta >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>{item.delta >= 0 ? "+" : ""}{formatQuota(item.delta)}</div></List.Item>}
                                />
                            </Card>
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}

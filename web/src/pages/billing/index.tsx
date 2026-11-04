import { App, Button, Card, Col, Empty, List, Progress, Radio, Row, Skeleton, Statistic, Tag } from "antd";
import { ArrowUpRight, Coins, Copy, Gift, History, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { hostedApi, type InvitationSelf, type QuotaLedger, type QuotaSummary, type RechargeProduct, type SubscriptionPlan, type UserSubscription } from "@/services/api/hosted";

const formatQuota = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
const formatMoney = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const ledgerLabel = (item: QuotaLedger) => {
    if (item.reason?.trim()) return item.reason;
    if (item.businessType === "generation_settlement") return i18n.t("billingPage.ledgerGeneration");
    if (item.businessType === "subscription_purchase") return i18n.t("billingPage.ledgerSubscription");
    if (item.businessType === "custom_channel_unlock") return i18n.t("billingPage.ledgerChannelUnlock");
    if (item.source === "recharge") return i18n.t("billingPage.ledgerRecharge");
    if (item.source === "invitation") return i18n.t("billingPage.ledgerInvitation");
    if (item.source === "admin") return i18n.t("billingPage.ledgerAdmin");
    return i18n.t("billingPage.ledgerOther");
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
    // Subscribing here re-renders the page (and its i18n.t helpers) when the locale changes.
    useTranslation();
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
            message.error(error instanceof Error ? error.message : i18n.t("billingPage.loadFailed"));
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
        if (status === "success") message.success(i18n.t("billingPage.paymentSuccess"));
        if (status === "pending") message.info(i18n.t("billingPage.paymentPending"));
        if (status === "fail") message.error(i18n.t("billingPage.paymentFailed"));
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
            message.error(error instanceof Error ? error.message : i18n.t("billingPage.orderFailed"));
        } finally {
            setBuying(undefined);
        }
    };

    const buySubscription = async (plan: SubscriptionPlan) => {
        try {
            const result = await hostedApi.purchaseSubscription(plan.id);
            setSubscription(result);
            message.success(i18n.t("billingPage.subscribed"));
            await load();
        } catch (error) { message.error(error instanceof Error ? error.message : i18n.t("billingPage.subscribeFailed")); }
    };

    const copyInviteCode = async () => {
        if (!invitation?.inviteCode) return;
        const link = `${window.location.origin}/register?invite=${encodeURIComponent(invitation.inviteCode)}`;
        await navigator.clipboard.writeText(link);
        message.success(i18n.t("billingPage.inviteCopied"));
    };

    return (
        <main className="h-full overflow-y-auto bg-[#f7f7f5] px-5 py-8 text-stone-950 dark:bg-[#11110f] dark:text-stone-100 sm:px-8">
            <div className="mx-auto max-w-6xl">
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[.24em] text-orange-600 dark:text-orange-400">ACCOUNT CENTER</div>
                        <h1 className="text-3xl font-semibold tracking-[-.04em]">{i18n.t("billingPage.title")}</h1>
                        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{i18n.t("billingPage.subtitle")}</p>
                    </div>
                    <Button icon={<History className="size-4" />} onClick={() => void load()} loading={loading}>{i18n.t("billingPage.refresh")}</Button>
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
                                                <div className="flex items-center gap-2 text-sm text-stone-300"><WalletCards className="size-4 text-orange-300" /> {i18n.t("billingPage.platformCredits")}</div>
                                                <div className="mt-6 text-5xl font-semibold tracking-[-.06em]">{formatQuota(quota?.available || 0)}</div>
                                                <div className="mt-2 text-sm text-stone-400">{i18n.t("billingPage.availableReserved", { reserved: formatQuota(quota?.reserved || 0) })}</div>
                                            </div>
                                            <div className="rounded-full border border-white/10 bg-white/10 p-3"><Coins className="size-5 text-orange-300" /></div>
                                        </div>
                                        <div className="relative mt-9">
                                            <div className="mb-2 flex justify-between text-xs text-stone-400"><span>{i18n.t("billingPage.usageRate")}</span><span>{balancePercent}%</span></div>
                                            <Progress percent={balancePercent} showInfo={false} strokeColor="#fb923c" trailColor="rgba(255,255,255,.12)" />
                                        </div>
                                    </div>
                                </Card>
                            </Col>
                            <Col xs={24} lg={9}>
                                <Card className="h-full !border-stone-200 !bg-white/70 dark:!border-stone-800 dark:!bg-stone-900/50">
                                    <div className="flex items-center gap-2 text-sm font-medium"><Gift className="size-4 text-orange-500" /> {i18n.t("billingPage.inviteRewardTitle")}</div>
                                    <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">{i18n.t("billingPage.inviteDescription")}</p>
                                    <div className="mt-5 flex items-center gap-2">
                                        <div className="flex-1 min-w-0 truncate rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-2 font-mono text-sm dark:border-stone-700 dark:bg-stone-950">{invitation?.inviteCode ? `${window.location.origin}/register?invite=${encodeURIComponent(invitation.inviteCode)}` : i18n.t("billingPage.inviteNotReady")}</div>
                                        <Button icon={<Copy className="size-4" />} onClick={() => void copyInviteCode()} disabled={!invitation?.inviteCode}>{i18n.t("billingPage.copyLink")}</Button>
                                    </div>
                                    <div className="mt-5 grid grid-cols-2 gap-3">
                                        <Statistic title={i18n.t("billingPage.invited")} value={invitation?.counts.invited || 0} prefix={<UsersRound className="mr-1 inline size-4" />} />
                                        <Statistic title={i18n.t("billingPage.rewardCount")} value={invitation?.counts.rewarded || 0} />
                                    </div>
                                </Card>
                            </Col>
                        </Row>

                        <section className="mt-8">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{i18n.t("billingPage.choosePlan")}</h2><span className="text-xs text-stone-400">{i18n.t("billingPage.autoCreditHint")}</span></div><Radio.Group value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} optionType="button" buttonStyle="solid" options={[{ label: i18n.t("billingPage.alipay"), value: "alipay" }, { label: i18n.t("billingPage.wechat"), value: "wxpay" }]} /></div>
                            {products.length ? <Row gutter={[16, 16]}>{products.map((product) => (
                                <Col key={product.id} xs={24} sm={12} lg={8}>
                                    <Card className="h-full !border-stone-200 !bg-white transition duration-300 hover:-translate-y-1 hover:!border-orange-300 hover:shadow-lg dark:!border-stone-800 dark:!bg-stone-900">
                                        <div className="flex items-start justify-between"><div><div className="text-base font-semibold">{product.name}</div><div className="mt-2 text-3xl font-semibold tracking-[-.05em]">{formatMoney(product.payAmountFen)}</div></div><Tag color="orange">{i18n.t("billingPage.recommended")}</Tag></div>
                                        <div className="mt-5 space-y-2 text-sm text-stone-500 dark:text-stone-400"><div className="flex justify-between"><span>{i18n.t("billingPage.baseCredits")}</span><strong className="text-stone-800 dark:text-stone-200">{formatQuota(product.quotaAmount)}</strong></div>{product.giftQuota > 0 ? <div className="flex justify-between"><span>{i18n.t("billingPage.giftCredits")}</span><strong className="text-orange-600">+{formatQuota(product.giftQuota)}</strong></div> : null}{product.customChannelEnabled && (product.customChannelLimit || 0) > 0 ? <div className="flex justify-between"><span>{i18n.t("billingPage.customChannel")}</span><strong className="text-stone-800 dark:text-stone-200">{product.customChannelLimit} {i18n.t("billingPage.channelUnit")}{product.customChannelDays ? ` · ${i18n.t("billingPage.days", { days: product.customChannelDays })}` : ` · ${i18n.t("billingPage.longTerm")}`}</strong></div> : null}</div>
                                        <Button type="primary" block className="mt-6" icon={<ArrowUpRight className="size-4" />} loading={buying === product.id} onClick={() => void buy(product)}>{i18n.t("billingPage.rechargeNow")}</Button>
                                    </Card>
                                </Col>
                            ))}</Row> : <Card><Empty description={i18n.t("billingPage.noProducts")} /></Card>}
                        </section>

                        <section className="mt-8">
                            <div className="mb-4"><h2 className="text-xl font-semibold">{i18n.t("billingPage.subscriptionTitle")}</h2><span className="text-xs text-stone-400">{i18n.t("billingPage.subscriptionHint")}</span></div>
                            {subscription?.active ? <Card className="mb-4 !border-emerald-200 !bg-emerald-50/70"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">{i18n.t("billingPage.currentSubscription", { name: subscription.subscription?.plan.name })}</div><div className="mt-1 text-sm text-stone-600">{i18n.t("billingPage.validUntil", { date: subscription.subscription?.expiresAt ? new Date(subscription.subscription.expiresAt).toLocaleDateString() : "-" })}</div></div><Tag color="success">{i18n.t("billingPage.activated")}</Tag></div></Card> : null}
                            {subscriptionPlans.length ? <Row gutter={[16, 16]}>{subscriptionPlans.map((plan) => <Col key={plan.id} xs={24} sm={12} lg={8}><Card className="h-full !border-stone-200 dark:!border-stone-800"><div className="flex items-start justify-between"><div><div className="font-semibold">{plan.name}</div><div className="mt-2 text-3xl font-semibold">{formatQuota(plan.priceQuota)} <span className="text-sm font-normal text-stone-400">{i18n.t("billingPage.creditsUnit")}</span></div></div><Tag color="blue">{i18n.t("billingPage.days", { days: plan.durationDays })}</Tag></div><div className="mt-4 space-y-2 text-xs text-stone-500">{plan.quotas.map((quota) => <div key={quota.publishedModelId} className="rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-950"><div className="font-medium text-stone-700 dark:text-stone-200">{quota.modelName || i18n.t("billingPage.modelNumber", { id: quota.publishedModelId })}</div><div>{i18n.t("billingPage.modelQuota", { images: quota.imageCount, seconds: quota.videoSeconds, tokens: formatQuota(quota.textTokens) })}</div></div>)}</div><Button type="primary" block className="mt-5" onClick={() => void buySubscription(plan)}>{i18n.t("billingPage.subscribeNow")}</Button></Card></Col>)}</Row> : <Card><Empty description={i18n.t("billingPage.noPlans")} /></Card>}
                        </section>

                        <section className="mt-8">
                            <h2 className="mb-4 text-xl font-semibold">{i18n.t("billingPage.ledgerTitle")}</h2>
                            <Card className="!border-stone-200 !bg-white dark:!border-stone-800 dark:!bg-stone-900">
                                <List
                                    dataSource={ledger}
                                    locale={{ emptyText: i18n.t("billingPage.noLedger") }}
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

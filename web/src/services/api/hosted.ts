export type QuotaSummary = { balance: number; reserved: number; available: number };
export type QuotaLedger = { id: number; delta: number; balanceAfter: number; source: string; businessType: string; createdAt: string };
export type RechargeProduct = {
    id: number;
    name: string;
    payAmountFen: number;
    quotaAmount: number;
    giftQuota: number;
    status: "active" | "hidden";
    sortOrder: number;
};
export type RechargeOrder = { id: number; orderNo: string; payAmountFen: number; quotaAmount: number; giftQuota: number; status: string; expiresAt: string; paidAt?: string; creditedAt?: string };
export type Checkout = { provider: string; url: string; params: Record<string, string> };
export type InvitationSelf = {
    inviteCode: string;
    counts: { invited: number; rewarded: number };
    rewardConfigSummary: { open: boolean; inviterQuota: number; inviteeQuota: number };
};
export type PublishedModel = {
    id: number;
    capability: "image" | "text" | "video" | "audio" | string;
    displayName: string;
    publicConfig: Record<string, unknown>;
    status?: "active" | "hidden";
    sortOrder?: number;
};
export type HostedQuote = { quoteId: string; modelId: number; amount: number; currency: string; priceVersion: number; expiresAt: string; summary: Record<string, unknown> };
export type HostedGenerationTask = {
    id: string;
    quoteId: string;
    modelId: number;
    capability: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    reservedAmount: number;
    settledAmount: number;
    output?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
};

type Envelope<T> = { data: T; requestId?: string };
type ErrorEnvelope = { error?: { code?: string; message?: string } };
const apiBase = (import.meta.env.VITE_HOSTED_API_BASE || "/api/v1").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await response.json().catch(() => ({}))) as Envelope<T> & ErrorEnvelope;
    if (!response.ok) throw new Error(body.error?.message || "请求处理失败");
    return body.data;
}

export const hostedApi = {
    quota: () => request<QuotaSummary>("/account/quota"),
    ledger: () => request<{ items: QuotaLedger[]; nextCursor: string }>("/account/ledger?limit=20"),
    products: () => request<{ items: RechargeProduct[] }>("/recharge/products"),
    createOrder: (productId: number, paymentMethod = "alipay") =>
        request<{ order: RechargeOrder; checkout: Checkout }>("/recharge/orders", {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ productId, paymentProvider: "epay", paymentMethod }),
        }),
    invitation: () => request<InvitationSelf>("/invitation/self"),
    models: (capability?: string, signal?: AbortSignal) =>
        request<{ items: PublishedModel[] }>(`/models${capability ? `?capability=${encodeURIComponent(capability)}` : ""}`, { signal }),
    quote: (modelId: number, capability: string, parameters: Record<string, unknown>, count = 1, signal?: AbortSignal) =>
        request<HostedQuote>("/quotes", {
            method: "POST",
            signal,
            body: JSON.stringify({ modelId, capability, parameters, count }),
        }),
    createGenerationTask: (input: { quoteId: string; modelId: number; capability: string; parameters: Record<string, unknown>; payload: Record<string, unknown>; idempotencyKey?: string; signal?: AbortSignal }) => {
        const { signal, ...body } = input;
        return request<HostedGenerationTask>("/generation-tasks", {
            method: "POST",
            signal,
            headers: { "Idempotency-Key": input.idempotencyKey || crypto.randomUUID() },
            body: JSON.stringify(body),
        });
    },
    getGenerationTask: (id: string) => request<HostedGenerationTask>(`/generation-tasks/${encodeURIComponent(id)}`),
    executeGenerationTask: (id: string, signal?: AbortSignal) => request<HostedGenerationTask>(`/generation-tasks/${encodeURIComponent(id)}/execute`, { method: "POST", signal }),
    cancelGenerationTask: (id: string) => request<HostedGenerationTask>(`/generation-tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};

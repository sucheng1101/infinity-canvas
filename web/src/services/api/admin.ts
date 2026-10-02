import type { PublishedModel, RechargeProduct } from "@/services/api/hosted";

export type AdminChannel = {
    id: number;
    name: string;
    provider: string;
    baseUrl: string;
    apiKeySet: boolean;
    apiKeyMasked?: string;
    modelApiKeys: AdminChannelModelApiKey[];
    models: AdminChannelModel[];
    settings: Record<string, unknown>;
    status: "active" | "hidden";
    sortOrder: number;
};

export type AdminChannelModel = {
    id?: number;
    name: string;
    capability: "image" | "video" | "text" | "audio";
    script?: string;
    status?: "active" | "hidden";
};

export type AdminChannelModelApiKey = {
    id: number;
    name: string;
    apiKeySet: boolean;
    apiKeyMasked?: string;
    models: string[];
};

export type AdminChannelInput = {
    name: string;
    provider: string;
    baseUrl: string;
    modelApiKeys: Array<{ id?: number; name: string; apiKey: string; models: string[] }>;
    models: Array<Partial<AdminChannelModel> & Pick<AdminChannelModel, "name" | "capability">>;
    settings: Record<string, unknown>;
    status: "active" | "hidden";
    sortOrder: number;
};

export type ChannelTestResult = {
    ok: boolean;
    latencyMs: number;
    modelCount: number;
    message: string;
};

export type AdminRoute = {
    id: number;
    publishedModelId: number;
    publishedModel: string;
    channelId: number;
    channelName: string;
    provider: string;
    upstreamModel: string;
    priority: number;
    weight: number;
    weightPercent: number;
    available: boolean;
    status: "active" | "hidden";
    settings: Record<string, unknown>;
};

export type PricingVersion = {
    id: number;
    publishedModelId: number;
    publishedModel?: string;
    version: number;
    formula: Record<string, unknown>;
    currency: string;
    status: "draft" | "active" | "retired";
    effectiveAt: string;
    retiredAt?: string;
};

export type InvitationSettings = { open: boolean; inviterQuota: number; inviteeQuota: number; version?: number };
export type PaymentSettings = { enabled: boolean; gatewayUrl: string; partnerId: string; key?: string; payMethods: string[]; callbackUrl: string };
export type EmailSettings = {
    enabled: boolean;
    verificationRequired: boolean;
    registrationEnabled: boolean;
    domainRestrictionEnabled: boolean;
    aliasRestrictionEnabled: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUsername: string;
    smtpPassword?: string;
    smtpFrom: string;
    smtpSSLEnabled: boolean;
    smtpForceAuthLogin: boolean;
    allowedDomains: string[];
    blockedDomains: string[];
};

export type AdminUser = {
    id: number;
    username: string;
    email: string;
    displayName: string;
    remark: string;
    groupName: string;
    status: "active" | "pending" | "blocked";
    role: "user" | "admin";
    emailVerifiedAt?: string;
    lastLoginAt?: string;
    createdAt: string;
    updatedAt: string;
    quota: { balance: number; reserved: number; available: number };
};

export type AdminUsageLog = {
    id: number;
    taskId: string;
    requestId: string;
    userId: number;
    username?: string;
    publishedModelId: number;
    publishedModel: string;
    capability: string;
    channelId: number;
    channelName: string;
    provider: string;
    upstreamModel: string;
    requestType: string;
    reasoningEffort?: string;
    status: "running" | "succeeded" | "failed";
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    chargedQuota: number;
    ip?: string;
    retryCount: number;
    errorCode?: string;
    errorMessage?: string;
    startedAt: string;
    completedAt?: string;
    requestSummary?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
};

export type AdminUserDetail = { user: AdminUser; ledger: Array<Record<string, unknown>>; usage: AdminUsageLog[] };
export type AdminUsageResult = {
    items: AdminUsageLog[];
    total: number;
    page: number;
    pageSize: number;
    stats: { total: number; succeeded: number; failed: number; running: number; chargedQuota: number; totalTokens: number; averageDurationMs: number };
};

type Envelope<T> = { data: T; requestId?: string; error?: { message?: string } };
const apiBase = (import.meta.env.VITE_HOSTED_API_BASE || "/api/v1").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiBase}${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await response.json().catch(() => ({}))) as Envelope<T>;
    if (!response.ok) throw new Error(body.error?.message || "请求处理失败");
    return body.data;
}

const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body) });

export const adminApi = {
    models: () => request<{ items: PublishedModel[] }>("/admin/models"),
    createModel: (body: Partial<PublishedModel>) => request<PublishedModel>("/admin/models", json(body)),
    updateModel: (id: number, body: Partial<PublishedModel>) => request<PublishedModel>(`/admin/models/${id}`, json(body, "PUT")),
    hideModel: (id: number) => request<{ ok: boolean }>(`/admin/models/${id}`, { method: "DELETE" }),
    channels: () => request<{ items: AdminChannel[] }>("/admin/channels"),
    createChannel: (body: AdminChannelInput) => request<AdminChannel>("/admin/channels", json(body)),
    updateChannel: (id: number, body: AdminChannelInput) => request<AdminChannel>(`/admin/channels/${id}`, json(body, "PUT")),
    fetchChannelModels: (body: { baseUrl: string; apiKey?: string; keyId?: number }) => request<{ items: string[] }>("/admin/channels/fetch-models", json(body)),
    testChannel: (id: number) => request<ChannelTestResult>(`/admin/channels/${id}/test`, { method: "POST" }),
    hideChannel: (id: number) => request<{ ok: boolean }>(`/admin/channels/${id}`, { method: "DELETE" }),
    routes: () => request<{ items: AdminRoute[] }>("/admin/model-routes"),
    createRoute: (body: Record<string, unknown>) => request<AdminRoute>("/admin/model-routes", json(body)),
    updateRoute: (id: number, body: Record<string, unknown>) => request<AdminRoute>(`/admin/model-routes/${id}`, json(body, "PUT")),
    hideRoute: (id: number) => request<{ ok: boolean }>(`/admin/model-routes/${id}`, { method: "DELETE" }),
    pricing: () => request<{ items: PricingVersion[] }>("/admin/pricing"),
    createPricing: (body: Record<string, unknown>) => request<PricingVersion>("/admin/pricing", json(body)),
    publishPricing: (id: number) => request<PricingVersion>(`/admin/pricing/${id}/publish`, { method: "POST" }),
    retirePricing: (id: number) => request<{ ok: boolean }>(`/admin/pricing/${id}/retire`, { method: "POST" }),
    products: () => request<{ items: RechargeProduct[] }>("/admin/recharge-products"),
    saveProduct: (body: Record<string, unknown>, id?: number) => request<RechargeProduct>(id ? `/admin/recharge-products/${id}` : "/admin/recharge-products", json(body, id ? "PUT" : "POST")),
    invitation: () => request<InvitationSettings>("/admin/invitation-settings"),
    saveInvitation: (body: InvitationSettings) => request<InvitationSettings>("/admin/invitation-settings", json(body, "PUT")),
    adjustQuota: (body: Record<string, unknown>) => request<{ ok: boolean }>("/admin/quota-adjustments", json(body)),
    payment: () => request<PaymentSettings>("/admin/payment-settings"),
    savePayment: (body: PaymentSettings) => request<PaymentSettings>("/admin/payment-settings", json(body, "PUT")),
    email: () => request<EmailSettings>("/admin/email-settings"),
    saveEmail: (body: EmailSettings) => request<EmailSettings>("/admin/email-settings", json(body, "PUT")),
    testEmail: (email: string) => request<{ sent: boolean }>("/admin/email-settings/test", json({ email })),
    users: (params: Record<string, string | number | undefined> = {}) => request<{ items: AdminUser[]; total: number; page: number; pageSize: number }>(`/admin/users?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]))}`),
    user: (id: number) => request<AdminUserDetail>(`/admin/users/${id}`),
    createUser: (body: Record<string, unknown>) => request<AdminUser>("/admin/users", json(body)),
    updateUser: (id: number, body: Record<string, unknown>) => request<AdminUser>(`/admin/users/${id}`, json(body, "PATCH")),
    updateUserStatus: (id: number, status: AdminUser["status"]) => request<AdminUser>(`/admin/users/${id}/status`, json({ status })),
    resetUserPassword: (id: number, newPassword?: string) => request<{ temporaryPassword: string }>(`/admin/users/${id}/password`, json({ newPassword })),
    adjustUserQuota: (id: number, body: { delta: number; reason: string; source?: string }) => request<{ ok: boolean }>(`/admin/users/${id}/quota`, json({ ...body, idempotencyKey: crypto.randomUUID() })),
    userUsage: (id: number, page = 1, pageSize = 20) => request<AdminUsageResult>(`/admin/users/${id}/usage?page=${page}&pageSize=${pageSize}`),
    usageLogs: (params: Record<string, string | number | undefined> = {}) => request<AdminUsageResult>(`/admin/usage-logs?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)]))}`),
    usageLog: (id: number) => request<AdminUsageLog>(`/admin/usage-logs/${id}`),
};

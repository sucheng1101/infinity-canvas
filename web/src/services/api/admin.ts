import type { PublishedModel, RechargeProduct } from "@/services/api/hosted";

export type AdminChannel = {
    id: number;
    name: string;
    provider: string;
    baseUrl: string;
    apiKeySet: boolean;
    apiKeyMasked?: string;
    settings: Record<string, unknown>;
    status: "active" | "hidden";
    sortOrder: number;
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
export type EmailSettings = { enabled: boolean; verificationRequired: boolean; registrationEnabled: boolean; domainRestrictionEnabled: boolean; aliasRestrictionEnabled: boolean; smtpHost: string; smtpPort: number; smtpUsername: string; smtpPassword?: string; smtpFrom: string; smtpSSLEnabled: boolean; smtpForceAuthLogin: boolean; allowedDomains: string[]; blockedDomains: string[] };

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
    createChannel: (body: Record<string, unknown>) => request<AdminChannel>("/admin/channels", json(body)),
    updateChannel: (id: number, body: Record<string, unknown>) => request<AdminChannel>(`/admin/channels/${id}`, json(body, "PUT")),
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
};

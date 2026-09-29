export type AuthUser = {
    id: number;
    username: string;
    email: string;
    status: "active" | "pending" | "blocked";
    role: "user" | "admin";
    emailVerifiedAt?: string;
};

type ApiEnvelope<T> = { data: T; requestId?: string };
type ApiErrorEnvelope = { error?: { code?: string; message?: string }; requestId?: string };

export class AuthApiError extends Error {
    constructor(
        message: string,
        readonly code = "REQUEST_FAILED",
        readonly status = 0,
    ) {
        super(message);
    }
}

const apiBase = (import.meta.env.VITE_HOSTED_API_BASE || "/api/v1").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit) {
    let response: Response;
    try {
        response = await fetch(`${apiBase}${path}`, {
            ...init,
            credentials: "include",
            headers: { "Content-Type": "application/json", ...init?.headers },
        });
    } catch {
        throw new AuthApiError("\u8fde\u63a5\u8d26\u6237\u670d\u52a1\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u3001\u670d\u52a1\u72b6\u6001\u6216 API \u5730\u5740\u914d\u7f6e", "SERVICE_UNAVAILABLE");
    }
    const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiErrorEnvelope;
    if (!response.ok) {
        if (!body.error && [502, 503, 504].includes(response.status)) {
            throw new AuthApiError(`\u8d26\u6237\u670d\u52a1\u672a\u5c31\u7eea\uff08HTTP ${response.status}\uff09\uff0c\u8bf7\u68c0\u67e5\u670d\u52a1\u72b6\u6001\u3001MySQL \u4e0e Redis \u8fde\u63a5`, "UPSTREAM_UNAVAILABLE", response.status);
        }
        if (!body.error && response.status >= 500) {
            throw new AuthApiError(`\u8d26\u6237\u670d\u52a1\u5185\u90e8\u5f02\u5e38\uff08HTTP ${response.status}\uff09\uff0c\u8bf7\u67e5\u770b\u8d26\u6237\u670d\u52a1\u65e5\u5fd7`, "SERVICE_ERROR", response.status);
        }
        throw new AuthApiError(body.error?.message || "\u8bf7\u6c42\u5904\u7406\u5931\u8d25", body.error?.code, response.status);
    }
    return body.data;
}

export const authApi = {
    me: () => request<{ user: AuthUser }>("/auth/me"),
    login: (email: string, password: string) => request<{ user: AuthUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    register: (username: string, email: string, password: string, verificationCode?: string, inviteCode?: string) => request<{ user: AuthUser; verificationRequired: boolean; verificationToken?: string }>("/auth/register", { method: "POST", body: JSON.stringify({ username, email, password, verificationCode, inviteCode }) }),
    registrationCode: (email: string) => request<{ accepted: boolean; verificationCode?: string }>("/auth/register/code", { method: "POST", body: JSON.stringify({ email }) }),
    verifyEmail: (token: string) => request<{ user: AuthUser; sessionCreated: boolean }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) }),
    resendVerification: (email: string) => request<{ accepted: boolean; verificationToken?: string }>("/auth/verify-email/resend", { method: "POST", body: JSON.stringify({ email }) }),
    forgotPassword: (email: string) => request<{ accepted: boolean; resetToken?: string }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
    resetPassword: (token: string, password: string) => request<{ ok: boolean }>("/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
};

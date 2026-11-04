export type ApiEnvelope<T> = { data: T; requestId?: string };
export type ApiErrorEnvelope = { error?: { code?: string; message?: string }; requestId?: string };

export const API_BASE = (import.meta.env.VITE_HOSTED_API_BASE || "/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
    constructor(
        message: string,
        readonly code = "REQUEST_FAILED",
        readonly status = 0,
    ) {
        super(message);
    }
}

type RawResult<T> = { body: ApiEnvelope<T> & ApiErrorEnvelope; response: Response };
type NetworkFailure = { networkError: true };

// One fetch/JSON step shared by every account-service caller. Network failures are
// returned rather than thrown so each caller keeps its own error wording.
export async function performRequest<T>(path: string, init?: RequestInit): Promise<RawResult<T> | NetworkFailure> {
    let response: Response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            ...init,
            credentials: "include",
            headers: { "Content-Type": "application/json", ...init?.headers },
        });
    } catch {
        return { networkError: true };
    }
    const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiErrorEnvelope;
    return { body, response };
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const result = await performRequest<T>(path, init);
    if ("networkError" in result) throw new ApiError("连接账户服务失败，请检查网络或服务状态", "SERVICE_UNAVAILABLE");
    if (!result.response.ok) throw new ApiError(result.body.error?.message || "请求处理失败", result.body.error?.code, result.response.status);
    return result.body.data;
}

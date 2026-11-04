import { API_BASE, ApiError, requestJson } from "@/services/api/http";

export type AssetKind = "character" | "scene" | "prop" | "media";

export type AssetImage = {
    id: number;
    storageKey: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
};

export type AssetItem = {
    id: string;
    userId?: number;
    kind: AssetKind;
    name: string;
    prompt: string;
    tags: string[];
    license: string;
    images: AssetImage[];
    createdAt: string;
    updatedAt: string;
};

export type AssetInput = {
    kind: AssetKind;
    name: string;
    prompt?: string;
    tags?: string[];
    license?: string;
};

const queryString = (params: Record<string, string | number | undefined>) =>
    new URLSearchParams(
        Object.entries(params)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => [key, String(value)]),
    ).toString();

export const assetsApi = {
    list: (params: { kind?: string; q?: string; page?: number; pageSize?: number } = {}) => requestJson<{ items: AssetItem[]; total: number }>(`/assets?${queryString(params)}`),
    create: (body: AssetInput) => requestJson<AssetItem>("/assets", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: AssetInput) => requestJson<AssetItem>(`/assets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => requestJson<{ ok: boolean }>(`/assets/${id}`, { method: "DELETE" }),
    // 上传走 multipart，不能复用 performRequest（它固定发 JSON 头）。
    uploadImage: async (id: string, file: File): Promise<AssetItem> => {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`${API_BASE}/assets/${id}/images`, { method: "POST", credentials: "include", body: form });
        const body = (await response.json().catch(() => ({}))) as { data?: AssetItem; error?: { message?: string; code?: string } };
        if (!response.ok) throw new ApiError(body.error?.message || "参考图上传失败", body.error?.code, response.status);
        return body.data as AssetItem;
    },
};

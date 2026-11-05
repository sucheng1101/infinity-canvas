export const ASSET_DRAG_MIME = "application/x-ic-asset";

export type DragAssetPayload = {
    id: string;
    name: string;
    imageUrl?: string;
    prompt?: string;
};

export function setAssetDragData(dataTransfer: DataTransfer, payload: DragAssetPayload): void {
    dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
}

export function readAssetDragData(dataTransfer: DataTransfer): DragAssetPayload | null {
    const raw = dataTransfer.getData(ASSET_DRAG_MIME);
    if (!raw) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const { id, name, imageUrl, prompt } = parsed as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) return null;
    if (imageUrl !== undefined && typeof imageUrl !== "string") return null;
    if (prompt !== undefined && typeof prompt !== "string") return null;
    return { id, name, imageUrl, prompt };
}

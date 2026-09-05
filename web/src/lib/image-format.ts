import i18n from "@/i18n";

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export function isHeicImage(blob: Blob, name = "") {
    return HEIC_MIME_TYPES.has(blob.type.toLowerCase()) || /\.(?:heic|heif)(?:$|[?#])/i.test(name);
}

export function isImageFile(file: File) {
    return file.type.toLowerCase().startsWith("image/") || isHeicImage(file, file.name);
}

export async function normalizeImageBlob(blob: Blob, name = "") {
    if (!isHeicImage(blob, name)) return blob;

    try {
        const { default: convert } = await import("heic2any");
        const converted = await convert({ blob, toType: "image/jpeg", quality: 0.92 });
        const result = Array.isArray(converted) ? converted[0] : converted;
        if (!(result instanceof Blob) || !result.size) throw new Error("HEIC conversion returned an empty image");
        return result.type === "image/jpeg" ? result : new Blob([result], { type: "image/jpeg" });
    } catch (error) {
        throw new Error(i18n.t("common.imageReadFailed"), { cause: error });
    }
}

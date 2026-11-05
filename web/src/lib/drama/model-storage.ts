import localforage from "localforage";

// 短剧模型文件（GLB 等）通常有几十 MB，优先存 OPFS；拿不到 OPFS 的浏览器退回 IndexedDB。
// key 由调用方生成，例如 `character-xxx.glb`，读写时统一编码成安全文件名。

const OPFS_DIR = "drama-models";
const INDEXED_DB_STORE = "drama-models";
const UNSUPPORTED_MESSAGE = "当前浏览器不支持本地模型存储：OPFS 与 IndexedDB 都不可用，请改用最新版 Chrome 或 Edge。";

const indexedModels = localforage.createInstance({ name: "infinite-canvas", storeName: INDEXED_DB_STORE });

// lib.dom 还没声明 OPFS 目录句柄的异步迭代器，这里补上实现里真实存在的 entries()。
type DirectoryEntries = AsyncIterableIterator<[string, FileSystemHandle]>;
type OpfsDirectory = FileSystemDirectoryHandle & { entries?: () => DirectoryEntries };

const toFileName = (key: string) => encodeURIComponent(key);
const toKey = (name: string) => decodeURIComponent(name);

function opfsSupported() {
    return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
}

function indexedDbSupported() {
    return typeof indexedDB !== "undefined";
}

async function opfsDirectory(create: boolean): Promise<OpfsDirectory | null> {
    if (!opfsSupported()) return null;
    try {
        const root = await navigator.storage.getDirectory();
        return (await root.getDirectoryHandle(OPFS_DIR, { create })) as OpfsDirectory;
    } catch {
        // 无痕模式或权限被拒时会走到这里，由调用方决定是否降级到 IndexedDB。
        return null;
    }
}

/** 保存模型文件，同 key 覆盖。 */
export async function saveModel(key: string, file: Blob): Promise<void> {
    const dir = await opfsDirectory(true);
    if (dir) {
        try {
            const handle = await dir.getFileHandle(toFileName(key), { create: true });
            const writable = await handle.createWritable();
            await writable.write(file);
            await writable.close();
            return;
        } catch (error) {
            console.warn("OPFS 写入模型失败，改用 IndexedDB", error);
        }
    }
    if (!indexedDbSupported()) throw new Error(UNSUPPORTED_MESSAGE);
    try {
        await indexedModels.setItem(toFileName(key), file);
    } catch (error) {
        console.error("IndexedDB 写入模型失败", error);
        throw new Error("模型保存失败，浏览器本地存储可能已满或被禁用。");
    }
}

/** 读取模型文件，不存在返回 null。 */
export async function loadModel(key: string): Promise<Blob | null> {
    const dir = await opfsDirectory(false);
    if (dir) {
        try {
            const handle = await dir.getFileHandle(toFileName(key));
            return await handle.getFile();
        } catch {
            // OPFS 里没有就继续找 IndexedDB
        }
    }
    if (!indexedDbSupported()) return null;
    return (await indexedModels.getItem<Blob>(toFileName(key))) ?? null;
}

/** 删除模型文件，两个存储都清一遍，避免残留占空间。 */
export async function removeModel(key: string): Promise<void> {
    const dir = await opfsDirectory(false);
    if (dir) {
        try {
            await dir.removeEntry(toFileName(key));
        } catch {
            // 本来就不在 OPFS 里
        }
    }
    if (indexedDbSupported()) await indexedModels.removeItem(toFileName(key));
}

/** 列出全部模型 key（OPFS 与 IndexedDB 的并集）。 */
export async function listModels(): Promise<string[]> {
    const keys = new Set<string>();
    const dir = await opfsDirectory(false);
    if (dir?.entries) {
        for await (const [name] of dir.entries()) keys.add(toKey(name));
    }
    if (indexedDbSupported()) {
        for (const name of await indexedModels.keys()) keys.add(toKey(name));
    }
    return [...keys];
}

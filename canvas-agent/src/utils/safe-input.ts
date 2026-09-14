import path from "node:path";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** 判断线程/轮次/消息标识是否安全：仅允许字母数字与 _-. 组合，阻断路径穿越与注入字符。 */
export function isSafeId(value: unknown): boolean {
    const id = typeof value === "string" ? value.trim() : "";
    return id !== "" && SAFE_ID_PATTERN.test(id);
}

/** 校验并返回线程/轮次/消息标识；空值返回空串，非法值抛出异常。 */
export function safeId(value: unknown, label = "标识"): string {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id) return "";
    if (!SAFE_ID_PATTERN.test(id)) throw new Error(`${label}格式无效`);
    return id;
}

/** 校验工作空间路径：必须为不含空字节与穿越片段的归一化绝对路径。 */
export function assertSafeWorkspacePath(workspacePath: string) {
    if (!workspacePath || !path.isAbsolute(workspacePath) || workspacePath.includes("\0")) throw new Error("工作空间路径必须是绝对路径");
    if (/(^|[\\/])\.\.?(?:[\\/]|$)/.test(workspacePath)) throw new Error("工作空间路径包含穿越片段");
    if (path.normalize(workspacePath) !== workspacePath) throw new Error("工作空间路径包含非法片段");
}

/** 判断本地文件路径是否可用于展示类系统调用：绝对路径且不含空字节与换行。 */
export function isSafeLocalFilePath(filePath: string): boolean {
    return Boolean(filePath) && path.isAbsolute(filePath) && !filePath.includes("\0") && !/[\r\n]/.test(filePath);
}

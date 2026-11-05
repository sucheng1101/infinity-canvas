import { createZip, readZip } from "@/lib/zip";
import { DRAMA_SCHEMA_VERSION, type DramaBackupManifest, type DramaProject } from "@/types/drama";
import { loadModel, saveModel } from "./model-storage";

// 短剧备份包（.icdrama，本质是 zip）：
//   manifest.json       备份清单
//   project.json        项目数据（场景布局 + 镜头，不含生成结果）
//   models/<key>        角色/场景/道具的模型文件
// 生成结果媒体（出图、出片、配音）一律不进备份，避免备份包无限膨胀。

const MODEL_PREFIX = "models/";

/** 备份版本校验：远端版本高于当前版本时拒绝，其余情况接受。 */
export function checkSchemaVersion(remote: number, current: number): void {
    if (remote > current) throw new Error("备份来自更高版本，请先升级");
}

/** 收集项目里被引用的模型 key（角色定妆模型、场景 GLB、道具 GLB）。 */
function collectModelKeys(project: DramaProject): string[] {
    const keys = [...project.characters.map((item) => item.modelKey), ...project.scenes.map((item) => item.glbKey), ...project.props.map((item) => item.glbKey)];
    return [...new Set(keys.filter((key): key is string => !!key))];
}

/** 导出备份包；模型文件缺失时跳过，manifest 会如实记录。 */
export async function exportDramaBackup(project: DramaProject): Promise<Blob> {
    const models: Array<{ key: string; blob: Blob }> = [];
    for (const key of collectModelKeys(project)) {
        const blob = await loadModel(key);
        if (blob) models.push({ key, blob });
    }

    const files = ["manifest.json", "project.json", ...models.map((item) => `${MODEL_PREFIX}${item.key}`)];
    const manifest: DramaBackupManifest = {
        schemaVersion: DRAMA_SCHEMA_VERSION,
        app: "infinite-canvas",
        projectId: project.id,
        exportedAt: new Date().toISOString(),
        includes: { models: models.length > 0, media: false },
        files,
    };
    // output 置空即可，JSON 序列化会丢掉 undefined，备份里就不会残留生成结果的地址。
    const layout: DramaProject = { ...project, shots: project.shots.map((shot) => ({ ...shot, output: undefined })) };

    return createZip([{ name: "manifest.json", data: JSON.stringify(manifest, null, 2) }, { name: "project.json", data: JSON.stringify(layout, null, 2) }, ...models.map((item) => ({ name: `${MODEL_PREFIX}${item.key}`, data: item.blob }))]);
}

/** 导入备份包：校验版本、还原项目数据，并把包里的模型文件写回本地存储。 */
export async function importDramaBackup(file: Blob): Promise<DramaProject> {
    const entries = await readZip(file);

    const manifestBlob = entries.get("manifest.json");
    if (!manifestBlob) throw new Error("备份缺少 manifest.json，不是有效的短剧备份包");
    const manifest = JSON.parse(await manifestBlob.text()) as DramaBackupManifest;
    if (typeof manifest.schemaVersion !== "number") throw new Error("备份缺少 schemaVersion，无法判断兼容性");
    checkSchemaVersion(manifest.schemaVersion, DRAMA_SCHEMA_VERSION);

    const projectBlob = entries.get("project.json");
    if (!projectBlob) throw new Error("备份缺少 project.json，无法还原项目");
    const project = JSON.parse(await projectBlob.text()) as DramaProject;

    for (const path of manifest.files ?? []) {
        if (!path.startsWith(MODEL_PREFIX)) continue;
        const modelBlob = entries.get(path);
        if (modelBlob) await saveModel(path.slice(MODEL_PREFIX.length), modelBlob);
    }

    return project;
}

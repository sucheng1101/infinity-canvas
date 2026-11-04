export type ParsedShot = { prompt: string; dialogue: string; durationSec: number; shotSize: string; camera: string };
export type ParsedScene = { name: string; summary: string; shots: ParsedShot[] };

const shotSizes = ["特写", "近景", "中景", "全景", "远景"];
const cameras = ["固定", "推", "拉", "摇", "移", "跟随", "环绕", "升降", "手持", "航拍"];

// 模型经常把 JSON 包在 ```json 里，或者前后带解释文字，这里只取第一个完整对象。
export function extractJsonObject(raw: string): unknown {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("没有找到分镜 JSON");
    return JSON.parse(text.slice(start, end + 1));
}

const asString = (value: unknown, fallback = "") => (typeof value === "string" ? value.trim() : fallback);

// 解析模型返回的分镜 JSON；字段缺失或类型不对时用安全默认值补齐，不抛错。
export function parseStoryboard(raw: string): ParsedScene[] {
    const data = extractJsonObject(raw) as { scenes?: unknown };
    if (!Array.isArray(data?.scenes)) throw new Error("分镜 JSON 缺少 scenes 数组");
    return data.scenes.map((item, sceneIndex) => {
        const scene = item as { name?: unknown; summary?: unknown; shots?: unknown };
        const shots = Array.isArray(scene.shots) ? scene.shots : [];
        return {
            name: asString(scene.name, `场次 ${sceneIndex + 1}`),
            summary: asString(scene.summary),
            shots: shots.map((rawShot) => {
                const shot = rawShot as { prompt?: unknown; dialogue?: unknown; durationSec?: unknown; shotSize?: unknown; camera?: unknown };
                const duration = Number(shot.durationSec);
                const shotSize = asString(shot.shotSize);
                const camera = asString(shot.camera);
                return {
                    prompt: asString(shot.prompt),
                    dialogue: asString(shot.dialogue),
                    durationSec: Number.isFinite(duration) && duration > 0 ? Math.min(600, Math.round(duration)) : 4,
                    shotSize: shotSizes.includes(shotSize) ? shotSize : "",
                    camera: cameras.includes(camera) ? camera : "",
                };
            }),
        };
    });
}

// 让文本模型按固定结构输出，字段与后端 shot 表一一对应。
export function buildStoryboardPrompt(script: string) {
    return [
        "你是短剧分镜师。把下面的剧本拆成可直接拍摄的分镜，只输出 JSON，不要解释。",
        'JSON 结构：{"scenes":[{"name":"场次名","summary":"一句话概括","shots":[{"prompt":"画面提示词，包含主体/动作/环境/光线","dialogue":"台词，没有就空字符串","durationSec":4,"shotSize":"特写|近景|中景|全景|远景","camera":"固定|推|拉|摇|移|跟随|环绕|升降|手持|航拍"}]}]}',
        "要求：每场 2–6 个镜头；prompt 用中文描述画面，不要写镜头编号；durationSec 取 2–10 的整数。",
        "",
        "剧本：",
        script.trim(),
    ].join("\n");
}

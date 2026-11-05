// 无限画布短剧插件：把平台能力暴露给 Magpie / Agent。
// 鉴权：环境变量 INFINITE_CANVAS_API 指向账户服务，Cookie 会话由调用方注入或使用内置令牌。
const API = (process.env.INFINITE_CANVAS_API || "http://127.0.0.1:1011").replace(/\/$/, "");

async function call(path, init = {}) {
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(process.env.INFINITE_CANVAS_TOKEN ? { Authorization: `Bearer ${process.env.INFINITE_CANVAS_TOKEN}` } : {}),
            ...(init.headers || {}),
        },
        credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(body?.error?.message || `请求失败：HTTP ${response.status}`);
        error.code = body?.error?.code;
        throw error;
    }
    return body.data;
}

/** 建一条生成任务并等待终态，返回可用的输出。 */
async function runTask({ capability, modelId, parameters = {}, payload = {}, timeoutSec = 120 }) {
    const quote = await call("/api/v1/quotes", { method: "POST", body: JSON.stringify({ modelId, capability, count: 1, parameters }) });
    const task = await call("/api/v1/generation-tasks", {
        method: "POST",
        body: JSON.stringify({ quoteId: quote.quoteId, modelId, capability, parameters, payload, idempotencyKey: crypto.randomUUID() }),
    });
    await call(`/api/v1/generation-tasks/${task.id}/execute`, { method: "POST" });
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const current = await call(`/api/v1/generation-tasks/${task.id}`);
        if (["succeeded", "failed", "cancelled"].includes(current.status)) {
            if (current.status !== "succeeded") throw new Error(current.errorMessage || `任务${current.status}`);
            return current.output || {};
        }
    }
    throw new Error("任务超时，请到任务中心查看");
}

export const tools = {
    "image.generate": {
        description: "根据提示词出图，返回图片地址",
        parameters: { prompt: "string", modelId: "number?" },
        run: ({ prompt, modelId = 1 }) => runTask({ capability: "image", modelId, payload: { prompt, n: 1 } }),
    },
    "video.generate": {
        description: "图生视频或文生视频，返回视频地址",
        parameters: { prompt: "string", imageUrl: "string?", seconds: "number?", modelId: "number?" },
        run: ({ prompt, imageUrl, seconds = 5, modelId }) =>
            runTask({ capability: "video", modelId, parameters: { durationSeconds: seconds }, payload: { prompt, seconds, ...(imageUrl ? { images: [imageUrl] } : {}) }, timeoutSec: 600 }),
    },
    "audio.speak": {
        description: "把台词合成语音，返回 wav 地址",
        parameters: { text: "string", modelId: "number?" },
        run: ({ text, modelId = 18 }) => runTask({ capability: "audio", modelId, payload: { input: text } }),
    },
    "drama.list": { description: "列出已发布的模型（供选择 modelId）", parameters: {}, run: () => call("/api/v1/models") },
};

export default { tools };

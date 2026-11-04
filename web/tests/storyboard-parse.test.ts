import { expect, test } from "bun:test";

import { buildStoryboardPrompt, extractJsonObject, parseStoryboard } from "@/lib/canvas/storyboard-parse";

const sample = `好的，以下是分镜：
\`\`\`json
{"scenes":[{"name":"雨夜街头","summary":"女主等人","shots":[{"prompt":"雨夜霓虹下的长街，女主撑伞站立","dialogue":"你终于来了","durationSec":6,"shotSize":"近景","camera":"推"},{"prompt":"伞面特写，雨滴滑落","dialogue":"","durationSec":2}]}]}
\`\`\`
`;

test("extractJsonObject 能从代码块和解释文字中取出 JSON", () => {
    const data = extractJsonObject(sample) as { scenes: unknown[] };
    expect(Array.isArray(data.scenes)).toBe(true);
});

test("parseStoryboard 补齐缺失字段并校验枚举", () => {
    const scenes = parseStoryboard(sample);
    expect(scenes.length).toBe(1);
    expect(scenes[0].name).toBe("雨夜街头");
    expect(scenes[0].shots.length).toBe(2);
    expect(scenes[0].shots[0].durationSec).toBe(6);
    expect(scenes[0].shots[0].camera).toBe("推");
    // 第二个镜头没写景别/运镜，应留空而不是瞎补
    expect(scenes[0].shots[1].shotSize).toBe("");
    expect(scenes[0].shots[1].durationSec).toBe(2);
});

test("durationSec 越界或非法时回落到 4 秒", () => {
    const scenes = parseStoryboard('{"scenes":[{"shots":[{"prompt":"x","durationSec":9999},{"prompt":"y"}]}]}');
    expect(scenes[0].shots[0].durationSec).toBe(600);
    expect(scenes[0].shots[1].durationSec).toBe(4);
    expect(scenes[0].name).toBe("场次 1");
});

test("缺少 scenes 时抛错", () => {
    expect(() => parseStoryboard('{"foo":1}')).toThrow();
});

test("buildStoryboardPrompt 带上剧本与结构说明", () => {
    const prompt = buildStoryboardPrompt("女主在雨里等人");
    expect(prompt).toContain("女主在雨里等人");
    expect(prompt).toContain('"scenes"');
    expect(prompt).toContain("durationSec");
});

import { expect, test } from "bun:test";

import { buildManifest, buildSrt, formatSrtTime } from "@/lib/canvas/export-storyboard";

test("formatSrtTime 补齐时分秒与毫秒", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(61.5)).toBe("00:01:01,500");
    expect(formatSrtTime(3723.25)).toBe("01:02:03,250");
});

test("buildSrt 按镜头时长累加且跳过无台词镜头", () => {
    const srt = buildSrt([
        { index: 1, sceneName: "一", durationSec: 4, dialogue: "你终于来了" },
        { index: 2, sceneName: "一", durationSec: 5 },
        { index: 3, sceneName: "二", durationSec: 6, dialogue: "走吧" },
    ]);
    const blocks = srt.trim().split(/\n\n/);
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toBe("1\n00:00:00,000 --> 00:00:04,000\n你终于来了");
    expect(blocks[1]).toBe("2\n00:00:09,000 --> 00:00:15,000\n走吧");
});

test("buildManifest 累计时间轴并保留素材地址", () => {
    const manifest = buildManifest(
        "测试项目",
        [
            { index: 1, sceneName: "一", durationSec: 3, dialogue: "a", prompt: "p1", imageUrl: "/api/v1/files/a.png" },
            { index: 2, sceneName: "一", durationSec: 4, dialogue: "", prompt: "p2" },
        ],
        new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(manifest.totalDurationSec).toBe(7);
    expect(manifest.shots[1].startSec).toBe(3);
    expect(manifest.shots[0].image).toBe("/api/v1/files/a.png");
    expect(manifest.shots[1].video).toBeNull();
    expect(manifest.exportedAt).toBe("2026-01-01T00:00:00.000Z");
});

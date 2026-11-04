import { expect, test } from "bun:test";

import { buildDraftMetaInfo, buildJianyingDraft } from "@/lib/canvas/jianying-draft";

test("草稿时间轴按秒换算微秒并累加", () => {
    const draft = buildJianyingDraft([
        { index: 1, sceneName: "一", durationSec: 3, dialogue: "你好", videoUrl: "/v/1.mp4" },
        { index: 2, sceneName: "一", durationSec: 5, dialogue: "", videoUrl: "/v/2.mp4" },
    ]);
    expect(draft.duration).toBe(8 * 1_000_000);
    const videoTrack = draft.tracks.find((track) => track.type === "video");
    expect(videoTrack?.segments.length).toBe(2);
    expect(videoTrack?.segments[1].target_timerange.start).toBe(3 * 1_000_000);
});

test("只有带台词的镜头才生成字幕素材", () => {
    const draft = buildJianyingDraft([
        { index: 1, sceneName: "一", durationSec: 4, dialogue: "走吧", videoUrl: "/v/1.mp4" },
        { index: 2, sceneName: "一", durationSec: 4 },
    ]);
    expect(draft.materials.texts.length).toBe(1);
    expect(draft.materials.texts[0].content).toBe("走吧");
    expect(draft.tracks.some((track) => track.type === "text")).toBe(true);
});

test("竖屏默认 9:16，无视频时不生成视频轨", () => {
    const draft = buildJianyingDraft([{ index: 1, sceneName: "一", durationSec: 2, dialogue: "x" }]);
    expect(draft.canvas_config.ratio).toBe("9:16");
    expect(draft.tracks.some((track) => track.type === "video")).toBe(false);
});

test("meta info 带上项目名", () => {
    const draft = buildJianyingDraft([]);
    expect(buildDraftMetaInfo("测试项目", draft).draft_name).toBe("测试项目");
});

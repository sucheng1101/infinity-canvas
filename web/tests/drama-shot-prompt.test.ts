import { expect, test } from "bun:test";

import { buildShotPrompt, buildShotRequest } from "@/lib/drama/render/shot-prompt";
import type { CharacterCard, DramaShot, SceneCard } from "@/types/drama";

const characters: CharacterCard[] = [
    { id: "c1", name: "林小满", prompt: "古装少女，青色长裙，长发束带", refImages: [], heightCm: 165, color: "#8899aa" },
    { id: "c2", name: "沈砚", prompt: "黑衣剑客，冷峻面容", refImages: [], heightCm: 182, color: "#222222" },
];

const scene: SceneCard = { id: "s1", name: "山门石阶", templateId: "palace", world: "cultivation", size: { x: 20, z: 20 } };

const shot: DramaShot = {
    id: "shot-1",
    sceneId: "s1",
    index: 1,
    shotSize: "近景",
    durationSec: 6,
    dialogue: "你终于来了",
    prompt: "少女推门入院，雨后水汽未散",
    cast: [
        { characterId: "c1", position: [0, 0, 0], rotationY: 0 },
        { characterId: "c2", position: [1, 0, 0], rotationY: 0 },
    ],
    camera: {
        lens: 35,
        keys: [
            { t: 0, position: [0, 1.5, 6], target: [0, 1.2, 0], fov: 45, easing: "linear" },
            { t: 3, position: [0, 1.5, 2], target: [0, 1.2, 0], fov: 45, easing: "linear" },
        ],
    },
    status: "已预演",
};

test("buildShotPrompt 带上景别、角色名与角色提示词", () => {
    const prompt = buildShotPrompt(shot, characters, scene);
    expect(prompt).toContain("近景");
    expect(prompt).toContain("林小满");
    expect(prompt).toContain("古装少女，青色长裙，长发束带");
    expect(prompt).toContain("沈砚");
    expect(prompt).toContain("少女推门入院，雨后水汽未散");
    expect(prompt).toContain("山门石阶");
    // 机位由远及近，应推导成推镜头
    expect(prompt).toContain("推镜头");
});

test("buildShotRequest 有 guide 时只放一张参考图并带上深度图参数", () => {
    const request = buildShotRequest(shot, characters, scene, { color: "data:image/png;base64,AAAA", depth: "depth-frame-1" });
    expect(request.capability).toBe("image");
    const images = request.payload.images as string[];
    expect(images.length).toBe(1);
    expect(images[0]).toBe("data:image/png;base64,AAAA");
    expect(request.parameters.guideDepth).toBe("depth-frame-1");
    expect(request.payload.n).toBe(1);
});

test("buildShotRequest 无 guide 时 images 为空数组", () => {
    const request = buildShotRequest(shot, characters, scene);
    expect((request.payload.images as string[]).length).toBe(0);
    expect(request.parameters.guideDepth).toBeUndefined();
});

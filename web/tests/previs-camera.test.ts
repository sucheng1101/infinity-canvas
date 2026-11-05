import { expect, test } from "bun:test";

import { fovFromLens, sampleCamera } from "@/lib/drama/previs/scene-builder";
import type { CameraKey } from "@/types/drama";

const key = (t: number, position: [number, number, number], fov = 40, easing: CameraKey["easing"] = "linear", target: [number, number, number] = [0, 1, 0]): CameraKey => ({
    t,
    position,
    target,
    fov,
    easing,
});

test("首尾两端返回关键帧原值", () => {
    const keys = [key(0, [0, 2, 8], 30), key(2, [10, 2, 8], 50), key(4, [20, 2, 8], 60)];
    expect(sampleCamera(keys, 0)).toEqual({ position: [0, 2, 8], target: [0, 1, 0], fov: 30 });
    expect(sampleCamera(keys, 4).position[0]).toBe(20);
    expect(sampleCamera(keys, 4).fov).toBe(60);
});

test("线性插值：中点取两端平均，target 与 fov 同步插值", () => {
    const keys = [key(0, [0, 0, 0], 30, "linear", [0, 0, 0]), key(2, [10, 4, -6], 50, "linear", [2, 2, 2])];
    const mid = sampleCamera(keys, 1);
    expect(mid.position).toEqual([5, 2, -3]);
    expect(mid.target).toEqual([1, 1, 1]);
    expect(mid.fov).toBe(40);
    // 段内 1/4 处
    expect(sampleCamera(keys, 0.5).position[0]).toBe(2.5);
});

test("非法时间钳制：负数与 NaN 落到首帧，超出落到尾帧", () => {
    const keys = [key(1, [1, 1, 1], 35), key(3, [9, 9, 9], 45)];
    expect(sampleCamera(keys, -10).position).toEqual([1, 1, 1]);
    expect(sampleCamera(keys, Number.NaN).position).toEqual([1, 1, 1]);
    expect(sampleCamera(keys, Number.POSITIVE_INFINITY).position).toEqual([9, 9, 9]);
    expect(sampleCamera(keys, 999).fov).toBe(45);
});

test("缓动按段起点关键帧（easeIn / easeOut / easeInOut / linear）", () => {
    const build = (easing: CameraKey["easing"]) => [key(0, [0, 0, 0], 40, easing), key(4, [8, 0, 0], 40, "linear")];
    // 进度 0.25：linear 0.25、easeIn 0.0625、easeOut 0.4375、easeInOut 0.125
    expect(sampleCamera(build("linear"), 1).position[0]).toBeCloseTo(2, 6);
    expect(sampleCamera(build("easeIn"), 1).position[0]).toBeCloseTo(0.5, 6);
    expect(sampleCamera(build("easeOut"), 1).position[0]).toBeCloseTo(3.5, 6);
    expect(sampleCamera(build("easeInOut"), 1).position[0]).toBeCloseTo(1, 6);
    // 进度 0.5 时 easeInOut 与 linear 重合
    expect(sampleCamera(build("easeInOut"), 2).position[0]).toBeCloseTo(4, 6);
});

test("单个关键帧与空关键帧都有稳定输出", () => {
    const single = [key(2, [3, 1.5, -4], 28)];
    expect(sampleCamera(single, 0).position).toEqual([3, 1.5, -4]);
    expect(sampleCamera(single, 99).position).toEqual([3, 1.5, -4]);

    const empty = sampleCamera([], 1.2);
    expect(empty).toEqual({ position: [0, 1.6, 6], target: [0, 1, 0], fov: 40 });
    expect(sampleCamera([], 0, 27).fov).toBe(27);
});

test("乱序关键帧按时间排序后插值", () => {
    const keys = [key(2, [10, 0, 0]), key(0, [0, 0, 0])];
    expect(sampleCamera(keys, 1).position[0]).toBe(5);
    expect(sampleCamera(keys, -1).position[0]).toBe(0);
});

test("焦距换算视角：50mm 约 27 度，非法焦距回落到 40", () => {
    expect(fovFromLens(50)).toBeCloseTo(26.99, 1);
    expect(fovFromLens(0)).toBe(40);
    expect(fovFromLens(Number.NaN)).toBe(40);
});

import type { DramaSceneTemplate } from "@/types/drama";

// 场景白模模板：只描述几何构件，贴图/材质/灯光交给预演引擎处理。
// 单位统一为米，地面顶面在 y=0，其余构件都从 y=0 起算（position 取构件中心点）。

type Part = DramaSceneTemplate["parts"][number];

const WALL_THICKNESS = 0.2;
const WALL_HEIGHT = 3;
const FLOOR_THICKNESS = 0.1;

function part(kind: Part["kind"], position: [number, number, number], size: [number, number, number], rotationY?: number): Part {
    return { kind, position, size, rotationY };
}

/** 地面：厚 0.1，中心下沉一半，让顶面正好落在 y=0。 */
function floor(x: number, z: number): Part {
    return part("floor", [0, -FLOOR_THICKNESS / 2, 0], [x, FLOOR_THICKNESS, z]);
}

/** 四面墙：用于封闭室内空间。 */
function fourWalls(x: number, z: number, height = WALL_HEIGHT): Part[] {
    const t = WALL_THICKNESS;
    return [part("wall", [0, height / 2, -z / 2], [x, height, t]), part("wall", [0, height / 2, z / 2], [x, height, t]), part("wall", [-x / 2, height / 2, 0], [t, height, z]), part("wall", [x / 2, height / 2, 0], [t, height, z])];
}

/** 三面墙：正面敞开，留给机位和演员进出。 */
function threeWalls(x: number, z: number, height = WALL_HEIGHT): Part[] {
    const t = WALL_THICKNESS;
    return [part("wall", [0, height / 2, -z / 2], [x, height, t]), part("wall", [-x / 2, height / 2, 0], [t, height, z]), part("wall", [x / 2, height / 2, 0], [t, height, z])];
}

export const SCENE_TEMPLATES: DramaSceneTemplate[] = [
    {
        id: "empty",
        name: "空场",
        world: "any",
        size: { x: 40, z: 40 },
        parts: [floor(40, 40)],
    },
    {
        id: "indoor",
        name: "室内",
        world: "any",
        size: { x: 12, z: 10 },
        parts: [floor(12, 10), ...fourWalls(12, 10)],
    },
    {
        id: "street",
        name: "街道",
        world: "cultivation",
        size: { x: 30, z: 12 },
        parts: [
            floor(30, 12),
            // 两侧沿街墙体，铺满整条街的长度
            part("wall", [0, 1.5, -6], [30, 3, 0.4]),
            part("wall", [0, 1.5, 6], [30, 3, 0.4]),
            // 两侧店铺盒，做出街面的高低错落
            part("box", [-10, 1.6, -4.8], [8, 3.2, 2]),
            part("box", [6, 1.9, -4.8], [10, 3.8, 2]),
            part("box", [-8, 1.8, 4.8], [9, 3.6, 2]),
            part("box", [8, 1.4, 4.8], [7, 2.8, 2]),
        ],
    },
    {
        id: "palace",
        name: "宫殿",
        world: "cultivation",
        size: { x: 40, z: 30 },
        parts: [
            floor(40, 30),
            // 正面三级台阶，越靠里越高
            part("step", [0, 0.15, 13], [12, 0.3, 2]),
            part("step", [0, 0.3, 11], [12, 0.6, 2]),
            part("step", [0, 0.45, 9], [12, 0.9, 2]),
            // 六根立柱：两排三列，柱高 8 米
            ...[-12, 0, 12].flatMap((x) => [part("pillar", [x, 4, -10], [0.9, 8, 0.9]), part("pillar", [x, 4, 4], [0.9, 8, 0.9])]),
            // 屋顶压在立柱顶上
            part("roof", [0, 8.6, -3], [30, 1.2, 18]),
        ],
    },
    {
        id: "urban_street",
        name: "都市街道",
        world: "urban",
        size: { x: 30, z: 12 },
        parts: [
            floor(30, 12),
            // 中间沥青路面，比地面略高一点
            part("box", [0, 0.03, 0], [30, 0.06, 7]),
            // 两侧路灯柱
            ...[-12, -4, 4, 12].flatMap((x) => [part("pillar", [x, 2.5, -4.6], [0.16, 5, 0.16]), part("pillar", [x, 2.5, 4.6], [0.16, 5, 0.16])]),
        ],
    },
    {
        id: "apartment",
        name: "公寓",
        world: "urban",
        size: { x: 10, z: 8 },
        parts: [
            floor(10, 8),
            ...threeWalls(10, 8, 2.8),
            // 床
            part("box", [-2.8, 0.28, -2.6], [2, 0.56, 1.6]),
            // 桌
            part("box", [2.6, 0.38, 1.8], [1.4, 0.76, 0.8]),
            // 衣柜：贴着东墙横放，所以绕 y 轴转 90 度
            part("box", [3.6, 1, 0], [0.6, 2, 2.4], Math.PI / 2),
        ],
    },
    {
        id: "office",
        name: "办公室",
        world: "urban",
        size: { x: 12, z: 10 },
        parts: [
            floor(12, 10),
            ...threeWalls(12, 10, 2.8),
            // 两排工位盒
            part("box", [-3.6, 0.38, -2], [2.4, 0.76, 1.2]),
            part("box", [0.4, 0.38, -2], [2.4, 0.76, 1.2]),
            part("box", [4.4, 0.38, -2], [2.4, 0.76, 1.2]),
            part("box", [-1.6, 0.38, 2], [2.4, 0.76, 1.2]),
            part("box", [2.4, 0.38, 2], [2.4, 0.76, 1.2]),
        ],
    },
    {
        id: "shop",
        name: "店铺",
        world: "urban",
        size: { x: 12, z: 10 },
        parts: [
            floor(12, 10),
            ...threeWalls(12, 10, 3),
            // 柜台
            part("box", [0, 0.55, -1.5], [6, 1.1, 0.9]),
            // 两侧货架
            part("box", [-4.6, 1, 1], [0.6, 2, 4]),
            part("box", [4.6, 1, 1], [0.6, 2, 4]),
        ],
    },
];

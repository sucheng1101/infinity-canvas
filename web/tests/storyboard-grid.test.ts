import { expect, test } from "bun:test";

import { buildGridPrompt, gridCells, sliceGridRects } from "@/lib/canvas/storyboard-grid";

const layouts = [4, 6, 9] as const;

test("gridCells 返回三种宫格的行列", () => {
    expect(gridCells(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridCells(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridCells(9)).toEqual({ cols: 3, rows: 3 });
});

test("sliceGridRects 数量正确且首格从原点开始", () => {
    for (const layout of layouts) {
        const { cols, rows } = gridCells(layout);
        const rects = sliceGridRects(layout, 1200, 900);
        expect(rects.length).toBe(layout);
        expect(rects.length).toBe(cols * rows);
        expect(rects[0]).toEqual({ x: 0, y: 0, width: 1200 / cols, height: 900 / rows });
    }
});

test("sliceGridRects 各格均为整数像素，宽高之和等于总宽高", () => {
    for (const layout of layouts) {
        const { cols } = gridCells(layout);
        const rects = sliceGridRects(layout, 1001, 751);
        for (const rect of rects) {
            expect([rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)).toBe(true);
        }
        const firstRow = rects.slice(0, cols);
        expect(firstRow.reduce((sum, rect) => sum + rect.width, 0)).toBe(1001);
        const firstColumn = rects.filter((_, index) => index % cols === 0);
        expect(firstColumn.reduce((sum, rect) => sum + rect.height, 0)).toBe(751);
    }
});

test("sliceGridRects 把余数并入最后一格，相邻格不重叠", () => {
    const rects = sliceGridRects(4, 101, 99);
    expect(rects.map((rect) => rect.width)).toEqual([50, 51, 50, 51]);
    expect(rects.map((rect) => rect.height)).toEqual([49, 49, 50, 50]);
    expect(rects[1].x).toBe(rects[0].x + rects[0].width);
    expect(rects[2].y).toBe(rects[0].y + rects[0].height);
});

test("buildGridPrompt 带上镜头数量、宫格数与每个镜头文本", () => {
    const shots = [{ prompt: "雨夜霓虹下的长街，女主撑伞站立" }, { prompt: "伞面特写，雨滴滑落" }, { prompt: "男主回头，霓虹映在脸上" }];
    const prompt = buildGridPrompt(shots, 4);
    expect(prompt).toContain("3 个镜头");
    expect(prompt).toContain("4 宫格");
    expect(prompt).toContain("2 行 × 2 列");
    expect(prompt).toContain("每格一个镜头");
    expect(prompt).toContain("保持角色形象、服装、场景与画风一致");
    shots.forEach((shot, index) => expect(prompt).toContain(`${index + 1}. ${shot.prompt}`));
});

test("buildGridPrompt 按宫格数截断多余镜头", () => {
    const shots = Array.from({ length: 6 }, (_, index) => ({ prompt: `镜头 ${index + 1}` }));
    const prompt = buildGridPrompt(shots, 4);
    expect(prompt).toContain("1. 镜头 1");
    expect(prompt).toContain("4. 镜头 4");
    expect(prompt).not.toContain("镜头 5");
});

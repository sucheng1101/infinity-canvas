import { expect, test } from "bun:test";
import { promptFacets } from "../src/data/prompt-facets";
import { searchFacets, validateFacets } from "../src/lib/prompt-facet";

const expectedCounts = { style: 30, camera: 20, lighting: 15, composition: 12, color: 10, material: 8, mood: 5 } as const;

test("内置提示词片段数据通过校验", () => {
    expect(validateFacets(promptFacets)).toEqual([]);
});

test("总数 100 条且各分类数量符合要求", () => {
    expect(promptFacets).toHaveLength(100);
    for (const [category, count] of Object.entries(expectedCounts)) {
        expect(promptFacets.filter((facet) => facet.category === category)).toHaveLength(count);
    }
});

test("所有 id 全局唯一", () => {
    expect(new Set(promptFacets.map((facet) => facet.id)).size).toBe(promptFacets.length);
});

test("中文名和英文提示词都能被搜索命中", () => {
    expect(searchFacets(promptFacets, "电影").map((facet) => facet.id)).toContain("style-cinematic");
    expect(searchFacets(promptFacets, "cinematic").map((facet) => facet.id)).toContain("style-cinematic");
});

test("不存在的查询返回空数组", () => {
    expect(searchFacets(promptFacets, "不存在的关键词 zzz")).toEqual([]);
});

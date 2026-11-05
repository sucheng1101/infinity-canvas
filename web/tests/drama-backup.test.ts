import { expect, test } from "bun:test";

import { checkSchemaVersion } from "@/lib/drama/backup";

test("同版本备份直接接受", () => {
    expect(() => checkSchemaVersion(1, 1)).not.toThrow();
});

test("更低版本备份直接接受", () => {
    // 目前只发布过 1，往前兼容没有额外分支，直接放行
    expect(() => checkSchemaVersion(0, 1)).not.toThrow();
});

test("更高版本备份抛错提示升级", () => {
    expect(() => checkSchemaVersion(2, 1)).toThrow("备份来自更高版本，请先升级");
});

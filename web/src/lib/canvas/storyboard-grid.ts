export type GridLayout = 4 | 6 | 9;

export type GridRect = { x: number; y: number; width: number; height: number };

const gridShapes: Record<GridLayout, { cols: number; rows: number }> = {
    4: { cols: 2, rows: 2 },
    6: { cols: 3, rows: 2 },
    9: { cols: 3, rows: 3 },
};

export function gridCells(layout: GridLayout): { cols: number; rows: number } {
    return { ...gridShapes[layout] };
}

// 一张图里排多个镜头，先锁角色与画风一致，再按行列顺序对位，方便直接出图后裁切。
export function buildGridPrompt(shots: { prompt: string }[], layout: GridLayout): string {
    const { cols, rows } = gridCells(layout);
    const cells = shots.slice(0, layout).map((shot, index) => `${index + 1}. ${shot.prompt.trim()}`);
    return [
        `请把以下 ${cells.length} 个镜头排成 ${layout} 宫格分镜图（${rows} 行 × ${cols} 列），每格一个镜头，从左到右、从上到下依次排列。`,
        "要求：保持角色形象、服装、场景与画风一致；格与格之间用细白线分隔，画面内不要出现文字、编号或水印。",
        "",
        "镜头列表：",
        ...cells,
    ].join("\n");
}

// 按行列等分整图；边界统一向下取整切分，余数自然落到最后一格，保证不丢像素也不重叠。
export function sliceGridRects(layout: GridLayout, width: number, height: number): GridRect[] {
    const { cols, rows } = gridCells(layout);
    const cuts = (size: number, count: number) => Array.from({ length: count + 1 }, (_, index) => Math.floor((size * index) / count));
    const xs = cuts(width, cols);
    const ys = cuts(height, rows);
    return Array.from({ length: cols * rows }, (_, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        return { x: xs[col], y: ys[row], width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row] };
    });
}

import type { PromptFacet, PromptFacetCategory } from "@/types/prompt-facet";

export const PROMPT_FACET_CATEGORIES: PromptFacetCategory[] = ["style", "camera", "lighting", "composition", "color", "material", "mood"];

export function validateFacets(facets: PromptFacet[]): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    const zhs = new Set<string>();
    const ens = new Set<string>();

    facets.forEach((facet, index) => {
        const label = facet?.id?.trim() || `第 ${index + 1} 条`;

        if (!facet?.id?.trim()) problems.push(`${label}：id 不能为空`);
        else if (ids.has(facet.id)) problems.push(`${label}：id 重复`);
        else ids.add(facet.id);

        const zh = facet?.zh?.trim() ?? "";
        if (!zh) problems.push(`${label}：中文名称 zh 不能为空`);
        else if (zhs.has(zh)) problems.push(`${label}：中文名称「${zh}」重复`);
        else zhs.add(zh);

        const en = facet?.en?.trim() ?? "";
        if (!en) problems.push(`${label}：英文提示词 en 不能为空`);
        else if (ens.has(en)) problems.push(`${label}：英文提示词「${en}」重复`);
        else ens.add(en);

        if (!Array.isArray(facet?.aliases)) problems.push(`${label}：aliases 必须是数组`);

        if (!PROMPT_FACET_CATEGORIES.includes(facet?.category)) problems.push(`${label}：分类「${facet?.category}」不在允许范围内`);
    });

    return problems;
}

export function searchFacets(facets: PromptFacet[], query: string, category?: PromptFacetCategory): PromptFacet[] {
    const keyword = query.trim().toLowerCase();
    return facets.filter((facet) => {
        if (category && facet.category !== category) return false;
        if (!keyword) return true;
        return [facet.zh, facet.en, ...facet.aliases].some((text) => text.toLowerCase().includes(keyword));
    });
}

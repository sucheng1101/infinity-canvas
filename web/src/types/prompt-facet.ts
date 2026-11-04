export type PromptFacetCategory = "style" | "camera" | "lighting" | "composition" | "color" | "material" | "mood";
export type PromptFacet = {
    id: string;
    category: PromptFacetCategory;
    zh: string;
    en: string;
    aliases: string[];
    params?: Record<string, string | number>;
    verifiedModels?: string[];
};

import type { PromptFacet } from "@/types/prompt-facet";
import style from "./style.json";
import camera from "./camera.json";
import lighting from "./lighting.json";
import composition from "./composition.json";
import color from "./color.json";
import material from "./material.json";
import mood from "./mood.json";

export const promptFacets: PromptFacet[] = [...style, ...camera, ...lighting, ...composition, ...color, ...material, ...mood] as PromptFacet[];

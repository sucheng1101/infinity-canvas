import { requestJson } from "@/services/api/http";

export type StoryboardShot = {
    id: string;
    userId: number;
    sceneId: string;
    orderIndex: number;
    durationSec: number;
    shotSize: string;
    camera: string;
    dialogue: string;
    prompt: string;
    imageNodeId: string | null;
    videoNodeId: string | null;
    createdAt: string;
    updatedAt: string;
    assetRefs: string[];
};

export type StoryboardScene = {
    id: string;
    userId: number;
    projectId: string;
    name: string;
    summary: string;
    orderIndex: number;
    createdAt: string;
    updatedAt: string;
    shots: StoryboardShot[];
};

export type SceneInput = {
    name: string;
    summary: string;
};

export type ShotInput = {
    durationSec: number;
    shotSize: string;
    camera: string;
    dialogue: string;
    prompt: string;
    assetRefs?: string[];
    imageNodeId?: string | null;
    videoNodeId?: string | null;
};

// 分镜按场次分组返回，镜头随场次一起下发，不再单独请求。
export const storyboardApi = {
    scenes: (projectId: string) => requestJson<{ items: StoryboardScene[] }>(`/projects/${projectId}/scenes`),
    createScene: (projectId: string, input: SceneInput) => requestJson<StoryboardScene>(`/projects/${projectId}/scenes`, { method: "POST", body: JSON.stringify(input) }),
    updateScene: (id: string, input: SceneInput) => requestJson<StoryboardScene>(`/scenes/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    removeScene: (id: string) => requestJson<{ ok: boolean }>(`/scenes/${id}`, { method: "DELETE" }),
    createShot: (sceneId: string, input: ShotInput) => requestJson<StoryboardShot>(`/scenes/${sceneId}/shots`, { method: "POST", body: JSON.stringify(input) }),
    updateShot: (id: string, input: ShotInput) => requestJson<StoryboardShot>(`/shots/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    removeShot: (id: string) => requestJson<{ ok: boolean }>(`/shots/${id}`, { method: "DELETE" }),
};

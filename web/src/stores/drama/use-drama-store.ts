import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist, type StorageValue } from "zustand/middleware";

import { SCENE_TEMPLATES } from "@/lib/drama/scene-templates";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CharacterCard, DramaProject, DramaShot, DramaWorld, SceneCard } from "@/types/drama";

const DRAMA_STORE_KEY = "infinite-canvas:drama_store";

export type DramaStore = {
    hydrated: boolean;
    projects: DramaProject[];
    setHydrated: (hydrated: boolean) => void;
    createProject: (title: string, world: DramaWorld) => string;
    updateProject: (id: string, patch: Partial<Omit<DramaProject, "id" | "createdAt">>) => void;
    deleteProject: (id: string) => void;
    addCharacter: (projectId: string, card: Partial<CharacterCard>) => string;
    updateCharacter: (projectId: string, characterId: string, patch: Partial<Omit<CharacterCard, "id">>) => void;
    removeCharacter: (projectId: string, characterId: string) => void;
    addScene: (projectId: string, scene: Partial<SceneCard>) => string;
    updateScene: (projectId: string, sceneId: string, patch: Partial<Omit<SceneCard, "id">>) => void;
    removeScene: (projectId: string, sceneId: string) => void;
    addShot: (projectId: string, sceneId: string, partial: Partial<Omit<DramaShot, "id" | "sceneId" | "index">>) => string;
    updateShot: (projectId: string, shotId: string, patch: Partial<Omit<DramaShot, "id" | "sceneId">>) => void;
    removeShot: (projectId: string, shotId: string) => void;
    reorderShots: (projectId: string, sceneId: string, orderedIds: string[]) => void;
};

/** 所有写操作都刷新 updatedAt，列表排序和“最近编辑”都靠它。 */
function touchProject(projects: DramaProject[], projectId: string, update: (project: DramaProject) => DramaProject): DramaProject[] {
    return projects.map((project) => (project.id === projectId ? { ...update(project), updatedAt: Date.now() } : project));
}

/** 镜号在项目内全局连续（1..n），决定拍摄与导出顺序；新增、删除、重排后统一重算。 */
function renumberShots(shots: DramaShot[]): DramaShot[] {
    return shots.map((shot, index) => ({ ...shot, index: index + 1 }));
}

/** 只调整某场次内部的顺序：把排好的镜头填回该场次原本占的位置。 */
function reorderInScene(shots: DramaShot[], sceneId: string, ordered: DramaShot[]): DramaShot[] {
    const queue = [...ordered, ...shots.filter((shot) => shot.sceneId === sceneId && !ordered.some((item) => item.id === shot.id))];
    return shots.map((shot) => (shot.sceneId === sceneId ? (queue.shift() ?? shot) : shot));
}

export const useDramaStore = create<DramaStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            setHydrated: (hydrated) => set({ hydrated }),

            createProject: (title, world) => {
                const now = Date.now();
                const project: DramaProject = { id: nanoid(), title: title.trim() || "未命名短剧", world, createdAt: now, updatedAt: now, characters: [], scenes: [], props: [], shots: [], timeline: { fps: 24, totalSec: 0 } };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },

            updateProject: (id, patch) => set((state) => ({ projects: touchProject(state.projects, id, (project) => ({ ...project, ...patch })) })),

            deleteProject: (id) => set((state) => ({ projects: state.projects.filter((project) => project.id !== id) })),

            addCharacter: (projectId, card) => {
                const character: CharacterCard = {
                    id: card.id ?? nanoid(),
                    name: card.name?.trim() || "新角色",
                    prompt: card.prompt ?? "",
                    refImages: card.refImages ?? [],
                    modelKey: card.modelKey,
                    heightCm: card.heightCm ?? 170,
                    color: card.color ?? "#8b7355",
                };
                set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, characters: [...project.characters, character] })) }));
                return character.id;
            },

            updateCharacter: (projectId, characterId, patch) =>
                set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, characters: project.characters.map((item) => (item.id === characterId ? { ...item, ...patch } : item)) })) })),

            removeCharacter: (projectId, characterId) =>
                set((state) => ({
                    projects: touchProject(state.projects, projectId, (project) => ({
                        ...project,
                        characters: project.characters.filter((item) => item.id !== characterId),
                        // 角色删除后，镜头里对应的站位也一并清掉，避免预演时找不到人
                        shots: project.shots.map((shot) => (shot.cast.some((cast) => cast.characterId === characterId) ? { ...shot, cast: shot.cast.filter((cast) => cast.characterId !== characterId) } : shot)),
                    })),
                })),

            addScene: (projectId, scene) => {
                const template = SCENE_TEMPLATES.find((item) => item.id === scene.templateId) ?? SCENE_TEMPLATES[0];
                const project = get().projects.find((item) => item.id === projectId);
                const world: DramaWorld = scene.world ?? (template.world === "any" ? (project?.world ?? "urban") : template.world);
                const card: SceneCard = { id: scene.id ?? nanoid(), name: scene.name?.trim() || template.name, templateId: template.id, world, size: scene.size ?? { ...template.size }, glbKey: scene.glbKey };
                set((state) => ({ projects: touchProject(state.projects, projectId, (item) => ({ ...item, scenes: [...item.scenes, card] })) }));
                return card.id;
            },

            updateScene: (projectId, sceneId, patch) => set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, scenes: project.scenes.map((item) => (item.id === sceneId ? { ...item, ...patch } : item)) })) })),

            removeScene: (projectId, sceneId) =>
                set((state) => ({
                    projects: touchProject(state.projects, projectId, (project) => ({ ...project, scenes: project.scenes.filter((item) => item.id !== sceneId), shots: renumberShots(project.shots.filter((shot) => shot.sceneId !== sceneId)) })),
                })),

            addShot: (projectId, sceneId, partial) => {
                const shot: DramaShot = {
                    id: nanoid(),
                    sceneId,
                    index: 0,
                    shotSize: partial.shotSize ?? "中景",
                    durationSec: partial.durationSec ?? 4,
                    dialogue: partial.dialogue ?? "",
                    prompt: partial.prompt ?? "",
                    cast: partial.cast ?? [],
                    camera: partial.camera ?? { lens: 35, keys: [] },
                    status: partial.status ?? "待预演",
                    output: partial.output,
                };
                // 镜号由 store 统一分配，新镜头排在项目最后
                set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, shots: renumberShots([...project.shots, shot]) })) }));
                return shot.id;
            },

            updateShot: (projectId, shotId, patch) => set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, shots: project.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)) })) })),

            removeShot: (projectId, shotId) => set((state) => ({ projects: touchProject(state.projects, projectId, (project) => ({ ...project, shots: renumberShots(project.shots.filter((shot) => shot.id !== shotId)) })) })),

            reorderShots: (projectId, sceneId, orderedIds) =>
                set((state) => ({
                    projects: touchProject(state.projects, projectId, (project) => {
                        const inScene = project.shots.filter((shot) => shot.sceneId === sceneId);
                        const ordered = [...orderedIds.map((id) => inScene.find((shot) => shot.id === id)).filter((shot): shot is DramaShot => !!shot), ...inScene.filter((shot) => !orderedIds.includes(shot.id))];
                        return { ...project, shots: renumberShots(reorderInScene(project.shots, sceneId, ordered)) };
                    }),
                })),
        }),
        {
            name: DRAMA_STORE_KEY,
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ projects: state.projects }) as StorageValue<DramaStore>["state"],
            onRehydrateStorage: () => () => {
                useDramaStore.setState({ hydrated: true });
            },
        },
    ),
);

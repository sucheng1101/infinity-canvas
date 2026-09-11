import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Form, Input, Modal, Select } from "antd";
import { Download, FileUp, ImagePlus, Plus, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { uploadImage } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasProjectKind, EcommerceProductBrief } from "@/stores/canvas/use-canvas-store";
import type { ReferenceImage } from "@/types/image";

type EcommerceFormValues = {
    title?: string;
    productName: string;
    category: string;
    platform: string;
    audience: string;
    sellingPoints: string;
};

export default function CanvasPage({ projectKindFilter }: { projectKindFilter?: CanvasProjectKind } = {}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [ecommerceOpen, setEcommerceOpen] = useState(false);
    const [ecommerceForm] = Form.useForm<EcommerceFormValues>();
    const [ecommerceReferences, setEcommerceReferences] = useState<ReferenceImage[]>([]);
    const ecommerceReferenceInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const allProjects = useCanvasStore((state) => state.projects);
    const projects = projectKindFilter ? allProjects.filter((project) => project.kind === projectKindFilter) : allProjects;
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/canvas/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const createAndEnter = () => enterProject(createProject(t("canvas.defaultTitle", { count: allProjects.length + 1 })));
    const openEcommerce = () => {
        ecommerceForm.resetFields();
        setEcommerceReferences([]);
        setEcommerceOpen(true);
    };
    const addEcommerceReferences = async (files?: FileList | null) => {
        const next = await Promise.all(Array.from(files || []).filter((file) => file.type.startsWith("image/")).map(async (file) => {
            const stored = await uploadImage(file);
            return { id: nanoid(), name: file.name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey } satisfies ReferenceImage;
        }));
        setEcommerceReferences((value) => [...value, ...next]);
    };
    const createEcommerce = async () => {
        const values = await ecommerceForm.validateFields();
        const brief: EcommerceProductBrief = {
            productName: values.productName.trim(),
            category: values.category.trim(),
            platform: values.platform,
            audience: values.audience.trim(),
            sellingPoints: values.sellingPoints.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean),
            referenceImages: ecommerceReferences.map((item) => item.storageKey || item.dataUrl),
            realismPreset: "实拍质感：自然光、真实材质、轻微镜头瑕疵、避免塑料感与过度锐化",
        };
        const briefNode = createCanvasNode(CanvasNodeType.Text, { x: 260, y: 220 }, { content: `商品资料\n商品：${brief.productName}\n类目：${brief.category}\n平台：${brief.platform}\n人群：${brief.audience}\n卖点：${brief.sellingPoints.join("、")}`, status: "success" });
        const planNode = createCanvasNode(CanvasNodeType.Text, { x: 260, y: 560 }, { content: "套图规划\n1. 主图：突出商品主体与核心卖点\n2. 卖点图：拆分功能、材质与细节\n3. 场景图：展示真实使用情境", status: "success" });
        const mainNode = createCanvasNode(CanvasNodeType.Config, { x: 760, y: 220 }, { content: `主图生成\n${brief.productName}，${brief.sellingPoints.join("、")}\n${brief.realismPreset}`, generationMode: "image", status: "idle" });
        const sellingNode = createCanvasNode(CanvasNodeType.Config, { x: 760, y: 560 }, { content: `卖点图生成\n平台：${brief.platform}\n${brief.sellingPoints.join("、")}\n${brief.realismPreset}`, generationMode: "image", status: "idle" });
        const sceneNode = createCanvasNode(CanvasNodeType.Config, { x: 1260, y: 220 }, { content: `使用场景图生成\n面向${brief.audience}的${brief.productName}使用场景\n${brief.realismPreset}`, generationMode: "image", status: "idle" });
        const qaNode = createCanvasNode(CanvasNodeType.Text, { x: 1260, y: 560 }, { content: "电商 QA\n□ 商品主体清晰\n□ 卖点与商品资料一致\n□ 平台尺寸与文案合规\n□ 无夸大或无法证明的声明", status: "success" });
        const referenceNodes = ecommerceReferences.map((reference, index) => createCanvasNode(CanvasNodeType.Image, { x: 260 + index * 280, y: 900 }, { content: reference.dataUrl, storageKey: reference.storageKey, status: "success", mimeType: reference.type }));
        const nodes = [briefNode, planNode, ...referenceNodes, mainNode, sellingNode, sceneNode, qaNode];
        const generationNodes = [mainNode, sellingNode, sceneNode];
        const connections = generationNodes.flatMap((node) => [briefNode, planNode, ...referenceNodes].map((source) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: node.id }))).concat(generationNodes.map((source) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: qaNode.id })));
        const id = createProject(values.title?.trim() || `${brief.productName} · 电商套图`, { kind: "ecommerce", ecommerceBrief: brief, nodes, connections });
        setEcommerceOpen(false);
        enterProject(id);
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch {
            message.error(t("canvas.importFailed"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 })) : projects[0]?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 })));
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{projectKindFilter ? t("navigation.projects") : t("canvas.title")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("canvas.title")}-${selectedIds.length}`)}>
                                    {t("canvas.exportSelected")}
                                </Button>
                                <Button disabled={!hydrated} onClick={() => setDeleteIds(selectedIds)}>
                                    {t("canvas.deleteSelected")}
                                </Button>
                            </>
                        ) : null}
                        {projects.length ? (
                            <Button disabled={!hydrated} onClick={() => setDeleteIds(projects.map((project) => project.id))}>
                                {t("canvas.deleteAll")}
                            </Button>
                        ) : null}
                        <Button disabled={!hydrated} icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
                            {t("canvas.import")}
                        </Button>
                        {!projectKindFilter ? <Button disabled={!hydrated} type="primary" icon={<Plus className="size-4" />} onClick={createAndEnter}>{t("canvas.create")}</Button> : null}
                        {projectKindFilter === "ecommerce" ? <Button disabled={!hydrated} onClick={openEcommerce}>新建电商项目</Button> : null}
                    </div>
                </header>

                {!hydrated ? (
                    <section className="flex min-h-[360px] items-center justify-center border-y border-stone-200 text-sm text-stone-500 dark:border-stone-800">{t("canvas.loading")}</section>
                ) : projects.length ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : (
                    <section className="flex min-h-[360px] flex-col items-center justify-center border-y border-stone-200 text-center dark:border-stone-800">
                        <h2 className="text-xl font-medium">{t("canvas.empty")}</h2>
                        <p className="mt-3 text-sm text-stone-500">{t("canvas.emptyDescription")}</p>
                        {!projectKindFilter ? <Button type="primary" className="mt-6" icon={<Plus className="size-4" />} onClick={createAndEnter}>{t("canvas.create")}</Button> : null}
                        {projectKindFilter === "ecommerce" ? <Button className="mt-3" onClick={openEcommerce}>从电商套图开始</Button> : null}
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
            <Modal title="新建电商项目" open={ecommerceOpen} onCancel={() => setEcommerceOpen(false)} onOk={() => void createEcommerce()} okText="创建并打开">
                <Form form={ecommerceForm} layout="vertical" initialValues={{ platform: "淘宝 / 天猫" }}>
                    <Form.Item name="title" label="项目名称"><Input placeholder="例如：春季保温杯主图套图" /></Form.Item>
                    <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]}><Input /></Form.Item>
                    <Form.Item name="category" label="商品类目" rules={[{ required: true, message: "请输入商品类目" }]}><Input placeholder="例如：家居 / 食品 / 服饰" /></Form.Item>
                    <Form.Item name="platform" label="目标平台" rules={[{ required: true }]}><Select options={["淘宝 / 天猫", "京东", "抖音电商", "小红书", "跨平台"].map((value) => ({ value, label: value }))} /></Form.Item>
                    <Form.Item name="audience" label="目标人群" rules={[{ required: true, message: "请输入目标人群" }]}><Input /></Form.Item>
                    <Form.Item name="sellingPoints" label="核心卖点" rules={[{ required: true, message: "请输入至少一个卖点" }]}><Input.TextArea rows={3} placeholder="多个卖点用逗号或换行分隔" /></Form.Item>
                    <Form.Item label="参考图（可选）">
                        <input ref={ecommerceReferenceInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { void addEcommerceReferences(event.target.files); event.target.value = ""; }} />
                        <Button icon={<ImagePlus className="size-4" />} onClick={() => ecommerceReferenceInputRef.current?.click()}>上传参考图</Button>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {ecommerceReferences.map((reference) => <div key={reference.id} className="group relative size-16 overflow-hidden rounded-md border border-stone-200 dark:border-stone-700"><img src={reference.dataUrl} alt={reference.name} className="size-full object-cover" /><button type="button" aria-label={`移除${reference.name}`} className="absolute right-0 top-0 hidden bg-black/60 p-0.5 text-white group-hover:block" onClick={() => setEcommerceReferences((items) => items.filter((item) => item.id !== reference.id))}><X className="size-3" /></button></div>)}
                        </div>
                        <p className="mt-2 text-xs text-stone-500">将参考图连接到主图、卖点图和场景图节点，生成时可继续调整。</p>
                    </Form.Item>
                    <Form.Item label="真实感预设"><Input.TextArea value="实拍质感：自然光、真实材质、轻微镜头瑕疵、避免塑料感与过度锐化" readOnly rows={2} /></Form.Item>
                </Form>
            </Modal>
        </main>
    );
}

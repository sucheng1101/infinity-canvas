import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, AutoComplete, Button, Form, Input, Modal, Select } from "antd";
import { Download, FileUp, Plus, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { imageToDataUrl, setImageBlob, uploadImage } from "@/services/image-storage";
import { requestImageQuestion } from "@/services/api/image";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import { ModelPicker } from "@/components/model-picker";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { hasAgentUrlBootstrap } from "@/lib/agent/agent-url-bootstrap";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { CanvasNodeType } from "@/types/canvas";
import type { EcommerceProductBrief } from "@/stores/canvas/use-canvas-store";
import type { ReferenceImage } from "@/types/image";

type EcommerceFormValues = {
    productName: string;
    platform: string;
};

const ECOMMERCE_SCENES = ["纯色棚拍", "木桌场景", "大理石台面", "户外自然光", "生活方式", "节日礼盒", "模特展示", "ins 风格", "国潮风", "夏日清爽", "咖啡店", "酒店居家"];
const ECOMMERCE_CATEGORIES = ["家居", "食品", "服饰", "美妆个护", "数码3C", "母婴", "运动户外", "宠物用品", "珠宝配饰", "图书文具", "礼品文创"];
const ECOMMERCE_AUDIENCES = ["办公室白领", "学生党", "宝妈", "送礼人群", "银发族", "健身人群", "户外爱好者", "宠物主人", "情侣", "儿童"];
const ECOMMERCE_SELLING_POINTS = ["高性价比", "材质安全", "轻便便携", "防水防摔", "长效续航", "易于清洁", "智能互联", "礼盒包装", "限量设计", "工厂直供"];
const ECOMMERCE_QA_PROMPT = `电商 QA 检查
请结合商品资料与套图规划，逐张检查生成的商品图并输出检查报告：
1. 商品身份一致性：颜色、轮廓、比例、结构、材质、标识是否与商品资料一致；
2. 事实边界：是否出现未经证实的功能、认证、容量或夸大承诺；
3. 套图角色：主图、卖点图、场景图是否各司其职，有无明显重复；
4. 平台合规：构图留白是否合适，有无水印角标，画面文字是否可读。
输出格式：每张图一段，先给「通过」或「有问题」，再列出问题项和具体修订建议。`;

export default function ProjectsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [ecommerceOpen, setEcommerceOpen] = useState(false);
    const [ecommerceForm] = Form.useForm<EcommerceFormValues>();
    const [ecommerceReferences, setEcommerceReferences] = useState<ReferenceImage[]>([]);
    const [ecommercePrompts, setEcommercePrompts] = useState({ main: "", selling: "", scene: "" });
    const [hasProposal, setHasProposal] = useState(false);
    const [ecommerceNote, setEcommerceNote] = useState("");
    const [ecommerceGenerating, setEcommerceGenerating] = useState(false);
    const [ecommerceModel, setEcommerceModel] = useState("");
    const [ecommerceTextModel, setEcommerceTextModel] = useState("");
    const [ecommerceScene, setEcommerceScene] = useState("");
    const [ecommerceBrief, setEcommerceBrief] = useState({ category: "", audience: "", sellingPoints: "" });
    const [ecommerceRequests, setEcommerceRequests] = useState<string[]>([]);
    const ecommerceReferenceInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const allProjects = useCanvasStore((state) => state.projects);
    // 项目管理只管理电商项目；普通画布归「我的画布」（/canvas）。
    const projects = allProjects.filter((project) => project.kind === "ecommerce");
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const effectiveConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const enterProject = (id: string) => {
        const agentHash = hasAgentUrlBootstrap(window.location.hash) ? window.location.hash : "";
        navigate(`/projects/${id}${agentQuery}${agentHash}`, { replace: Boolean(agentHash) });
    };
    const openEcommerce = () => {
        ecommerceForm.resetFields();
        setEcommerceReferences([]);
        setEcommercePrompts({ main: "", selling: "", scene: "" });
        setHasProposal(false);
        setEcommerceNote("");
        setEcommerceModel(effectiveConfig.imageModel || "");
        setEcommerceTextModel(effectiveConfig.textModel || "");
        setEcommerceScene("");
        setEcommerceBrief({ category: "", audience: "", sellingPoints: "" });
        setEcommerceRequests([]);
        setEcommerceOpen(true);
    };
    const addEcommerceReferences = async (files?: FileList | null) => {
        const next = await Promise.all(Array.from(files || []).filter((file) => file.type.startsWith("image/")).map(async (file) => {
            const stored = await uploadImage(file);
            return { id: nanoid(), name: file.name, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey } satisfies ReferenceImage;
        }));
        setEcommerceReferences((value) => [...value, ...next]);
    };
    const generateEcommerceProposal = async () => {
        const requirement = ecommerceNote.trim();
        if (hasProposal && !requirement) return;
        const values = ecommerceForm.getFieldsValue();
        if (!values.productName?.trim()) {
            message.warning("请先填写商品名称");
            ecommerceForm.setFields([{ name: "productName", errors: ["请输入商品名称"] }]);
            return;
        }
        if (!effectiveConfig.textModel && !effectiveConfig.model) {
            message.warning("请先在配置的偏好设置中选择默认文本模型");
            return;
        }
        setEcommerceGenerating(true);
        try {
            const briefLines = [
                `商品：${values.productName.trim()}`,
                ecommerceBrief.category && `类目：${ecommerceBrief.category}`,
                `平台：${values.platform}`,
                ecommerceBrief.audience && `人群：${ecommerceBrief.audience}`,
                ecommerceScene && `场景方向：${ecommerceScene}`,
                ecommerceBrief.sellingPoints && `卖点：${ecommerceBrief.sellingPoints}`,
            ].filter(Boolean).join("\n");
            const currentBlock = hasProposal ? `\n\n当前方案：\n${briefLines}\n【主图】${ecommercePrompts.main}\n【卖点图】${ecommercePrompts.selling}\n【场景图】${ecommercePrompts.scene}` : `\n\n商品资料：\n${briefLines}`;
            const historyBlock = ecommerceRequests.length ? `\n\n历史调整要求：\n${ecommerceRequests.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
            const askBlock = requirement ? `\n\n本次调整要求：${requirement}` : "";
            const referenceParts = await Promise.all(
                ecommerceReferences.map(async (reference) => ({ type: "image_url" as const, image_url: { url: await imageToDataUrl(reference) } })),
            );
            const answer = await requestImageQuestion(
                { ...effectiveConfig, model: ecommerceTextModel || "" },
                [{
                    role: "user",
                    content: [
                        { type: "text", text: `你是电商视觉策划专家。请根据商品资料${ecommerceReferences.length ? "和参考图" : ""}${ecommerceScene ? `、场景方向「${ecommerceScene}」` : ""}${requirement ? `与调整要求` : ""}，制定电商套图方案：补全类目、人群、卖点，并为三类电商图各写一条可直接使用的中文生图提示词，只写画面描述本身。主图保持商品主体清晰，场景图体现所选场景方向；已确定的内容保持稳定，只按要求调整相关部分。${currentBlock}${historyBlock}${askBlock}\n\n严格按以下格式输出完整方案：\n【类目】类别\n【人群】目标人群\n【卖点】卖点1、卖点2\n【主图】提示词\n【卖点图】提示词\n【场景图】提示词` },
                        ...referenceParts,
                    ],
                }],
                () => {},
            );
            const pick = (label: string) => new RegExp(`【${label}】\\s*([\\s\\S]*?)(?=【|$)`).exec(answer)?.[1]?.trim() || "";
            const category = pick("类目");
            const audience = pick("人群");
            const sellingPoints = pick("卖点");
            const prompts = { main: pick("主图"), selling: pick("卖点图"), scene: pick("场景图") };
            if (!prompts.main && !prompts.selling && !prompts.scene) throw new Error("no prompts");
            if (category) setEcommerceBrief((prev) => ({ ...prev, category: category }));
            if (audience) setEcommerceBrief((prev) => ({ ...prev, audience: audience }));
            if (sellingPoints) setEcommerceBrief((prev) => ({ ...prev, sellingPoints: sellingPoints }));
            setEcommercePrompts(prompts);
            setHasProposal(true);
            if (requirement) setEcommerceRequests((prev) => [...prev, requirement]);
            setEcommerceNote("");
            message.success(hasProposal ? "方案已按调整要求更新" : "方案已生成，可直接微调或继续输入调整要求");
        } catch (error) {
            message.error({ content: `AI 生成方案失败：${error instanceof Error ? error.message : String(error)}`, duration: 6 });
        } finally {
            setEcommerceGenerating(false);
        }
    };
    const createEcommerce = async () => {
        const values = await ecommerceForm.validateFields();
        const brief: EcommerceProductBrief = {
            productName: values.productName.trim(),
            category: ecommerceBrief.category.trim(),
            platform: values.platform || "淘宝 / 天猫",
            audience: ecommerceBrief.audience.trim(),
            sellingPoints: ecommerceBrief.sellingPoints.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean),
            referenceImages: ecommerceReferences.map((item) => item.storageKey || item.dataUrl),
            realismPreset: "实拍质感：自然光、真实材质、轻微镜头瑕疵、避免塑料感与过度锐化",
            ...(ecommerceScene ? { scene: ecommerceScene } : {}),
        };
        const briefText = [
            `商品：${brief.productName}`,
            brief.category && `类目：${brief.category}`,
            `平台：${brief.platform}`,
            brief.audience && `人群：${brief.audience}`,
            brief.scene && `场景：${brief.scene}`,
            brief.sellingPoints.length > 0 && `卖点：${brief.sellingPoints.join("、")}`,
        ].filter(Boolean).join("\n");
        const briefNode = createCanvasNode(CanvasNodeType.Text, { x: 260, y: 220 }, { content: `商品资料\n${briefText}`, status: "success" });
        const planNode = createCanvasNode(CanvasNodeType.Text, { x: 260, y: 560 }, { content: "套图规划\n1. 主图：突出商品主体与核心卖点\n2. 卖点图：拆分功能、材质与细节\n3. 场景图：展示真实使用情境", status: "success" });
        const mainPrompt = `${ecommercePrompts.main || [brief.productName, ...brief.sellingPoints].filter(Boolean).join("，")}\n${brief.realismPreset}`;
        const sellingPrompt = `${ecommercePrompts.selling || [`平台：${brief.platform}`, brief.sellingPoints.length > 0 ? brief.sellingPoints.join("、") : ""].filter(Boolean).join("\n")}\n${brief.realismPreset}`;
        const scenePrompt = `${ecommercePrompts.scene || `${brief.audience ? `面向${brief.audience}的` : ""}${brief.productName}使用场景${brief.scene ? `，场景为${brief.scene}` : ""}`}\n${brief.realismPreset}`;
        const mainNode = { ...createCanvasNode(CanvasNodeType.Config, { x: 760, y: 220 }, { content: `主图生成\n${mainPrompt}`, prompt: mainPrompt, generationMode: "image", status: "idle", ecommerceImageSource: true, ...(ecommerceModel ? { model: ecommerceModel } : {}) }), title: "主图生成" };
        const sellingNode = { ...createCanvasNode(CanvasNodeType.Config, { x: 760, y: 560 }, { content: `卖点图生成\n${sellingPrompt}`, prompt: sellingPrompt, generationMode: "image", status: "idle", ecommerceImageSource: true, ...(ecommerceModel ? { model: ecommerceModel } : {}) }), title: "卖点图生成" };
        const sceneNode = { ...createCanvasNode(CanvasNodeType.Config, { x: 760, y: 900 }, { content: `使用场景图生成\n${scenePrompt}`, prompt: scenePrompt, generationMode: "image", status: "idle", ecommerceImageSource: true, ...(ecommerceModel ? { model: ecommerceModel } : {}) }), title: "场景图生成" };
        const qaNode = { ...createCanvasNode(CanvasNodeType.Config, { x: 760, y: 1240 }, { content: ECOMMERCE_QA_PROMPT, prompt: ECOMMERCE_QA_PROMPT, generationMode: "text", status: "idle", ecommerceQa: true }), title: "电商 QA" };
        const referenceNodes = ecommerceReferences.map((reference, index) => createCanvasNode(CanvasNodeType.Image, { x: 260 + index * 280, y: 1240 }, { content: reference.dataUrl, storageKey: reference.storageKey, status: "success", mimeType: reference.type }));
        const nodes = [briefNode, planNode, ...referenceNodes, mainNode, sellingNode, sceneNode, qaNode];
        const generationNodes = [mainNode, sellingNode, sceneNode];
        const connections = generationNodes.flatMap((node) => [briefNode, planNode, ...referenceNodes].map((source) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: node.id }))).concat([briefNode, planNode, ...referenceNodes].map((source) => ({ id: nanoid(), fromNodeId: source.id, toNodeId: qaNode.id })));
        const id = createProject(`${brief.productName} · 电商套图`, { kind: "ecommerce", ecommerceBrief: brief, nodes, connections });
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
        enterProject(mode === "new" ? createProject(t("canvas.defaultTitle", { count: projects.length + 1 }), { kind: "ecommerce" }) : projects[0]?.id || createProject(t("canvas.defaultTitle", { count: projects.length + 1 }), { kind: "ecommerce" }));
    }, [createProject, hydrated, mode, projects, t]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">{t("canvas.opening")}</main>;

    return (
        <main className="h-full overflow-auto bg-background text-stone-950 dark:text-stone-100">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-6 dark:border-stone-800">
                    <div>
                        <p className="text-xs text-stone-500">{t("canvas.library")}</p>
                        <h1 className="mt-3 text-3xl font-semibold">{t("navigation.projects")}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {selectedIds.length ? (
                            <>
                                <Button disabled={!hydrated} icon={<Download className="size-4" />} onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `${t("navigation.projects")}-${selectedIds.length}`)}>
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
                        <Button disabled={!hydrated} onClick={openEcommerce}>新建电商项目</Button>
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
                        <Button className="mt-6" onClick={openEcommerce}>从电商套图开始</Button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
            <Modal title="新建电商项目" open={ecommerceOpen} width={680} styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" } }} onCancel={() => setEcommerceOpen(false)} onOk={() => void createEcommerce()} okText="创建并打开">
                <Form form={ecommerceForm} layout="vertical" initialValues={{ platform: "淘宝 / 天猫" }} className="[&_.ant-form-item]:mb-3">
                    <div className="flex items-start gap-2">
                        <Form.Item name="productName" label="商品名称" rules={[{ required: true, message: "请输入商品名称" }]} className="!mb-0 min-w-0 flex-1"><Input placeholder="例如：春季保温杯" /></Form.Item>
                        <Form.Item label="场景模板" className="!mb-0 !w-44 shrink-0">
                            <Select allowClear placeholder="可选" value={ecommerceScene || undefined} onChange={(value) => setEcommerceScene(value || "")} options={ECOMMERCE_SCENES.map((value) => ({ value, label: value }))} />
                        </Form.Item>
                    </div>
                    <Form.Item label="参考图（可选）">
                        <input ref={ecommerceReferenceInputRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(event) => { void addEcommerceReferences(event.target.files); event.target.value = ""; }} />
                        <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => ecommerceReferenceInputRef.current?.click()} aria-label="上传参考图" className="grid size-16 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-stone-300 text-stone-400 transition hover:border-stone-400 hover:text-stone-600 dark:border-stone-700 dark:text-stone-500 dark:hover:border-stone-500 dark:hover:text-stone-300">
                                <Plus className="size-6" />
                            </button>
                            {ecommerceReferences.map((reference) => <div key={reference.id} className="group relative size-16 overflow-hidden rounded-md border border-stone-200 dark:border-stone-700"><img src={reference.dataUrl} alt={reference.name} className="size-full object-cover" /><button type="button" aria-label={`移除${reference.name}`} className="absolute right-0 top-0 hidden bg-black/60 p-0.5 text-white group-hover:block" onClick={() => setEcommerceReferences((items) => items.filter((item) => item.id !== reference.id))}><X className="size-3" /></button></div>)}
                        </div>
                    </Form.Item>
                    <div className="flex items-center gap-2">
                        <Input value={ecommerceNote} onChange={(event) => setEcommerceNote(event.target.value)} onPressEnter={() => void generateEcommerceProposal()} placeholder={hasProposal ? "提出调整要求，如：主图换成夜景氛围" : "可填写需求，也可以直接生成方案"} />
                        <Button className="shrink-0" type="primary" icon={<Sparkles className="size-4" />} loading={ecommerceGenerating} onClick={() => void generateEcommerceProposal()}>{hasProposal ? "发送" : "AI 生成方案"}</Button>
                    </div>
                    {ecommerceRequests.length > 0 ? (
                        <div className="mt-2 space-y-1">
                            {ecommerceRequests.map((item, index) => <p key={index} className="text-xs text-stone-500">调整 {index + 1}：{item}</p>)}
                        </div>
                    ) : null}
                    <div className="mt-3 space-y-2">
                        <p className="text-xs font-medium text-stone-500">套图方案（可手动填写，或由 AI 生成/调整）</p>
                        <div className="grid gap-x-3 sm:grid-cols-3">
                            <Form.Item label="类目" className="!mb-0">
                                <AutoComplete value={ecommerceBrief.category} onChange={(value) => setEcommerceBrief({ ...ecommerceBrief, category: value })} options={ECOMMERCE_CATEGORIES.map((value) => ({ value }))} placeholder="选择或输入" />
                            </Form.Item>
                            <Form.Item label="人群" className="!mb-0">
                                <AutoComplete value={ecommerceBrief.audience} onChange={(value) => setEcommerceBrief({ ...ecommerceBrief, audience: value })} options={ECOMMERCE_AUDIENCES.map((value) => ({ value }))} placeholder="选择或输入" />
                            </Form.Item>
                            <Form.Item label="卖点" className="!mb-0">
                                <AutoComplete value={ecommerceBrief.sellingPoints} onChange={(value) => setEcommerceBrief({ ...ecommerceBrief, sellingPoints: value })} options={ECOMMERCE_SELLING_POINTS.map((value) => ({ value }))} placeholder="选择或输入，可逗号组合" />
                            </Form.Item>
                        </div>
                        <div className="space-y-1.5">
                            {[{ key: "main" as const, label: "主图" }, { key: "selling" as const, label: "卖点图" }, { key: "scene" as const, label: "场景图" }].map((item) => (
                                <div key={item.key} className="grid grid-cols-[52px_1fr] items-start gap-2">
                                    <span className="pt-2 text-xs text-stone-500">{item.label}</span>
                                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 5 }} value={ecommercePrompts[item.key]} onChange={(event) => setEcommercePrompts({ ...ecommercePrompts, [item.key]: event.target.value })} className="!text-xs" placeholder={`${item.label}提示词`} />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="mt-2 flex items-center gap-x-1.5 text-xs text-stone-500">
                        <span className="shrink-0 font-medium">高级选项</span>
                        <span className="shrink-0">平台</span>
                        <Form.Item name="platform" noStyle>
                            <Select className="!w-28 shrink-0" options={["淘宝 / 天猫", "京东", "抖音电商", "小红书", "跨平台"].map((value) => ({ value, label: value }))} />
                        </Form.Item>
                        <span className="ml-1 shrink-0">AI 方案</span>
                        <ModelPicker config={effectiveConfig} value={ecommerceTextModel} onChange={setEcommerceTextModel} capability="text" showChannel={false} onMissingConfig={() => openConfigDialog(true)} className="!w-32 min-w-0 flex-1" placeholder="默认文本模型" />
                        <span className="ml-1 shrink-0">生成模型</span>
                        <ModelPicker config={effectiveConfig} value={ecommerceModel} onChange={setEcommerceModel} capability="image" showChannel={false} onMissingConfig={() => openConfigDialog(true)} className="!w-32 min-w-0 flex-1" placeholder="默认生图模型" />
                    </div>
                </Form>
            </Modal>
        </main>
    );
}

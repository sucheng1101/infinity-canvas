---
name: ecommerce-canvas-flow
description: 无限画布电商套图流程的产品设计约定与实现规范。凡涉及新建电商项目弹窗、电商画布（/projects/:id）、生成面板、AI 改词、QA 检查、ecommerceImageSource/ecommerceQa 标记、方案提示词格式的改动，必须先读本 skill 并按既定路线实现，避免偏离产品方向。
---

# 电商套图流程（Ecommerce Canvas Flow）

本 skill 固化电商流程的产品路线与实现约定。改电商相关功能前先通读本文；新能力应沿着路线延伸，不要另起炉灶。

## 产品流程（用户旅程）

1. **新建**（对话式弹窗）：只填「商品名称」（唯一必填）+ 可选上传参考图 + 选场景模板 → 「AI 生成方案」产出完整方案（类目、人群、卖点 + 主图/卖点图/场景图三条提示词）。
2. **对话调整**：方案区常驻可编辑（默认空白、AI 生成即自动填充）；下方输入框可连续提出调整要求，AI 基于当前方案与历史要求迭代，只改相关部分。
3. **创建并打开**：进入电商画布 `/projects/:id`，项目名自动为「商品名 · 电商套图」。
4. **画布输出**：每个组合提示词器节点有独立的开始生成按钮（可单独生成）；工具栏「生成套图」打开生成面板——顶部方案摘要、三行组合器（每行 = 该图参考图 + 可编辑提示词 + 独立生成按钮）、「一键生成三图 + QA 检查」。
5. **AI 改词**：工具栏对话面板，基于三个节点当前提示词按用户要求改写并直接写回节点，与生成面板互斥打开。

## 弹窗设计约定

- 必填仅「商品名称」；类目、人群、卖点常驻显示、默认空白、可手填，AI 生成即自动填充（只补空还是覆盖由指令控制：调整轮只改相关部分）。
- 方案输出严格按格式（解析依赖，勿改标记）：
  `【类目】…【人群】…【卖点】a、b…【主图】…【卖点图】…【场景图】…`，用 `【label】` 正则解析。
- 场景模板 12 个（纯色棚拍/木桌场景/大理石台面/户外自然光/生活方式/节日礼盒/模特展示/ins 风格/国潮风/夏日清爽/咖啡店/酒店居家），选中场景写入 brief.scene 并注入 AI 指令与场景图提示词。
- 高级选项常驻不折叠：目标平台（默认淘宝/天猫）、AI 方案模型（text capability，可空=默认文本模型）、生成模型（image capability，可空=默认图片模型）。模型与 Key 通过 ModelPicker 渠道库对应。
- 参考图上传为方形加号入口；参考图发给 API 前必须 `imageToDataUrl` 转 base64（远程 API 读不到 blob:/本地地址）。
- 带参考图出方案要求文本模型具备视觉能力；不支持时应提示用户换模型或不传图。

## 画布结构约定

- 模板节点：商品资料、套图规划（文本）→ 主图生成/卖点图生成/场景图生成（Config，image）→ 电商 QA（Config，text）。节点标题固定为「主图生成/卖点图生成/场景图生成/电商 QA」，生成面板与改词面板靠 title 关键字定位节点。
- 模板布局为单列行式：主图生成(760,220) → 卖点图生成(760,560) → 场景图生成(760,900) → 电商 QA(760,1240) 各占一行，左侧商品资料/套图规划/参考图列与右侧生成节点错开；生成结果落在对应节点所在行的右侧，保证「一个组合提示词器一行」。
- 元数据标记：生成节点 `ecommerceImageSource: true`；QA 节点 `ecommerceQa: true`。提示词存 `metadata.prompt`；`metadata.content` 为「标题\n提示词」。
- **QA 不与生成节点直连**（配置→配置连接会触发 getConnectedConfigInputNodes 改写输入解析，破坏参考图）；QA 的输入 = 商品资料/套图规划/参考图直连 + buildNodeGenerationInputs 里按 ecommerceQa 标记动态收集生成节点的图片子节点。
- QA 输出格式：逐图「通过/有问题 + 问题项 + 修订建议」，报告为新生成的文本节点。
- 生成结果放置用 `findFreePosition` 避让现有节点；「整理排版」用 `tidyNodePositions`（组节点带子节点移动）。
- 生成顺序：图片节点并行 → 全部结束后自动跑 QA（`runGenerationTargets`），QA 永远最后。

## 隔离规则（红线）

- 电商画布是独立入口 `/projects/:id`（`pages/canvas/ecommerce-project.tsx` 传 `canvasKind="ecommerce"`）。
- 列表页同样分离：`/canvas`（`pages/canvas/index.tsx`）只管理普通画布并隐藏电商项目；`/projects`（`pages/projects/index.tsx`）是复刻列表页后独立二开的电商项目列表，新建电商项目弹窗也在这里，两者不共享列表组件。
- 副本组件在 `components/canvas/ecommerce/`：canvas-toolbar（整理排版/生成套图/AI 改词按钮）、canvas-selection-toolbar（批量生成）、canvas-config-node-panel（节点标题显示）、prompt-chat-panel、generate-panel。
- 共享文件（project.tsx、canvas-node-generation.ts 等）中的电商增强必须 `isEcommerce` 或元数据标记门控，原画布分支保持基线表达式；纯新增导出（工具函数、i18n 文案）可不门控。
- 原画布 `/canvas/:id` 的界面与行为不得因电商需求改变。

## 模型与数据

- 方案/改词/QA 用文本能力模型（弹窗「AI 方案模型」可覆盖默认）；生图用 image 能力模型（弹窗「生成模型」可覆盖）。
- 方案数据持久化在 `EcommerceProductBrief`（category/audience/sellingPoints/scene/referenceImages/realismPreset），画布「商品资料」节点是方案的完整版展示与编辑入口。

## 路线图（按此延伸，勿另起炉灶）

场景模板 → 商品身份锁定提示词 → 平台尺寸适配导出 → 服装模特图模板 → QA 自动化（已做基础版）→ 套图蓝图（按类目 3/6/9 张）→ 批量 SKU 复用。调研依据见 `docs/content/docs/overview/ecommerce-workflows.zh-CN.mdx`。

## 文档同步

每次改动更新 `CHANGELOG.md` Unreleased 与 `docs/content/docs/progress/pending-test.mdx`；重大路线调整先更新本 skill。

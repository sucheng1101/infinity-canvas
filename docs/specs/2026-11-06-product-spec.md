# 产品 Spec 与任务计划：从生图到视频到短剧

> 依据：[开源调研](./2026-11-05-oss-research.md)、[路线图](./2026-11-05-product-roadmap.md)、仓库现状（本文第 2 节为代码核实结果）。
> 状态：草案，等待边界值确认后执行。

## 1. 目标与范围

**总目标**：一套「对话 + 画布」的创作工作台，用模板承载行业经验，让客户沿「生图 → 视频 → 短剧」逐步深入，而不是换上三套产品。

**本期范围**：v0.21 至 v0.25 五个版本，覆盖导航、词库、异步任务中心、资产/材料库、分镜与短剧 MVP、导出。

**不在范围**：本地推理引擎、多语言超过中英、DAG/CPM 调度、模型数量扩张、团队协作与权限矩阵（单账号为主，团队留到 v0.26+）。

## 2. 现状基线（已核实）

| 能力 | 现状 | 缺口 |
| --- | --- | --- |
| 生成 | Relay 同步执行（`executeGenerationTask` 直接调 `Relay.Execute`），失败/取消/超时已有额度回退 | 无队列、无 worker、无任务中心 UI |
| 数据 | `generation_tasks`、`usage_logs`、`quota_*`、`published_models`、`channels` | 无资产表、无场景/镜头表 |
| 前端 | `/workbench`（图/视频）、`/canvas`、`/projects`（电商）、`/prompts`、`/model-plaza`、`/assets` | 无资产库、无分镜视图、无任务中心 |
| 词库 | 远程来源聚合 + 分类标签，缓存 IndexedDB | 无结构化字段、无参数绑定、无私有收藏 |
| 素材 | `text / image / video` 三类，存 IndexedDB | 无音频、无标签、无授权、无云端 |
| 导航 | 6 个平级入口（画布/工作台/项目/提示词/模型广场/资产） | 无创作路径分组 |

## 3. 分期与依赖

```
v0.21a 导航重排 ──┐
v0.21b 词库地基 ──┤
                  ├─→ v0.23 资产库/材料库 ─→ v0.24 分镜与短剧 ─→ v0.25 导出与模板市场
v0.22 任务中心 ───┘
```

- v0.22（任务中心）可与 v0.21 并行，但**必须先于 v0.24**。
- v0.23 依赖 v0.22（资产图生成走异步任务）与对象存储。
- v0.24 依赖 v0.23（分镜引用资产）。

## 4. v0.21a 导航重排（1 天）

### 4.1 目标

让新用户一眼知道从哪开始；把「模型广场」从一级导航降级为能力。

### 4.2 信息架构

| 一级 | 路由 | 说明 |
| --- | --- | --- |
| 创作 | `/workbench` | 图片 / 视频两个 tab，保留现有实现 |
| 画布 | `/canvas`（默认）、`/projects` | 「画布」页内两个 tab：自由画布 / 电商套图；未来加「短剧分镜」 |
| 素材 | `/assets` | tab：资产库（v0.23 起）/ 媒体库 / 模板（v0.25） |
| 灵感 | `/prompts` | tab：词库（v0.21b）/ 社区（现有远程来源） |
| 我的 | 下拉 | 额度与充值（`/assets/wallet`）、渠道（`/channels`）、用量（`/assets/usage`）、设置（`/assets/settings`） |

`/model-plaza` 保留路由但从导航移除；模型选择统一走已有的 `ModelPicker`。

### 4.3 首页三卡片

`/app` 改为三张入口卡：**做商品图**（跳 `/projects?create=1`）、**做短视频**（跳 `/workbench?mode=video`）、**从空白画布开始**（跳 `/canvas`）。

### 4.4 任务

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| T1.1 | `navigation-tools.ts` 改为分组结构（key/label/icon/items/mode） | `web/src/constant/navigation-tools.ts` | 类型导出，现有引用处编译通过 |
| T1.2 | 顶栏按分组渲染，含「我的」下拉 | `web/src/components/layout/app-top-nav.tsx` | 六个入口归入五项；当前路由高亮正确 |
| T1.3 | `/canvas` 页加 tab（自由画布 / 电商套图） | `web/src/pages/canvas/index.tsx` | 两 tab 各自列表正确、可进入 |
| T1.4 | 首页三卡片 | `web/src/pages/home/index.tsx` | 三卡片点击分别进入对应入口 |
| T1.5 | 导航 i18n（中英） | `i18n/locales/*.ts` | 切英文后导航无中文残留 |

## 5. v0.21b 词库地基（3–4 天）

### 5.1 数据模型

```ts
export type PromptFacetCategory = "subject" | "style" | "lighting" | "camera" | "composition" | "color" | "material" | "mood" | "negative";

export type PromptFacet = {
  id: string;
  category: PromptFacetCategory;
  zh: string;                 // 中文名
  en: string;                 // 提交给模型的英文
  aliases: string[];          // 搜索别名
  params?: Record<string, unknown>;  // 绑定参数，如 { camera: "push-in" }
  verifiedModels?: string[];  // 已验证可用的模型（上游模型名）
  exampleUrl?: string;
  source?: "official" | "community" | "user";
};
```

### 5.2 种子数据

- 官方 100 条：风格 30、镜头 20、光线 15、构图 12、色彩 10、材质 8、氛围 5。
- 存 `web/src/data/prompt-facets/*.json`，按 category 分文件，构建期打包。
- 字段校验放在一个 `validateFacets()` 单测里，防止缺 `en`。

### 5.3 交互

| 动作 | 行为 |
| --- | --- |
| 搜索 | 按 zh/en/aliases 模糊匹配，支持分类筛选 |
| 插入 | 插入到「当前激活的提示词目标」；无目标时复制到剪贴板并提示 |
| 收藏 | 写入 `usePromptFacetStore.collect(id)`，本地持久化（localforage） |
| 反向沉淀 | 画布节点菜单「存为词条」（v0.23 起，需云存储） |

「当前激活的提示词目标」用一个轻量总线：`usePromptTargetStore`，画布节点编辑器与工作台输入框在聚焦时注册 `{ type, insert(text) }`，失焦注销。

### 5.4 任务

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| T2.1 | `PromptFacet` 类型与校验 | `web/src/types/prompt-facet.ts`、`lib/prompt-facet.ts` | 单测覆盖字段校验与搜索匹配 |
| T2.2 | 100 条种子 JSON | `web/src/data/prompt-facets/` | `validateFacets` 全过，数量达标 |
| T2.3 | 词库页（`/prompts` 词库 tab） | `pages/prompts/index.tsx` + `components/prompts/prompt-facet-panel.tsx` | 分类、搜索、收藏、插入可用 |
| T2.4 | 插入总线与画布接入 | `stores/use-prompt-target-store.ts`、画布 composer | 画布节点聚焦时插入命中该节点 |
| T2.5 | 中文界面选词、提交英文 | 插入逻辑 | 实际提交提示词为 `en` |
| T2.6 | i18n | `i18n/locales/*.ts` | 中英一致 |

## 6. v0.22 异步任务中心（1.5–2 周）

### 6.1 目标

把「同步执行」改成「入队 + worker 消费」，为分镜批量生成（20+ 任务）打底，同时改善现有批量生成。

### 6.2 服务端设计

- 复用 `generation_tasks` 表：`queued → running → succeeded / failed / cancelled`（状态机已有）。
- 新增 `internal/queue`：
  - `Enqueue(taskID)`：把任务标记为 queued 并推入内存通道。
  - worker 池：`N` 个 goroutine，从通道取任务，调用现有 `Relay.Execute`。
  - 启动时扫描 `status = queued` 的旧任务重新入队（重启恢复）。
- 接口调整：
  - `POST /generation-tasks/:id/execute` 改为**入队并立即返回 202 + task**（不再阻塞）。
  - 前端轮询 `GET /generation-tasks/:id` 或新增 `GET /generation-tasks?status=queued,running` 列表接口。
- 计费：入队前完成 quote 与预扣（现有逻辑），失败/取消按现有路径回退。

### 6.3 边界值（**待你确认**）

| 项 | 建议值 | 失败行为 |
| --- | --- | --- |
| worker 并发数 | 2（`RELAY_WORKERS` 可配） | 超出排队，不影响上游限流 |
| 单用户并发上限 | 1 | 第二个任务排队，前端显示「排队中」 |
| 队列上限 | 200 条 | 入队返回 429 `QUEUE_FULL`，不预扣 |
| 任务超时 | 沿用 `RELAY_TIMEOUT`（5 分钟） | 判失败并回退额度（现有 reaper） |
| 排队超时 | 10 分钟 | 出队前判失败并回退，避免无限排队 |

### 6.4 前端设计

- 右下角「任务中心」悬浮按钮 + 抽屉：排队/生成中/成功/失败分组，显示耗时与节点标题。
- 支持取消、重试（复用 `handleRetryNode` 路径）、点击跳回画布节点。
- 批量生成改为入队，进度提示改为读任务状态。

### 6.5 任务

| 编号 | 任务 | 文件 | 验收 |
| --- | --- | --- | --- |
| T3.1 | `internal/queue`（入队、worker、恢复） | `server/internal/queue/queue.go` | 单测：入队→执行→完成；重启恢复 queued |
| T3.2 | `execute` 改异步 + 队列满返回 429 | `httpapi/router.go` | 接口返回 202；第 201 条返回 429 且不预扣 |
| T3.3 | 任务列表接口 | `httpapi/router.go`、`generation/service.go` | 按用户过滤、分页 |
| T3.4 | 任务中心抽屉 | `components/canvas/task-center.tsx` | 状态实时更新，取消/重试生效 |
| T3.5 | 批量生成接入队列 | `pages/canvas/hooks/use-canvas-generation.ts` | 20 个任务按并发上限排队，进度准确 |
| T3.6 | 服务端测试 | `server/internal/queue/*_test.go` | `go test` 通过 |

## 7. v0.23 资产库与材料库云化（2–3 周）

### 7.1 数据模型

```sql
-- assets: 角色/场景/道具/媒体
CREATE TABLE assets (
  id           CHAR(36) PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  kind         VARCHAR(16) NOT NULL,   -- character / scene / prop / media
  name         VARCHAR(128) NOT NULL,
  prompt       TEXT,
  tags_json    JSON,
  license      VARCHAR(16) NOT NULL DEFAULT 'own',
  created_at   DATETIME(3) NOT NULL,
  updated_at   DATETIME(3) NOT NULL,
  INDEX idx_assets_user_kind (user_id, kind)
);

CREATE TABLE asset_images (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  asset_id    CHAR(36) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  url         VARCHAR(1024) NOT NULL,
  width       INT, height INT, bytes BIGINT,
  INDEX idx_asset_images_asset (asset_id)
);
```

### 7.2 存储

- S3 兼容：本地 MinIO、生产 R2/S3，配置 `S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY`。
- **上传走后端中转**（简单、可控），单文件上限沿用现有图片上限；后续可换预签名直传。
- 图片仍可保留一份缩略图在浏览器缓存，原图存对象存储。

### 7.3 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/assets?kind=&q=&page=` | 列表/搜索 |
| POST | `/api/v1/assets` | 创建（含图片 storage key） |
| PUT | `/api/v1/assets/:id` | 改名/标签/描述 |
| DELETE | `/api/v1/assets/:id` | 删除（引用中需二次确认） |
| POST | `/api/v1/assets/:id/images` | 追加参考图（三视图） |

### 7.4 前端

- `/assets` 新增「资产库」tab：按 kind 分组卡片、搜索、标签筛选。
- 画布节点右键/菜单：**存为资产**（图片节点 → 角色/场景/道具卡）。
- 资产卡可拖入画布 → 生成参考图节点；生成面板自动带上 `assetRefs`。
- 三视图生成：选中角色卡 → 一次生成正面/侧面/背面（走任务队列，3 个任务）。

### 7.5 任务

| 编号 | 任务 | 验收 |
| --- | --- | --- |
| T4.1 | 迁移 `assets`/`asset_images` | 迁移可重复执行，`go test` 通过 |
| T4.2 | 对象存储客户端与配置 | 本地 MinIO 上传/读取成功 |
| T4.3 | 资产 CRUD 接口 | 归属校验、分页、搜索 |
| T4.4 | 资产库页面 | 列表/筛选/详情/删除确认 |
| T4.5 | 画布「存为资产」与拖入 | 存→拖→生成参考图链路通 |
| T4.6 | 三视图生成 | 一次生成 3 张并落到资产卡 |

## 8. v0.24 分镜与短剧 MVP（3–4 周）

### 8.1 数据模型

```sql
CREATE TABLE scenes (
  id CHAR(36) PRIMARY KEY, project_id VARCHAR(64) NOT NULL, user_id BIGINT NOT NULL,
  name VARCHAR(128), summary TEXT, order_index INT, created_at DATETIME(3)
);

CREATE TABLE shots (
  id CHAR(36) PRIMARY KEY, scene_id CHAR(36) NOT NULL, user_id BIGINT NOT NULL,
  order_index INT NOT NULL,
  duration_sec INT NOT NULL DEFAULT 4,
  shot_size VARCHAR(16),      -- 特写/近景/中景/全景
  camera VARCHAR(16),         -- 固定/推/拉/摇/移/环绕
  dialogue TEXT,
  prompt TEXT,
  asset_refs_json JSON,       -- 引用的 assets.id
  image_node_id VARCHAR(64),  -- 对应的画布节点
  video_node_id VARCHAR(64),
  INDEX idx_shots_scene (scene_id, order_index)
);
```

画布节点通过 `metadata.shotId` 反向关联；**画布是编辑入口，分镜侧栏是结构化视图**。

### 8.2 流程

1. 用户粘贴剧本（或已有分集）→ 文本模型输出 `shots[]` JSON → 落库并生成画布节点（每镜一个配置节点 + 参考资产）。
2. 多宫格分镜：一次生成 6/9 宫格图 → 用已有切图能力切成子节点，逐镜替换。
3. 逐镜出图 → 逐镜出视频（走任务队列）。
4. 配音与字幕：TTS 节点（新增音频生成）→ 生成 SRT 草稿。

### 8.3 任务

| 编号 | 任务 | 验收 |
| --- | --- | --- |
| T5.1 | `scenes`/`shots` 迁移与接口 | 增删改查、排序、归属校验 |
| T5.2 | 剧本→分镜解析（JSON schema + 容错） | 3 个真实剧本样本解析成功 |
| T5.3 | 分镜侧栏视图 | 场次→镜头列表、拖拽排序、字段编辑 |
| T5.4 | 多宫格分镜生成 + 切图 | 6 宫格一次生成并落成 6 个子节点 |
| T5.5 | 逐镜批量生成 | 20 镜头排队执行，进度与失败可重试 |
| T5.6 | 配音（TTS）与 SRT 草稿 | 逐镜生成音频并输出字幕文件 |

## 9. v0.25 导出与模板市场（2 周）

### 9.1 导出包

```
project-<id>.zip
├── images/        # 分镜图、参考图
├── videos/        # 每个镜头的视频片段
├── audio/         # 配音与 BGM
├── subtitles.srt  # 字幕
└── manifest.json  # 镜头顺序、时长、提示词、资产引用
```

`manifest.json` 是后续剪映草稿的基础，先做稳定格式。

### 9.2 剪映草稿（可选）

需逆向草稿 JSON 结构，独立工作量，建议放到 v0.26 或外包验证。

### 9.3 模板市场

- 模板 = 画布快照 + 资产引用 + 变量占位（如 `{{商品名}}`）。
- 支持保存为模板、从模板实例化、导入/导出 JSON。

## 10. 横切关注点

| 主题 | 要求 |
| --- | --- |
| 计费 | 入队前报价与预扣；失败/取消/超时回退；导出与 TTS 计入用量 |
| 权限 | 所有资产/分镜/任务按 `user_id` 过滤；管理端只读聚合 |
| 合规 | 资产 `license` 字段；上传协议；短剧内容审核留到 v0.26 |
| i18n | 新增页面同步中英；词条本身自带 `zh/en` |
| 测试 | 队列、资产 CRUD、分镜解析必须有 Go 单测；前端关键工具函数有 vitest/bun test |
| 文档 | 每版更新 `CHANGELOG` 与 `pending-test` |

## 11. 排期

| 版本 | 内容 | 预估 | 累计 |
| --- | --- | --- | --- |
| v0.21a | 导航重排 | 1 天 | 1 天 |
| v0.21b | 词库地基（100 条） | 3–4 天 | 5 天 |
| v0.22 | 任务中心 | 1.5–2 周 | ~3 周 |
| v0.23 | 资产库 + 材料库云化 | 2–3 周 | ~6 周 |
| v0.24 | 分镜与短剧 MVP | 3–4 周 | ~10 周 |
| v0.25 | 导出与模板市场 | 2 周 | ~12 周 |

## 12. 待确认

1. 第 6.3 节的五个边界值（worker 并发 2、单用户并发 1、队列 200、排队超时 10 分钟）。
2. 对象存储选型：自建 MinIO / Cloudflare R2 / 其他 S3。
3. 是否接受「先不做剪映草稿，只做工程包导出」。
4. v0.21a 导航改造是否允许调整现有 `/projects` 与 `/canvas` 的入口关系（仅列表页 tab 化，不改页面内部）。

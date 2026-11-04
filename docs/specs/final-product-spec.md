# 无限画布 · 最终版产品与技术 Spec（v1.0）

> 本文替代此前的 `2026-11-05-product-roadmap.md`、`2026-11-05-oss-research.md`、`2026-11-06-product-spec.md`、`2026-11-06-storage-design.md` 中的规划部分；那几份保留作为背景与调研记录。
> 写作依据：仓库代码核实 + GitHub 开源项目调研（见 `2026-11-05-oss-research.md`）。
> 状态：可执行。所有待决问题已收束到第 12 节「已决策」。

## 1. 定位与目标

**一句话**：一套「对话 + 画布」的 AI 视觉创作工作台，用模板承载行业经验，让客户沿「生图 → 视频 → 短剧」逐步深入，而不是换成三套产品。

**为什么这样定位**（调研结论）：

- 一站式创作台（即梦/可灵类）出片快，但改不动细节、拼不了长流程。
- 专业工作流（ComfyUI 类）能拼长流程，但普通用户学不会。
- 我们的位置：**对话降低门槛，画布保留可控性，模板承载行业经验**；再加上开源项目没有的完整商业闭环（账户/积分/订阅/渠道计费）。

**不可动摇的两条体验底线**：

1. 任何模板，从「点一下」到「看到第一张成品」不超过 3 步。
2. 生成出来的每个节点都能单独重生成、改词、换模型，不锁死。

## 2. 已完成基线（代码核实）

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 五项导航（创作/画布/素材/灵感/我的） | 已完成 | 提交 `316eb72` |
| 画布 / 电商列表 tab 互通、首页三张快捷卡 | 已完成 | `316eb72` |
| 托管生成（图片/文本/视频/音频）、积分与订阅、渠道与路由 | 已完成 | 现有 `server/internal/relay`、`generation`、`billing` |
| 异步清理与保留期、上游重试、订单过期 | 已完成 | `b314a74`、`e45bd64` |
| 存储抽象（local 驱动 + S3 预留）、管理员存储配置后端、用户存储选择后端 | 后端完成，**前端待做** | `17d344b`、`da7b774`、`0d820f2` |
| 电商套图工作流（对话生成方案 → 画布模板 → 三图 → QA） | 已完成 | `.agents/skills/ecommerce-canvas-flow/SKILL.md` |
| 中英双语（登录/注册/找回/验证/重置/渠道/模型广场/充值） | 已完成 | `02680d8`…`1f6f6d1` |

## 3. 最终信息架构

### 3.1 一级导航（五项）

| 一级 | 路由 | 页面职责 |
| --- | --- | --- |
| 创作 | `/workbench?mode=image\|video` | 快速出片：单张/批量生图、文生视频、图生视频、历史 |
| 画布 | `/canvas`、`/canvas/:id`、`/projects`、`/projects/:id` | 自由画布与电商套图两个 tab；未来加「短剧分镜」tab |
| 素材 | `/assets`（tab：资产库 / 媒体库 / 模板） | 角色·场景·道具资产、图片视频音频媒体、工作流模板 |
| 灵感 | `/prompts`（tab：词库 / 社区） | 结构化词典 + 远程来源案例 |
| 我的 | 下拉：`/assets/wallet`、`/assets/usage`、`/channels`、`/assets/settings`、`/admin` | 额度充值、用量、自定义渠道、设置、管理后台 |

`/model-plaza` 保留路由但不在导航；模型选择统一走 `ModelPicker`。

### 3.2 关键页面状态

- `/app` 首页：三张快捷卡（做商品图 / 做短视频 / 空白画布）。
- `/assets` 在 v0.23 前只有「媒体库」；资产库与模板随版本上线。

## 4. 领域模型（最终态）

| 实体 | 关键字段 | 说明 | 状态 |
| --- | --- | --- | --- |
| `User` | `storage_provider_id` | 用户自选存储 | 已建字段 |
| `StorageProvider` | `driver(local\|s3)`、`enabled`、`is_default`、`endpoint`、`bucket`、`access_key_cipher`、`secret_key_cipher`、`public_base`、`use_path_style`、`local_dir` | 管理员配置的存储目标 | 已建表 |
| `Asset`（v0.23） | `kind(character\|scene\|prop\|media)`、`name`、`prompt`、`tags_json`、`license` | 跨项目复用的资产 | 待建 |
| `AssetImage`（v0.23） | `asset_id`、`storage_key`、`url`、`width`、`height`、`bytes` | 资产参考图（三视图） | 待建 |
| `Scene`（v0.24） | `project_id`、`name`、`order_index` | 场次 | 待建 |
| `Shot`（v0.24） | `scene_id`、`order_index`、`duration_sec`、`shot_size`、`camera`、`dialogue`、`prompt`、`asset_refs_json`、`image_node_id`、`video_node_id` | 分镜最小单位 | 待建 |
| `PromptFacet`（v0.21b） | `category`、`zh`、`en`、`aliases`、`params`、`verified_models` | 结构化词条 | 待建（前端数据 + 本地收藏） |
| `GenerationTask` | 既有字段 + `queued` 状态流转 | 任务中心复用 | 已存在 |

**画布与结构化数据的关系**：画布节点是编辑入口，`Shot`/`Asset` 是数据真身；节点通过 `metadata.shotId` / `metadata.assetRefs` 关联。**不做纯表单流水线**。

## 5. 存储子系统（最终态）

### 5.1 分层

```
管理员在后台配置 providers（可多个）
        ↓ 启用其中的若干
用户在「我的 → 设置」里选择自己用哪个（空 = 跟随管理员默认）
        ↓
上传时解析：用户选择 → 管理员默认 → 第一个启用项
        ↓
驱动：local（本机磁盘，经 /api/v1/files 提供）｜ s3（任意兼容服务）
```

### 5.2 驱动与配置

- 代码只依赖 S3 协议，供应商只是 Endpoint 不同：MinIO、Cloudflare R2、阿里云 OSS、腾讯云 COS、Backblaze B2、AWS S3。
- 环境变量只作为**首次启动的默认值**（`STORAGE_DRIVER`、`STORAGE_LOCAL_DIR`、`STORAGE_PUBLIC_BASE`、`S3_*`）；真正的开关在后台 providers 表。
- 首次启动自动创建「本地存储」，`enabled=true`、`is_default=true`，保证开箱可用。

### 5.3 接口（已实现）

| 方法 | 路径 | 角色 |
| --- | --- | --- |
| GET | `/api/v1/admin/storage-providers` | 管理员：列表（凭证掩码） |
| POST | `/api/v1/admin/storage-providers` | 管理员：新建 |
| PUT | `/api/v1/admin/storage-providers/:id` | 管理员：编辑（留空保留原密钥） |
| DELETE | `/api/v1/admin/storage-providers/:id` | 管理员：删除（禁止删最后一个启用项） |
| POST | `/api/v1/admin/storage-providers/:id/test` | 管理员：连接测试 |
| GET | `/api/v1/account/storage-options` | 用户：可选存储 + 当前项 |
| PUT | `/api/v1/account/storage` | 用户：选择（空=默认） |

### 5.4 安全

- AK/SK 用 AES-GCM（`internal/cipherbox`）加密入库，接口只返回 `mini********dmin` 形式掩码。
- 对象 key 由服务端生成（UUID），拒绝 `..` 穿越；桶默认私有。

### 5.5 待做

- 管理后台「存储配置」面板；用户端存储选择 UI。
- `GET /api/v1/files/*key` 只读路由（local 驱动）。
- 上传接口 + 大小上限 + 孤儿文件清理（与日志保留同一 worker）。

## 6. 内容供给

### 6.1 词库（v0.21b）

- 类型：`PromptFacetCategory = subject | style | lighting | camera | composition | color | material | mood | negative`。
- 字段：`id / category / zh / en / aliases / params / verifiedModels / exampleUrl / source`。
- 首批 100 条：风格 30、镜头 20、光线 15、构图 12、色彩 10、材质 8、氛围 5。
- 交互三动作：**搜索 → 插入到当前节点 → 收藏到私有库**；中文界面选词、提交英文。
- 插入总线 `usePromptTargetStore`：画布节点编辑器与工作台输入框聚焦时注册插入目标。

### 6.2 材料库（v0.23）

- 两类：**资产**（角色/场景/道具，带参考图与 license）与**媒体**（图/视频/音频，带标签与集合）。
- 与画布打通：资产卡拖入画布 = 参考图节点；「存为资产」从节点反向沉淀。
- 三视图生成：一次 3 个任务走任务队列。

### 6.3 模板（v0.25）

- 模板 = 画布快照 + 资产引用 + 变量占位（`{{商品名}}`）。
- 支持保存、实例化、导入导出 JSON。

## 7. 创作链路

```
工作台（快速出片）
   └─ 需要多步 → 画布（自由编排）
        └─ 电商/短剧 → 模板化画布（对话生成方案 → 结构化节点 → 批量生成 → QA/合成）
             └─ 交付：工程包（图/视频/音频/SRT/manifest）→ 剪映草稿
```

**短剧流程（v0.24）**：粘贴剧本 → 文本模型输出 `shots[]` JSON → 落库并建节点 → 多宫格分镜（6/9 格切成子节点）→ 逐镜出图 → 逐镜出视频 → TTS 配音 + SRT。

## 8. 任务中心与计费（v0.22）

- `queued → running → succeeded / failed / cancelled`，复用 `generation_tasks`。
- 服务端 `internal/queue`：入队 + worker 池 + 启动扫描 `queued` 恢复。
- `POST /generation-tasks/:id/execute` 改为入队后立即返回 202。
- 计费：入队前 quote + 预扣；失败/取消/超时按现有路径回退。

## 9. 接口总表（规划）

| 域 | 接口 | 版本 |
| --- | --- | --- |
| 存储 | 见 5.3 | 已实现（后端） |
| 资产 | `GET/POST /assets`、`PUT/DELETE /assets/:id`、`POST /assets/:id/images` | v0.23 |
| 分镜 | `GET/POST /projects/:id/scenes`、`/scenes/:id/shots`、`PUT /shots/:id` | v0.24 |
| 任务 | `GET /generation-tasks?status=queued,running` | v0.22 |
| 词库 | 纯前端数据 + 本地收藏（不建服务端表） | v0.21b |
| 导出 | `POST /projects/:id/export`（返回 zip / 草稿包） | v0.25 |

## 10. 边界值与参数（已确认）

| 项 | 取值 | 失败行为 |
| --- | --- | --- |
| 上游响应上限 | 32MB | 判失败并回退额度 |
| 上游重试 | 429/5xx 重试 1 次，退避 500ms | 仍失败判失败 |
| worker 并发 | 2（`RELAY_WORKERS` 可配） | 排队 |
| 单用户并发 | 1 | 排队，前端显示「排队中」 |
| 队列上限 | 200 | 429 `QUEUE_FULL`，不预扣 |
| 任务超时 / 排队超时 | 5 分钟 / 10 分钟 | 判失败并回退 |
| 优雅退出 | 60s（`SHUTDOWN_TIMEOUT`） | 超时强退，reaper 回收 |
| 日志保留 | 180 天（`LOG_RETENTION`） | 每小时分批清理 |
| 单文件上传上限 | 沿用现有图片上限（v0.23 定具体值） | 拒绝并提示 |

## 11. 分期与验收

| 版本 | 内容 | 验收标准 | 状态 |
| --- | --- | --- | --- |
| v0.21a | 五项导航、列表 tab、首页三卡 | 六入口归五项；tab 互通；三卡可达 | **已完成** |
| v0.21b | 词库地基 | 100 条词条通过校验；搜索/收藏/插入命中当前节点 | **已完成**（页面 + 收藏 + 插入总线） |
| v0.22 | 任务中心 | 20 个任务按并发排队；取消/重试生效；重启可恢复 | **代码完成**；异步链路待接真实渠道验证 |
| v0.23 | 存储前端 + 资产库 + 媒体库云化 | 管理员可配 3 种存储并测试；用户可切换；资产可跨项目复用 | **已完成**（存储前后端 + 资产库增删改传 + 节点存为资产）；资产拖入画布未做 |
| v0.24 | 分镜与短剧 MVP | 剧本→分镜→逐镜生成→配音字幕全链路可跑 | **代码完成**（后端 + 面板 + 剧本生成 + 导出）；多宫格分镜、配音字幕未做 |
| v0.25 | 工程包导出 + 剪映草稿 + 模板市场 | 导出包可被外部工具消费；模板可实例化 | 工程包与剪映草稿骨架**已做**；模板市场未做；剪映导入未验证 |

**验证边界（必须知道）**：本机 `/api/v1/models` 为空，没有可用模型渠道，因此所有依赖模型生成的链路（入队执行到终态、剧本拆镜、逐镜出图、配音）只做到代码完整 + 类型/构建通过，**没有真机跑通**。

## 12. 已决策（不再讨论）

| 项 | 结论 |
| --- | --- |
| 载体形态 | 无限画布为壳，结构化数据在侧栏/分镜视图 |
| 存储 | 管理员后台配置 + 用户自选；代码只依赖 S3 协议；本地 MinIO 优先 |
| 剪映草稿 | 一并做，排在工程包导出之后 |
| 导航 | 五项分组；`/model-plaza` 降级 |
| 语言 | 中英双语，不追多语言 |
| 调度 | 不做 DAG/CPM 并行调度 |
| 本地推理 | 不做（与托管 SaaS 冲突） |
| 模型数量 | 不堆数量，重点「选对模型 + 成本可控」 |

## 13. 非目标与风险

**非目标**：团队协作与权限矩阵（v0.26+）、内容审核体系（v0.26+）、多租户计费拆分、移动端原生应用。

**风险**：

1. **同质化**：Toonflow（20.4k★）已占「画布 + 短剧」，ArcReel（6.1k★）占「流水线 + 剪映导出」。差异必须落在「电商与短剧共用资产」与「商业闭环」。
2. **成本**：分镜批量生成会放大视频成本，任务中心必须配预算上限与失败即停。
3. **合规**：资产 license、肖像权、素材版权要先于功能上线。
4. **维护面**：每版只开一个新面，避免同时推进插件、Agent、分镜、素材。

## 14. 文档索引

| 文档 | 用途 |
| --- | --- |
| `2026-11-05-oss-research.md` | 开源调研原始记录（含星数与 README 依据） |
| `2026-11-05-product-roadmap.md` | 早期路线图（已被本文取代） |
| `2026-11-06-product-spec.md` | v0.21–v0.25 详细任务拆解 |
| `2026-11-06-storage-design.md` | 存储驱动与供应商切换细节 |
| `docs/content/docs/progress/todo.mdx` | 功能待办 |
| `docs/content/docs/progress/pending-test.mdx` | 待手测项 |

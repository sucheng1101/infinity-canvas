# 优化编排 Spec：性能、健壮性与工程化分波治理

## 1. 目标与范围

把 2026-11-03 审计出的问题按「文件所有权互不重叠」拆成若干工作包（WP），用总控台 + 子智能体并行推进，每个 WP 独立验收、独立提交，任何时刻都能停在可运行状态。

范围包含：

- 画布前端正确性：删除项目二次确认、项目恢复失败兜底、图片解码失败兜底、媒体导入失败提示。
- 首屏与构建：路由懒加载、构建分包、全局样式与重型依赖收敛。
- 服务端安全与资金：取消任务归属校验顺序、上游响应大小上限、过期订单后台清理与补单、优雅退出。
- 工程化门禁：CI 跑 typecheck/test/build、删重复 lockfile、清理无用依赖、补 ErrorBoundary。
- 服务端性能：模型目录同步移出读路径、后台列表分页下推、连接池配置。
- 画布渲染性能：mention 引用增量计算、恢复 `React.memo` 命中、框选与滚轮 rAF 合并、侧栏虚拟化、保存节流。
- 结构收敛：电商副本组件合并、`project.tsx` 单组件拆分、三份 `request` 封装合并。

不包含：

- 不改变原画布已有交互与视觉基线（电商增强仍以 `isEcommerce` 门控）。
- 不做上游合并、不发版本、不动官方行为语义。
- 不在本 Spec 内做新功能（工作室模板、Skill、Agent SDK 适配另立 Spec）。
- 不引入新状态管理库、不重写存储层。

## 2. 编排协议

### 2.1 角色

- **总控台（本会话）**：拆包、派活、串行提交、维护进度看板、执行验收门禁、对外汇报。
- **子智能体（独立会话）**：只做被分配的 WP，只改声明范围内的文件，返回「改动清单 + 验收自检 + 风险」。
- **用户**：最终手测与发布决策；需要时可要求总控台跑构建与测试。

### 2.2 文件所有权（硬约束）

1. 同一文件在同一波次只能有一个 WP 持有；跨波次复用必须等上一波提交完成。
2. `web/src/pages/canvas/project.tsx` 是全仓库最热文件，**同一时刻只允许一个 WP 持有**，且必须单独成波次。
3. 子智能体不得修改未列入自己 WP 的文件；发现必须改时，停下来报告总控台，由总控台决定改派。
4. 子智能体不执行 `git` 命令；提交统一由总控台按 WP 逐个提交，提交信息形如 `perf(canvas): memoize mention references`。

### 2.3 验收门禁（每个 WP 必过）

- 改动范围检查：`git diff --stat` 只包含 WP 声明文件，超出即驳回。
- 行为基线检查：原画布路径与电商路径的差异只出现在声明的 `isEcommerce` 分支内。
- 自检清单：WP 声明的「必测点」逐条给出结论（未测要写明原因）。
- 编译与测试：默认由用户执行；若用户授权，总控台在合并波次后统一跑 `bun run typecheck`、`bun test`、`go build ./...`。

### 2.4 冲突与回滚

- 每波结束打一个本地提交；任一 WP 验收不通过则 `git checkout -- <files>` 回滚该 WP，其余 WP 不受影响。
- 子智能体之间出现同一文件写入冲突时，总控台把后到的 WP 顺延到下一波，不并行合并。

## 3. 波次与工作包

### Wave 1：正确性与地基（并行，互不重叠）

| WP | 目标 | 文件所有权 | 必测点 |
| --- | --- | --- | --- |
| WP1 | 画布健壮性：删除项目二次确认、恢复失败兜底页、图片解码 `onerror`、媒体导入失败提示 | `web/src/pages/canvas/project.tsx`、`web/src/lib/canvas/canvas-image-data.ts`、`web/src/components/canvas/canvas-top-bar.tsx` | 删除项目弹确认；坏图不再卡死裁切/切分/放大；导入损坏文件有错误提示 |
| WP2 | 首屏：路由懒加载 + `manualChunks` + streamdown 样式收敛 + `ProConfigProvider` 降级 + workbench 按 mode 懒加载 | `web/src/router.tsx`、`web/src/main.tsx`、`web/vite.config.ts`、`web/src/components/layout/app-providers.tsx`、`web/src/pages/workbench/index.tsx`、`web/index.html` | 各路由首屏可打开；切页有 fallback；admin/画布不再进首包 |
| WP3 | 服务端：取消任务先校验归属、`io.LimitReader` 上限、过期订单 sweep 与过期后支付补单、信号优雅退出 | `server/internal/httpapi/router.go`、`server/internal/payment/service.go`、`server/internal/relay/service.go`、`server/main.go` | 取消他人任务返回 404 且不中断上游；超大响应报错而非 OOM；到期订单自动 expired；Ctrl+C 平滑退出 |
| WP4 | 门禁：新增 CI（typecheck + test + build）、删 `web/package-lock.json`、清理无用依赖、`tsconfig` 纳入测试目录 | `.github/workflows/ci.yml`、`web/package.json`、`web/tsconfig.json`、`web/package-lock.json` | CI 在 PR 上触发；`bun install` 正常；无残留依赖引用 |
| WP5 | 文档：更新 `CHANGELOG.md`、`pending-test.mdx`、本 Spec 的进度看板 | `CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx`、本文件 | 每条 WP 在 pending-test 有对应待测项 |

### Wave 2：画布性能与体验（WP6 独占 project.tsx，其余并行）

| WP | 目标 | 文件所有权 | 必测点 |
| --- | --- | --- | --- |
| WP6 | 画布渲染：mention 引用增量缓存、修 `React.memo` 命中、框选与滚轮 rAF 合并、保存节流到 800ms | `web/src/pages/canvas/project.tsx`、`web/src/components/canvas/infinite-canvas.tsx`、`web/src/stores/canvas/use-canvas-store.ts` | 200 节点画布拖拽不卡；框选不抖；流式输出不重渲染全树 |
| WP7 | 服务端性能：模型目录同步移出读路径、后台订单/用量列表分页下推、SQL 聚合替代内存统计、连接池配置 | `server/internal/modelcatalog/service.go`、`server/internal/admin/service.go`、`server/internal/store/store.go` | `/models` 读不再写库；订单列表分页正确且 total 准确 |
| WP8 | 前端数据层：抽 `services/api/http.ts` 合并三份 `request`、react-query 接管 billing/model-plaza/channels/assets、积分统一 `queryKey` | `web/src/services/api/http.ts`（新增）、`web/src/services/api/auth.ts`、`hosted.ts`、`admin.ts`、`web/src/pages/billing/**`、`web/src/pages/model-plaza/**`、`web/src/pages/channels/**`、`web/src/pages/assets/**` | 各页加载/错误态一致；积分只请求一次；后台保存后只刷新受影响的 key |
| WP9 | 副本收敛：电商工具栏/选择栏/配置面板三个副本合并为带 variant 的单一实现，并补回 `data-canvas-bottom-toolbar` | `web/src/components/canvas/canvas-toolbar.tsx`、`canvas-selection-toolbar.tsx`、`canvas-config-node-panel.tsx`、`web/src/components/canvas/ecommerce/*` | 通用画布与电商画布视觉与行为不变；电商自动聚焦不再顶到工具栏下 |

### Wave 3：结构收敛与测试

| WP | 目标 | 文件所有权 | 必测点 |
| --- | --- | --- | --- |
| WP10 | `project.tsx` 拆分：生成链路抽 hook、对话框状态收 reducer，单函数不再超过 200 行 | `web/src/pages/canvas/project.tsx`、`web/src/pages/canvas/hooks/**` | 生成/重试/取消/批量全链路回归 |
| WP11 | 后台与用户页 i18n + 巨型 JSX 拆分 + 死代码清理 | `web/src/pages/admin/**`、`web/src/pages/auth/**`、`web/src/pages/projects/**`、`web/src/components/ui/**`、`web/src/hooks/use-version-check.ts`、`web/src/components/layout/version-release-modal.tsx` | 切英文后无中文残留（后台可暂缓）；删掉的组件无引用 |
| WP12 | 测试补齐：quota 幂等、支付回调重放、`request` 封装、计费 units 单一实现 | `server/internal/quota/**`、`server/internal/payment/**`、`server/internal/billing/**`（新增）、`web/tests/**` | `bun test` 与 `go test ./...` 全绿 |

## 4. 进度看板

总控台在每次派活、每次收回结果时更新下表，并同步写入本文件（第 4 节为唯一事实来源）。

| WP | 波次 | 状态 | 负责人 | 提交 | 备注 |
| --- | --- | --- | --- | --- | --- |
| WP1 | 1 | 已验收 | 总控台（子智能体失败后接管） | `b6fdba5` | 删除确认、恢复兜底页、图片解码 onerror、导入失败提示；型检通过 |
| WP2 | 1 | 已验收 | 总控台 | `03f16ee` | 20 个路由改懒加载、manualChunks 拆 codemirror/markdown/antd、ErrorBoundary、移除 ProConfigProvider、workbench 按 mode 懒加载；型检 + 构建通过 |
| WP3 | 1 | 已验收 | 总控台 | `e45bd64` | 取消先校验归属、上游 32MB 上限、订单批量过期与迟到支付入账、优雅退出（默认 60s，`SHUTDOWN_TIMEOUT` 可覆盖）；`go build`/`go vet`/`go test` 通过，取消他人任务实测 404 |
| WP4 | 1 | 已验收 | 总控台 | `3c964e4` | 新增 CI（typecheck + test + build）；删双 lockfile 与依赖清理因本地无 bun、无法同步 lock，暂缓 |
| WP5 | 1 | 已验收 | 总控台 | `75e2459` | 看板、CHANGELOG 与 pending-test 同步 |
| WP6 | 2 | 部分完成 | 总控台 | `b69f491`、`96c9308` | 框选与滚轮 rAF 合并、持久化 400→800ms、侧栏元素列表分片渲染；`memo` 命中仍依赖拆分 |
| S3 | 2 | 已验收 | 总控台 | `6985d06`、`0b26126` | 本地存储读写失败提示、画布数据损坏兜底、电商工具栏补回 `data-canvas-bottom-toolbar`、导入中提示与「已保存」提示 |
| WP7 | 2 | 已验收 | 总控台 | `b490ace`、`52abb5f` | `/models` 读路径不再写库；订单列表改 `UNION ALL` 分页并修掉后台 `page/pageSize` 解析错位 |
| WP8 | 3 | 部分完成 | 总控台 | `5724e36`、`fc78bf5` | `services/api/http.ts` 合并三份 `request`；`useQuota` 统一积分查询（顶栏 + 数据看板）；其余页面仍为手写 `load()` |
| WP12 | 3–4 | 部分完成 | 总控台 | `b314a74`、`911465d` | 上游重试 1 次、报价过期与日志保留清理；新增计费单位与重试策略单测；计费单位尚未收敛为单一实现 |
| 体验补全 | 4 | 部分完成 | 总控台 | `8623519`、`0b26126`、`462d375`、`dead181` | 批量并发 3 + 进度 + 取消、导入中提示、保存提示、空状态引导、失败项一键重试 |
| WP11 | 4 | 部分完成 | 总控台 | `2e8c59f` | 删除 4 个无引用组件（-480 行）；页面级 i18n 覆盖未做 |
| WP10-A | 5 | 已验收 | 总控台 | `a2939f6` | 生成链路（`handleGenerateNode` + `handleRetryNode`，共 614 行）抽到 `useCanvasGeneration`，页面从 3800 行降到 2977 行，节点状态常量抽到 `lib/canvas/node-status.ts`；`tsc` + 生产构建 + 热更新通过 |
| WP12 | 6 | 已验收 | 总控台 | `3f6b6cd`、`97f5654` | 计费单位收敛到 `internal/billing`（三份 `billingUnit` + 两份 `billingUnits` 合并，语义与回退值保持不变），新增 `billing` 单测；测试目录纳入 typecheck（用本地 `bun:test` 类型声明替代 `@types/bun`，避免动 lockfile） |
| WP6 收尾 | 6 | 已验收 | 总控台 | `b5f8b05` | 小地图按 100ms 节流重绘，拖拽时不再每帧重建全部方块 |
| WP11 i18n | 7–8 | 进行中 | 总控台 | `02680d8`、`3953c6e`、`324c57f`、`d6ca206` | 登录、注册、找回密码、邮箱验证、重置密码五个页面完成中英双语（`authPage.*`，登录路径中文硬编码清零）；自定义渠道页、模型广场完成（`channelsPage.*`、`modelPlaza.*`）；仅剩 `billing` 页面 |

状态取值：`待启动` → `进行中` → `待验收` → `已验收` / `阻塞`。

### 4.2 剩余执行计划（全部可执行项）

按顺序推进，每项独立提交并过门禁。`WP9` 已于 `6039023` 完成（三份电商副本合并，-692 行）。

| # | 项 | 关键改动 | 门禁 |
| --- | --- | --- | --- |
| 1 | WP10-A 生成链路抽离 | `project.tsx` 的 `handleGenerateNode`（约 440 行）拆到 `pages/canvas/hooks/use-canvas-generation.ts`，四个 capability 分支各自成函数 | tsc + 手动回归生成/重试/取消 |
| 2 | WP10-B 派生计算缓存 | mention 引用按内容签名缓存、`renderNodePanel` 去掉多余依赖恢复 `React.memo` 命中 | tsc + 200 节点画布拖拽体感 |
| 3 | WP10-C 列表与小地图 | 侧栏元素列表虚拟化、缩略图按 `storageKey` 粒度订阅、小地图改 canvas 位图 | tsc + 大画布滚动 |
| 4 | WP7b 订单分页 | 充值单 + 运营单 `UNION ALL` + `COUNT(*)`，商品名与用户名批量预取 | go build/vet/test |
| 5 | WP8-A http 收敛 | 新增 `services/api/http.ts`，合并 auth/hosted/admin 三份 `request` 与错误映射 | tsc |
| 6 | WP8-B react-query 接管 | billing / model-plaza / channels / assets / admin 改 `useQuery`，积分统一 `queryKey: ["quota"]` | tsc + 页面手测 |
| 7 | WP12-A 计费单位统一 | 抽出 `internal/billing` 单一 `units()`，relay/generation/subscription/migrate 复用之 | go test |
| 8 | WP12-B 关键测试 | quota 幂等与 payment 回调重放（sqlmock 或接口级）、`units()` 表驱动测试 | go test |
| 9 | 服务端清理任务 | 过期 quote 置 expired；审计与用量日志按保留期分批删除 | go build/vet |
| 10 | 上游重试 | 同优先级渠道 429/5xx 重试 1 次（退避 500ms），仍失败才判失败 | go test |
| 11 | 批量生成队列 | 并发上限 3，其余排队，带进度与「停止全部」 | tsc + 手测 20 张套图 |
| 12 | 画布体验补全 | 上传中占位节点、保存状态提示（保存中/已保存/失败重试）、失败项批量重试、画布空状态引导 | tsc + 手测 |
| 13 | WP11 收尾 | auth/billing/channels/model-plaza i18n、删除死代码（`dia-text-reveal`、`version-release-modal` 等）、日期格式化统一、图片 `alt`/`loading` | tsc + 切英文检查 |
| 14 | 依赖与类型检查 | 尝试安装 `@types/bun` 让 `tests/` 进入 typecheck；评估依赖清理与双 lockfile（需 bun） | tsc / bun |

### 4.3 本计划采用的行为边界值

| 项 | 取值 | 失败处理 |
| --- | --- | --- |
| 批量生成并发 | 3（其余排队，队列长度不设上限） | 单张失败不影响队列，失败项可一键重试 |
| 上游重试 | 429 / 5xx 重试 1 次，退避 500ms | 仍失败则按现有逻辑判失败并回退预占额度 |
| 审计与用量日志保留 | 180 天，每天清理一次，分批删除 | 清理失败只记日志，不影响请求 |
| 过期报价 | 复用 `QUOTE_TTL`（默认 5 分钟），每分钟批量置 expired | 仅影响状态标记，不删行 |

### 4.4 被环境阻塞

- 依赖清理与双 lockfile 合并：本机只有 npm、没有 bun，无法同步 `bun.lock`。需要一次 `bun install` 才能安全删除 `package-lock.json` 与未使用依赖。
- `tests/` 纳入 typecheck：需要 `@types/bun`；若加依赖需同步 lockfile，同样受上一条阻塞。

### 4.1 已确认的边界值

| 项 | 取值 | 失败处理 |
| --- | --- | --- |
| 上游响应读取上限 | 32MB（`maxUpstreamResponseBytes`） | 返回 `UPSTREAM_RESPONSE_TOO_LARGE`，任务判失败并回退预占额度，不截断 |
| 优雅退出等待 | 默认 60s，环境变量 `SHUTDOWN_TIMEOUT` 可覆盖 | 超时强退；未完成任务由 reaper 超时回收并返额度 |
| 订单批量过期 | 复用现有 `PAYMENT_ORDER_TTL`（默认 30 分钟），每分钟扫描一次 | 过期后到账的合法回调仍入账，重复入账由订单状态与事件唯一键拦住 |

## 5. 风险

- **并行写同一文件**：靠第 2.2 节的所有权硬约束与「project.tsx 独占」规避；总控台在派活前先 `git status` 确认工作区干净。
- **子智能体越界修改**：门禁第一项即 `git diff --stat` 比对声明文件，越界直接回滚。
- **行为回归无自动化保护**：Wave 1 补上 CI 之前没有回归网，因此 Wave 1 的 WP 全部要求「必测点」人工确认，且不修改共享画布基线表达式。
- **`.env.local` 与本地数据库**：所有 WP 禁止读取或修改 `server/.env.local`、`%LOCALAPPDATA%\InfiniteCanvas`。

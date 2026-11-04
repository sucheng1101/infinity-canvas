# 项目运行链路（架构总览）

![运行链路总览](/images/architecture.svg)

> 依据当前代码核实（`server/main.go`、`server/internal/httpapi/router.go`、`server/internal/relay/service.go`、`web/src/main.tsx`、`web/src/pages/canvas/`）。Mermaid 图在支持的环境可直接渲染；上图源文件为 `docs/public/images/architecture.svg`。

## 1. 部署拓扑

```mermaid
flowchart LR
    subgraph Browser["浏览器（React SPA，:1010）"]
        UI["页面 / 画布 / 工作台"]
        IDB[("IndexedDB<br/>画布项目·资产·图片")]
        LS[("localStorage<br/>主题·偏好")]
    end

    subgraph Server["账户服务（Go/Gin，:1011）"]
        API["HTTP API /api/v1"]
        AUTH["会话鉴权"]
        RELAY["Relay 生成编排"]
        QUOTA["积分/订阅"]
        STORE["存储注册表"]
    end

    MySQL[("MySQL 3306<br/>业务数据")]
    Redis[("Redis 6379<br/>限流计数")]
    Upstream["上游模型 API<br/>OpenAI 兼容 / Gemini / 视频"]
    Object[("对象存储<br/>本地磁盘 或 S3 兼容")]

    UI -->|"fetch /api/v1（dev 由 Vite 代理）"| API
    UI --- IDB
    UI --- LS
    API --> AUTH
    API --> RELAY
    API --> QUOTA
    API --> STORE
    AUTH --> MySQL
    RELAY --> MySQL
    QUOTA --> MySQL
    API -->|"限流 / 登录失败计数"| Redis
    RELAY -->|"HTTP"| Upstream
    STORE --> Object
```

**本地模式特例**：`VITE_APP_MODE=local`（或 `web/.env.test`）时，浏览器**直连**用户自己配置的 OpenAI 兼容接口，API Key 存在浏览器，不经过账户服务；托管模式才走 `/api/v1` 的 Relay。

## 2. 后端启动链路

```mermaid
sequenceDiagram
    participant M as main()
    participant C as config
    participant S as store
    participant DB as MySQL
    participant R as Redis
    participant API as httpapi
    M->>C: Load() + Validate()
    M->>S: Open(cfg)
    S->>DB: gorm.Open（连接池）
    S->>DB: migrate()（按版本前滚）
    S->>R: Ping
    M->>S: LoadEmailSettings(db)
    M->>M: auth.EnsureAdmin（首次建管理员）
    M->>M: modelcatalog.SyncFromChannels（启动同步目录）
    M->>M: signal.NotifyContext（SIGINT/SIGTERM）
    M->>M: 启动 3 个后台 worker
    M->>M: storage.NewRegistry（无 provider 时种子"本地存储"）
    M->>API: NewRouter(cfg, db, redis, mailer, registry)
    M->>API: ListenAndServe(:1011)
    M->>M: <-ctx.Done() → Server.Shutdown(60s)
```

**后台 worker（全部随主 ctx 退出）**：

| worker | 周期 | 作用 |
| --- | --- | --- |
| `reapStaleTasks` | `RELAY_TIMEOUT + 1min` | 回收进程中断遗留的 queued/running 任务并退额度 |
| `expireOrders` | 1 分钟 | 批量把超时未支付订单置 `expired` |
| `maintainData` | 1 小时 | 过期报价置 `expired`；按保留期分批清理审计/访问/用量日志 |

## 3. 前端启动链路

```mermaid
flowchart TD
    HTML["index.html"] --> MAIN["main.tsx"]
    MAIN --> EB["ErrorBoundary"]
    EB --> AP["AppProviders"]
    AP --> CP["antd ConfigProvider（主题/语言）"]
    CP --> APP["antd App（message/modal 上下文）"]
    APP --> QC["QueryClientProvider（react-query）"]
    QC --> CRI["ClientRootInit"]
    CRI --> SCHED["提示词来源调度"]
    CRI --> PARAM["解析 URL baseUrl / apiKey"]
    CRI --> ERRH["监听本地存储错误并提示"]
    CRI --> RP["RouterProvider"]
    RP --> LAZY["按路由懒加载页面"]
```

路由均为 `lazy()` 加载，`Suspense` 兜底；`/canvas/:id`、`/projects/:id` 进入画布壳。

## 4. 鉴权链路

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant A as /api/v1
    participant MW as requireAuth
    participant H as handler
    B->>A: 请求（Cookie: ic_session）
    A->>MW: 中间件
    MW->>MW: 读 Cookie → 查会话（MySQL）
    alt 有效
        MW->>H: 注入 currentUser
        H-->>B: 200 + data
    else 过期/无效
        MW-->>B: 401
    end
```

限流与登录失败计数走 Redis（`allowGuard`、`loginAllowed`），会话本身存 MySQL。

## 5. 托管生成链路（核心）

```mermaid
sequenceDiagram
    participant UI as 画布/工作台
    participant API as httpapi
    participant PR as pricing
    participant GN as generation
    participant QT as quota
    participant RL as relay
    participant UP as 上游模型

    UI->>API: POST /quotes（模型+参数）
    API->>PR: Quote() → 校验模型与定价
    PR-->>UI: quoteId + 金额 + 过期时间

    UI->>API: POST /generation-tasks（quoteId+幂等键）
    API->>GN: Create()（幂等检查、事务内预扣）
    GN->>QT: Reserve（积分/订阅额度）
    GN-->>UI: task（queued）

    UI->>API: POST /generation-tasks/:id/execute
    API->>RL: Execute(ctx, userID, taskID)
    RL->>RL: findTaskRoute（模型→路由→渠道→专用 Key）
    RL->>RL: Start(task) queued→running
    RL->>UP: HTTP 请求（429/5xx 重试 1 次）
    alt 成功
        UP-->>RL: 响应（≤32MB）
        RL->>GN: Complete(settled)
        RL->>RL: finishUsage（写入 usage_logs）
        RL-->>UI: succeeded
    else 失败/超时/取消
        RL->>GN: Fail / Cancel
        GN->>QT: Release（回退预扣）
        RL-->>UI: failed / cancelled
    end
```

**关键约束**：取消前先按 `userID` 校验归属；上游 Key 只在 Relay 内部解密使用，不序列化、不写日志。

## 6. 存储解析链路

```mermaid
flowchart LR
    UP["上传请求"] --> REG["storage.Registry"]
    REG --> Q1{"用户自选 provider？"}
    Q1 -->|是且启用| P1["该 provider"]
    Q1 -->|否| Q2{"管理员默认 provider？"}
    Q2 -->|是| P2["默认 provider"]
    Q2 -->|否| P3["第一个启用项"]
    P1 --> DRV{"driver"}
    P2 --> DRV
    P3 --> DRV
    DRV -->|local| L["写磁盘<br/>URL = /api/v1/files/key"]
    DRV -->|s3| S3["PutObject<br/>URL = publicBase 或 endpoint/bucket"]
```

管理员在后台配置 providers（AK/SK 加密入库、只回掩码），用户在「我的 → 设置」里自选；没有启用项时上传直接报错，不会静默落到未知位置。

## 7. 数据落点

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 账户、会话、积分、订单、生成任务、用量日志 | MySQL | 迁移按版本前滚（`store/migrate.go`） |
| 限流计数、登录失败计数 | Redis | 窗口过期自动清理 |
| 画布项目、画布内图片、生成历史 | 浏览器 IndexedDB（localforage） | 目前不云同步 |
| 主题、语言、侧栏宽度等 | localStorage | 只放极小配置 |
| 资产/媒体原文件（v0.23 起） | 对象存储 | 本地磁盘或 S3 兼容 |

## 8. 一次生成的数据流（简版）

```
用户拖入参考图 → 生成配置节点（提示词）→ 点击生成
  → 前端组装 generationConfig（模型/质量/尺寸/参考图）
  → 托管模式：/quotes → /generation-tasks → /execute → Relay → 上游
  → 返回 dataURL/URL → 存 IndexedDB → 写入节点 metadata → 画布渲染
  → usage_logs 记录模型、耗时、质量、积分
```

## 9. 故障与降级点

| 环节 | 故障表现 | 现有处理 |
| --- | --- | --- |
| 上游 429/5xx | 请求失败 | 重试 1 次，仍失败判失败并退额度 |
| 上游超大响应 | 内存风险 | 32MB 上限，超限判失败 |
| 进程被杀 | 任务停在 running | 重启后 reaper 超时回收退额度 |
| Redis 不可用 | 限流失效 | 现有实现为放行（fail-open），需注意 |
| 本地存储写满 | 上传失败 | 前端提示「本地存储写入失败」 |
| 迁移失败 | 服务起不来 | `migrate` 返回错误即 `log.Fatal` |

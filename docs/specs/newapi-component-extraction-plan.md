# New API 组件提取计划

> 状态：设计阶段  
> 关联 Spec：[无限画布独立运营平台 Spec](./independent-operation-platform-spec.md)
> 来源基线：[New API 来源基线记录](./newapi-source-baseline.md)

## 1. 提取原则

1. 以现有 New API 仓库为来源，优先采用已经运行过的账户、支付、额度、渠道和 Relay 组件。
2. 不把整个 New API 仓库未经筛选地复制进无限画布。
3. 每次提取记录来源仓库、来源提交、文件清单、依赖闭包和目标提交。
4. 保留 AGPL-3.0、项目来源、版权和网络交互源码提供要求。
5. 生产数据库固定使用 MySQL；去除与商业版无关的数据库兼容分支前，先确认不会破坏提取组件。
6. New API 原管理前端不整体迁移；普通用户端和管理端均使用当前项目 React + Ant Design。
7. 画布项目、节点、素材和生成结果继续使用浏览器本地存储，不提取云端项目资产模块。
8. 先完成依赖闭包和最小可启动后端，再逐步迁移业务，不在第一轮同时改造所有 Relay。

## 2. 目标后端结构

保持 New API 已验证的目录分层，避免无收益的结构重写：

```text
main.go
config/ setting/ common/ constant/ types/
router/ controller/ middleware/ service/ model/
relay/ dto/ migrations/ deploy/
```

无限画布专属模块使用明确前缀或独立文件：

```text
controller/canvas_*.go
service/canvas_*.go
model/canvas_*.go
relay/canvas_*.go
```

## 3. 组件分层清单

### 3.1 直接采用并优先验证

| 能力 | New API 主要来源 | 处理方式 |
| --- | --- | --- |
| 配置和启动 | `main.go`, `config/`, `setting/` | 保持结构，改为画布应用配置 |
| 数据库 | `model/main.go`, `model/setup.go` | MySQL 主路径，保留迁移顺序 |
| 用户与角色 | `model/user.go`, `controller/user.go`, `middleware/` | 直接采用后裁剪用户字段 |
| 会话与登录 | `service/`, `controller/`, JWT/Session 相关代码 | 直接采用，隐藏 API Token 入口 |
| 密码找回 | 用户认证与通知相关服务 | 直接采用，接入画布登录页 |
| 额度与钱包 | `model/wallet.go`, `service/quota.go`, `service/billing.go` | 直接采用核心事务和流水规则 |
| 充值订单 | `model/topup.go`, `controller/topup.go` | 沿用订单状态和幂等字段 |
| 支付配置 | `setting/payment_*.go`, `setting/operation_setting/payment_setting.go` | 保持配置方式 |
| 易支付 | `controller/topup.go`, `controller/subscription_payment_epay.go`, 相关 service | 直接采用充值回调核心 |
| Stripe / Creem / Waffo | 对应 `controller/*topup*`, `service/*` 和 `setting/payment_*` | 按管理员启用项提取 |
| 渠道与模型 | `model/channel.go`, `model/ability.go`, `service/channel*.go` | 直接采用后增加画布发布字段 |
| Relay | `relay/`, `relay/channel/` | 先迁移图片、文本、视频、音频实际需要的适配器 |
| 用量与结算 | `relay/helper/price.go`, `service/task_billing.go`, `service/tiered_settle.go` | 保持预消费、实际结算和失败返还 |
| 日志 | `model/log.go`, `service/log_info_generate.go` | 增加画布任务关联元数据 |
| Redis 与限流 | `common/`, `middleware/` | 直接采用并按运营接口重新划分限流键 |
| 管理权限 | `middleware/admin.go`, 管理 controller | 直接采用，页面重做 |

### 3.2 采用后画布化改造

| 能力 | 改造目标 |
| --- | --- |
| 用户可见模型 | 返回管理员发布的模型名称、能力、参数和销售价格摘要；隐藏供应商、渠道、成本和密钥 |
| 普通用户 Token | 取消 Token 管理和开发者控制台；生成请求只接受登录会话 |
| 计费入口 | 从 API 调用语义改成“报价 -> 预占 -> 生成任务 -> 结算” |
| 图片接口 | 将当前画布请求参数映射到统一 Relay，并返回可写入本地画布的结果 |
| 视频接口 | 保留异步任务 ID、轮询、超时、失败返还和刷新恢复 |
| 文本与音频 | 保留流式或任务结果处理，但用户端不暴露上游协议 |
| 管理后台 | 使用当前项目 Ant Design，复用服务端接口和权限，不迁移 Semi Design 页面 |
| 错误处理 | 用户错误与管理员诊断字段分开存储和返回 |
| 生成日志 | 增加用户、画布临时任务 ID、能力、模型、价格版本和本地结果引用 |

### 3.3 第一阶段暂不迁移

- New API 原管理前端和开发者控制台；
- 普通用户 API Token、分组 Token 和 API 文档；
- 订阅、返佣、签到、抽奖和与画布无关的运营模块；
- 画布云端项目、云端素材库和对象存储；
- 当前画布没有使用的上游适配器；
- 与运营产品无关的 Playground、调试页面和批量 API 分发功能。

## 3.4 基于当前来源仓库的首批文件映射

以下路径已在 `D:\Desktop\object\newapi` 基线工作区核对，后续提取以最小依赖闭包为准：

| 目标能力 | 首批来源文件/目录 | 备注 |
| --- | --- | --- |
| 用户、角色与会话 | `model/user.go`, `model/user_cache.go`, `controller/user*.go`, `middleware/user*.go`, `middleware/admin*.go` | 删除普通用户 Token 管理入口，保留登录会话 |
| 邀请机制 | `model/user.go`, `controller/user.go`, `common/constants.go`, `model/option.go`, `router/api-router.go`, `service/funding_source.go`, `service/billing_session.go`, `docs/superpowers/specs/2026-09-20-promotion-lottery-wallet-dashboard-design.md` | 复用邀请码、邀请关系和奖励配置；改造成验证完成事件幂等入账，并接入风险审计；抽取时暂不迁移抽奖和订阅模块 |
| 钱包与额度 | `model/wallet.go`, `model/wallet_migration.go`, `service/quota.go`, `model/log.go` | 结合本项目不可变流水与预占状态机重新裁剪 |
| 充值订单 | `model/topup.go`, `controller/topup.go` | 只保留充值、订单查询和退款所需路径 |
| 支付配置与回调 | `setting/payment_*.go`, `setting/operation_setting/payment_setting.go`, `service/epay.go`, `controller/topup_*.go`, `controller/subscription_payment_*.go` | 按首期启用渠道建立依赖闭包 |
| 模型、渠道与能力 | `model/channel.go`, `model/ability.go`, `model/pricing*.go`, `service/channel*.go`, `router/api-router.go` | 增加发布名称和用户公开字段，不返回内部路由 |
| Relay | `relay/`, `relay/channel/` 下首期实际能力适配器 | 先按图片、文本、视频、音频需求筛选，不整目录搬迁 |
| 限流与缓存 | `common/`, `middleware/` 中 Redis、限流和分布式锁相关文件 | 认证、支付、报价、生成分别使用独立键空间 |

来源仓库当前在 Relay、任务、钱包、资金来源和任务计费文件中存在并行未提交改动，完整快照见来源基线记录。提取默认以基线提交 `b64d461d795fcca8923377a3727fe105b9f2cdb5` 为准，工作区改动单独评估。

## 4. 提取顺序

### M0：来源冻结

- 记录 New API 来源仓库路径和基线提交；
- 检查当前工作区是否有用户改动；
- 生成组件来源清单；
- 复制许可证和归属文件；
- 确认 AGPL 发布和网络交互源码提供方式。

### M1：最小可启动后端

- 配置、日志、MySQL、Redis、基础路由；
- 管理员初始化；
- 用户注册、登录、退出、当前用户；
- 管理员权限中间件；
- 健康检查和错误码。

### M2：钱包与支付

- 用户额度；
- 不可变额度流水；
- 邀请码、邀请关系、管理员奖励配置与奖励流水；
- 充值订单；
- New API 支付配置读取；
- 首个管理员已启用支付渠道；
- 回调验签、幂等入账和订单查询。

### M3：模型与渠道

- 管理员模型和渠道配置；
- 用户可见模型发布列表；
- 渠道密钥服务端保存与脱敏；
- 图片、文本、视频、音频四类适配器首期同时接入；
- 模型健康检查和失败切换。

### M4：画布生成接入

- 服务端报价；
- 登录会话鉴权；
- 额度预占；
- 生成任务；
- Relay 请求；
- 实际结算和失败返还；
- 前端结果写回本地画布。

### M5：管理后台

- 用户与额度；
- 模型发布与价格；
- 渠道与健康；
- 充值订单与支付；
- 消费日志和异常任务；
- 管理员审计。

## 5. 每个组件的迁移记录格式

```text
组件：
来源仓库：D:\Desktop\object\newapi
来源提交：COMMIT
来源文件：
依赖闭包：
目标文件：
许可证/归属处理：
直接采用 / 画布化改造 / 暂不迁移：
删除的用户端能力：
数据库表：
接口变化：
验证命令：
回滚方式：
```

## 6. 进入代码前置条件

- 本计划评审通过；
- New API 基线提交确定；
- 当前无限画布工作区改动已记录；
- MySQL 数据库名、字符集、时区和连接方式确定；
- Redis 是否必选及部署方式确定；
- 邮件服务配置来源确定；
- 首期支付渠道确定为 New API 中的哪些已支持渠道；
- 第一阶段 Relay 能力清单确定；
- AGPL 来源与发布说明位置确定。

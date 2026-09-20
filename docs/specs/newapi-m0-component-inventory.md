# New API M0 组件与依赖闭包清单

> 状态：M0 执行中  
> 来源提交：`b64d461d795fcca8923377a3727fe105b9f2cdb5`  
> 来源仓库：`D:\Desktop\object\newapi`

## 1. 冻结规则

- 所有来源内容使用 `git show <commit>:<path>` 从基线提交读取，不从当前脏工作区直接复制。
- 每个组件分批进入目标仓库，每批记录来源文件、目标文件、依赖闭包、删除能力和目标提交。
- 保留 New API 的 AGPL-3.0 许可证、项目来源、版权归属、Go 模块标识和受保护项目信息。
- 前端 Semi Design 页面不迁移；只提取后端接口和业务规则，页面使用当前 React + Ant Design 重做。
- 生产仅验收 MySQL；提取初期保留必要 GORM 结构，数据库兼容分支在依赖闭包稳定后再评估裁剪。

## 2. M1 身份与基础设施

| 组件 | 基线来源 | 依赖闭包 | 处理方式 |
| --- | --- | --- | --- |
| 启动与配置 | `main.go`, `common/`, `setting/`, `config/` | Gin、GORM、配置注册、日志、环境变量 | 提取最小启动链，剔除与开发者平台无关的初始化 |
| MySQL | `model/main.go`, `model/setup.go` | `gorm.io/gorm`, `gorm.io/driver/mysql` | 生产固定 MySQL 8.0；建立当前项目独立迁移表 |
| Redis | `common/redis.go` 及限流相关文件 | `go-redis/redis/v8` | 保留会话、限流、幂等锁和任务状态需要的最小集合 |
| 用户与角色 | `model/user.go`, `model/user_cache.go` | `common`, `dto`, `logger`, GORM | 裁剪 GitHub/Discord/OIDC、API Token、订阅和侧边栏字段 |
| 登录与注册 | `controller/user.go`, `router/api-router.go` | Gin Session、认证中间件、邮件、验证码、限流 | 改成邮箱密码主路径和 `/api/v1/auth/*` 契约 |
| 管理权限 | `middleware/` 的用户/管理员认证文件 | 会话、用户缓存、错误返回 | 保留 `user/admin` 两种角色 |

## 3. M2 钱包、邀请与易支付

| 组件 | 基线来源 | 依赖闭包 | 处理方式 |
| --- | --- | --- | --- |
| 钱包聚合与流水 | `model/wallet.go`, `model/wallet_migration.go` | GORM 事务、用户表、幂等操作 | 采用事务与流水思想，目标模型使用统一额度账户 |
| 额度服务 | `service/quota.go` | `pkg/billingexpr`, `relay/common`, 运维/性能指标、倍率配置 | 不整文件复制；拆出预占/结算接口，计费表达式放 M3 评估 |
| 邀请码与关系 | `model/user.go`, `controller/user.go`, `common/constants.go`, `model/option.go` | 用户创建、运营配置、日志 | 提取邀请码和邀请人/被邀请人奖励配置，重做幂等奖励事务 |
| 邀请资金来源 | `service/funding_source.go`, `service/billing_session.go` | 钱包账户类型、任务计费 | 只吸收来源标记和恢复同来源的规则；来源工作区版本另行评估 |
| 充值订单 | `model/topup.go`, `controller/topup.go` | decimal、用户、钱包、支付配置 | 只保留易支付主路径和订单查询；Stripe/Creem/Waffo 首期不挂路由 |
| 易支付 | `service/epay.go`, `github.com/Calcium-Ion/go-epay` | 回调地址、支付配置、验签 | 沿用配置方式，回调落 `payment_events` 并幂等入账 |
| 支付配置 | `setting/operation_setting/payment_setting.go`, 旧支付配置加载代码 | 全局配置注册 | 保留充值档位、折扣与易支付配置；后台使用 Ant Design 重做 |

## 4. M3 模型、渠道与四类 Relay

| 组件 | 基线来源 | 依赖闭包 | 处理方式 |
| --- | --- | --- | --- |
| 渠道 | `model/channel.go`, `service/channel*.go` | `constant`, `dto`, `types`, 渠道缓存 | 保留渠道密钥、健康、优先级；用户接口全部脱敏 |
| 能力路由 | `model/ability.go` | 渠道表、GORM、缓存 | 映射到 `published_models` 与 `model_routes` |
| 定价 | `model/pricing*.go`, `setting/billing_setting`, `setting/ratio_setting`, `pkg/billingexpr` | 模型倍率、端点类型、表达式引擎 | 保留价格计算逻辑，输出不可变 `pricing_versions` 快照 |
| 图片 | `relay/channel/openai`, `relay/channel/gemini` 及画布实际渠道 | Relay DTO、文件处理、请求转换 | 首期接入 |
| 文本 | `relay/channel/openai`, `relay/channel/gemini` 及画布实际渠道 | 流式响应、Token 统计、计费 | 首期接入 |
| 视频 | `relay/channel/task`, `relay/channel/minimax`, `relay/channel/jimeng` 及画布实际渠道 | 异步任务、轮询、远端任务 ID | 首期接入，后续查询固定原渠道 |
| 音频 | `relay/channel/openai`, `relay/channel/minimax` 及画布实际渠道 | 音频 DTO、文件/流式响应、用量 | 首期接入 |

具体渠道以当前画布已配置且实际使用的模型协议为准；M3 开始前再生成适配器逐文件清单，不复制 `relay/channel` 全目录。

## 5. 首期明确排除

- New API 的 React + Semi Design 前端。
- 普通用户 API Token、分组 Token、API 文档和开发者控制台。
- OAuth、Passkey、2FA、订阅、抽奖、兑换码、返佣比例和提现。
- Playground、批量 API 分发、与画布无关的渠道适配器。
- SQLite/PostgreSQL 生产验收、云端项目、云端素材库和对象存储。
- Stripe、Creem、Waffo 路由；保留后续扩展记录但不进入首期部署。

## 6. M0 验收结果

- [x] 来源仓库、分支、基线提交和许可证已记录。
- [x] 来源工作区并行未提交改动已记录，默认不参与提取。
- [x] M1-M3 首批来源组件和高风险依赖已分类。
- [x] 首期排除能力已明确。
- [x] 将 AGPL-3.0 许可证副本与来源归属文件落入 `server/` 目录。
- [ ] 为 M1 建立逐文件复制/重写映射和目标目录。
- [x] 确认目标 Go 模块路径 `github.com/sucheng1101/infinity-canvas/server` 和后端目录 `server/`。
- [x] M1 骨架已落地：配置、迁移、身份服务、SMTP、路由和健康检查。

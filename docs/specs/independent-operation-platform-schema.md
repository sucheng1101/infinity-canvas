# 独立运营平台字段与状态机草案

> 状态：实施前草案。生产数据库固定使用 MySQL；本文件只定义在线账户、额度、支付、模型和生成任务数据，不把画布项目与素材上传到服务端。

## 1. MySQL 约定

- 字符集：`utf8mb4`，排序规则使用部署环境统一的 `utf8mb4` 排序规则。
- 时间：数据库保存 UTC `DATETIME(3)`；接口按用户或系统时区格式化。
- 金额：人民币使用 `DECIMAL(18,2)`；额度和模型计费使用最小额度单位 `BIGINT`，避免浮点误差。
- 所有业务表包含 `id`、`created_at`、`updated_at`；不可变流水只允许追加，不允许更新金额字段。
- 所有外部回调和异步请求必须有唯一幂等键。

## 2. 核心表

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `users` | `id`, `email`, `password_hash`, `status`, `email_verified_at`, `last_login_at` | 邮箱唯一；仅保存认证和运营所需资料 |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `revoked_at`, `ip`, `user_agent` | 会话令牌只存哈希；支持退出和撤销 |
| `password_reset_tokens` | `id`, `user_id`, `token_hash`, `expires_at`, `used_at` | 单次使用、过期即失效 |
| `published_models` | `id`, `capability`, `display_name`, `public_config_json`, `price_version_id`, `status`, `sort_order` | 用户只读管理员发布的模型名称和公开参数 |
| `channels` | `id`, `provider`, `base_url`, `credential_ciphertext`, `status`, `health_state` | 服务端保存供应商和密钥，用户接口禁止返回 |
| `model_routes` | `id`, `published_model_id`, `channel_id`, `upstream_model`, `priority`, `status` | 内部路由和供应商映射 |
| `pricing_versions` | `id`, `published_model_id`, `formula_json`, `currency`, `effective_at`, `retired_at` | 报价和结算使用不可变版本快照 |
| `quota_accounts` | `id`, `user_id`, `balance`, `reserved` | 统一可用额度；充值/赠送/邀请/补偿通过流水 `source` 区分 |
| `quota_ledger` | `id`, `user_id`, `delta`, `balance_after`, `source`, `business_type`, `business_id`, `idempotency_key`, `pricing_snapshot_json` | 充值、消费、释放、退款、人工调整均追加流水 |
| `topup_products` | `id`, `name`, `pay_amount`, `quota_amount`, `gift_quota`, `status`, `sort_order` | 管理员维护充值套餐 |
| `topup_orders` | `id`, `user_id`, `product_id`, `order_no`, `pay_amount`, `quota_amount`, `status`, `expires_at`, `paid_at` | 订单号唯一；状态变更受幂等保护 |
| `payment_events` | `id`, `provider`, `provider_event_id`, `order_id`, `payload_json`, `verify_state`, `processed_at` | 原始回调留痕和重复回调拦截 |
| `generation_tasks` | `id`, `user_id`, `client_task_id`, `capability`, `published_model_id`, `status`, `quote_amount`, `actual_amount`, `error_code`, `result_ref` | `client_task_id` 由本地画布生成，服务端不保存画布内容 |
| `quota_reservations` | `id`, `task_id`, `user_id`, `amount`, `status`, `expires_at`, `settled_amount` | 预占、结算、释放的状态机载体 |
| `audit_logs` | `id`, `operator_id`, `action`, `resource_type`, `resource_id`, `before_json`, `after_json`, `request_id` | 管理员、支付和额度敏感操作审计 |
| `invitation_relations` | `id`, `inviter_user_id`, `invitee_user_id`, `invite_code`, `bound_at`, `verified_at`, `status` | 注册时绑定直属邀请人；绑定后保持不可变 |
| `invitation_rewards` | `id`, `relation_id`, `beneficiary_user_id`, `reward_type`, `quota_amount`, `config_version`, `status`, `idempotency_key`, `credited_at` | 邀请人/被邀请人奖励快照与幂等入账 |
| `invitation_risk_events` | `id`, `relation_id`, `risk_type`, `evidence_json`, `status`, `reviewed_by` | 自邀、循环、同设备/IP 高频等风险审计 |
| `operation_settings` | `id`, `key`, `value`, `version`, `updated_by` | 邀请人奖励、被邀请人奖励、上限和开关等运营配置 |

## 3. 关键唯一索引

```text
users(email)
sessions(token_hash)
topup_orders(order_no)
payment_events(provider, provider_event_id)
quota_ledger(idempotency_key)
generation_tasks(user_id, client_task_id)
quota_reservations(task_id)
invitation_relations(invitee_user_id)
invitation_rewards(idempotency_key)
invitation_rewards(relation_id, reward_type)
```

## 4. 状态机

### 4.1 充值订单

```text
CREATED -> PENDING_PAYMENT -> PAID -> QUOTA_CREDITED
                         \-> EXPIRED
PAID -> REFUND_PENDING -> REFUNDED
```

支付回调先验签、写入 `payment_events`，再在同一事务内将订单置为 `PAID`、写入额度流水并标记 `QUOTA_CREDITED`。重复回调只返回已处理结果。

### 4.2 生成任务与额度

```text
QUOTED -> RESERVED -> RUNNING -> SUCCEEDED -> SETTLED
                    |          \-> FAILED -> RELEASED
                    \-> EXPIRED -> RELEASED
```

- `QUOTED` 只在报价仍有效时允许预占。
- 预占成功后才向上游发起请求。
- 成功按实际用量结算，多余预占释放；失败或超时释放未使用额度。
- 所有状态迁移以 `task_id` 和幂等键保护，管理端补偿也写入额度流水。

### 4.3 会话与找回密码

```text
REGISTERED -> EMAIL_VERIFIED -> ACTIVE -> SUSPENDED
RESET_ISSUED -> RESET_USED
RESET_ISSUED -> RESET_EXPIRED
```

### 4.4 邀请关系与奖励

```text
REGISTERED -> BOUND -> EMAIL_VERIFIED -> REWARD_PENDING -> REWARDED
                                  \-> RISK_REVIEW -> REWARDED
                                  \-> REJECTED
```

- 邀请码只绑定直属邀请人一次，禁止自邀和循环关系。
- 邀请人奖励、被邀请人奖励分别读取管理员配置，并在奖励记录中保存配置版本快照。
- 同一邀请关系的同一奖励类型只允许一次成功入账；重复验证、重复回调或重试只返回原处理结果。
- 风险规则命中时进入 `RISK_REVIEW`，奖励暂不入账，由管理员补发、作废或恢复。

## 5. 首阶段接口边界

用户端：注册、登录、退出、当前用户、发送验证邮件、申请重置、完成重置、公开模型列表、报价、创建任务、查询任务、额度和充值订单、邀请链接、邀请关系与奖励明细。

管理端：用户状态、额度调整、模型发布、渠道与路由、价格版本、充值套餐、支付配置、订单/退款、任务异常、邀请奖励配置、邀请关系、风险事件、奖励补发/作废、审计日志。

明确不提供给普通用户：API Key、Base URL、供应商、渠道、成本价、内部路由、New API Token 和开发者控制台。

## 6. 第一阶段实施清单（M0-M2）

1. 冻结 New API 来源提交并完成许可证、依赖闭包和组件映射。
2. 建立 Go 模块化单体骨架、MySQL 连接、迁移表和 Redis 适配。
3. 实现管理员初始化、邮箱注册/验证、登录、退出、找回密码和会话撤销。
4. 实现 `quota_accounts`、`quota_ledger` 及额度查询，不开放人工调整之外的写入口。
5. 提取 New API 支付配置和订单核心，先接入一个已选支付渠道，完成回调验签、幂等入账和订单查询。
6. 提取 New API 邀请码、邀请关系、邀请人/被邀请人奖励和后台配置能力，按验证完成事件幂等发放额度。
7. 在当前 React + Ant Design 中建立登录、账户额度、充值和邀请页面；登录状态变化不得清理 localforage 画布数据。
8. 完成接口级验收和数据库事务验收后，再进入模型、渠道和 Relay 提取。

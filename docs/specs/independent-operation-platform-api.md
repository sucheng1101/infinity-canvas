# 独立运营平台 API 契约草案

> 状态：实施前草案。接口只描述在线账户、额度、支付和生成任务；画布项目、节点、素材与生成文件仍由浏览器本地保存。

## 1. 统一约定

- 前缀：`/api/v1`。
- 认证：服务端会话 + HttpOnly、Secure、SameSite Cookie；生成接口不接受普通用户 API Key。
- 请求头：`X-Request-Id` 由客户端可选提供，服务端缺失时生成；写接口支持 `Idempotency-Key`。
- 成功响应：`{ "data": ..., "requestId": "..." }`。
- 失败响应：`{ "error": { "code": "...", "message": "...", "details": {} }, "requestId": "..." }`。
- 用户响应只返回可操作信息；供应商、渠道、凭据、成本、内部路由和管理员诊断字段只在管理接口返回。

## 2. 认证与账户

| 方法 | 路径 | 认证 | 请求核心字段 | 返回核心字段 |
| --- | --- | --- | --- | --- |
| POST | `/auth/register` | 公开 | `email`, `password`, `captcha` | `user`, `verificationRequired` |
| POST | `/auth/verify-email` | 公开 | `token` | `user`, `session` |
| POST | `/auth/verify-email/resend` | 公开 | `email` | 固定受理结果 |
| POST | `/auth/login` | 公开 | `email`, `password`, `captcha` | `user`, `session`, `quota` |
| POST | `/auth/logout` | 登录 | 无 | `ok` |
| GET | `/auth/me` | 登录 | 无 | `user`, `quota` |
| POST | `/auth/password/forgot` | 公开 | `email`, `captcha` | 固定成功文案 |
| POST | `/auth/password/reset` | 公开 | `token`, `newPassword` | `ok` |
| GET | `/invitation/self` | 登录 | 无 | `inviteCode`, `inviteUrl`, `rewardConfigSummary`, `counts` |
| GET | `/invitation/rewards` | 登录 | `cursor`, `limit` | `items`, `nextCursor` |
| GET | `/invitation/referrals` | 登录 | `cursor`, `limit` | 脱敏下级列表 |

密码重置完成后撤销该用户全部现有会话；邮件服务只在部署配置中保存，前端不接触 SMTP 凭据。

邀请关系在注册时绑定，奖励建议在邮箱验证成功后按当前配置版本发放。用户端只看到自己的邀请链接、脱敏下级、奖励额度和状态，不展示其他用户的余额、充值金额或消费明细。

## 3. 模型、报价与生成

| 方法 | 路径 | 认证 | 请求核心字段 | 返回核心字段 |
| --- | --- | --- | --- | --- |
| GET | `/models` | 登录 | `capability` 可选 | `id`, `displayName`, `capability`, `publicConfig`, `priceSummary` |
| POST | `/quotes` | 登录 | `modelId`, `capability`, `parameters`, `count` | `quoteId`, `amount`, `currency`, `priceVersion`, `expiresAt`, `summary` |
| POST | `/generations` | 登录 | `quoteId`, `clientTaskId`, `modelId`, `parameters`, `Idempotency-Key` | `taskId`, `status`, `reservedAmount` |
| GET | `/generations/:taskId` | 登录 | 无 | `status`, `progress`, `actualAmount`, `error`, `resultHints` |
| POST | `/generations/:taskId/cancel` | 登录 | 无 | `status`, `refundAmount` |
| GET | `/generations` | 登录 | `status`, `cursor`, `limit` | `items`, `nextCursor` |

`resultHints` 只包含让浏览器写回本地画布所需的临时结果引用或远端任务信息，不承担云端素材归档。

## 4. 额度与充值

| 方法 | 路径 | 认证 | 请求核心字段 | 返回核心字段 |
| --- | --- | --- | --- | --- |
| GET | `/account/quota` | 登录 | 无 | `balance`, `reserved`, `available`, `sourceSummary` |
| GET | `/account/ledger` | 登录 | `cursor`, `limit`, `type` | `items`, `nextCursor` |
| GET | `/recharge/products` | 登录 | 无 | `id`, `name`, `payAmount`, `quotaAmount`, `giftQuota`, `status` |
| POST | `/recharge/orders` | 登录 | `productId`, `paymentProvider`, `Idempotency-Key` | `orderId`, `orderNo`, `payAmount`, `quotaAmount`, `checkout` |
| GET | `/recharge/orders/:orderId` | 登录 | 无 | `status`, `paidAt`, `creditedAt`, `checkout` |
| POST | `/payments/:provider/webhook` | 支付签名 | 渠道原始回调 | `ack` |

支付回调验签、落原始事件、更新订单、额度入账和流水写入在同一幂等事务中完成。

## 5. 管理接口分组

```text
/api/v1/admin/users
/api/v1/admin/quota-adjustments
/api/v1/admin/models
/api/v1/admin/channels
/api/v1/admin/routes
/api/v1/admin/pricing
/api/v1/admin/recharge-products
/api/v1/admin/payment-settings
/api/v1/admin/invitation-settings
/api/v1/admin/invitation-relations
/api/v1/admin/invitation-rewards
/api/v1/admin/invitation-risk-events
/api/v1/admin/orders
/api/v1/admin/generations
/api/v1/admin/finance/summary
/api/v1/admin/audit-logs
```

管理接口使用角色权限和审计中间件。渠道凭据写入时加密，读取时只返回脱敏摘要；模型发布接口单独维护用户可见名称和公开参数。

## 6. 错误码首批集合

```text
AUTH_REQUIRED
AUTH_INVALID_CREDENTIALS
AUTH_EMAIL_NOT_VERIFIED
AUTH_SESSION_EXPIRED
AUTH_RESET_TOKEN_INVALID
QUOTA_INSUFFICIENT
QUOTE_EXPIRED
QUOTE_PARAMETER_MISMATCH
TASK_DUPLICATE
TASK_NOT_CANCELABLE
PAYMENT_ORDER_EXPIRED
PAYMENT_SIGNATURE_INVALID
PAYMENT_EVENT_DUPLICATE
MODEL_UNAVAILABLE
UPSTREAM_PENDING
UPSTREAM_FAILED
RATE_LIMITED
ADMIN_FORBIDDEN
INVITATION_CODE_INVALID
INVITATION_SELF_USE
INVITATION_ALREADY_BOUND
INVITATION_REWARD_LIMITED
INVITATION_RISK_REVIEW
```

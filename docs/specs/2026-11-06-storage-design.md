# 文件存储设计：本地优先，S3 兼容随时切换

> 状态：本地驱动已实现并测试；S3 驱动只留配置与接口，启用时补 SDK 即可。
> 代码：`server/internal/storage/`（`storage.go` 接口、`local.go` 本地驱动、`storage_test.go`）。

## 1. 为什么只做一套 S3 接口

对象存储的事实标准是 **S3 API**，国内外主流服务全部兼容，所以“选型”实际是“选一家 S3 兼容服务”：

| 类别 | 服务 | 适用场景 | 成本要点 |
| --- | --- | --- | --- |
| 自建 | **MinIO** | 本地开发、私有化交付、数据不出内网 | 只花服务器与带宽 |
| 自建 | Ceph RGW / SeaweedFS | 已有 Ceph 集群或多节点自建 | 运维成本高 |
| 国内云 | 阿里云 OSS、腾讯云 COS、华为云 OBS、七牛 Kodo | 面向国内用户，访问快 | 存储便宜，**下行流量单独计费** |
| 海外云 | **Cloudflare R2**、Backblaze B2、AWS S3 | 海外用户、无出口流量费诉求 | R2 免出口流量费，B2 单价低 |

结论：**代码只依赖 S3 协议**，换供应商只改环境变量。

## 2. 驱动与配置

```env
STORAGE_DRIVER=local            # local | s3
STORAGE_LOCAL_DIR=data/uploads  # local 驱动的根目录
STORAGE_PUBLIC_BASE=/api/v1/files

# s3 驱动（当前版本未接入，先留位）
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_USE_PATH_STYLE=true
```

各供应商的 `S3_ENDPOINT` 示例已写进 `server/.env.example`，包含 MinIO、R2、OSS、COS、B2、AWS S3。

**path-style 说明**：MinIO、R2、OSS、COS 需要用 `S3_USE_PATH_STYLE=true`；AWS S3 可用 `false`（virtual-hosted style）。

## 3. 接口

```go
type Store interface {
    Put(ctx, key string, r io.Reader, size int64, contentType string) (url string, err error)
    Open(ctx, key string) (io.ReadCloser, error)
    Delete(ctx, key string) error
    URL(key string) string
    Driver() string
    Health(ctx) error
}
```

- `Put` 返回浏览器可直接加载的 URL：本地驱动返回 `STORAGE_PUBLIC_BASE + key`；S3 驱动返回对象公网地址或 CDN 地址。
- `NormalizeKey` 拒绝空 key 与包含 `..` 的路径，避免目录穿越。

## 4. 本地驱动

- 根目录 `STORAGE_LOCAL_DIR`（默认 `data/uploads`，启动时自动创建）。
- 对象按 `key` 存为文件，例如 `asset/2026/11/<uuid>.png`。
- 读取通过未来新增的 `GET /api/v1/files/*key` 路由（v0.23 资产库时接上）。
- 已在 `server/internal/storage/storage_test.go` 覆盖：写入/读取/删除、缺失对象删除不报错、key 穿越拦截、未知驱动报错。

## 5. 切换到 S3 的三步

1. 建桶、拿 AK/SK：MinIO 控制台或云厂商 RAM 授权（**只给该桶的读写权限**，不要用主账号密钥）。
2. 配 `STORAGE_DRIVER=s3` 与五个 `S3_*` 变量，`go build` 后启动。
3. 迁移旧文件：本地 `data/uploads` 与桶内 key 一一对应，用 `mc mirror` 或一次性脚本拷贝即可，数据库里的 URL 无需变化（只换域名前缀时改 `STORAGE_PUBLIC_BASE` / CDN）。

## 6. 待办（v0.23 资产库时）

- 补 `s3.go` 驱动（引入 `aws-sdk-go-v2` 或 `minio-go`，二选一，届时单独评审依赖）。
- 新增 `GET /api/v1/files/*key` 只读路由（本地驱动用），带缓存头与内容类型。
- 上传接口与大小上限（沿用现有图片上限），失败回滚。
- 生命周期规则：孤儿文件定期清理（与日志保留任务同一个 worker 体系）。

## 7. 安全约束

- 对象 key 一律由服务端生成（UUID），**不接受客户端自定义 key**。
- 桶策略默认私有；如走 CDN 公开读，需确认 key 不可猜测。
- AK/SK 只进环境变量或 `.env.local`，不进仓库、不进日志（`secret-scan` 已覆盖）。

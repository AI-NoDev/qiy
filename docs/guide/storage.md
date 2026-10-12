# 文件存储

```ts
storage { provider local; }
```

或 `storage { provider s3; }`。

## 文件字段

```ts
field datasheet File
  @nullable
  @label("产品资料")
  @upload(both)
  @maxBytes(10485760)
  @mime("application/pdf")
  @maxFiles(1);
```

`@upload(binary|base64|both)` 控制允许的上传编码；默认是 `binary`。`@maxBytes` 的范围为 1 字节到 100 MiB，未声明时为 25 MiB。`@mime(...)` 接受一个或多个精确 MIME 或 `image/*` 形式的通配类型，未声明时为 `*/*`。当前单个 `File` 字段只允许 `@maxFiles(1)`；多文件需要后续独立的 `Files` 类型，不能通过调大该值静默模拟。

生成器把策略同时写入 Refine Upload 和服务端路由。前端只做交互预检，服务端仍会按 `resource + field` 重新检查上传模式、MIME 和大小；未知字段 fail-closed。二进制使用 `POST /api/v1/files?...&resource=...&field=...`，base64 使用 `POST /api/v1/files/base64` JSON body。两者返回受保护的 Attachment 元数据（大小、MIME、归属），并共用先鉴权再读取的下载、签名下载和删除端点。重复对象 key 返回 409，存储成功但元数据写入失败时会回滚对象。

base64 会增加约三分之一传输体积，不适合大文件；大文件优先使用 binary 或后续的直传/分片协议。当前 GraphQL DataProvider 仍通过同一 REST 文件端点上传，尚未生成 GraphQL multipart upload schema。

| Provider | 说明 |
| --- | --- |
| `local` | 本地目录，适合开发与单机部署 |
| `s3` | Bun 原生 `Bun.S3Client` 的 S3 兼容对象存储（AWS S3 / R2 / MinIO 等） |

抽象层与 Django 的文件存储类似，但生成的是前后端都可用的受保护端点，而不是公开静态 URL。

S3 使用 `Bun.S3Client`，不额外安装 AWS SDK。运行时读取 `QIY_S3_BUCKET`、`QIY_S3_REGION`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY`；临时凭据可提供 `QIY_S3_SESSION_TOKEN`。

## 清理任务

```ts
cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
```

定时扫描并清理数据库中缺失物理文件的元数据。

需要 `QIY_STORAGE_METADATA=database` 和 `DATABASE_URL`。调用 `cleanupMissingAttachmentObjects()` 默认只预演，只有显式 `{ dryRun: false }` 才删除；生成的清理 CLI 同样默认预演，使用 `--apply` 执行。上述定时任务会显式执行删除。此任务清理的是失去文件的数据库记录，不会扫描存储中缺少数据库记录的孤儿文件。

数据库元数据模式以附件表为准：移除附件记录后，下载、元数据查询和签名下载均不再从进程内缓存恢复访问。已经签发的 S3 下载 URL 在有效期内仍可能有效，删除记录不能撤销已签发 URL。

## 存储验收

在 Qiy 源码仓库中，设置上述 `QIY_S3_BUCKET`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY` 后，可运行：

```sh
bun tools/verify-s3-storage.ts
bun tools/verify-s3-storage.ts --api
```

bucket 必须已经存在。默认模式实际生成应用并验证上传、读取、签名下载和删除；`--api` 还会安装生成包依赖，验证 HTTP 上传/下载/删除、SQLite 附件元数据与访问权限。工具使用随机对象 key，结束时清理测试对象和临时工作区；建议使用独立验收 bucket。

生成包本地回归还覆盖字段缺失、MIME 拒绝、超限、binary/base64、非法 base64 和重复 key。该联合测试已在 MinIO 通过，身份由测试注入。生产部署仍需验证自己的身份服务、数据库、bucket 权限及签名 URL 策略。

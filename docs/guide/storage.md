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

`@upload(binary|base64|both)` 控制允许的上传编码；默认是 `binary`。`@maxBytes` 的范围为 1 字节到 100 MiB，未声明时为 25 MiB（对 `Files` 是**每个文件**的上限）。`@mime(...)` 接受一个或多个精确 MIME 或 `image/*` 形式的通配类型，未声明时为 `*/*`。单个 `File` 字段只允许 `@maxFiles(1)`；需要多个附件时声明 `Files` 类型，而不是调大 `File` 的 `maxFiles`。

## 多文件字段

```ts
field attachments Files
  @nullable
  @upload(base64)
  @maxBytes(5242880)
  @mime("application/pdf", "image/*")
  @maxFiles(5);
```

- `Files` 在数据库里是一个 JSON 数组列（SQLite `text(mode:"json")`、PostgreSQL `jsonb`、MySQL `json`），保存 storage key 列表；每个 key 仍然对应自己的 Attachment 元数据与对象，因此下载、签名下载、归属校验、孤儿扫描都沿用单文件逻辑。
- 上传仍然**一个文件一个请求**：前端多选后逐个上传并收集 key，写入 `Files` 字段；`@maxFiles` 由服务端 REST schema 以 `maxItems` 强制执行（超长返回 422），web 端 `Upload` 用 `maxCount` 做交互预检。
- `Files` 不能作为主键或唯一字段，默认不可排序、不可过滤；GraphQL 暴露为 `[String!]`。
- 当前没有批量原子上传：若前端在第 N 个文件失败，前 N-1 个对象已写入存储，可由 `attachments:orphans` 发现并清理无记录残留。

生成器把策略同时写入 Refine Upload 和服务端路由。前端只做交互预检，服务端仍会按 `resource + field` 重新检查上传模式、MIME 和大小；未知字段 fail-closed。二进制使用 `POST /api/v1/files?...&resource=...&field=...`，base64 使用 `POST /api/v1/files/base64` JSON body。两者返回受保护的 Attachment 元数据（大小、MIME、归属），并共用先鉴权再读取的下载、签名下载和删除端点。重复对象 key 返回 409，存储成功但元数据写入失败时会回滚对象。

base64 会增加约三分之一传输体积，不适合大文件；大文件优先使用 binary 或后续的直传/分片协议。当前 GraphQL DataProvider 仍通过同一 REST 文件端点上传，尚未生成 GraphQL multipart upload schema；`Files` 的 GraphQL 契约只是 `[String!]` 的 key 列表，不含上传语义。

| Provider | 说明 |
| --- | --- |
| `local` | 本地目录，适合开发与单机部署 |
| `s3` | Bun 原生 `Bun.S3Client` 的 S3 兼容对象存储（AWS S3 / R2 / MinIO 等） |

抽象层与 Django 的文件存储类似，但生成的是前后端都可用的受保护端点，而不是公开静态 URL。

S3 使用 `Bun.S3Client`，不额外安装 AWS SDK。运行时读取 `QIY_S3_BUCKET`、`QIY_S3_REGION`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY`；临时凭据可提供 `QIY_S3_SESSION_TOKEN`。

## 分片 / 断点续传上传

大文件可以用**会话式分片上传**（服务端按块缓冲后一次性写入 storage；local 与 s3 provider 同一套 API）：

| 端点 | 作用 |
| --- | --- |
| `POST /api/v1/files/upload-sessions` | 开一个上传会话：`{ key, resource, field, fileName?, contentType?, resourceId? }` → `{ id, receivedBytes: 0, maxBytes }`；key 已存在返回 409 |
| `GET /api/v1/files/upload-sessions/:id` | 查询已接收字节数（断点续传据此决定 offset），只能由会话创建者访问 |
| `PUT /api/v1/files/upload-sessions/:id?offset=<n>` | 追加一块原始字节；`offset` 必须等于已接收字节数（否则 409），超过字段 `@maxBytes` 返回 413 |
| `POST /api/v1/files/upload-sessions/:id/complete` | 合并分片、校验 MIME 与上传模式、写入存储并登记 attachment 元数据；空会话 400 |
| `DELETE /api/v1/files/upload-sessions/:id` | 放弃会话（不产生对象） |

边界：会话存在**进程内存**里（TTL 1 小时），多副本部署需要粘性会话或共享会话表；S3 的 **presigned PUT / 原生 multipart** 尚未实现（仍经服务端中转）；分片大小由客户端决定。

## 清理任务

```ts
cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
```

定时扫描并清理数据库中缺失物理文件的元数据。

需要 `QIY_STORAGE_METADATA=database` 和 `DATABASE_URL`。调用 `cleanupMissingAttachmentObjects()` 默认只预演，只有显式 `{ dryRun: false }` 才删除；生成的清理 CLI 同样默认预演，使用 `--apply` 执行。上述定时任务会显式执行删除。此任务清理的是失去文件的数据库记录，不会扫描存储中缺少数据库记录的孤儿文件。

## 孤儿对象扫描

反方向（存储里有对象、数据库里没有记录）由上一条命令不覆盖，需要在**另一个**方向上扫描，避免"删记录"和"删对象"互相掩盖问题：

```powershell
bun run --cwd apps/<server-alias> attachments:orphans            # 预演，只报告
bun run --cwd apps/<server-alias> attachments:orphans -- --apply # 审核后删除
```

- 同样需要 `QIY_STORAGE_METADATA=database` 与 `DATABASE_URL`；`local` 与 `s3` 两种 provider 都能枚举对象（`local` 递归遍历存储目录，`s3` 走 `ListObjectsV2`，分页上限 20×1000 个 key）。
- 输出 `{ objects, metadata, orphans, missingObjects, removed, dryRun, truncated }`：`orphans` 是无记录的存储对象，`missingObjects` 是有记录但没有对象的数量（由 `attachments:cleanup` 处理）。`--limit`（或 `QIY_ATTACHMENT_ORPHAN_LIMIT`，默认 1000，上限 10000）限制单次处理量，超出时 `truncated` 为 true 并提示再次运行。
- **默认只预演**，不删除任何对象；只有 `--apply` 才删除，且只删除 `orphans` 列表里的对象。`missingObjects` 不会被本命令删除，两条命令各管一个方向。
- 孤儿通常来自元数据写入失败、绕过 API 手工删除记录，或迁移/恢复后遗留的对象；建议定期预演并在审核后执行。删除对象**不可撤销**，S3 上还会产生删除费用。

数据库元数据模式以附件表为准：移除附件记录后，下载、元数据查询和签名下载均不再从进程内缓存恢复访问。已经签发的 S3 下载 URL 在有效期内仍可能有效，删除记录不能撤销已签发 URL。

## 存储验收

在 Qiy 源码仓库中，设置上述 `QIY_S3_BUCKET`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY` 后，可运行：

```sh
bun tools/verify-s3-storage.ts
bun tools/verify-s3-storage.ts --api
```

bucket 必须已经存在。默认模式实际生成应用并验证上传、读取、**对象枚举（`list()`）**、签名下载和删除；`--api` 还会安装生成包依赖，验证 HTTP 上传/下载/删除、SQLite 附件元数据、访问权限，以及**对真实 bucket 的孤儿扫描**（预演只报告、`--apply` 只删除无记录对象、被引用对象保留）。工具使用随机对象 key，结束时清理测试对象和临时工作区；建议使用独立验收 bucket。

不想手工准备环境时，可用自带的 S3 兼容验收（需要本机已有 `minio/minio` 镜像）：

```sh
bun tools/verify-s3-acceptance.ts
```

它会从已有镜像启动一个本地 MinIO、在数据卷里预建 bucket 目录（MinIO 会把已存在的目录当作 bucket，因此不需要 `mc` 或管理员凭据），等待就绪后依次运行上面两条命令，最后删除容器与临时目录；已设置 `QIY_S3_ENDPOINT` 时改为复用现有 bucket，`QIY_S3_KEEP=1` 可保留临时目录复核。

生成包本地回归还覆盖字段缺失、MIME 拒绝、超限、binary/base64、非法 base64 和重复 key。生产部署仍需验证自己的身份服务、数据库、bucket 权限及签名 URL 策略。

生成包本地回归还覆盖字段缺失、MIME 拒绝、超限、binary/base64、非法 base64 和重复 key。该联合测试已在 MinIO 通过，身份由测试注入。生产部署仍需验证自己的身份服务、数据库、bucket 权限及签名 URL 策略。

`tools/verify-orphan-cleanup.ts` 在源码仓库中验收孤儿扫描：生成带 `File` 字段的应用、真实 HTTP 上传两个对象、删掉其中一个的附件记录制造孤儿，然后断言预演只报告不删除、`--apply` 只删除无记录对象、仍被引用的对象保留、`missingObjects` 单独统计、清理命令仍能删除失去对象的记录。该验收使用 `local` provider；S3 一侧由 `tools/verify-s3-acceptance.ts` → `verify-s3-storage.ts --api` 在真实 bucket 上覆盖同样的双向断言与 `list()` 枚举。

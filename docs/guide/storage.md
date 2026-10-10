# 文件存储

```ts
storage { provider local; }
```

或 `storage { provider s3; }`。

## 文件字段

```ts
field datasheet File @nullable @label("产品资料");
```

生成上传端点（返回受保护的 Attachment 元数据：大小、MIME、归属）、先鉴权再读取的下载端点、删除端点，以及可选的定时清理任务。

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

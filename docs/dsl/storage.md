# storage（文件存储）

`storage` 声明文件对象存在哪里，`File` / `Files` 字段声明实体如何引用这些对象。生成的存储层是**受保护端点**（先鉴权再读），不是公开静态目录；对象元数据（大小、MIME、归属、资源）与密钥一起管理，孤儿对象与失联元数据各有独立清理命令。

```qiy
storage { provider local; }     // 或 storage { provider s3; }
```

| 项目 | 说明 |
| --- | --- |
| 位置 | `application {}` 内，`elysia` 之后、`auth` 之前（固定解析顺序） |
| 键 | 只有 `provider` |
| 取值 | `local` 或 `s3`；其它值报 `Unsupported storage provider <p>` |
| 默认 | 未声明时等价于 `provider local`（`QIY_STORAGE_PROVIDER` 默认 `local`） |
| 效果 | 决定运行时 `QIY_STORAGE_PROVIDER` 的默认值、S3 环境变量是否生成、以及 `attachments:*` 工具的目标 |

## 文件字段

```qiy
field datasheet File
  @nullable
  @label("产品资料")
  @upload(both)
  @maxBytes(10485760)
  @mime("application/pdf")
  @maxFiles(1);

field attachments Files
  @nullable
  @upload(base64)
  @maxBytes(5242880)
  @mime("application/pdf", "image/*")
  @maxFiles(5);
```

```text
field <name> ( "File" | "Files" ) ( "@upload(" ( "binary" | "base64" | "both" ) ")"
  | "@maxBytes(" <int> ")" | "@mime(" <mime> ( "," <mime> )* ")" | "@maxFiles(" <int> ")" )* ";"
```

| 属性 | 适用 | 默认 | 校验 |
| --- | --- | --- | --- |
| `@upload(binary\|base64\|both)` | File/Files | `binary` | 其它值 → `File upload mode must be binary, base64 or both`；非文件字段 → `@upload is only valid for File and Files fields` |
| `@maxBytes(n)` | File/Files | `26214400`（25 MiB，**每个文件**） | 1 … 104857600（100 MiB），越界报 `File maxBytes must be between 1 and 104857600` |
| `@mime("a/b", "image/*")` | File/Files | 不限（`*/*`） | 小写化后必须匹配 `type/subtype` 或 `type/*`；重复/空 → 报错；至少一个 |
| `@maxFiles(n)` | File 只能是 `1`；Files `1…20` | `Files` 默认 `6` | `File fields support maxFiles(1); declare the field as Files for multiple files`；`Files maxFiles must be between 1 and 20` |
| 其它字段注解 | — | — | 与普通字段一致（`@nullable`、`@label`、`@comment`、`@formVisible`…） |

字段级硬约束（数据库 IR 校验）：

- `File` / `Files` 不能作为**主键**；`Files` 还**不能 unique**。
- `Files` 默认**不可排序、不可过滤**（JSON 数组没有有意义的排序语义）。
- 字段级修饰不能互相矛盾（例如 `File @maxFiles(2)` 直接拒绝）。
- 展示模板（`@display`/`@tableDisplay`/`@relationDetail`）**不能**插入 `File`/`Files` 字段。

## 存储列类型

| 字段 | PostgreSQL | SQLite | MySQL |
| --- | --- | --- | --- |
| `File` | `text` | `text` | `text`（unique/有索引时 `varchar(255)`） |
| `Files` | `jsonb`（`string[]`） | `text` + `mode:"json"` | `json` |

`File` 存一个 storage key 字符串；`Files` 存 key 数组，每个 key 仍对应自己的附件元数据与对象，下载/签名/归属/孤儿扫描都复用单文件逻辑。

## 生成结果

### API 契约

| 位置 | `File` | `Files` |
| --- | --- | --- |
| REST body schema | `string`（1–240 字符） | `string[]`（`minItems: 1`，`maxItems: @maxFiles ?? 6`） |
| GraphQL | `String` | `[String!]` |
| CSV 导入 | 支持 | **不导入**（`Files` 列被排除） |
| 列表/表单 | 单个上传控件 + 预览/下载 | 多文件上传控件（`maxCount = @maxFiles`） |

### 端点

| 方法 | 路径 | 作用 | 角色 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/files?key&resource&field[&fileName&contentType&resourceId]` | 二进制上传（`request.blob()`） | `admin`/`operator` |
| `POST` | `/api/v1/files/base64` | JSON 上传：`{ key, data, contentType, resource, field, … }` | `admin`/`operator` |
| `GET` | `/api/v1/files?key=` | 读取对象（鉴权后流式返回） | 归属者或 `admin` |
| `GET` | `/api/v1/files/metadata?key=` | 附件元数据 | 归属者或 `admin` |
| `GET` | `/api/v1/files/signed?key=` | 签名 URL（S3 返回 300 秒预签名；local 返回 `null`） | 归属者或 `admin` |
| `DELETE` | `/api/v1/files?key=` | 删除对象 + 元数据 | 仅 `admin` |
| `POST` | `/api/v1/files/upload-sessions` | 开启分片上传会话 | `admin`/`operator` |
| `GET` | `/api/v1/files/upload-sessions/:id` | 查询已收字节（断点续传） | 会话创建者 |
| `PUT` | `/api/v1/files/upload-sessions/:id?offset=n` | 追加一块；offset 必须等于已收字节 | 会话创建者 |
| `POST` | `/api/v1/files/upload-sessions/:id/complete` | 合并 + 校验 + 落库 | 会话创建者 |
| `DELETE` | `/api/v1/files/upload-sessions/:id` | 放弃会话 | 会话创建者 |

上传校验顺序（服务端权威，前端只做交互预检）：

1. storage key 形状（每段 `[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*`，≤240 字符）→ 400 `Invalid storage key`；
2. `resource + field` 必须对应已声明的文件字段 → 400 `Unknown file field`（fail-closed）；
3. 编码模式匹配（`binary`/`base64`/`both`）→ 415 `File field does not accept <enc> uploads`；
4. key 已存在（元数据或对象）→ 409 `Storage key already exists`；
5. 大小 ≤ `@maxBytes` → 413 `File is too large`；
6. MIME 匹配 `@mime`（支持 `image/*`）→ 415 `File MIME type is not allowed`；
7. 写对象 → 写元数据；元数据失败会**删除已写对象**（尽量不产生孤儿）。

### 附件元数据与权限

| 模式 | 存储位置 | 触发 |
| --- | --- | --- |
| 进程内（默认） | `Map` | `QIY_STORAGE_METADATA` 不为 `database` |
| 数据库 | `attachments` 表 | `QIY_STORAGE_METADATA=database` + `DATABASE_URL` |

**生产 Server 强制数据库模式**：`server.ts` 在启动时检查 `QIY_STORAGE_METADATA !== "database"` 会抛错（内存元数据在多副本/重启后不可靠）。生成的 `.env` 默认就是 `database`。

| 操作 | 规则 |
| --- | --- |
| 读/下载/元数据/签名 | `principal.id === metadata.ownerId` 或 `principal.role === "admin"`；否则 404（不泄露存在性） |
| 上传 | `admin`/`operator`（`viewer` 403 `Permission denied`） |
| 删除 | 仅 `admin` |
| 元数据缺失 | 一律 404，不会从缓存「恢复」访问 |

附件记录的 `resource`/`resourceId`/`fileName`/`contentType`/`size`/`ownerId` 由上传请求记录，可用于审计与清理；删除实体行**不会**自动删除对象（见清理命令）。

## 分片 / 断点续传

- 会话状态在**进程内存**，TTL 1 小时；多副本部署需要粘性会话或共享会话表。
- `PUT` 的 `offset` 必须严格等于已接收字节数，否则 409；超过 `@maxBytes` 返回 413。
- `complete` 时再校验 MIME 与上传模式，空会话 400；S3 的 **presigned PUT / 原生 multipart** 尚未实现（仍经服务端中转）。
- `Files` 的上传仍是**一个文件一个请求**：前端多选后逐个上传收集 key，再写入字段；没有批量原子上传——第 N 个失败时前 N-1 个对象已存在（可用孤儿扫描清理）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QIY_STORAGE_PROVIDER` | `local`（或 `storage { provider … }`） | `local` / `s3`；其它值运行时抛错 |
| `QIY_STORAGE_ROOT` | `<server>/../../storage`（生成 `.env` 写 `./storage`） | local provider 的根目录 |
| `QIY_STORAGE_METADATA` | `database`（生成 `.env`） | 设为 `database` 使用附件表；生产必需 |
| `QIY_S3_BUCKET` | 空 | **必填**（`S3 bucket is required`） |
| `QIY_S3_REGION` | 空 | S3 区域 |
| `QIY_S3_ENDPOINT` | 空 | S3 兼容端点（R2/MinIO） |
| `QIY_S3_ACCESS_KEY_ID` / `QIY_S3_SECRET_ACCESS_KEY` | 空 | 凭据；**只放服务端** |
| `QIY_S3_SESSION_TOKEN` | 空 | 临时凭据的会话 token |
| `QIY_ATTACHMENT_ORPHAN_LIMIT` | `1000`（代码上限 10000） | 孤儿扫描单次处理量（`attachments:orphans` CLI 只读该环境变量，没有 `--limit` 参数） |
| `QIY_ATTACHMENT_CLEANUP_LIMIT` | `1000`（代码上限 10000） | 失联元数据清理单次处理量（`attachments:cleanup` 读取） |

S3 使用 Bun 原生 `Bun.S3Client`（不安装 AWS SDK）：`save/open/exists/delete/presign/list` 六个操作；`list()` 分页上限 20×1000 key，避免误配 bucket 导致无界扫描。

## 清理：两个方向

```qiy
elysia {
  cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
}
```

| 方向 | 命令 | 作用 |
| --- | --- | --- |
| 元数据在、对象丢失 | `bun run attachments:cleanup`（默认**预演**，`--apply` 执行） | 删除失去文件的附件记录；定时任务 `cleanupMissingAttachments` 会显式删除 |
| 对象在、元数据缺失 | `bun run attachments:orphans`（默认**预演**，`--apply` 执行） | 列出/删除无记录的存储对象；输出 `{ objects, metadata, orphans, missingObjects, removed, dryRun, truncated }` |

- 两者都需要 `QIY_STORAGE_METADATA=database` 与 `DATABASE_URL`；输出 `removed` 只在 `--apply` 时非 0。
- 单次处理量由环境变量限制：孤儿扫描用 `QIY_ATTACHMENT_ORPHAN_LIMIT`，失联元数据清理用 `QIY_ATTACHMENT_CLEANUP_LIMIT`（默认 1000，代码内上限 10000）；超出时孤儿扫描输出 `truncated: true`。
- **删除对象不可撤销**，S3 上还会产生删除费用；建议定期预演、审核后执行。
- 已经签发的 S3 下载 URL 在有效期内仍可能有效——删除记录不能撤销已签发 URL。

## 示例：产品资料 + 多附件（本地）

```qiy [app.qiy]
qiy v0;
application catalog-admin {
  database postgresql {}
  api { client rest; }
  storage { provider local; }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role userRole;
  }

  entity products {
    field id UUID @id;
    field sku Text @unique;
    field name Text;
    field datasheet File @nullable @label("产品资料") @upload(both) @maxBytes(10485760) @mime("application/pdf");
    field images Files @nullable @upload(binary) @maxBytes(5242880) @mime("image/*") @maxFiles(5);
  }
}
```

上传（binary）：

```bash
curl -X POST "http://localhost:3000/api/v1/files?key=products/acme-1000/datasheet.pdf&resource=products&field=datasheet&contentType=application/pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/pdf" \
  --data-binary @datasheet.pdf
# => { id, storageKey, fileName, contentType, size, ownerId, resource, resourceId, createdAt }
```

把返回的 `storageKey` 写入实体：

```bash
curl -X PATCH http://localhost:3000/api/v1/products/<id> \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"datasheet":"products/acme-1000/datasheet.pdf"}'
```

## 示例：S3 兼容存储

```qiy
storage { provider s3; }
```

```dotenv
QIY_STORAGE_PROVIDER=s3
QIY_STORAGE_METADATA=database
QIY_S3_BUCKET=qiy-attachments
QIY_S3_REGION=us-east-1
QIY_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
QIY_S3_ACCESS_KEY_ID=<key>
QIY_S3_SECRET_ACCESS_KEY=<secret>
```

bucket 必须事先存在；`GET /api/v1/files/signed` 会返回 300 秒有效的预签名 GET URL（local provider 返回 `{ url: null }`，直接用 `/api/v1/files?key=` 受保护下载）。

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `Unsupported storage provider <p>` | `storage { provider … }` 非法值 |
| `Unsupported field type <t>` | 把 `File`/`Files` 写成别的拼写 |
| `Field attribute @upload is only valid for File and Files fields` | 在普通字段上用上传注解 |
| `File upload mode must be binary, base64 or both; received <m>` | `@upload` 取值错误 |
| `File maxBytes must be between 1 and 104857600` | `@maxBytes` 越界 |
| `File maxFiles must be between 1 and 20; received <n>` | `Files @maxFiles` 越界 |
| `File fields support maxFiles(1); declare the field as Files for multiple files` | `File @maxFiles(2)` |
| `Invalid File MIME type <m>` / `Duplicate File MIME type <m>` / `File @mime requires at least one MIME type` | `@mime` |
| `... Files cannot be a primary key` / `... Files cannot be unique` | `Files` 约束 |
| `upload policy requires File or Files type`（IR 校验） | 上传注解挂在非文件字段 |
| `Invalid storage key`（运行时） | key 含非法段/超长 |
| `Unknown file field`（运行时） | `resource`/`field` 不匹配已声明文件字段 |
| `File field does not accept <enc> uploads` | 编码模式不允许 |
| `Storage key already exists` | key 冲突（409） |
| `File is too large` / `File MIME type is not allowed` | 413 / 415 |

## 安全注意事项

1. **下载走鉴权端点**，没有公开对象 URL（除 S3 预签名，且有效期 300 秒）；不要把 `QIY_S3_*` 或 bucket 直链暴露给前端。
2. **归属校验以元数据为准**：非归属者非 admin 一律 404（不区分「不存在」与「无权限」），避免枚举对象。
3. **服务端重新校验策略**：`resource + field` 决定 upload mode/MIME/size，未知字段 fail-closed；前端预检可被绕过。
4. **key 由客户端提供**：必须自己生成不可猜测的 key（如 `resource/<uuid>/<filename>`）；重复 key 会 409，而不是覆盖。
5. **删除仅 admin**，但删除实体行不会删对象；定期跑两个方向的清理，避免存储泄漏与失联记录。
6. **生产必须 `QIY_STORAGE_METADATA=database`**：内存元数据在重启/多副本后会丢失归属信息，导致文件不可读。
7. **base64 会膨胀约 1/3**，大文件用 binary 或分片；分片会话在内存，多副本需粘性会话。
8. **`Files` 没有批量原子性**：部分上传成功会产生孤儿对象，靠 `attachments:orphans` 收敛。
9. **CSV 导入不含 `Files`**：避免通过导入写入任意对象引用。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 上传 415 | MIME 不在 `@mime`，或 `@upload` 不允许该编码 | 调整字段声明或请求头/编码 |
| 上传 403 | 当前角色是 `viewer` | 用 `admin`/`operator` 会话 |
| 下载 404 | 不是归属者/不是 admin，或元数据缺失 | 用上传者账号；检查 `QIY_STORAGE_METADATA=database` |
| 重启后文件打不开 | 仍用内存元数据 | 设 `QIY_STORAGE_METADATA=database` 并迁移 |
| `QIY_STORAGE_METADATA=database is required for production file metadata` | 生产启动校验 | 修正 `.env.production` |
| 上传成功但字段没值 | 上传只返回 key，需要 PATCH 实体写入 | 前端生成代码已处理；自定义调用需自行写入 |
| 签名 URL 为 null | `local` provider 不支持预签名 | 直接用受保护下载端点 |
| 孤儿扫描不删 | 默认预演 | 加 `--apply`，并确认 `removed > 0` |

## 进阶用法

**1）先上传、后提交（草稿流）**：上传端点只返回对象 + 元数据，业务实体在保存时才写入 key。这样新建表单可以先传附件再点保存；未保存的草稿会留下无引用对象，靠 `attachments:orphans` 定期收敛。

```ts
// 1) 上传
const uploaded = await fetch(`/api/v1/files?key=products/${crypto.randomUUID()}/spec.pdf&resource=products&field=datasheet`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
  body: file,
}).then((response) => response.json());
// 2) 保存实体时才写 key
await fetch(`/api/v1/products/${id}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ datasheet: uploaded.storageKey }),
});
```

**2）大文件断点续传**：开会话 → 记录 `receivedBytes` → 失败后从该 offset 续传 → `complete`。

```ts
const session = await startSession({ key, resource: "products", field: "datasheet" });
let offset = 0;
for (const chunk of chunks) {
  await putChunk(session.id, offset, chunk);   // offset 必须等于已接收字节
  offset += chunk.byteLength;
}
await completeSession(session.id);             // 合并 + MIME/大小校验 + 写元数据
```

**3）`Files` 多文件顺序上传**：逐个上传收集 key 数组，任一失败可重试该文件；写入字段时用完整数组，服务端按 `maxItems` 校验。

**4）把 S3 下载交给浏览器**：对大文件用 `/api/v1/files/signed` 拿 300 秒预签名 URL 让浏览器直连对象存储，避免经 Node/Bun 中转；local provider 返回 `null` 时回退到受保护下载端点。

**5）存储 key 规范**：`<resource>/<uuid>/<safe-file-name>`（只用 `[A-Za-z0-9_-]` 与点号分段）。不要用用户原文件名直接拼 key，避免路径穿越与覆盖（服务端会拒绝非法段，但可猜测的 key 仍会 409 冲突）。

## 相关

- [文件存储（指南）](/guide/storage)：S3/MinIO 验收、孤儿与清理运维、分片细节。
- [entity 与 field](/dsl/entity)：字段类型、`@nullable`、`@formVisible`。
- [权限（permission）](/dsl/permissions)：`restrict`/`scope` 与文件字段的关系（字段掩码不适用于上传端点）。
- [application](/dsl/application#storage)：块位置与关键字速查。
- [Elysia 插件与 cron](/dsl/application#elysia)：`cleanupMissingAttachments` 定时任务。
- 示例：[examples/erpadmin/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/erpadmin/app.qiy)（`File` 字段 + local storage）、[examples/plugin-matrix/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/plugin-matrix/app.qiy)。
- 测试：`tests/file-upload-policy.test.ts`；验收 `tools/verify-s3-storage.ts`、`tools/verify-s3-acceptance.ts`、`tools/verify-resumable-upload.ts`、`tools/verify-orphan-cleanup.ts`。

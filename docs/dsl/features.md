# features（系统管理功能开关）

`features` 块在 `application {}` 内声明系统管理功能的开关，位置与 `api`/`realtime`/`auth` 同层（`database`、`api` 之后，`auth` 之前/之后均可，解析器按固定顺序读取）：

```qiy
application supply-chain {
  database sqlite {}
  api { client rest; }
  features {
    apiDocs true;
    apiKeys true;
  }
  auth { ... }
}
```

两个开关都**默认 false**：不写 `features` 块、或只写一个键时，未声明的功能保持关闭。`features { apiDocs false; apiKeys false; }` 与省略等价，但序列化时会保留显式块以便 round-trip。

## 开关语义

| 开关 | 打开后生成的内容 |
| --- | --- |
| `apiDocs` | `/system/overview` 的「实体系 / Dataflow / API 文档 / 权限模型」标签页、`GET /api/v1/openapi.json`（按当前账号权限过滤的 OpenAPI 3.1 文档）、`GET /api/v1/docs/model`（Mermaid/表格用的模型元数据）、web 依赖 `mermaid` + `@scalar/api-reference-react` |
| `apiKeys` | `qiy_api_keys` 表与迁移、`GET/POST/DELETE /api/v1/auth/api-keys`、Bearer `qiy_...` / `X-API-Key` 认证、`/system/overview` 的「访问密钥」标签页（`apiDocs` 未开时该页只有访问密钥页签） |

两者都关闭时：不生成文档路由、`app/features.ts` 的菜单链接为空、不添加 mermaid/Scalar 依赖，概览页与现有应用完全不变。

## 校验

- 只接受 `apiDocs` / `apiKeys` 两个键，未知键报错：`Unsupported features setting <key>`。
- 值必须是 `true` / `false`；重复键报 `Duplicate features setting <key>`。
- `apiKeys true` 需要同时声明 `auth` 块（密钥需要用户表来解析角色/claims），否则解析失败：`features apiKeys requires an auth block`。`apiDocs true` 不强制 auth，但生成端点仍走应用自己的 authenticator（未认证请求由 guard 拒绝）。

## 生成的 API 文档

- `GET /api/v1/openapi.json`：需要认证（`/api/v1/openapi` 是 Elysia 插件自带的公共端点，`/api/v1/openapi.json` 是 Qiy 生成的受保护端点）。文档包含：
  - `info`/`servers`/`tags`/`components.securitySchemes`（`bearerSession` = JWT Bearer，`apiKey` = `X-API-Key`）；
  - 每个资源的 list/show/create/patch/delete 与 `distribution`/`trend`/`aggregate` 分析端点；
  - 每个 dataflow 的 `POST /api/v1/commands/<name>`；
  - auth/me、login（启用本地登录时）、api-keys 与 docs 端点；
  - `x-qiy-roles` / `x-qiy-permissions` / `x-qiy-verification` 元数据。
- **按当前主体过滤**：admin 看到全部资源（包括用户资源）与全部命令；非 admin 看不到用户资源；`restrict.roles` 与 `pages` 的页面规则进一步裁剪端点（例如 operator 看不到 `DELETE` 受限资源的操作）；viewer 在资源路径上只有 GET；命令按 dataflow `allow roles`/`allow permission` 过滤，带 `allow verification` 或没有 allow 规则的命令只对 admin 展示（无法在文档阶段求值 verification，已在限制中说明）。`GET /api/v1/docs/model` 使用同一过滤规则，并给实体附带 `restricted`/`actions` 字段。
- 文档页的「API 文档」标签通过 Scalar（`@scalar/api-reference-react`）渲染该 spec；实体系/Dataflow 标签用 `mermaid` 动态渲染 `classDiagram`/`flowchart`。

## 生成的 API Key

- 表 `qiy_api_keys`：`id, userId, name, prefix, hash, createdAt, lastUsedAt, expiresAt, revokedAt`。只存 HMAC-SHA256（用 `QIY_AUTH_SECRET` 作 pepper）+ 8 位 hex 前缀；完整密钥 `qiy_<prefix>_<43 字符 base64url>` 只在创建响应里出现一次。
- 认证：`Authorization: Bearer qiy_...` 或 `X-API-Key: qiy_...`，在项目原有 authenticator 之后兜底解析；解析出用户行后按该用户的 role/claims 走同一 guard、scope 与权限规则。已撤销/过期密钥返回 401；`lastUsedAt` 最多每分钟更新一次。
- 每个用户最多 10 个有效密钥；名称 1–80 字符；`expiresAt` 可选且必须是未来时间（无效值 400/422），超过上限返回 409。
- 端点（均要求登录会话）：`GET /api/v1/auth/api-keys`（只返回掩码列表）、`POST /api/v1/auth/api-keys { name, expiresAt? }` → `{ key, record }`、`DELETE /api/v1/auth/api-keys/:id`（仅能撤销自己的密钥）。功能关闭时这些路由不存在（404）。

## 限制

- 文档页对**任意已登录用户**开放（feature flag 只控制是否生成），但 API 文档内容、模型元数据与命令列表都按当前用户权限过滤；这是刻意的选择，便于所有角色查阅自己可用的 API。
- 带 `allow verification` 的命令在 OpenAPI 中只对 admin 展示（verification 依赖运行时输入，无法在文档阶段判定）；资源行的数据 scope（例如 org 范围）不会过滤文档结构，只在真实请求时生效。
- Scalar 渲染的是服务端已过滤的 spec；客户端不再二次过滤。API key 的 `lastUsedAt` 更新是 best-effort 且节流，失败不影响认证。

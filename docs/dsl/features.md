# features（系统管理功能开关）

`features` 块在 `application {}` 内声明系统管理的开发者页面与 API 能力开关，位置与 `api`/`realtime`/`auth` 同层（`database`、`api` 之后，解析器按固定顺序读取）：

```qiy
application supply-chain {
  database sqlite {}
  api { client rest; }
  features {
    overview true;   # 功能总览页面 + 菜单项（默认 true）
    apiDocs true;    # API 文档页面 + OpenAPI 端点（默认 false）
    apiKeys true;    # 访问密钥页面 + 表/认证（默认 false）
  }
  auth { ... }
}
```

`overview` **默认 true**，`apiDocs` / `apiKeys` **默认 false**。不写 `features` 块时不会生成任何开发者页面；显式块会完整序列化三个布尔值以便 round-trip。

## 三个独立页面（系统管理菜单组，顺序固定）

| 页面 | 路由 | 生成条件 | 内容 |
| --- | --- | --- | --- |
| 功能总览 | `/system/overview` | `overview && (apiDocs || apiKeys)` | 三个标签页：**实体系**（Mermaid `classDiagram` + 字段/注解表 + 关系表）、**Dataflow**（每个 dataflow 的 Mermaid `flowchart`、allow rules、输入与步骤）、**权限模型**（权限字段/组/校验 + 当前用户有效权限）。不包含 API 文档或访问密钥页签。 |
| API 文档 | `/system/api-docs` | `apiDocs` | 全页内置 AntD OpenAPI 3.1 浏览器：左侧按 tag 分组（带操作数），右侧操作卡（方法/路径/摘要/参数/请求体/响应/安全方案/权限与角色标签 + 可复制 curl），支持大小写不敏感搜索（路径/方法/摘要/tag）与无结果状态；只读，不发 try-it 请求。 |
| 访问密钥 | `/system/api-keys` | `apiKeys` | 全页 API Key 管理：标题/说明、`Authorization: Bearer qiy_…` 与 `X-API-Key` 的 curl 示例、按名称/前缀/状态搜索与状态筛选、有效数/上限提示、权限标签（角色/权限/权限组 + Tooltip 说明）、掩码密钥/状态/创建/最近使用/过期（Tooltip 完整时间）、撤销确认、创建弹窗（名称 + 可选过期时间）、一次性密钥展示（只显示一次，可复制）。 |

菜单链接由一个生成文件 `app/features.ts` 的 `qiyMenuLinks` 提供，`buildMenuTree` 把它们按顺序追加到「系统管理」分组（不存在的分组会自动创建）；每个链接只在对应页面生成时存在，因此不会出现死路由。三个页面都要求登录，内容按当前账号的角色/权限过滤。

## 生成条件矩阵

| overview | apiDocs | apiKeys | 结果 |
| --- | --- | --- | --- |
| true | true | true | 三页 + 菜单三项 |
| true | true | false | 功能总览 + API 文档；无访问密钥页/表/认证兜底 |
| true | false | true | 功能总览 + 访问密钥；`/api/v1/docs/model` 为总览生成，`/api/v1/openapi.json` 与 API 文档页不生成 |
| false | true | true | 仅 API 文档 + 访问密钥；无功能总览页/菜单项 |
| false/true | false | false | 不生成任何开发者页面；`features.ts` 菜单链接为空 |

规则：功能总览页面本身要求 `overview` 为 true **且**至少一个 docs-api 开关（`apiDocs`/`apiKeys`）打开；服务端的 `/api/v1/docs/model` 在「功能总览需要它」或 `apiDocs` 打开时生成，`/api/v1/openapi.json` 只在 `apiDocs` 打开时生成。

## 校验

- 只接受 `overview` / `apiDocs` / `apiKeys` 三个键，未知键报错：`Unsupported features setting <key>`。
- 值必须是 `true` / `false`；重复键报 `Duplicate features setting <key>`。
- `apiKeys true` 需要同时声明 `auth` 块（密钥需要用户表来解析角色/claims），否则解析失败：`features apiKeys requires an auth block`。`apiDocs`/`overview` 不强制 auth，但生成端点仍走应用自己的 authenticator（未认证请求由 guard 拒绝）。

## 生成的 API 文档

- `GET /api/v1/openapi.json`（`apiDocs`）：需要认证（`/api/v1/openapi` 是 Elysia 插件自带的公共端点，`/api/v1/openapi.json` 是 Qiy 生成的受保护端点）。文档包含 `info`/`servers`/`tags`/`components.securitySchemes`（`bearerSession` = JWT Bearer，`apiKey` = `X-API-Key`）、每个资源的 CRUD 与 `distribution`/`trend`/`aggregate` 分析端点、每个 dataflow 的 `POST /api/v1/commands/<name>`、auth/me、login（启用本地登录时）、api-keys 与 docs 端点，以及 `x-qiy-roles` / `x-qiy-permissions` / `x-qiy-verification` 元数据。
- **按当前主体过滤**：admin 看到全部资源（包括用户资源）与全部命令；非 admin 看不到用户资源；`restrict.roles` 与 `pages` 的页面规则进一步裁剪端点（例如 operator 看不到 `DELETE` 受限资源的操作）；viewer 在资源路径上只有 GET；命令按 dataflow `allow roles`/`allow permission` 过滤，带 `allow verification` 或没有 allow 规则的命令只对 admin 展示（无法在文档阶段求值 verification，已在限制中说明）。
- `GET /api/v1/docs/model`（`apiDocs` 或需要功能总览时）：返回同一过滤规则下的模型元数据，并给实体附带 `restricted`/`actions` 字段。

## 生成的 API Key

- 表 `qiy_api_keys`：`id, userId, name, prefix, hash, createdAt, lastUsedAt, expiresAt, revokedAt`。只存 HMAC-SHA256（用 `QIY_AUTH_SECRET` 作 pepper）+ 8 位 hex 前缀；完整密钥 `qiy_<prefix>_<43 字符 base64url>` 只在创建响应里出现一次。
- 认证：`Authorization: Bearer qiy_...` 或 `X-API-Key: qiy_...`，在项目原有 authenticator 之后兜底解析；解析出用户行后按该用户的 role/claims 走同一 guard、scope 与权限规则。已撤销/过期密钥返回 401；`lastUsedAt` 最多每分钟更新一次。
- 每个用户最多 10 个有效密钥；名称 1–80 字符；`expiresAt` 可选且必须是未来时间（无效值 400/422），超过上限返回 409。
- 端点（均要求登录会话）：`GET /api/v1/auth/api-keys`（只返回掩码列表）、`POST /api/v1/auth/api-keys { name, expiresAt? }` → `{ key, record }`、`DELETE /api/v1/auth/api-keys/:id`（仅能撤销自己的密钥）。功能关闭时这些路由不存在（404）。

## 限制

- 三个页面都对**任意已登录用户**开放（feature flag 只控制是否生成），但内容按当前用户权限过滤；这是刻意的选择，便于所有角色查阅自己可用的 API。
- 带 `allow verification` 的命令在 OpenAPI 中只对 admin 展示（verification 依赖运行时输入，无法在文档阶段判定）；资源行的数据 scope（例如 org 范围）不会过滤文档结构，只在真实请求时生效。
- API 文档浏览器是只读的：不发送 try-it 请求，curl 示例使用占位 token（当前语言），由使用者替换为真实会话令牌或 API key。Mermaid 渲染超过 10 秒或抛错时回退显示原始 Mermaid 源码。
- API key 的 `lastUsedAt` 更新是 best-effort 且节流，失败不影响认证。

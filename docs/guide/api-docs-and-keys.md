# API 文档与访问密钥

`features` 打开后，生成的应用在 **系统管理** 菜单组里得到最多三个独立的开发者页面（顺序固定；只在对应开关打开时出现，不会产生死路由）：

| 页面 | 路由 | 开关 | 内容 |
| --- | --- | --- | --- |
| 功能总览 | `/system/overview` | `overview`（默认 true）且 `apiDocs`/`apiKeys` 至少一个打开 | **实体系**：Mermaid `classDiagram` + 字段/注解表 + 关系表；**Dataflow**：每个 flow 的 Mermaid `flowchart`、allow 规则、输入与步骤；**权限模型**：权限字段/组/校验 + 当前用户有效权限 |
| API 文档 | `/system/api-docs` | `apiDocs` | 全页 AntD OpenAPI 3.1 浏览器：tag 列表（带操作数）、操作卡（方法/路径/摘要/参数/请求体/响应/安全方案/角色与权限标签 + 可复制 curl）、搜索、无结果状态；每张操作卡可展开 **Try it**，用当前浏览器会话 token（或手动输入 `X-API-Key`）发真实请求并显示原始响应（截断 20k 字符）；可下载当前账号过滤后的 OpenAPI JSON（`<title>.openapi.json`） |
| 访问密钥 | `/system/api-keys` | `apiKeys` | 全页 API Key 管理：说明与 curl 示例、按名称/前缀/状态搜索与筛选、有效数/上限提示、权限标签、创建弹窗（名称 + 可选过期）、一次性密钥展示、**轮换**（旧密钥立即撤销、新密钥只展示一次）、撤销、**审计轨迹**（created/rotated/revoked） |

三页都在 `<Authenticated>` 布局内（未登录跳 `/auth/login`），内容按当前账号的角色/权限过滤。完整开关语义、生成矩阵与限制见 [DSL：features](/dsl/features)。

## 启用

```qiy
features {
  overview true;   # 功能总览页面 + 菜单项（默认 true）
  apiDocs true;    # API 文档页面 + OpenAPI 端点（默认 false）
  apiKeys true;    # 访问密钥页面 + 表/认证（默认 false）
}
```

- `apiKeys` 需要同时声明 `auth` 块（密钥要用用户表解析角色/claims），否则解析失败：`features apiKeys requires an auth block`。
- 生成访问密钥后需要执行常规迁移（`qiy_api_keys` 是新表）：

```bash
cd apps/server
bun run db:generate
bun run db:migrate
```

## 页面生成规则

- 功能总览：`overview && (apiDocs || apiKeys)`；只含实体/Dataflow/权限模型三个标签页，**不再包含** API 文档或访问密钥标签。
- API 文档：`apiDocs`；访问密钥：`apiKeys`。
- 功能总览依赖 `/api/v1/docs/model`：该端点在「功能总览需要」或 `apiDocs` 打开时生成；`/api/v1/openapi.json` 只在 `apiDocs` 打开时生成。
- 全部关闭（`overview false; apiDocs false; apiKeys false;`）时不生成页面、菜单项、文档路由与 `mermaid` 依赖。

## OpenAPI 文档

受保护的文档端点（必须带登录 token 或 API key，未认证 401，`Cache-Control: no-store`）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/openapi.json
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/docs/model
```

`GET /api/v1/openapi.json` 是按当前主体**过滤后**的 OpenAPI 3.1 文档：

| 规则 | 行为 |
| --- | --- |
| admin | 全部资源（含用户资源）与全部命令 |
| 非 admin | 看不到用户资源 |
| `restrict.roles` | 角色不在列表 → 资源整体不出现 |
| `pages` | 按页面动作（list/show/create/edit/delete）裁剪操作 |
| viewer | 资源路径上只保留 `list`/`show` |
| 命令：admin | 全部 |
| 命令：`allow verification` | 非 admin 不展示（依赖运行时输入） |
| 命令：`allow roles` | 角色在列表内才展示 |
| 命令：`allow permission` | 需持有展开后的全部**权限值**（permission field 的值；group 会递归展开） |
| 命令：无 allow | 非 admin 不展示 |

文档里的 `components.securitySchemes` 同时声明 `bearerSession`（JWT Bearer）与 `apiKey`（`X-API-Key`）；每个操作带 `x-qiy-roles`、`x-qiy-permissions`、`x-qiy-verification` 元数据，其中 `x-qiy-permissions` 记录**展开后的权限值**（例如 `inventory:receive`），与服务端过滤、Web 按钮可见性一致。Elysia 插件自带的 `/api/v1/openapi` 是公开端点，**不含** Qiy 的权限过滤，不要把它当生产文档源。

非 admin 的文档会隐藏 **verification 门控**的命令（运行时输入无法在文档里安全构造）。过滤后的文档带 `x-qiy-hidden`，列出 `{ method, path, reason: "verification", verification, label }`；Web 页面会显示「verification-gated operations are hidden」提示及原因，而不是让操作无声消失。admin 不受此隐藏影响。

## 创建和使用 API key

登录会话下创建（完整密钥只返回一次）：

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $QIY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI deploy","expiresAt":"2027-01-01T00:00:00.000Z","scopes":["inventory:receive"]}'
# 201 => { "key": "qiy_1a2b3c4d_...", "record": { "id": "...", "maskedKey": "qiy_1a2b3c4d_********", "scopes": ["inventory:receive"], ... } }
```

之后用密钥调用普通 API（两种头都接受）：

```bash
curl -H "X-API-Key: qiy_1a2b3c4d_..." http://localhost:3000/api/v1/inventory
curl -H "Authorization: Bearer qiy_1a2b3c4d_..." http://localhost:3000/api/v1/inventory
```

列出/撤销/轮换/审计（只能操作自己的密钥）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys
curl -X DELETE -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys/<id>
curl -X POST -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys/<id>/rotate
# 201 => { "key": "qiy_...新密钥", "record": { "id": "...", "rotatedFromId": "<旧 id>", ... } }
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys/events
```

行为要点：

- 密钥以**用户身份**走同一个 guard、data scope、页面与权限规则；operator 的密钥与 operator 会话权限一致。
- 服务端只保存 HMAC-SHA256（`QIY_AUTH_SECRET` 作为 pepper）+ 8 位 hex 前缀；数据库泄露也无法还原完整密钥。
- **API Key 不携带 id_token claims**：`permission from claim` 来源对密钥请求不生效，只继承角色组、数据库列与 scope 派生的 claim 键。
- `lastUsedAt` 最多每分钟更新一次（best-effort）；已撤销/过期立即 401；每用户最多 10 个有效密钥；名称 1–80 字符；`expiresAt` 必须是未来时间。
- **权限 scopes（可选）**：创建/轮换时可传 `scopes: string[]`，取值为当前账号的有效权限值；服务端在 `loadPermissions` 中取用户权限与 scopes 的**交集**，因此 scopes 只能收窄、不能提权。`null`/空数组表示继承全部权限；最多 50 个、每个 ≤120 字符。注意：scopes 只影响**权限值检查**（dataflow/verification/命令 allow 等）；角色页面访问仍继承用户角色。
- **轮换**保留名称、过期时间与 scopes，生成新密钥并立即撤销旧密钥；旧密钥在新密钥创建后不可再认证，`rotatedFromId` 记录链路；已过期/已撤销的密钥返回 404/409。
- **审计轨迹**记录 `created` / `rotated` / `revoked`（时间、keyId），按用户隔离、最多返回最近 100 条；审计写入是 best-effort，不阻塞密钥操作，但不用于安全授权判断。
- `QIY_AUTH_SECRET` 必须 ≥32 字符（本地登录/API Key 共用），生产用 `openssl rand -hex 32` 生成并只放服务端。

## 功能开关与降级

| 场景 | 结果 |
| --- | --- |
| `apiDocs false` | 不生成 API 文档页与 `/api/v1/openapi.json`；若功能总览开启仍生成 `/api/v1/docs/model` |
| `apiKeys false` | 不生成密钥页、`qiy_api_keys` 表与认证兜底；`/api/v1/auth/api-keys` 404 |
| `overview false` | 不生成功能总览页与菜单项；API 文档/访问密钥页可独立存在 |
| `apiDocs false` 且 `apiKeys false` | 不生成任何开发者页面、菜单项与 `mermaid` 依赖 |
| 未登录访问三页 | 重定向到 `/auth/login`（布局级 `Authenticated`） |

限制：

- API 文档浏览器支持 Try it：请求从当前浏览器发出，自动带 `qiy.access_token` 会话令牌；API Key 只在当次表单输入，不写入 localStorage。响应原样展示并截断到 20k 字符；服务端鉴权、权限过滤和字段校验仍是最终权威。curl 示例使用占位 token（当前语言），由使用者替换为真实会话令牌或 API Key。
- 带 `allow verification` 的命令在文档中只对 admin 可见；数据 scope 只影响真实请求，不影响文档结构。
- Mermaid 渲染超过 10 秒或抛错时回退显示原始 Mermaid 源码。
- 页面本身对任意已登录用户开放（flag 只控制生成），内容按权限过滤。

Demo：`examples/self/app.qiy` 三个开关全开；启动后访问：

- `http://localhost:8000/system/overview`（实体/Dataflow/权限模型）
- `http://localhost:8000/system/api-docs`（搜索、tag 列表、操作详情、curl 与 Try it）
- `http://localhost:8000/system/api-keys`（搜索/筛选、创建/撤销、一次性密钥）

用 seeded 的 `admin@example.com / admin-password`（或 operator/viewer）登录查看差异化内容。

## 相关

- [DSL：features](/dsl/features)：开关矩阵、端点、校验错误与限制。
- [DSL：permissions](/dsl/permissions)：`allow permission` / `pages` 如何影响文档过滤。
- [DSL：auth](/dsl/auth)：`QIY_AUTH_SECRET`、会话与 API Key 的认证顺序。
- [API 与数据源](./api)：REST/GraphQL 端点与 DataProvider。

# API 文档与访问密钥

`features` 打开后，生成的应用在 **系统管理** 菜单组里得到三个独立的开发者页面（顺序固定；只在对应开关打开时出现，不会产生死路由）：

| 页面 | 路由 | 开关 | 内容 |
| --- | --- | --- | --- |
| 功能总览 | `/system/overview` | `overview`（默认 true）且 `apiDocs`/`apiKeys` 至少一个打开 | **实体系**：Mermaid `classDiagram` + 字段/注解表 + 关系表；**Dataflow**：每个 dataflow 的 Mermaid `flowchart`、allow rules、输入与步骤；**权限模型**：权限字段/组/校验 + 当前用户有效权限 |
| API 文档 | `/system/api-docs` | `apiDocs` | 全页内置 AntD OpenAPI 3.1 浏览器：tag 列表（带操作数）、操作卡（方法/路径/摘要/参数/请求体/响应/安全方案/角色与权限标签 + 可复制 curl）、搜索路径/方法/摘要/tag、无结果状态；只读，不发真实请求 |
| 访问密钥 | `/system/api-keys` | `apiKeys` | 全页 API Key 管理：标题/说明、`Authorization: Bearer qiy_…` 与 `X-API-Key` curl 示例、按名称/前缀/状态搜索与状态筛选、有效数/上限提示、权限标签（角色/权限/权限组 + Tooltip）、创建弹窗（名称 + 可选过期时间）、一次性密钥展示与撤销 |

三页都要求登录，内容按当前账号的角色/权限过滤。

## 启用

```qiy
features {
  overview true;   # 功能总览页面 + 菜单项（默认 true）
  apiDocs true;    # API 文档页面 + OpenAPI 端点（默认 false）
  apiKeys true;    # 访问密钥页面 + 表/认证（默认 false）
}
```

`apiKeys` 需要 `auth` 块。生成访问密钥后需要执行常规迁移（`qiy_api_keys` 是新表）：

```bash
cd apps/server
bun run db:generate
bun run db:migrate
```

## 页面生成规则

- 功能总览：`overview && (apiDocs || apiKeys)`；它只包含实体系 / Dataflow / 权限模型三个标签页，**不再包含** API 文档或访问密钥标签。
- API 文档：`apiDocs`；访问密钥：`apiKeys`。
- 功能总览依赖 `/api/v1/docs/model`：该端点在「功能总览需要」或 `apiDocs` 打开时生成；`/api/v1/openapi.json` 只在 `apiDocs` 打开时生成。
- 全部关闭时（`overview false; apiDocs false; apiKeys false;`）不生成页面、菜单项、文档路由与 `mermaid` 依赖。

## OpenAPI 文档

受保护的文档端点（必须带登录 token 或 API key，未认证返回 401）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/openapi.json
```

`GET /api/v1/openapi.json` 是服务端**按当前主体过滤**后的 OpenAPI 3.1 文档：admin 能看到全部资源与命令；operator/viewer 只看到自己可用的资源、操作与命令（用户资源仅 admin 可见，`restrict.roles`/`pages` 规则继续生效）。文档里的 `components.securitySchemes` 同时声明 JWT Bearer 与 `X-API-Key` 两种认证。

模型元数据（功能总览的 Mermaid/表格数据源；`apiDocs` 或功能总览开启时可用）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/docs/model
```

## 创建和使用 API key

登录会话下创建（完整密钥只返回一次）：

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $QIY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"CI deploy","expiresAt":"2027-01-01T00:00:00.000Z"}'
# => { "key": "qiy_1a2b3c4d_...", "record": { "id": "...", "maskedKey": "qiy_1a2b3c4d_********", ... } }
```

之后用密钥调用普通 API（两种头都接受）：

```bash
curl -H "X-API-Key: qiy_1a2b3c4d_..." http://localhost:3000/api/v1/inventory
curl -H "Authorization: Bearer qiy_1a2b3c4d_..." http://localhost:3000/api/v1/inventory
```

列出/撤销（只能操作自己的密钥）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys
curl -X DELETE -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/auth/api-keys/<id>
```

行为要点：

- 密钥以用户的身份走同一个 guard、data scope、权限与页面规则；operator 的密钥与 operator 会话权限完全一致。
- 服务端只保存 HMAC-SHA256（`QIY_AUTH_SECRET` 作为 pepper）；数据库泄露也无法还原完整密钥。
- `lastUsedAt` 最多每分钟更新一次；已撤销/过期密钥立即 401；每用户最多 10 个有效密钥；名称 1–80 字符。
- `QIY_AUTH_SECRET` 必须至少 32 字符（本地登录/API keys 共用），生产环境用 `openssl rand -hex 32` 生成并只放服务端。

## 功能开关与降级

- `apiDocs false`：不生成 API 文档页面、OpenAPI 端点；若功能总览开启（且 `apiKeys` 或其他 docs-api 开关打开）仍生成 `/api/v1/docs/model` 供总览使用，但不生成 `/api/v1/openapi.json`。
- `apiKeys false`：不生成访问密钥页面、`qiy_api_keys` 表与认证兜底；`/api/v1/auth/api-keys` 返回 404。
- `overview false`：不生成功能总览页面与菜单项；API 文档/访问密钥页面可独立存在。
- `apiDocs false` 且 `apiKeys false`：不生成任何开发者页面、菜单项与 `mermaid` 依赖。
- API 文档浏览器是只读的：不发送 try-it 请求，curl 示例使用占位 token（当前语言），由使用者替换为真实会话令牌或 API key。
- 限制：带 `allow verification` 的命令在文档中仅 admin 可见（verification 依赖运行时输入）；资源级数据 scope 只影响真实请求，不影响文档结构；页面本身对任意已登录用户开放但内容按权限过滤。

Demo：`examples/self/app.qiy` 的 `features` 三开关均打开；启动后访问：

- <http://localhost:8000/system/overview>（实体/Dataflow/权限模型）
- <http://localhost:8000/system/api-docs>（搜索、tag 列表、操作详情与 curl）
- <http://localhost:8000/system/api-keys>（搜索/状态筛选、创建/撤销、一次性密钥）

用 seeded 的 `admin@example.com / admin-password`（或 operator/viewer）登录查看差异化内容。

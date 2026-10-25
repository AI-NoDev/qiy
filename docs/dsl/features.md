# features（系统管理功能开关）

`features` 块在 `application {}` 内声明**系统管理**开发者页面与对应 API 能力。它只控制「生成不生成」，不控制「谁可以看」——页面内容由当前账号的角色/权限实时过滤。

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

## 语法与默认值

```text
features "{" ( "overview" | "apiDocs" | "apiKeys" ) ( "true" | "false" ) ";" "}"
```

| 键 | 默认 | 生成内容 | 依赖 |
| --- | --- | --- | --- |
| `overview` | `true` | `/system/overview`（功能总览：实体系 / Dataflow / 权限模型）+ 菜单项 | 至少一个 docs-api 开关（`apiDocs`/`apiKeys`）打开 |
| `apiDocs` | `false` | `/system/api-docs` 页面、`GET /api/v1/openapi.json`、OpenAPI 浏览器 | 需要登录 |
| `apiKeys` | `false` | `/system/api-keys` 页面、`qiy_api_keys` 表、`/api/v1/auth/api-keys`、Bearer/`X-API-Key` 认证兜底 | **必须**同时有 `auth` 块（且用户实体存在） |

- 只接受这三个键；未知键 → `Unsupported features setting <key>; expected overview, apiDocs or apiKeys`。
- 值必须是 `true`/`false`；重复键 → `Duplicate features setting <key>`。
- 不写 `features` 块时：不生成任何开发者页面（等价于 `overview true; apiDocs false; apiKeys false;`，但没有 `features.ts` 菜单链接）。显式块会完整序列化三个布尔值以便 round-trip。
- `apiKeys true` 但无 `auth` → 解析期 `features apiKeys requires an auth block`；有 `auth` 但用户实体不存在 → `features apiKeys requires the auth user entity <e>`。
- 解析顺序固定：`features` 在 `api` 之后、`realtime`/`elysia`/`storage`/`auth` 之前（见 [application](/dsl/application#features)）。

## 生成矩阵

| overview | apiDocs | apiKeys | 页面 | 端点 / 表 |
| --- | --- | --- | --- | --- |
| true | true | true | 三页 + 菜单三项 | `openapi.json`、`docs/model`、`api-keys`、`qiy_api_keys` |
| true | true | false | 功能总览 + API 文档 | `openapi.json`、`docs/model`；无密钥表/认证 |
| true | false | true | 功能总览 + 访问密钥 | `docs/model`、`api-keys`、表；无 `openapi.json` |
| false | true | true | API 文档 + 访问密钥 | 同第一行，但无总览页/菜单项 |
| false/true | false | false | **不生成**开发者页面 | `features.ts` 菜单链接为空；不生成 `mermaid` 依赖 |

判定公式（生成器）：`overviewRequested = overview && (apiDocs || apiKeys)`；`docsModelEnabled = apiDocs || overviewRequested`；`openapi.json` 只在 `apiDocs` 时生成。

菜单由生成文件 `apps/web/app/features.ts` 的 `qiyMenuLinks` 提供（`qiyFeatureFlags` 同时导出三个布尔值），`buildMenuTree` 把它们按顺序追加到「系统管理」分组（不存在则创建）。每个链接只在对应页面存在时生成，不会出现死路由。

## 三个页面

| 页面 | 路由 | 内容 |
| --- | --- | --- |
| 功能总览 | `/system/overview` | 三个标签页：**实体系**（Mermaid `classDiagram` + 字段/注解表 + 关系表）、**Dataflow**（每个 flow 的 Mermaid `flowchart`、allow 规则、输入与步骤）、**权限模型**（权限字段/组/校验 + 当前用户有效权限）。不含 API 文档或密钥页签 |
| API 文档 | `/system/api-docs` | 全页 AntD OpenAPI 3.1 浏览器：左侧按 tag 分组（带操作数），右侧操作卡（方法/路径/摘要/参数/请求体/响应/安全方案/角色/权限标签 + 可复制 curl），大小写不敏感搜索（路径/方法/摘要/tag）与无结果状态；**只读**，不发 try-it 请求 |
| 访问密钥 | `/system/api-keys` | 全页密钥管理：说明与 curl 示例（`Authorization: Bearer qiy_…` / `X-API-Key`）、按名称/前缀/状态搜索与筛选、有效数/上限提示、权限标签（角色/权限组 + Tooltip）、创建弹窗（名称 + 可选过期）、一次性密钥展示（只显示一次，可复制）、撤销确认 |

- 三个页面都在 `<Authenticated>` 布局内：未登录会被重定向到 `/auth/login`（不是 403）。
- 页面数据全部来自受保护 API（`/api/v1/docs/model`、`/api/v1/openapi.json`、`/api/v1/auth/api-keys`），因此内容天然按当前账号过滤。
- Mermaid 渲染超过 10 秒或抛错时回退显示原始 Mermaid 源码。

## OpenAPI 文档过滤规则

`GET /api/v1/openapi.json` 与 `GET /api/v1/docs/model`（均 `Cache-Control: no-store`，未认证 401）按当前主体生成**裁剪后**的文档：

| 规则 | 行为 |
| --- | --- |
| admin | 看到全部资源（含用户资源）与全部命令 |
| 非 admin | **看不到用户资源**（`auth.userEntity` 对应表） |
| `restrict.roles` | 角色不在列表 → 该资源整体不出现 |
| `pages` 规则 | 按页面动作裁剪：`list`/`show`/`create`/`edit`/`delete` 分别判定 |
| viewer | 资源路径上**只保留** `list`/`show` 相关操作（即使 `pages` 允许写操作，文档也不列写操作） |
| 命令：admin | 全部 |
| 命令：`allow verification` | 非 admin **一律不展示**（依赖运行时输入，文档阶段无法判定） |
| 命令：`allow roles` | 角色在列表内才展示 |
| 命令：`allow permission` | 需持有展开后的**全部权限值** |
| 命令：无 allow | 非 admin 不展示（默认 `admin, operator` 的白名单只对 admin 生效） |

文档包含：`info`/`servers`/`tags`/`components.securitySchemes`（`bearerSession` = JWT Bearer、`apiKey` = `X-API-Key`）、每资源 CRUD 与 `distribution`/`trend`/`aggregate`、每命令 `POST /api/v1/commands/<name>`、`/auth/me`、`/auth/login`（有本地登录时）、`api-keys` 与 docs 端点自身，以及 `x-qiy-roles` / `x-qiy-permissions` / `x-qiy-verification` 元数据。

`x-qiy-permissions` 与命令可见性使用**展开后的权限值**（permission field 的值，例如 `inventory:receive`；group 会递归展开），而不是声明名；因此「持有该值」的非 admin 也能在文档里看到并调用对应命令。前端按钮可见性与服务端过滤共用同一套展开结果。

## API Key 生命周期

- 表 `qiy_api_keys`：`id`、`userId`、`name`、`prefix`、`hash`、`createdAt`、`lastUsedAt`、`expiresAt`、`revokedAt`（索引：用户、唯一 hash）。
- 格式：`qiy_<8 位 hex 前缀>_<43 字符 base64url 密钥>`；**只存** HMAC-SHA256（以 `QIY_AUTH_SECRET` 为 pepper）+ 前缀；完整密钥只在创建响应出现一次。
- 认证：先按项目原有 authenticator 解析会话；失败后再看 `Authorization: Bearer qiy_...` 或 `X-API-Key: qiy_...`。解析出用户行后，按该用户 role/claims 走同一 guard、scope、页面与权限规则；`lastUsedAt` 最多每分钟更新一次（best-effort）。
- 已撤销/过期 → 401；**API Key 不携带 id_token claims**，因此 `permission from claim` 来源对它不生效（只继承角色组 + 数据库列 + scope 派生的 claim 键）。
- 端点（全部要求会话登录，只能操作**自己的**密钥）：

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/v1/auth/api-keys` | 掩码列表（`maskedKey` 形如 `qiy_1a2b3c4d_********`） |
| `POST` | `/api/v1/auth/api-keys` | `{ name, expiresAt? }` → **201** `{ key, record }`；名称 1–80；`expiresAt` 必须是未来 ISO 时间；超过上限 **409** |
| `DELETE` | `/api/v1/auth/api-keys/:id` | 撤销自己的密钥（幂等）；不存在或属于别人 → 404 |

- 每个用户最多 **10** 个有效密钥（撤销/过期不计入）；超限 409 `At most 10 active API keys are allowed`。
- `apiKeys false` 时不生成表、路由与认证兜底：`/api/v1/auth/api-keys` 为 404，密钥头不会被解析。
- 新增 `qiy_api_keys` 表后必须执行迁移（`bun run db:generate && bun run db:migrate`）。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `QIY_AUTH_SECRET` | **≥32 字符**；API Key 的 HMAC pepper（与本地登录/OTP/onboarding 共用）。缺失或过短时哈希失败（fail-closed）。注意：生成的 `.env` 只在有本地密码/OTP 时自动写入该变量；**纯 OAuth 项目启用 `apiKeys` 时需要手动添加** |
| `DATABASE_URL` | `qiy_api_keys` 与其它生成的表一样走常规迁移 |
| — | `features` 本身没有专属环境变量；`apiDocs`/`overview` 的开关在生成期固化 |

## 校验错误

| 错误 | 触发 |
| --- | --- |
| `Unsupported features setting <k>; expected overview, apiDocs or apiKeys` | 未知键 |
| `Duplicate features setting <k>` | 重复键 |
| `Expected true or false near token …` | 值不是布尔 |
| `features apiKeys requires an auth block` | `apiKeys true` 无 `auth` |
| `features apiKeys requires the auth user entity <e>` | auth 用户实体不存在 |
| `QIY_AUTH_SECRET must be at least 32 characters to hash API keys` | 运行时环境变量非法 |

## 限制与安全

1. **flag 只控制生成**：三个页面（若生成）对任意已登录用户开放，内容按角色/权限过滤。这是刻意设计，便于所有角色查阅自己能调用的 API。
2. **API 文档是权限过滤后的视图**，不是完整攻击面清单：`allow verification` 与数据 scope 不会体现在文档结构里；带 `allow verification` 的命令只对 admin 显示。
3. **文档只读**：不发送 try-it 请求；curl 示例使用占位 token（随当前语言），由使用者替换为真实会话令牌或 API Key。
4. **API Key 等同会话**：泄露即等同该用户全部权限；只在服务端存 HMAC，前端只显示掩码与一次性完整值。不要在 CI 日志里回显 `key` 字段。
5. **撤销不可恢复**：撤销写 `revokedAt`，记录保留用于审计；重新签发会得到新密钥。
6. **密钥与用户的 claim 快照**：API Key 请求的 claims 来自用户行（scope 列），因此角色/scope 列变化会在下一次请求生效，无需换密钥；但 IdP claim 变化（如 `roles`）不会同步到 API Key。
7. `overview` 页面会渲染当前用户的**有效权限**，这意味着低权限用户也能看到自己的权限集合（这是预期的可观测性，不是泄漏）。

## 进阶用法

**1）CI 用最小权限 API Key**：为自动化建一个专用 `viewer`（或自定义权限较少的角色组）用户，用它的会话创建 Key，而不是用 admin 的 Key。Key 的行为与创建者会话完全一致，泄权范围可控。

```bash
# 1) admin 创建/维护 ci-bot 用户（角色 viewer）
# 2) ci-bot 登录后创建自己的 key（或由管理员代建后转交一次性 key）
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $CI_BOT_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"nightly-export","expiresAt":"2027-01-01T00:00:00.000Z"}'
```

**2）先开后关做灰度**：`apiDocs true` 只影响**生成**，页面内容始终按账号过滤。可以先给 admin 使用，再逐步给 operator/viewer 打开对应权限。

**3）把 `apiKeys` 与 `permission` 一起用**：Key 继承角色组 + 数据库列权限；需要按键区分能力时，用不同权限组的用户各发一把 Key，而不是在 Key 上加权限位。

**4）保留审计证据**：撤销 Key 只是写 `revokedAt`；定期导出 `qiy_api_keys`（不含 `hash`）做访问审计，配合 `lastUsedAt` 找出长期未用密钥。

**5）文档即契约测试**：在 CI 中用不同角色的 token 拉 `/api/v1/openapi.json`，断言「viewer 看不到写操作」「非 admin 看不到 users 资源」，把权限回归变成可执行断言（注意 `allow permission` 命令的文档偏差）。

## 相关

- [认证与登录（auth）](/dsl/auth)：用户表、会话与 `QIY_AUTH_SECRET`。
- [权限（permission）](/dsl/permissions)：权限值、组、`allow permission`/`allow verification`。
- [API 文档与访问密钥（指南）](/guide/api-docs-and-keys)：实际调用示例与降级行为。
- [application](/dsl/application#features)：块位置与关键字速查。
- 示例：[examples/self/app.qiy](https://github.com/AI-NoDev/qiy/blob/main/examples/self/app.qiy)（三开关全开）。
- 测试：`tests/features-api-keys.test.ts`、`tests/environment-generation.test.ts`。

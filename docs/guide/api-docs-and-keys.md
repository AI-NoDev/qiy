# API 文档与访问密钥

`features` 打开后在生成的应用里得到 **系统管理 → 功能总览** 页面（`/system/overview`）：

| 标签 | 内容 |
| --- | --- |
| 实体系 | 由实体/关系/枚举生成的 Mermaid `classDiagram`、每实体字段表（类型/可空/枚举/注解）、关系列表 |
| Dataflow | 每个 dataflow 的 Mermaid `flowchart`（输入 → context 加载 → 步骤/动作 → 结果），allow rules 与必填输入 |
| API 文档 | Scalar 渲染的、按当前账号权限过滤的 OpenAPI 3.1 文档 |
| 权限模型 | 权限字段、权限组、权限校验与当前用户的有效权限 |
| 访问密钥 | 个人 API key 的列表/创建/撤销（`apiKeys` 开启时） |

页面访问条件：已登录即可打开（文档内容按权限过滤）。`apiDocs` 打开时生成前四个标签；`apiKeys` 打开时生成「访问密钥」标签；两者都关闭时页面与菜单项都不生成。

## 启用

```qiy
features {
  apiDocs true;
  apiKeys true;
}
```

生成后需要执行常规迁移（`qiy_api_keys` 是新表）：

```bash
cd apps/server
bun run db:generate
bun run db:migrate
```

## OpenAPI 文档

受保护的文档端点（必须带登录 token 或 API key，未认证返回 401）：

```bash
curl -H "Authorization: Bearer $QIY_TOKEN" http://localhost:3000/api/v1/openapi.json
```

`GET /api/v1/openapi.json` 是服务端**按当前主体过滤**后的 OpenAPI 3.1 文档：admin 能看到全部资源与命令；operator/viewer 只看到自己可用的资源、操作与命令（用户资源仅 admin 可见，`restrict.roles`/`pages` 规则继续生效）。文档里的 `components.securitySchemes` 同时声明 JWT Bearer 与 `X-API-Key` 两种认证。

模型元数据（文档页的 Mermaid/表格数据源）：

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

- `apiDocs false`：不生成文档路由、OpenAPI 端点与 mermaid/Scalar 依赖；`/system/overview` 仅在 `apiKeys true` 时存在且只有「访问密钥」标签。
- `apiKeys false`：不生成 `qiy_api_keys` 表与认证兜底；`/api/v1/auth/api-keys` 返回 404。
- 两者都 false：不生成该页面、菜单项与依赖，应用与未声明 features 时完全一致。
- 限制：带 `allow verification` 的命令在文档中仅 admin 可见（verification 依赖运行时输入）；资源级数据 scope 只影响真实请求，不影响文档结构；文档页对任意已登录用户开放但内容按权限过滤。

Demo：`examples/self/modules/charts.qiy` 之外，`examples/self/app.qiy` 的 `features` 两开关均打开；启动后访问 `http://localhost:8000/system/overview`，用 seeded 的 `admin@example.com / admin-password`（或 operator/viewer）登录查看差异化文档。

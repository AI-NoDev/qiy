# 供应链 + ERP + WMS 一体化（examples/self）

一个模型同时覆盖供应链、ERP 与 WMS，并演示 Qiy 的多 OIDC Provider 登录（多选 + 每 Provider 身份字段映射）。

## 模型内容

- **供应链**：供应商、客户、采购单/明细、收货、销售单/明细、发运、单据状态机；
- **ERP**：产品、BOM、工作单（生产/领料/产出流水）、成本与价格字段（字段级 mask）、仪表盘分布/趋势指标；
- **WMS**：组织（scope tree claim）、仓库、库位、库存（在手/预留/批次）、库存流水、上架/调拨/盘点/预留/发运等 dataflow 命令（幂等 + 审计 + 事务回滚）；
- **实时**：库存、库存流水、发运的 realtime outbox；
- **权限**：pages 页面级角色、restrict 字段 mask、scope 按 claim 过滤仓库；
- **多 Provider 登录**：`providers oidc, oauth2, sso, okta, auth0, azure-ad-b2c, keycloak, google, kinde;`，Google 映射 `googleSubject`，oidc 用 `openid` claim 映射 `openidField`，Keycloak 映射 `keycloakSubject`。

## 生成与运行

```sh
bun run qiy generate examples/self/app.qiy examples/self/admin
cd examples/self/admin
bun install
bun run db:generate && bun run db:migrate
bun run typecheck && bun run test && bun run build
```

## 登录配置（示例）

```sh
export QIY_OIDC_GOOGLE_ISSUER=https://accounts.google.com
export QIY_OIDC_GOOGLE_AUDIENCE=<google client id>
export QIY_OIDC_GOOGLE_JWKS_URL=https://www.googleapis.com/oauth2/v3/certs
export QIY_OIDC_GOOGLE_AUTHORIZATION_URL=https://accounts.google.com/o/oauth2/v2/auth
export QIY_OIDC_GOOGLE_TOKEN_URL=https://oauth2.googleapis.com/token
export QIY_OIDC_GOOGLE_CLIENT_ID=<google client id>
# Keycloak / Okta / Auth0 / Azure AD B2C / Kinde 同理，变量前缀为 QIY_OIDC_<ID>_
```

浏览器登录页会列出所有已配置 Provider（未配置的自动隐藏）；服务端接受任一 Provider 的 token，并按各自映射列找到用户。


## 本地演示（多 Provider 登录 + Ably realtime，端口 8000）

Demo 同时配置了 **5 个 OIDC Provider**，登录页每个配一项按钮，服务端按 token `iss` 路由到对应 JWKS：

| Provider | 身份源 | 身份列 |
| --- | --- | --- |
| okta | 本地 Dex A（:5556） | 默认 `iss|sub` → `subject` |
| keycloak | 本地 Dex B（:5557，不同 issuer） | `sub` → `keycloakSubject` |
| google | 真实 Google 租户（PKCE，回调 `/oauth/google`） | `sub` → 默认列 |
| kinde | 真实 Kinde 租户（回调 `/oauth/kinde`） | `sub` → 默认列 |
| azure-ad-b2c | 真实 Entra External ID 租户（回调 `/oauth/azure`） | `sub` → 默认列 |

Ably realtime 通过 `QIY_ABLY_API_KEY` 配置；登录后 `POST /api/v1/realtime/token` 返回 ably TokenRequest（subscribe-only capability）。

```sh
# 1) 生成并迁移
bun run qiy generate examples/self/app.qiy examples/self/admin
cd examples/self/admin && bun install
cd apps/server && bun run db:generate && bun run db:migrate

# 2) 两个 Dex 租户（本地）
docker run -d --name qiy-dex-demo  -p 5556:5556 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/dex.yaml
docker run -d --name qiy-dex-demo2 -p 5557:5557 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/keycloak.yaml

# 3) 演示环境（含 Ably key / 真实 Provider client id，本地保存、不提交）
cp examples/self/dex/demo.env examples/self/admin/apps/server/.env.development

# 4) 演示数据
bun run examples/self/dex/seed.ts examples/self/admin/apps/server/qiy.sqlite

# 5) 启动：API :8001，Web :8000（所有 Provider 回调都在 8000）
cd examples/self/admin/apps/server && bun --env-file=.env.development src/server.ts
cd examples/self/admin/apps/web && QIY_API_PROXY=http://localhost:8001 bun run dev -- --port 8000
```

登录页每个按钮对应一个真实的登录方式：

- **Okta / Keycloak**：本地 Dex 账号 `admin@example.com` / `admin-password`（两个不同 issuer，分别写 `subject` 与 `keycloakSubject`）；
- **Google**：任意 Google 账号；token 交换在生成服务端完成（`POST /api/v1/auth/exchange`，server 端持有 client secret，SPA 不暴露 secret、不依赖 IdP CORS）；
- **Kinde**：任意 Kinde 账号，但需在 Kinde 控制台把回调改为 `http://localhost:8000/oauth/kinde`（当前登记的是 3000，会返回 400）；
- **Azure AD B2C**：必须是该 External ID 租户里的**本地账号**；`@outlook.com` 这类个人 Microsoft 账号不会被接受（页面会提示"此组织中不存在此帐户"）。在 Entra 管理中心 Users → New user 建一个本地用户（或点登录页的"新建一个帐户"走自助注册），再用该邮箱+密码登录。

打开 <http://localhost:8000>：登录页列出 **Okta / Keycloak / Google / Kinde / Azure AD B2C** 五个按钮；Okta/Keycloak 用 `admin@example.com / admin-password` 登录，三个真实厂商按钮需要在其控制台把对应回调登记到 8000（Kinde 目前登记的是 3000，需要在 Kinde 控制台把回调改成 `http://localhost:8000/oauth/kinde`）。

> 回调路径任意（`/auth/callback`、`/oauth/google`、`/oauth/kinde`、`/oauth/azure` 都可以），生成 Web 用通配路由 `oauth/*` 统一落到回调组件；StrictMode 双执行与 token 交换 CORS 已处理。

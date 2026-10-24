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


## 本地演示（两个 Dex OIDC 租户，端口 8000）

示例用**两个独立的 Dex 实例**模拟两个不同的 OIDC Provider（不同 issuer），登录页会展示两个可选按钮，服务端按 token 的 `iss` 路由到对应 JWKS，并把 `keycloak` Provider 的 `sub` 映射到 `keycloakSubject` 列：

| Provider | issuer | client id | 身份列 |
| --- | --- | --- | --- |
| okta | http://localhost:5556/dex | qiy-admin | 默认 `iss\|sub` → `subject` |
| keycloak | http://localhost:5557/dex | qiy-keycloak | `sub` → `keycloakSubject` |

```sh
# 1) 生成并迁移
bun run qiy generate examples/self/app.qiy examples/self/admin
cd examples/self/admin && bun install
cd apps/server && bun run db:generate && bun run db:migrate

# 2) 两个 OIDC Provider（Dex）
docker run -d --name qiy-dex-demo  -p 5556:5556 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/dex.yaml
docker run -d --name qiy-dex-demo2 -p 5557:5557 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/keycloak.yaml

# 3) .env.development（API 在 8001，回调统一 http://localhost:8000/auth/callback）
#    PORT=8001
#    QIY_OIDC_OKTA_ISSUER=http://localhost:5556/dex
#    QIY_OIDC_OKTA_AUDIENCE=qiy-admin
#    QIY_OIDC_OKTA_CLIENT_ID=qiy-admin
#    ... JWKS/AUTHORIZATION/TOKEN/REDIRECT
#    QIY_OIDC_KEYCLOAK_ISSUER=http://localhost:5557/dex
#    QIY_OIDC_KEYCLOAK_AUDIENCE=qiy-keycloak
#    QIY_OIDC_KEYCLOAK_CLIENT_ID=qiy-keycloak
#    QIY_OIDC_KEYCLOAK_REDIRECT_URI=http://localhost:8000/auth/callback

# 4) 启动
cd apps/server && bun --env-file=.env.development src/server.ts     # API :8001
cd apps/web && QIY_API_PROXY=http://localhost:8001 bun run dev -- --port 8000  # Web :8000
```

打开 <http://localhost:8000>，登录页列出 **Okta / Keycloak** 两个按钮，均可用 `admin@example.com / admin-password` 登录；两个 Provider 的 password grant 与 PKCE 授权码流程都已验证会返回各自真实 token 并能访问生成 API。

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


## 本地演示（Dex OIDC，端口 8000）

```sh
# 1) 生成并迁移
bun run qiy generate examples/self/app.qiy examples/self/admin
cd examples/self/admin && bun install
cd apps/server && bun run db:generate && bun run db:migrate

# 2) 用本地 Dex 作为 OIDC Provider（http://localhost:5556/dex）
docker run -d --name qiy-dex-demo -p 5556:5556 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/dex.yaml

# 3) API 监听 8001，Web 监听 8000（所有 Provider 回调都是 http://localhost:8000/auth/callback）
#    .env.development 里配置：
#    PORT=8001
#    QIY_OIDC_OKTA_ISSUER=http://localhost:5556/dex
#    QIY_OIDC_OKTA_AUDIENCE=qiy-admin
#    QIY_OIDC_OKTA_JWKS_URL=http://localhost:5556/dex/keys
#    QIY_OIDC_OKTA_AUTHORIZATION_URL=http://localhost:5556/dex/auth
#    QIY_OIDC_OKTA_TOKEN_URL=http://localhost:5556/dex/token
#    QIY_OIDC_OKTA_CLIENT_ID=qiy-admin
#    QIY_OIDC_OKTA_REDIRECT_URI=http://localhost:8000/auth/callback

cd apps/server && bun --env-file=.env.development src/server.ts   # API :8001
cd apps/web && QIY_API_PROXY=http://localhost:8001 bun run dev -- --port 8000   # Web :8000
```

打开 <http://localhost:8000>，登录页会列出已配置的 Provider（示例为 Okta，实际指向本地 Dex），用 `admin@example.com / admin-password` 登录。

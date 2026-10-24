# 供应链 + ERP + WMS 一体化（examples/self）

一个模型同时覆盖供应链、ERP 与 WMS，并演示 Qiy 的**混合认证**：同一张登录页同时提供账号密码登录、多个 OAuth/OIDC Provider 按钮、首次 OAuth 登录的账号开通（onboarding），以及登录后在个人中心绑定/解绑更多 Provider。所有身份都落在同一张 `users` 表上——每个 Provider 一个可空唯一身份列，密码哈希列与 Provider 身份列共存。

## 模型内容

- **供应链**：供应商、客户、采购单/明细、收货、销售单/明细、发运、单据状态机；
- **ERP**：产品、BOM、工作单（生产/领料/产出流水）、成本与价格字段（字段级 mask）、仪表盘分布/趋势指标；
- **WMS**：组织（scope tree claim）、仓库、库位、库存（在手/预留/批次）、库存流水、上架/调拨/盘点/预留/发运等 dataflow 命令（幂等 + 审计 + 事务回滚）；
- **实时**：库存、库存流水、发运的 realtime outbox；
- **权限**：pages 页面级角色、restrict 字段 mask、scope 按 claim 过滤仓库；
- **混合登录**：`providers local, okta, keycloak, google, kinde, azure-ad-b2c;` 同时启用密码登录和 5 个 OIDC Provider；每个 Provider 映射到自己的身份列（`oktaSubject`、`keycloakSubject`、`googleSubject`、`kindeSubject`、`azureSubject`），`profileField oauthProfiles` 记录各 Provider 返回的 email/name，供个人中心展示。

```qiy
auth {
  providers local, okta, keycloak, google, kinde, azure-ad-b2c;
  user users;
  subjectField subject;          # 必填的唯一规范身份列；onboarding 写入 "<provider>:<subject>"
  roleField role;
  usernameField email;           # 密码账号的唯一登录标识
  passwordField passwordHash;    # 可空 Text，存 Argon2id 哈希
  profileField oauthProfiles;    # 可空 Text，存每个 Provider 的 email/name/sub（JSON）
  provider okta { subjectField oktaSubject; }
  provider keycloak { subjectField keycloakSubject; }
  provider google { subjectField googleSubject; }
  provider kinde { subjectField kindeSubject; }
  provider azure-ad-b2c { subjectField azureSubject; }
}
```

## 生成与运行

```sh
bun run qiy generate examples/self/app.qiy examples/self/admin --sync
cd examples/self/admin
bun install
bun run db:generate && bun run db:migrate
bun run typecheck && bun run test && bun run build
```

## 登录方式

| 方式 | 账号 | 说明 |
| --- | --- | --- |
| 本地密码 | `admin@example.com` / `admin-password` | `POST /api/v1/auth/login`；seed 里的管理员，role=admin |
| Dex A（`okta` Provider） | `admin@example.com` / `admin-password` | 已绑定 `oktaSubject`，直接登录并拿到 Qiy 会话 |
| Dex A（`okta` Provider） | `viewer@example.com` / `viewer-password` | 未绑定任何行：用于演示登录后从 `/profile` 绑定新 Provider |
| Dex B（`keycloak` Provider） | `admin@example.com` / `admin-password` | 已绑定 `keycloakSubject`，不同 issuer 的第二个租户 |
| Dex B（`keycloak` Provider） | `operator@example.com` / `operator-password` | **未绑定任何行**：首次登录触发 onboarding，创建账号（默认 role=viewer） |
| Google / Kinde / Azure AD B2C | 各自租户账号 | 首次登录同样走 onboarding；绑定/解绑规则一致 |

两个 Dex 租户（issuer 分别是 `http://localhost:5556/dex` 和 `http://localhost:5557/dex`）用于本地真实 OAuth 登录；Google/Kinde/Azure 三个按钮需要各自租户可用（client id/secret 见下）。

## 本地演示（混合登录 + Ably realtime，端口 8000）

```sh
# 1) 生成并迁移
bun run qiy generate examples/self/app.qiy examples/self/admin --sync
cd examples/self/admin && bun install
cd apps/server && bun run db:generate && bun run db:migrate

# 2) 两个 Dex 租户（本地）；租户 B 额外包含 operator@example.com 用于 onboarding 验收
docker run -d --name qiy-dex-demo  -p 5556:5556 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/dex.yaml
docker run -d --name qiy-dex-demo2 -p 5557:5557 -v "$PWD/../../dex:/etc/dex" ghcr.io/dexidp/dex:v2.41.1 dex serve /etc/dex/keycloak.yaml

# 3) 演示环境（含 Ably key / 真实 Provider client id，本地保存、不提交）
#    必需：QIY_AUTH_SECRET（至少 32 字符）、QIY_OIDC_DEFAULT_ROLE（默认 viewer）
cp examples/self/dex/demo.env examples/self/admin/apps/server/.env.development

# 4) 演示数据（管理员绑定两个 Dex 身份，密码 admin-password）
bun run examples/self/dex/seed.ts examples/self/admin/apps/server/qiy.sqlite

# 5) 启动：API :8001，Web :8000（所有 Provider 回调都在 8000）
cd examples/self/admin/apps/server && bun --env-file=.env.development src/server.ts
cd examples/self/admin/apps/web && QIY_API_PROXY=http://localhost:8001 bun run dev -- --port 8000
```

打开 <http://localhost:8000> 会进入 `/auth/login`：上方是 Refine `AuthPage` 的账号密码表单，下方按钮来自 `GET /api/v1/auth/providers`（只显示 env 配置完整的 Provider）。用 `admin@example.com` / `admin-password` 直接登录；或点 Dex Provider 按钮走真实 Authorization Code + PKCE。

首次 OAuth 登录（例如 Dex B 的 `operator@example.com`）的完整链路：

1. 回调页调用 `POST /api/v1/auth/exchange`（server 端完成 code 交换与 id_token 验签）；
2. 身份没有 `users` 行 → 返回 `{ needsOnboarding: true, onboardingToken, profile }`，`onboardingToken` 是 10 分钟 HS256 签名令牌；
3. Web 跳到 `/auth/onboarding?token=...`，表单用 IdP 的 username/email 预填，用户可修改用户名/email，并**必须设置至少 8 位的密码**；
4. `POST /api/v1/auth/oauth/register` 创建 `users` 行（写入该 Provider 身份列、Argon2id 密码哈希、`QIY_OIDC_DEFAULT_ROLE` 默认角色）并返回 Qiy 会话 token，用户直接进入应用。

登录后打开右上角 **Profile**（`/profile`）可以：

- 查看账号信息（用户名/email/角色/是否设置了密码）和每个 Provider 的绑定状态（含 Provider 返回的 email/name）；
- **绑定**新的 Provider（`POST /api/v1/auth/bind`）：同一 Provider 身份已属于其他账号时返回 409；
- **解绑**已绑定的 Provider（`POST /api/v1/auth/unbind`）：会拒绝移除最后一个登录方式（既没有密码、也没有其它绑定），返回 409。

会话本身始终是 Qiy 用 `QIY_AUTH_SECRET` 签发的 HS256 Bearer token（12 小时）；浏览器不再保存 Provider 的 access/id token。服务端仍接受未过期的 Provider token（按 `iss` 路由到对应 JWKS），用于兼容已有集成。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `QIY_AUTH_SECRET` | 至少 32 字符；签发密码会话与 onboarding 令牌，缺失时服务启动失败 |
| `QIY_OIDC_DEFAULT_ROLE` | 首次 OAuth onboarding 创建账号的角色，`admin`/`operator`/`viewer`，默认 `viewer` |
| `QIY_OIDC_<ID>_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | 每个 Provider 的验签配置（`<ID>` 为大写 Provider 名，如 `AZURE_AD_B2C`） |
| `QIY_OIDC_<ID>_AUTHORIZATION_URL` / `_TOKEN_URL` / `_CLIENT_ID` / `_SCOPE` / `_REDIRECT_URI` | 登录页 PKCE 配置；`_REDIRECT_URI` 可分别指向 `/auth/callback` 或 `/oauth/<id>` |
| `QIY_OIDC_<ID>_CLIENT_SECRET` | 仅服务端使用（confidential client 的 code 交换），绝不放入 `VITE_*` |

真实厂商按钮（Google/Kinde/Azure AD B2C）需要在各自控制台登记对应回调：

- **Google**：回调 `http://localhost:8000/oauth/google`；token 交换在生成服务端完成（`QIY_OIDC_GOOGLE_CLIENT_SECRET` 只存在于服务端）。
- **Kinde**：回调 `http://localhost:8000/oauth/kinde`；若 Kinde 控制台登记的是 3000，需要先改成 8000。
- **Azure AD B2C / Entra External ID**：回调 `http://localhost:8000/oauth/azure`；必须是该租户里的**本地账号**（`@outlook.com` 等个人 Microsoft 账号会被拒绝）。

> 回调路径任意（`/auth/callback`、`/oauth/google`、`/oauth/kinde`、`/oauth/azure` 都可以），生成 Web 用通配路由 `oauth/*` 统一落到回调组件；StrictMode 双执行已处理。

## 验收

仓库内脚本 `tmp/verify-hybrid-demo.ts`（不提交）会驱动两个真实 Dex 租户完成：匿名 401、Provider 列表 5 项、密码登录、已有身份 OAuth 登录、新身份 onboarding → 注册 → `/auth/me`、绑定/解绑/最后登录方式保护。仓库测试覆盖生成器侧的 DSL、路由、鉴权与页面生成（`bun test tests/auth-providers.test.ts`）。

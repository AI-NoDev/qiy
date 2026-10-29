# 认证与权限

这篇指南讲**怎么把认证配起来、跑通、上线前检查什么**。完整语法、属性表、Provider 配置表、全部环境变量与校验错误见 [DSL：认证与登录](/dsl/auth)；权限模型见 [DSL：权限](/dsl/permissions)。

## 声明身份来源

最常用的三种起步：

```qiy
// 1) 本地密码（开发最快；账号由 CLI 创建）
auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

// 2) 单一 OIDC/OAuth2/SSO（企业 IdP）
auth { provider oidc; user users; subjectField externalSubject; roleField role; }

// 3) 混合：一张登录页同时有密码表单和多个 Provider 按钮
auth {
  providers local, okta, keycloak, google;
  user users;
  subjectField subject;
  roleField role;
  usernameField email;
  passwordField passwordHash;
  profileField oauthProfiles;
  provider okta { subjectField oktaSubject; }
  provider keycloak { subjectField keycloakSubject; }
  provider google { subjectField googleSubject; }
}
```

| 字段 | 说明 |
| --- | --- |
| `provider` | `local`、`otp`、`oidc`、`oauth2`、`sso`、`okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google`、`kinde`。单 Provider 写法 |
| `providers` | Provider 列表；可含 `local`（混合认证），不能含 `otp`、不能重复，且与 `provider` 互斥 |
| `local` | 由生成器推导（`providers` 含 `local` 或 `provider local`），DSL 不直接书写 |
| `user` | 用户实体名，必须存在 |
| `subjectField` | 外部身份 ID 映射列；有 OAuth 时必须是**非空 + 唯一 + Text** |
| `roleField` | 角色列，必须是枚举且值恰好 `admin`/`operator`/`viewer` |
| `usernameField` | 本地密码/OTP 登录标识列；必须**非空 + 唯一 + Text** |
| `passwordField` | 密码哈希列；必须 `@nullable` Text，不进 API schema |
| `profileField` | 可选 `@nullable` Text：保存每个 Provider 的 email/name/sub（JSON），供个人中心展示 |
| `provider <id> { subjectField …; claim …; }` | 每 Provider 身份列与身份 claim；混合模式下每个 Provider 必须有**自己的** `@nullable @unique` Text 列 |

## 用户模型

```qiy
enum userRole {
  value admin label "管理员" color red icon SafetyOutlined;
  value operator label "运营" color blue icon UserOutlined;
  value viewer label "只读" color default icon EyeOutlined;
}

entity users table users @label("用户") @icon(SafetyOutlined) {
  field id UUID @id;
  field email Text @unique;                                   // usernameField
  field displayName Text @nullable;
  field passwordHash Text @nullable @listVisible(false) @showVisible(false);
  field role userRole;                                        // roleField
  field subject Text @unique;                                 // subjectField（规范身份列）
  field oktaSubject Text @unique @nullable;                   // 每 Provider 身份列
  field googleSubject Text @unique @nullable;
  field oauthProfiles Text @nullable;                         // profileField
  field permissions Text @nullable;                           // permission from database field
}
```

- 混合模式下，除自动填充列（id / username / password / role / subject / email / displayName / name / profile / 各 Provider 身份列）以外的**必填**字段必须可空，否则生成期直接报 `Auth: OAuth onboarding cannot populate required user fields: …; make them nullable`。
- 如果声明了 `scope <resource> <field> claim org.id`，users 必须有 `orgId` 列（本地密码会话与 API Key 用它派生 claim）。

## 认证模式与生成结果

| 模式 | 登录页 | 服务端 | 额外路由 |
| --- | --- | --- | --- |
| 本地密码 | Refine `AuthPage`（无注册/忘记密码/记住我） | Argon2id 校验 + HS256 12h 会话 | `/auth/login` 页、`POST /api/v1/auth/login` |
| 单一 OIDC | PKCE 登录页（`VITE_QIY_*`） | JWKS + issuer/audience 验签 | `/auth/callback` |
| 多 Provider | 按 `GET /api/v1/auth/providers` 渲染按钮 | 按 token `iss` 路由到对应 JWKS | `/auth/callback`（`/oauth/*` 别名） |
| 混合 | 一张页：密码表单 + Provider 按钮 | `auth/hybrid.ts` 合并两种认证 | `/auth/onboarding`、`/profile`、bind/unbind/identities |
| OTP | 两阶段（标识 → 验证码） | challenge + 12h 会话 | `/api/v1/auth/otp/request`、`/verify` |

生成物清单、每个文件的职责见 [DSL：认证 · 生成文件](/dsl/auth#生成文件)。

## Authorization Code + PKCE

Okta、Auth0、Azure AD B2C、Keycloak、Google、Kinde 和通用 OIDC/OAuth2/SSO 共用浏览器端 Authorization Code + PKCE 适配器：`/auth/callback`、`state` 校验、S256 code challenge、可选 RP logout。它不生成 provider-specific SDK，也不把 client secret 放进 Web bundle。**单一 OIDC 模式**由浏览器直接 POST 到 IdP 的 `VITE_QIY_TOKEN_URL` 换取 token（public client，无 client secret）；**多 Provider / hybrid 模式**才经服务端 `POST /api/v1/auth/exchange` 兑换（服务端可持有 client secret 并验签 id_token）。

**单一 OIDC 模式**的 Web 环境变量：

```dotenv
VITE_QIY_AUTHORIZATION_URL=https://identity.example.com/oauth2/authorize
VITE_QIY_TOKEN_URL=https://identity.example.com/oauth2/token
VITE_QIY_CLIENT_ID=qiy-admin-spa
VITE_QIY_AUTH_SCOPE=openid profile email
VITE_QIY_REDIRECT_URI=https://admin.example.com/auth/callback
VITE_QIY_LOGOUT_URL=https://identity.example.com/logout
```

服务端仍用 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE`、`QIY_OIDC_JWKS_URL` 独立验签 access token（issuer/JWKS 必须 HTTPS）。Azure AD B2C 的 tenant/policy、Keycloak realm、Okta authorization server、Auth0 audience 都必须用真实租户值。

**多 Provider 与混合模式**不生成 `VITE_QIY_*`：配置全部来自服务端 `QIY_OIDC_<ID>_*`，登录页只拿到公开字段（authorize/token URL、client id、scope、redirect URI）。

远程 JWKS 的三个时间窗可按 IdP 调整，非法值启动即失败：

```dotenv
QIY_OIDC_JWKS_TIMEOUT_MS=5000        # 单次请求超时
QIY_OIDC_JWKS_COOLDOWN_MS=30000      # 未知 kid 后最短重取间隔（0 = 立即生效）
QIY_OIDC_JWKS_CACHE_MAX_AGE_MS=600000 # 缓存有效期 = 撤销的最坏延迟
```

轮换建议：IdP 先发布新 key 并保持 ≥ 一个 `CACHE_MAX_AGE` → 用新 key 签发 → 宽限期结束后移除旧 key。

## 会话与令牌

| 令牌 | 有效期 | 说明 |
| --- | --- | --- |
| 本地密码会话 | 12h | HS256、`iss=aud=qiy-admin`、`sub`=用户 id、`role` |
| OTP 会话 | 12h | 同上，`typ=qiy-otp` |
| OTP challenge | 5min | 含 `identifier` 与 `otpHash`，不依赖进程内存 |
| onboarding 令牌 | 10min | `typ=qiy-onboarding`，只证明「IdP 已验证该身份」 |
| Provider access token | IdP 决定 | 服务端按 `iss` 选 JWKS，验签后查用户行 |

- 浏览器把 token 存 `localStorage["qiy.access_token"]`；**不存 refresh token**，也没有 refresh cookie/BFF 续期。
- 单一 OIDC 模式用 `qiy.expires_at`（提前 60 秒）判定过期，并尝试一次 `prompt=none` 静默续期；`login_required`/`interaction_required`/`consent_required`/`account_selection_required` 视为需要交互，直接回登录页。多 Provider/混合模式不做静默续期。
- `GET /auth/me` 返回 `{ id, name, role, claims?, permissions?, groups? }`；权限与组只在声明了 `permission` 时出现。
- 角色以**数据库行**为准：每次请求重新读用户行，降权下一请求生效。
- **会话吊销**：`POST /api/v1/auth/logout-all` 写入 `qiy_session_revocations` 水位；该用户所有在此时刻之前签发的本地 token 立即 401。个人中心的「Sign out all devices」调用该端点并退出当前会话。

## 密码与账号运维

| 项目 | 现状 |
| --- | --- |
| 哈希 | `Bun.password` Argon2id |
| 最小长度 | 8 字符（无复杂度要求） |
| 未知账号 | 仍执行一次 dummy 校验再 401（避免时序侧信道） |
| 限流/锁定 | 本地密码登录默认按用户名（小写）计数：15 分钟窗口内 5 次失败后锁定 15 分钟，返回 **429 + Retry-After**；可用 `QIY_AUTH_LOGIN_MAX_ATTEMPTS`、`QIY_AUTH_LOGIN_WINDOW_MS`、`QIY_AUTH_LOGIN_LOCK_MS` 调整。计数在**单进程内存**中，多实例部署需网关/WAF 或共享限流 |
| 会话吊销 | `POST /api/v1/auth/logout-all`（个人中心按钮）；按用户写入 `qiy_session_revocations.revokedBefore`，之前签发的本地会话全部失效 |
| 初始管理员 | `bun run auth:bootstrap-admin`（读 `.env.production`，已存在 admin 时拒绝） |
| 重置密码 | `bun run auth:set-password`（按用户名/邮箱定位唯一一行） |
| 自助改密 | 未生成；个人中心只显示密码是否已设置 |

## OTP

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

- `POST /api/v1/auth/otp/request { identifier }` → `{ challengeToken, expiresIn: 300 }`；`POST /api/v1/auth/otp/verify { identifier, challengeToken, code }` → 12 小时会话。
- 生产必须配置 HTTPS 发送适配器：

```dotenv
QIY_AUTH_SECRET=<至少 32 字符随机值>
QIY_OTP_DELIVERY_URL=https://notification.example.com/otp
QIY_OTP_DELIVERY_TOKEN=<发送适配器凭据>
QIY_OTP_DELIVERY_TIMEOUT_MS=10000
```

- 适配器收到 `POST { recipient, code, expiresIn: 300 }`，可带 `Authorization: Bearer`；必须 2xx。
- 发送失败 → **502** `errorKey: "auth.otpDeliveryFailed"`，**不签发** challenge；服务端只记录适配器错误，不记录验证码；`QIY_DEV_MODE=1` 才返回详情。
- 开发：`QIY_DEV_MODE=1` + `QIY_OTP_DEV_CODE` 使用固定码并回显 `devCode`；**生产禁止**。
- 未知标识返回同构 200 + challenge，`verify` 401，避免枚举账号。
- 已知边界：无按标识/IP 限流；challenge 在 5 分钟内可重复使用（未持久化一次性消费）。

## 页面级权限与命令权限

| 路由 | 判定动作 |
| --- | --- |
| `/:resource` | `list` |
| `/:resource/new` | `create` |
| `/:resource/:id` | `show` |
| `/:resource/:id/edit` | `edit` |

- 守卫由 `app/components/resource-page-guard.tsx` 提供，通过 Refine `CanAccess` 调用 `AccessControlProvider`；拒绝渲染 403 `Result`，不会向后端发该页面的请求。
- 判定来源：生成认证时是「资源角色策略（`restrict.roles`）→ 页面规则（`pages`）→ 命令策略（dataflow/action `allow`）」；`mode integration` 时委托 `window.qiyHostAuth.can({ resource, action, params })`，未实现或抛错一律拒绝。
- 手动业务页（`action … page manual`）同样用 `CanAccess` 包裹，动作名即 action 名。
- **命令授权在服务端命令路由内执行**：`/api/v1/commands` 已从通用角色守卫豁免，否则持有 `allow permission` 的非 admin/operator 用户会被误拒。
- 按钮/页面隐藏不是授权；服务端 `allow`、`restrict`、`scope`、`require` 才是最终边界。

权限声明后的额外生成物（`auth/permissions.ts`、`/auth/permissions`、`/auth/verify-permission`、`/auth/me` 的 `permissions`/`groups`）见 [DSL：权限](/dsl/permissions)。

## 多 Provider（非混合）的账号前提

多 Provider 模式**不创建账号**：`/auth/exchange` 只换 token，`/auth/me` 再用该 Provider 的身份列查用户行。IdP 里合法但系统里没有行的身份，登录后会表现为「无身份 → 各页面 403」。上线前先建好用户行并填好对应 Provider 的身份列（`auth:bootstrap-admin` 只建本地账号，需要补列或写管理脚本）。

## 混合登录：首次登录开通与账号绑定

`providers` 含 `local` 即为混合模式：一张 `/auth/login` 同时渲染密码表单与 Provider 按钮；服务端 `auth/hybrid.ts` 把 `issuer=qiy-admin` 的密码会话（HS256，12h）与按 `iss` 路由的 Provider token 合成同一个 Bearer 认证器。

### 端点

| 端点 | 认证 | 说明 |
| --- | --- | --- |
| `POST /api/v1/auth/login` | 公开 | 密码登录，返回会话 token |
| `GET /api/v1/auth/providers` | 公开 | `{ providers, local: true }`，供登录页渲染按钮 |
| `POST /api/v1/auth/exchange` | 公开 | 服务端完成 code 兑换与 id_token 验签；已有身份返回会话；新身份返回 `{ needsOnboarding: true, onboardingToken, provider, profile }` |
| `POST /api/v1/auth/oauth/register` | 公开 + onboarding token | `{ onboardingToken, username, email?, password }` 创建账号，返回会话 |
| `POST /api/v1/auth/bind` | Bearer | `{ provider, code, codeVerifier, redirectUri }` 或 `{ onboardingToken }`；身份属于其它账号 → 409 |
| `POST /api/v1/auth/unbind` | Bearer | `{ provider }`；会成为最后一个登录方式时 409 |
| `GET /api/v1/auth/identities` | Bearer | 账号、是否设置密码、每个 Provider 的绑定状态与 profile |

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `QIY_AUTH_SECRET` | ≥32 字符；签发密码会话与 onboarding 令牌，并做 API Key pepper；缺失时启动失败 |
| `QIY_OIDC_DEFAULT_ROLE` | onboarding 新账号角色：`admin`/`operator`/`viewer`，默认 `viewer`（非法值启动失败） |
| `QIY_OIDC_<ID>_*` | 每个 Provider 的验签与 PKCE 配置 |

`onboardingToken` 是 HS256 JWT：`iss/aud = qiy-admin`、`typ = qiy-onboarding`、10 分钟有效、`QIY_AUTH_SECRET` 签名；注册接口只信任 token 里的身份，不接受客户端提交的 Provider/subject。

未配置任何 Provider 的混合项目仍可用密码登录（`/auth/providers` 返回空按钮列表）；配置了 Provider 但没有历史用户行时，第一次 OAuth 登录走 onboarding 而不是 401。

## Provider 配置与验收

完整的 Provider 配置表（Okta/Keycloak/Google/Kinde/Azure AD B2C/Auth0/Dex）与环境变量见 [DSL：认证 · Provider 配置表](/dsl/auth#provider-配置表)。真实租户验收：

```sh
bun tools/verify-multi-provider.ts     # 多 Provider 路由/映射/公开列表（本地 JWKS）
bun tools/verify-oidc-docker.ts --isolated   # 临时 HTTPS IdP + 容器内生成与认证测试（需 Docker）
bun tools/verify-okta.ts               # 需要 QIY_OKTA_* 与 HTTPS_PROXY
bun tools/verify-google.ts             # 需要 QIY_GOOGLE_*
bun tools/verify-azure-b2c.ts / verify-keycloak.ts / verify-kinde.ts / verify-dex.ts
```

`verify-oidc-docker.ts --isolated` 会创建临时网络、自签名证书和仅供测试的 HTTPS IdP，再从 `.qiy` 生成 SQLite/OIDC 应用，在容器内安装依赖、测试 HTTP 认证与类型检查；服务只通过临时 `NODE_EXTRA_CA_CERTS` 信任该证书，仍校验 TLS/签名/issuer/audience/用户映射；结束后删除容器、网络与工作目录。

受限网络下 Bun `fetch` 需要代理（生成器服务端同理）：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:10090"
$env:HTTP_PROXY="http://127.0.0.1:10090"
$env:NO_PROXY="localhost,127.0.0.1"
```

:::warning 当前限制

生成器与本地模拟已覆盖这些 Provider，但真实 Okta/Auth0/Azure/Keycloak/Google/Kinde 租户、JWKS 轮换、claim/audience、退出登录和第三方 Cookie 策略仍需逐个环境验收。OTP 发送适配器已用真实 HTTPS 服务验收投递载荷、凭据、超时、fail-closed 与开发模式边界，但真实短信/邮件供应商、供应商侧限流与一次性消费仍需在目标环境验收。

:::

## 审计、通知与数据访问

生成约定见 [Refine providers](./refine-providers)。受保护的生产 API 请求必须携带通过验证的 Bearer JWT；生产应保持 `QIY_DEV_MODE=0` 并配置所选认证 provider；没有认证配置的生成应用会拒绝生产启动，开发 preview 不能替代生产认证。

## 相关

- [DSL：认证与登录](/dsl/auth)：完整语法、Provider 表、全部环境变量、校验错误。
- [DSL：权限](/dsl/permissions)：原子权限、权限组、`restrict`/`scope`/`pages`。
- [API 文档与访问密钥](./api-docs-and-keys)：API Key 与 `features`。
- [真实外部服务验收](./real-services)：各 IdP 的脚本与凭据。
- 生成项目测试：`apps/server/tests/{auth,local-auth,hybrid-auth,otp-auth,api-keys,permissions}.test.ts`。

# 认证与权限

## 声明身份来源

```ts
auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
```

OIDC、OAuth2 和企业 SSO 也可以使用 `subjectField` 映射外部身份：

```ts
auth { provider oidc; user users; subjectField externalSubject; roleField role; }
```

同一个应用可以同时启用密码登录和多个 OAuth Provider（混合认证）：

```qiy
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
| `provider` | `local`、`otp`、`oidc`、`oauth2`、`sso`、`okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google` 或 `kinde`。单 Provider 写法 |
| `providers` | Provider 列表；可包含 `local`（混合认证），不能包含 `otp`、不能重复，且与单个 `provider` 互斥 |
| `local` | 由生成器推导：`providers` 列表包含 `local` 或 `provider local` 时为 `true`；DSL 中不直接书写 |
| `user` | 用户实体名，必须存在 |
| `subjectField` | 外部身份 ID 映射到的字段，通常对应 `sub`。混合认证中它是必填的唯一规范身份列（onboarding 写入 `<provider>:<subject>`） |
| `roleField` | 角色字段，通常引用枚举 |
| `usernameField` | 本地密码或 OTP 登录标识字段；必须是唯一、非空的 Text 字段 |
| `passwordField` | 本地密码哈希字段；只用于服务端验证，不进入 API schema |
| `profileField` | 可选的可空 Text 字段：保存每个 Provider 返回的 email/name/sub（JSON），供个人中心展示绑定信息 |

## 用户模型

```ts
enum userRole {
  value admin label "管理员" color red icon SafetyOutlined;
  value operator label "运营" color blue icon UserOutlined;
  value viewer label "只读" color default icon EyeOutlined;
}

entity users table users @label("用户") @icon(SafetyOutlined) {
  field id UUID @id;
  field email Text @unique;
  field displayName Text;
  field externalSubject Text @unique @listVisible(false) @showVisible(false);
  field role userRole @label("角色") @filterable(true);
  index users_email_idx btree(email) @unique;
}
```

`externalSubject` 通常不出现在列表和详情中，只用于登录时匹配身份。

## Authorization Code + PKCE

Okta、Auth0、Azure AD B2C、Keycloak、Google、Kinde 和通用 OIDC/OAuth2/SSO provider 共用浏览器端 Authorization Code + PKCE 适配器。生成项目包含 `/auth/callback`、state 校验、S256 code challenge、token exchange 和可选 RP logout。它不生成 provider-specific SDK，也不会把 client secret 放进 Web bundle。

Web 环境变量：

```dotenv
VITE_QIY_AUTHORIZATION_URL=https://identity.example.com/oauth2/authorize
VITE_QIY_TOKEN_URL=https://identity.example.com/oauth2/token
VITE_QIY_CLIENT_ID=qiy-admin-spa
VITE_QIY_AUTH_SCOPE=openid profile email
VITE_QIY_REDIRECT_URI=https://admin.example.com/auth/callback
VITE_QIY_LOGOUT_URL=https://identity.example.com/logout
```

服务端仍使用 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE`、`QIY_OIDC_JWKS_URL` 独立验证 access token。Azure AD B2C 的 tenant/policy、Keycloak realm、Okta authorization server、Auth0 audience 等必须使用真实租户值配置。

远程 JWKS 的三个时间窗口可按 IdP 调整，非法值会在启动时 fail-closed：

```dotenv
QIY_OIDC_JWKS_TIMEOUT_MS=5000
QIY_OIDC_JWKS_COOLDOWN_MS=30000
QIY_OIDC_JWKS_CACHE_MAX_AGE_MS=600000
```

- `QIY_OIDC_JWKS_TIMEOUT_MS`：单次 JWKS 请求超时。IdP 无响应时验证快速失败并返回 401，而不是挂住登录链路。
- `QIY_OIDC_JWKS_COOLDOWN_MS`：已成功获取密钥后，遇到未知 `kid` 需要等待多久才允许再次获取。设为 0 表示新密钥可立即生效；默认 30 秒可减少 IdP 抖动。
- `QIY_OIDC_JWKS_CACHE_MAX_AGE_MS`：缓存密钥的有效期，**同时是密钥退役（撤销）的最坏生效延迟**。已缓存的密钥即使已从 JWKS 移除，在缓存过期前仍会通过验签——这是本实现的已知语义，因此该值决定"轮换宽限期"与"撤销延迟"的取舍。

轮换操作建议：IdP 先发布新密钥（新旧并存）并保持至少一个 `CACHE_MAX_AGE`，再开始用新密钥签发，最后在宽限期结束后移除旧密钥。这样新 `kid` 会触发重新获取，而旧密钥仍在缓存有效期内可用，不会中断登录。

## 会话有效期与静默续期

登录回调会把 `expires_in` 换算成 `qiy.expires_at` 存入 `localStorage`。当 IdP 未返回 `expires_in` 时视为"有效期未知"，行为与之前一致（不会因本地判断而提前登出）。

`qiyAuthProvider.check` 用剩余有效期（提前 60 秒）判断会话是否仍可用；过期即视为未认证并跳转 `/auth/login`，而不是继续把已失效的 token 当成已登录。`/auth/login` 在这个情况下会先尝试**静默续期**：以 `prompt=none` 重新发起 Authorization Code + PKCE 流程，依赖 IdP 仍有效的会话 Cookie 直接换回新 token。

- 每个重定向周期只尝试一次（`sessionStorage` 标记），避免 IdP 拒绝时形成无限跳转；失败后显示常规登录按钮。
- 回调页把 `login_required`、`interaction_required`、`consent_required`、`account_selection_required` 识别为"需要交互"，直接转到登录页而不是报错。
- 401 时清除本地会话（access/id token 与有效期）后再跳转登录页。

Qiy **不会**把 refresh token 存进浏览器存储，也没有实现基于 refresh cookie 的续期：`localStorage` 中的长效 refresh token 会放大 XSS 影响，而 refresh cookie 需要由后端作为 OIDC 客户端（BFF）持有。当前方案只依赖 IdP 会话，因此 IdP 侧必须保留会话 Cookie 并允许 `prompt=none`；部署在 `iframe` 或第三方 Cookie 被阻断的场景需要改用 BFF 方案。

## OTP

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

OTP 生成 `/api/v1/auth/otp/request` 和 `/api/v1/auth/otp/verify`。challenge 是 5 分钟签名令牌，不依赖进程内存；验证成功后签发 12 小时 Bearer access token。生产环境必须配置 HTTPS 发送适配器：

```dotenv
QIY_AUTH_SECRET=<至少 32 字符随机值>
QIY_OTP_DELIVERY_URL=https://notification.example.com/otp
QIY_OTP_DELIVERY_TOKEN=<发送适配器凭据>
QIY_OTP_DELIVERY_TIMEOUT_MS=10000
```

Qiy 会向 `QIY_OTP_DELIVERY_URL` POST `{ recipient, code, expiresIn: 300 }`，并在配置了 `QIY_OTP_DELIVERY_TOKEN` 时带上 `Authorization: Bearer`。适配器必须返回 2xx，否则本次登录按失败处理。

发送失败时请求返回 **502** 与稳定 `errorKey: "auth.otpDeliveryFailed"`，**不会**签发 challenge，因此不会出现“客户端拿到 challenge 但用户没收到验证码”的状态；服务端只记录适配器错误，不记录验证码。`QIY_OTP_DELIVERY_TIMEOUT_MS`（默认 10000，允许 100–60000）通过 `AbortSignal.timeout` 生效，避免供应商无响应时挂住登录请求。地址必须是 `https:`；开发模式（`QIY_DEV_MODE=1`）下响应会附带适配器错误详情便于排查，生产环境只返回通用文案。

未知登录标识不会触达发送适配器，但仍返回结构相同的 200 + challenge，`verify` 返回 401，以免暴露账号是否存在。

开发环境可设置 `QIY_DEV_MODE=1` 和 `QIY_OTP_DEV_CODE`；生产环境不得启用固定验证码。发送适配器负责邮件、短信投递与供应商侧错误处理，Qiy 不绑定特定短信厂商。

当前边界：Qiy 未实现按标识或来源 IP 的频率限制，也未把 challenge 做成一次性使用——一次成功验证后，同一 challenge 在 5 分钟有效期内仍可再次换取 access token。面向公网的生产部署必须在发送适配器或前置网关上补充限流，并按需自行持久化一次性消费记录。

## 生成结果

- server：本地 Argon2id 密码验证、OTP challenge/verify，或 OIDC/OAuth2/SSO 的 JWKS、issuer、audience 校验与角色守卫；混合认证还会生成 `auth/hybrid.ts`（组合密码会话与 Provider token）、`auth/account.ts`（`GET /api/v1/auth/identities`）以及 onboarding/绑定的路由；
- web：Refine `AuthProvider`、`AccessControlProvider`、`Authenticated` 与登录页；
- 路由：本地 `AuthPage`、OTP 两阶段登录页、外部身份的 PKCE 登录与 callback 页面，混合认证额外生成 `/auth/onboarding` 与 `/profile`。

## 页面级权限

每个资源页面都包在按页面动作判定的守卫里，直接输入 URL 也不能渲染未授权页面：

| 路由 | 判定动作 |
| --- | --- |
| `/:resource` | `list` |
| `/:resource/new` | `create` |
| `/:resource/:id` | `show` |
| `/:resource/:id/edit` | `edit` |

守卫由 `app/components/resource-page-guard.tsx` 提供，通过 Refine 的 `CanAccess` 调用 `AccessControlProvider`；拒绝时渲染 403 `Result`，不会渲染页面内容，也不会向后端发起该页面的请求。因此菜单/按钮隐藏与页面直达使用同一份判定，不存在"按钮藏了但 URL 能开"的缺口。

判定来源随模式不同：生成认证时是角色（admin 全通、`operator` 可增改、`viewer` 只读、用户管理仅 admin），并与 `restrict <resource> { allow roles ... }` 的角色列表合并；`mode integration` 时委托宿主 `window.qiyHostAuth.can({ resource, action, params })`，宿主未实现或抛错一律拒绝。未声明认证的应用不生成守卫。

手动业务页（`action ... page manual`）继续使用 `CanAccess` 包裹，动作名即 `action` 名称，服务端仍是最终授权方：页面守卫只决定界面是否渲染，数据范围与写入权限由 API 的 `restrict`/`scope`、Dataflow 角色或宿主后端执行。

审计、通知、权限、认证和数据访问的生成约定见 [Refine providers](./refine-providers)。

受保护的生产 API 请求必须携带通过验证的 Bearer JWT。生产应保持 `QIY_DEV_MODE=0` 并配置所选认证 provider；没有认证配置的生成应用会拒绝生产启动，开发 preview 不能替代生产认证。

## 多 Provider 登录（多选 + 每 Provider 身份字段）

一个应用可以同时启用多个 OIDC Provider，登录页会列出所有已配置的 Provider 供用户选择；服务端按 token 的 `iss` 选择对应 JWKS 验签，并允许每个 Provider 映射到用户表里不同的身份字段（例如 Google 用 `sub`、OpenID 类 Provider 用 `openid` 列）。

```text
auth {
  providers oidc, oauth2, sso, okta, auth0, azure-ad-b2c, keycloak, google, kinde;
  user users;
  subjectField subject;          # 默认：{<iss>}|<sub> 写入该列
  roleField role;
  provider google { subjectField googleSubject; }          # 用 sub 写入 googleSubject
  provider oidc { subjectField openidField; claim openid; } # 用 openid claim 写入 openidField
}
```

- `providers` 与单个 `provider` 互斥；列表只接受 OIDC 家族 Provider 和可选的 `local`（`local` 表示同时开启密码登录，见下一节），不能包含 `otp`，且不能重复；
- `provider <id> { subjectField <field>; [claim <claim>;] }` 为该 Provider 指定用户表列与身份 claim（默认 claim 是 `sub`）；映射的 Provider 必须出现在 `providers` 中；
- 未配置 `ISSUER/AUDIENCE/JWKS_URL` 的 Provider 会在运行时自动禁用，不会阻塞其它 Provider；
- 生成器额外提供 `GET /api/v1/auth/providers`（只含公开字段：authorize/token URL、client id、scope、redirect URI），生成 Web 的登录页用它渲染 Provider 按钮（PKCE），回调按 Provider 完成 token 交换。

每个 Provider 的环境变量（`<ID>` 为 Provider 名大写、非字母数字换成下划线，例如 `AZURE_AD_B2C`）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `QIY_OIDC_<ID>_ISSUER` | 是 | 该 Provider 的 issuer（按 token `iss` 精确匹配，忽略尾部斜杠） |
| `QIY_OIDC_<ID>_AUDIENCE` | 是 | 该 Provider 的 audience |
| `QIY_OIDC_<ID>_JWKS_URL` | 是 | 该 Provider 的 JWKS 地址（便于 Keycloak/B2C 等按 policy 区分） |
| `QIY_OIDC_<ID>_AUTHORIZATION_URL` / `_TOKEN_URL` / `_CLIENT_ID` | 登录页需要 | 公开客户端 PKCE 配置 |
| `QIY_OIDC_<ID>_SCOPE` / `_REDIRECT_URI` / `_LOGOUT_URL` | 否 | 默认 `openid profile email`，redirect 可用全局 `QIY_OIDC_REDIRECT_URI` |
| `QIY_OIDC_<ID>_CLIENT_SECRET` | confidential client 需要 | 只存在服务端，用于 BFF 的 code 交换；绝不放进 `VITE_*` |

离线验收：`bun run tools/verify-multi-provider.ts` 会生成一个多 Provider 应用、用本地 JWKS 服务签真实 RS256 token，验证：按 issuer 路由、默认 `iss|sub` 映射、`openid` 非 sub claim 映射到专用列、未知 issuer/伪造签名拒绝、公开 Provider 列表只包含已配置项。

## 混合登录：密码 + OAuth（首次登录开通与账号绑定）

`providers` 列表里加 `local` 即可生成混合认证：一张 `/auth/login` 页面同时渲染 Refine `AuthPage` 的账号密码表单和所有已配置 Provider 按钮。服务端生成 `auth/hybrid.ts`，把 `issuer=qiy-admin` 的密码会话（HS256，12 小时）与按 `iss` 路由的 Provider token 合成同一个 Bearer 认证器。

约束（生成器校验）：

- `providers` 含 `local` 时必须同时声明 `usernameField` 与 `passwordField`；
- 每个 OAuth Provider 必须有**自己的** `subjectField` 映射，且该列必须是**可空 + 唯一**的 Text（本地密码账号没有该 Provider 身份，绑定也需要唯一性）；
- `subjectField`（规范身份列）仍是必填唯一列，onboarding 写入 `<provider>:<subject>`；
- `profileField` 若声明，必须是可空 Text；
- 用户表里除自动填充列（id/username/password/role/subject/email/displayName/profile 与各 Provider 身份列）以外的必填字段必须可空，否则 onboarding 无法创建账号，生成阶段直接报错。

### 端点

| 端点 | 认证 | 说明 |
| --- | --- | --- |
| `POST /api/v1/auth/login` | 公开 | 账号密码登录，返回 Qiy 会话 token |
| `GET /api/v1/auth/providers` | 公开 | 返回 `{ providers, local: true }` 供登录页渲染按钮 |
| `POST /api/v1/auth/exchange` | 公开 | BFF 完成 code 兑换与 id_token 验签；已有身份直接返回会话；新身份返回 `{ needsOnboarding: true, onboardingToken, profile }` |
| `POST /api/v1/auth/oauth/register` | 公开 + onboarding token | `{ onboardingToken, username, email?, password }` 创建用户行、写入 Provider 身份列与密码哈希、按 `QIY_OIDC_DEFAULT_ROLE` 赋角色，返回会话 token |
| `POST /api/v1/auth/bind` | Bearer | `{ provider, code, codeVerifier, redirectUri }` 或 `{ onboardingToken }`：把该 Provider 身份写入当前账号；身份已属于其它账号时 409 |
| `POST /api/v1/auth/unbind` | Bearer | `{ provider }` 解绑；没有密码且没有其它绑定时 409（拒绝移除最后一个登录方式） |
| `GET /api/v1/auth/identities` | Bearer | 账号信息、是否设置密码、每个 Provider 的绑定状态与记录的 email/name |

`onboardingToken` 是 HS256 签名 JWT：`iss/aud = qiy-admin`、`typ = qiy-onboarding`、10 分钟有效，`QIY_AUTH_SECRET`（至少 32 字符）签名；注册接口只信任 token 里的身份，不信任客户端提交的 Provider/subject。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `QIY_AUTH_SECRET` | 至少 32 字符；签发密码会话与 onboarding 令牌，缺失时服务启动失败 |
| `QIY_OIDC_DEFAULT_ROLE` | 首次 OAuth onboarding 创建账号的角色：`admin` / `operator` / `viewer`，默认 `viewer` |
| `QIY_OIDC_<ID>_*` | 每个 Provider 的验签与 PKCE 配置，同上表 |

未配置任何 Provider 的混合项目仍可用密码登录启动（`/auth/providers` 返回空按钮列表）；配置了 Provider 但没有历史用户行时，第一次 OAuth 登录会走 onboarding 而不再返回 401。


## 源码仓库认证验收

```sh
bun tools/verify-oidc-docker.ts --isolated
```

需要 Docker。命令创建临时网络、短期自签名证书和仅供测试的 HTTPS IdP，再从 `.qiy` 生成 SQLite/OIDC 应用，在 Docker 内安装依赖、测试 HTTP 认证和检查服务端类型。生成服务只通过临时 `NODE_EXTRA_CA_CERTS` 信任该测试证书，仍验证 TLS、签名、issuer、audience 和用户映射；结束后删除临时容器、网络及工作目录。

若指定已有测试容器，例如 `bun tools/verify-oidc-docker.ts qiy-oidc`，工具要求其测试环境提供 issuer/audience、Docker 网络及映射的 8443 端口。工具会提取该本机端口的公开证书作为测试信任根，并拒绝过期证书；此方式只用于已知本机测试容器，生产 IdP 必须使用受信任的证书链。

:::warning 当前限制

生成器与本地模拟已覆盖这些 provider，但真实 Okta/Auth0/Azure/Keycloak/Google/Kinde 租户、JWKS 轮换、claim/audience、退出登录和第三方 Cookie 策略仍需逐个环境验收。OTP 发送适配器已用真实 HTTPS 服务验收投递载荷、凭据、超时、失败 fail-closed 与开发模式边界（见 [V3 状态](https://github.com/AI-NoDev/qiy/blob/main/openwiki/v3-status.md)），但真实短信/邮件供应商、供应商侧限流与一次性消费仍需在目标环境验收。

:::

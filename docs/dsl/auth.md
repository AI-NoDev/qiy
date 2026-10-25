# 认证与登录（auth）

`auth { ... }` 声明「谁可以登录、身份存在哪张表、角色从哪个字段读」。它是生成式服务端认证的唯一入口：声明后生成 `auth/guard.ts`、`auth/*.ts`、登录页、AccessControlProvider 与一组认证端点；未声明认证的应用不生成守卫，且服务端在生产模式下拒绝启动（除非 `QIY_DEV_MODE=1`）。

支持的登录方式：

| 方式 | 写法 | 生成结果 |
| --- | --- | --- |
| 本地密码 | `provider local;` | Argon2id 校验 + HS256 会话 JWT + `/auth/login` + Refine `AuthPage` |
| 单一 OIDC/OAuth2/SSO | `provider oidc;`（或 `oauth2` / `sso` / `okta` / `auth0` / `azure-ad-b2c` / `keycloak` / `google` / `kinde`） | 浏览器 PKCE + 服务端 JWKS 验签；用 `QIY_OIDC_ISSUER/AUDIENCE/JWKS_URL` 单块配置 |
| 多 Provider | `providers okta, keycloak, google;` | 登录页按 `GET /api/v1/auth/providers` 渲染按钮；每 Provider 一段 `QIY_OIDC_<ID>_*` |
| 混合（密码 + OAuth） | `providers local, okta, google;` + `usernameField`/`passwordField` | 一张登录页同时有密码表单与 Provider 按钮；额外生成首次登录 onboarding、账号绑定/解绑、个人中心 |
| 一次性密码 | `provider otp;` | `/auth/otp/request` + `/auth/otp/verify`，5 分钟签名 challenge + 12 小时会话令牌 |

::: tip 与 application.md 的分工
`auth` 块的**位置与关键字清单**见 [application · auth](/dsl/application#auth)。本页补齐**属性语义、模式矩阵、会话/令牌模型、密码策略、onboarding/绑定、Provider 配置表、全部环境变量、校验错误与生成文件**。
:::

## 语法总览

```qiy [app.qiy]
auth {
  provider local;                       // 或 provider oidc; / provider otp; …
  providers local, okta, google;        // 与 provider 互斥；可含 local、不能含 otp
  user users;                           // 必填：用户实体名
  subjectField subject;                 // OAuth 身份列（外部身份写入这里）
  roleField role;                       // 必填：角色字段
  usernameField email;                  // local / otp 的登录标识列
  passwordField passwordHash;           // local 的密码哈希列
  profileField oauthProfiles;           // 可选：每 Provider 的 profile 元数据

  // 每 Provider 身份列映射（混合/多 Provider 常用）
  provider okta { subjectField oktaSubject; }
  provider keycloak { subjectField keycloakSubject; claim sub; }
}
```

```text
auth {
  ( "provider" <id> [ "{" ( "subjectField" <field> ";" | "claim" <name> ";" )* "}" | ";" ] )
| "providers" <id> ( "," <id> )* ";"
| "user" <entity> ";"
| "subjectField" <field> ";"
| "roleField" <field> ";"
| "usernameField" <field> ";"
| "passwordField" <field> ";"
| "profileField" <field> ";"
}
```

`provider <id> { ... }` 是**映射块**，不是第二个登录方式；它必须与 `provider`/`providers` 中已配置的 Provider 同名。`provider` 与 `providers` 互斥。

## 属性表

| 属性 | 必填 | 默认 | 语义与校验 |
| --- | --- | --- | --- |
| `provider` | 二选一 | — | 单个 Provider：`local`/`otp`/`oidc`/`oauth2`/`sso`/`okta`/`auth0`/`azure-ad-b2c`/`keycloak`/`google`/`kinde` |
| `providers` | 二选一 | — | Provider 列表；不能重复，**不能含 `otp`**，可含 `local`（表示同时开密码登录）；只有一个 OAuth Provider 且不含 `local` 时等价于 `provider` |
| `user` | 是 | — | 用户实体名；必须是已声明实体，否则 `Auth: unknown user entity` |
| `subjectField` | OAuth 家族必填 | `""` | 外部身份列：必须是**非空 + 唯一 + Text**；单 Provider 模式写入 `<iss>`\|`<sub>`，映射模式写入该 Provider 的映射列（见下） |
| `roleField` | 是 | — | 必须是枚举，且枚举值集合**恰好**是 `admin`/`operator`/`viewer`（多一个少一个都报错） |
| `usernameField` | `local` 必填；`otp` 必填 | `""` | 登录标识列：必须非空 + 唯一 + Text；不能与 `passwordField` 同名列 |
| `passwordField` | `local` 必填 | `""` | 密码哈希列：必须 `@nullable` + Text，且不会出现在 API schema（`@listVisible(false)` 之类由生成器隐式隐藏） |
| `profileField` | 否 | `""` | `@nullable` Text，存 `{ "<provider>": { email, name, sub } }` JSON；只有声明了 OAuth Provider 才允许 |
| `provider <id> { subjectField ... }` | 混合模式必需 | — | 该 Provider 的身份列：必须存在、Text、`@nullable`、`@unique` |
| `provider <id> { claim ... }` | 否 | `sub` | 用哪个 claim 作为该 Provider 的外部身份；必须是纯 claim 名 `[A-Za-z_][A-Za-z0-9_]*` |

模式推导（生成器内部，DSL 里无需书写）：

| 判定 | 条件 |
| --- | --- |
| 有本地密码登录 | `provider local` 或 `providers` 含 `local` |
| OAuth Provider 列表 | `providers` 去掉 `local`；或单 `provider` 非 local/otp |
| 混合认证（hybrid） | 本地密码 **且** 至少一个 OAuth Provider |
| Provider 选择器（多按钮登录页） | 混合认证 **或** OAuth Provider ≥ 2 |
| 单 Provider 传统模式 | 只有一个 OAuth Provider 且无本地密码 |

## 用户模型契约

```qiy
enum userRole {
  value admin;
  value operator;
  value viewer;
}

entity users table users @label("用户") {
  field id UUID @id;
  field email Text @unique;                                   // usernameField
  field displayName Text @nullable;
  field passwordHash Text @nullable @listVisible(false) @showVisible(false);
  field role userRole;                                        // roleField
  field subject Text @unique;                                 // subjectField（规范身份列）
  field oktaSubject Text @unique @nullable;                   // 每 Provider 身份列
  field googleSubject Text @unique @nullable;
  field orgId UUID @nullable;                                 // 供 scope claim org.id 使用
  field oauthProfiles Text @nullable;                         // profileField
  field permissions Text @nullable;                           // permission from database field
}
```

| 字段角色 | 要求 | 校验错误（节选） |
| --- | --- | --- |
| `usernameField` | 非空、唯一、Text | `Auth: usernameField must be a required unique Text field` |
| `passwordField` | `@nullable` Text | `Auth: passwordField must be a nullable Text field storing the password hash` |
| 两者不同列 | — | `Auth: usernameField and passwordField must be different fields` |
| `subjectField` | 非空、唯一、Text（有 OAuth 时） | `Auth: subjectField must be a required unique Text field` |
| `roleField` | 枚举值恰好 `admin`/`operator`/`viewer` | `Auth: roleField must be an enum with admin, operator and viewer values` |
| 每 Provider 映射列 | 存在、Text、`@nullable`、`@unique` | `Auth: provider <p> subjectField <f> must be nullable so accounts can exist without that binding` 等 |
| `profileField` | `@nullable` Text | `Auth: profileField must be a nullable Text field storing per-provider profile metadata` |
| onboarding 可创建 | 除自动列（id/username/password/role/subject/profile/各 Provider 身份列/`email`/`displayName`/`name`）外的**必填**字段必须可空 | `Auth: OAuth onboarding cannot populate required user fields: <字段…>; make them nullable` |
| `scope` claim 对应列 | 本地/混合模式下每个 scope claim 要在 users 有列（`org.id` → `orgId`） | `Data scope claim org.id needs a matching field on users (expected orgId) …` |

身份写入规则（生成器行为，非可选）：

| 模式 | 写入列 | 值 |
| --- | --- | --- |
| 单 Provider（无映射） | `subjectField` | `<iss>`\|`<sub>`（如 `https://id.example.com/\|user-1`） |
| 映射且声明 `claim` | 映射的 `subjectField` | 该 claim 的字符串值 |
| 映射且无 `claim` | 映射的 `subjectField` | `sub` |
| 混合 onboarding | 映射列 **和** 规范 `subjectField` | 映射列 `sub`；规范列 `<provider>:<subject>` |
| 本地密码 bootstrap（混合模式） | 规范 `subjectField` | `local:<username>`（纯本地密码模式没有 `subjectField`，不会写该列） |

## 登录页与会话行为（Web）

- 登录路由 `/auth/login`：`Refine <AuthPage type="login">`；**无** 注册链接、**无** 忘记密码、**无** 记住我（`registerLink={false} forgotPasswordLink={false} rememberMe={false}`）。账号只能由 bootstrap/管理员/onboarding 创建。
- 混合与多 Provider 模式：登录页在挂载时请求 `GET /api/v1/auth/providers`，为每个**完整配置**的 Provider 渲染一个按钮；点按钮即跳转授权端点（Authorization Code + **PKCE S256** + `state`）。
- 回调路由：`/auth/callback`（生成的默认 `redirect_uri`），`/oauth/*` 是同一组件的别名。混合模式下回调还会处理 `?linked=<provider>` 并回到 `/profile`。
- 会话存储：access token 存在 `localStorage["qiy.access_token"]`（多 Provider 模式另外保存 `id_token`/`expires_at`）；`/auth/me` 身份结果缓存 60 秒并按 token 失效。
- 过期与 401：单 Provider OIDC 模式用 `qiy.expires_at`（提前 60 秒）判定过期，并按 `prompt=none` 尝试一次静默续期；401 清除本地会话并跳登录页。
- **不实现 refresh token**：没有 refresh cookie / BFF 续期；多 Provider 与混合模式依赖 IdP 会话，access token 过期即需重新登录。
- 服务端鉴权头只接受 `Authorization: Bearer <token>`；CORS 下需把 `Authorization`、`Content-Type`、`Idempotency-Key`、`X-API-Key` 列入允许头（生成器已配置）。

## 会话与令牌模型

| 令牌 | 签发 | 算法 | 有效期 | 载荷/用途 |
| --- | --- | --- | --- | --- |
| 本地密码会话 | `POST /auth/login` | HS256（`QIY_AUTH_SECRET`） | **12 小时**（`expiresIn: 43200`） | `iss=aud=qiy-admin`、`sub=<user id>`、`role`、`typ=qiy-local` |
| OTP 会话 | `POST /auth/otp/verify` | HS256 | 12 小时 | 同 `sub`/`role`，`typ=qiy-otp` |
| OTP challenge | `POST /auth/otp/request` | HS256 | **5 分钟** | `typ=qiy-otp-challenge`、`identifier`、`otpHash`、`valid`、`sub` |
| onboarding 令牌 | `POST /auth/exchange`（混合） | HS256 | **10 分钟** | `typ=qiy-onboarding`、`provider`、`identitySubject`、可选 username/email/name |
| Provider access token | IdP | RS256/ES256 | IdP 决定 | 服务端按未验签 `iss` 路由到对应 Provider 的 JWKS 再验签 |
| API Key | `POST /auth/api-keys` | HMAC-SHA256 存储 | 可选过期 | 见 [features](/dsl/features) |

- 会话令牌只在服务端签验，浏览器只持有字符串；`role` 写在令牌里，但每次请求都会**重新读用户行**（`findUserById`）并以其 `role` 为准，因此降权在下一请求生效，无需等待令牌过期。
- Provider token 的 `iss` 必须与某个已配置 Provider 的 issuer（去掉尾部 `/`）**精确匹配**；未匹配直接 401，不会尝试其它密钥集。
- Provider 校验同时接受 `audience` 与 `clientId`（两者任一命中即可），算法限定 `RS256`/`ES256`。
- claims 被扁平化后挂到 `Principal.claims`（`org.id`、`realm_access.roles` 等），供 `scope`、`permission from claim`、`restrict mask claim` 使用；`iss/aud/exp/iat/nbf/jti/sub` 不进入 claims。

## 密码策略与账号运维

| 项目 | 现状 |
| --- | --- |
| 哈希算法 | `Bun.password.hash(password, { algorithm: "argon2id" })`；校验用 `Bun.password.verify` |
| 最小长度 | **8 字符**（`hashPassword` 强制），没有大小写/数字/符号复杂度要求 |
| 未知账号 | 仍然执行一次 Argon2id 校验（固定 dummy hash）再返回 401，避免时序侧信道 |
| 登录响应 | `{ accessToken, tokenType: "Bearer", expiresIn: 43200, id, name, role }`；失败统一 `Invalid username or password`（401），缺字段 400 |
| 限流/锁定 | **未生成**：无失败次数限制、无账号锁定、无验证码。公网部署需在网关/WAF 或发送适配器侧补齐 |
| 自助改密 | **未生成**：个人中心只显示「已设置/未设置」，改密走 CLI |
| 初始管理员 | `bun run auth:bootstrap-admin`（读 `.env.production`）：交互式输入用户名与密码，为所有其它必填列提示输入，混合模式写入 `subject = "local:<username>"`；已存在 admin 时拒绝执行 |
| 重置密码 | `bun run auth:set-password`：按用户名/邮箱定位**唯一**一行并覆盖哈希 |
| 密码字段保护 | `passwordField` 不会进入 API schema；dataflow 不能 update/create/emit 该字段（生成期拒绝） |

## OTP（一次性密码）

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

| 端点 | 请求 | 响应 |
| --- | --- | --- |
| `POST /api/v1/auth/otp/request` | `{ identifier }`（1–190 字符） | `{ challengeToken, expiresIn: 300, devCode? }` |
| `POST /api/v1/auth/otp/verify` | `{ identifier, challengeToken, code }`（code 4–12） | `{ accessToken, tokenType, expiresIn: 43200, id, name, role }` |

- 验证码 6 位数字；challenge 是 HMAC-SHA256(`identifier\ncode`) 的签名令牌，**不依赖进程内存**，可水平扩展。
- 发送适配器：`POST QIY_OTP_DELIVERY_URL`，body `{ recipient, code, expiresIn: 300 }`，配置了 `QIY_OTP_DELIVERY_TOKEN` 时带 `Authorization: Bearer`；必须 HTTPS 且返回 2xx。
- 发送失败 → **502** `{ error, errorKey: "auth.otpDeliveryFailed" }`，**不签发** challenge（不会出现「拿到 challenge 但没收到码」）；开发模式（`QIY_DEV_MODE=1`）额外返回适配器错误文案，生产只返回通用文案。适配器错误会写服务端日志，**验证码本身不落日志**。
- `QIY_OTP_DELIVERY_TIMEOUT_MS` 默认 10000，允许 100–60000，用 `AbortSignal.timeout` 生效。
- 未知标识仍返回结构相同的 200 + challenge（`valid:false`），`verify` 返回 401，避免枚举账号。
- 开发便利：`QIY_DEV_MODE=1` + `QIY_OTP_DEV_CODE` 时使用固定验证码并在响应里回显 `devCode`；**生产禁止**。
- 已知边界：没有按标识/IP 的限流；challenge 在 5 分钟内可被重复使用（未做一次性消费记录）。公网部署需在适配器或网关补限流，并按需自行持久化消费记录。

## 多 Provider 与混合认证

### 端点矩阵

| 端点 | local | 单 Provider | 多 Provider | 混合 | otp |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/login` | ✅ | — | — | ✅ | — |
| `GET /auth/providers` | — | — | ✅ `{ providers }` | ✅ `{ providers, local: true }` | — |
| `POST /auth/exchange` | — | — | ✅ 返回原始 `{ access_token, id_token?, expires_in? }` | ✅ 返回会话或 `{ needsOnboarding }` | — |
| `POST /auth/oauth/register` | — | — | — | ✅ | — |
| `POST /auth/bind` / `POST /auth/unbind` | — | — | — | ✅ | — |
| `GET /auth/identities` | ✅ | — | — | ✅ | — |
| `POST /auth/otp/request` / `verify` | — | — | — | — | ✅ |
| `GET /auth/me` | ✅ | ✅ | ✅ | ✅ | ✅ |

### 首次登录 onboarding（仅混合模式）

1. 用户点 Provider 按钮 → PKCE 授权 → 回调把 `code` + `code_verifier` 交给 `POST /auth/exchange`。
2. 服务端用 Provider 的 token 端点换 token，验签后取身份；若该 Provider 身份列已有对应用户 → 直接签发 12 小时会话。
3. 否则返回 `{ needsOnboarding: true, onboardingToken, provider, profile }`，前端跳到 `/auth/onboarding`。
4. 表单提交 `POST /auth/oauth/register { onboardingToken, username, email?, password }`：
   - 只信任 onboarding token 里的 `provider`/`subject`，**不接受**客户端自报身份；
   - `usernameField` 为 `email` 时校验邮箱格式；用户名/邮箱重复 → 409；
   - 密码走同一套 Argon2id + 8 字符下限；
   - 角色取 `QIY_OIDC_DEFAULT_ROLE`（默认 `viewer`，非法值启动即报错）；
   - 写入 `displayName`（claims 的 `name` 或用户名）、`profileField` 的该 Provider 元数据、映射身份列与规范 `subjectField = <provider>:<subject>`；
   - 成功返回与密码登录同构的会话。
5. onboarding token 10 分钟有效、HS256 签名、`iss=aud=qiy-admin`、`typ=qiy-onboarding`；过期/篡改/异 issuer → 401，需要重新走 Provider 登录。

### 个人中心：查看、绑定、解绑

`/profile` 页面（混合模式生成）读 `GET /api/v1/auth/identities`：

```json
{
  "user": { "id": "…", "username": "ops@example.com", "email": "ops@example.com", "name": "Ops", "role": "operator" },
  "password": { "set": true },
  "providers": [
    { "id": "okta", "label": "Okta", "bound": true, "subject": "00u…", "email": "ops@example.com", "name": "Ops" },
    { "id": "google", "label": "Google", "bound": false }
  ],
  "loginMethodCount": 2
}
```

| 操作 | 端点 | 规则 |
| --- | --- | --- |
| 绑定 | `POST /auth/bind`，body `{ provider, code, codeVerifier, redirectUri }` 或 `{ onboardingToken }` | 需已登录；身份已属**其他**账号 → 409；成功后写映射列 + `profileField` |
| 解绑 | `POST /auth/unbind`，body `{ provider }` | 需已登录；解绑会清空映射列与 profile；若这将是**最后一个**登录方式（无密码且无其它绑定）→ 409 `Cannot remove the last login method…` |
| 绑定按钮 | `beginProviderBind`（`/profile` 上的「Bind」） | 与登录同一套 PKCE，回调带 `?linked=<provider>` |

- UI 上「解绑」按钮在 `canRemove` 为 false 时禁用（与 409 规则一致），避免用户点出错误。
- 绑定流程要求 IdP 端已登录会话；跨账号冲突不会自动合并。

### 多 Provider（非混合）的账号前提

多 Provider 模式**不创建账号**：`/auth/exchange` 只换 token，随后 `/auth/me` 用身份列查用户行。身份列找不到行时表现为「登录成功但无身份」——页面 403。上线前必须先建好用户行并填好对应 Provider 的身份列（`auth:bootstrap-admin` 只建本地账号，需自行补列或写管理脚本）。

## Provider 配置表

`QIY_OIDC_<PROVIDER>_*` 的 `<PROVIDER>` 是 Provider 名**大写、非字母数字换成 `_`**：`okta` → `OKTA`，`azure-ad-b2c` → `AZURE_AD_B2C`。

| Provider id | issuer | audience | JWKS URL | 授权/令牌端点（示例） | 身份 claim | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `okta` | `https://<domain>/oauth2/default` | `api://default`（或自定义 AS 的 audience） | `https://<domain>/oauth2/default/v1/keys` | `/v1/authorize`、`/v1/token`、`/v1/logout` | `sub` | 需把用户 Assign 到该 OIDC 应用；自定义 AS 用自己的 issuer |
| `keycloak` | `https://<host>/realms/<realm>` | `account` 或 client id | `https://<host>/realms/<realm>/protocol/openid-connect/certs` | `/protocol/openid-connect/auth`、`…/token`、`…/logout` | `sub` | 角色常见于 `realm_access.roles`（嵌套，扁平化后为 `realm_access.roles`）；也可加 mapper 输出 `roles` |
| `google` | `https://accounts.google.com` | OAuth **client id** | `https://www.googleapis.com/oauth2/v3/certs` | `https://accounts.google.com/o/oauth2/v2/auth`、`https://oauth2.googleapis.com/token` | `sub` | 没有内建 `groups`/`roles`，需要自定义 claim 或在应用侧授权 |
| `kinde` | `https://<subdomain>.kinde.com` | client id | `https://<subdomain>.kinde.com/.well-known/jwks.json` | `/oauth2/auth`、`/oauth2/token`、`/logout` | `sub` | 支持 device code flow（Qiy 不内置该流程） |
| `azure-ad-b2c` | `https://<tenant>.b2clogin.com/<tenantId>/<policy>/v2.0/` | 应用 client id | `https://<tenant>.b2clogin.com/<tenant>.onmicrosoft.com/<policy>/discovery/v2.0/keys` | `/<policy>/oauth2/v2.0/authorize`、`…/token`、`…/logout` | `sub` | 自定义策略常签发 `roles`；tenant/policy 必须与 issuer 一致 |
| `auth0` | `https://<tenant>.<region>.auth0.com/` | API identifier（自定义 API） | `https://<tenant>.<region>.auth0.com/.well-known/jwks.json` | `/authorize`、`/oauth/token`、`/v2/logout` | `sub` | audience 必须是 API 标识，不是 client id（client id 也被接受） |
| `oidc` / `oauth2` / `sso` | 你的 IdP issuer | 你的 audience | 你的 JWKS | discovery 里的 authorize/token | `sub` | 通用容器；单 Provider 模式用 `QIY_OIDC_ISSUER/AUDIENCE/JWKS_URL` |
| Dex（用 `keycloak` 或 `oidc` 承载） | `https://<dex-host>/dex` | `qiy-admin` 或自建 client | `https://<dex-host>/dex/keys` | `/dex/auth`、`/dex/token` | `sub` | **默认不签发 `roles`/`groups`**：`permission from claim` 需要 tenant 侧加 mapper，否则该来源为空 |

::: warning 这些是配置起点，不是验收声明
上面是生成器/示例使用的端点形态。真实租户（Okta/Auth0/Azure/Keycloak/Google/Kinde/Dex）的 issuer、audience、JWKS、claim 设计、退出登录与第三方 Cookie 策略必须逐个环境验证；仓库提供 `tools/verify-*.ts` 的离线/真实租户验收脚本，它们存在不等于你的环境已验收。
:::

### 端到端示例：混合登录 + Okta + Dex

```qiy [app.qiy]
qiy v0;
application ops-admin {
  database postgresql {}
  api { client rest; }
  features { overview true; apiDocs true; apiKeys true; }

  auth {
    providers local, okta, keycloak;      // keycloak 用来承载自建 Dex 租户
    user users;
    subjectField subject;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    profileField oauthProfiles;
    provider okta { subjectField oktaSubject; }
    provider keycloak { subjectField dexSubject; claim sub; }
  }

  enum userRole { value admin; value operator; value viewer; }

  entity users {
    field id UUID @id;
    field email Text @unique;
    field displayName Text @nullable;
    field passwordHash Text @nullable;
    field role userRole;
    field subject Text @unique;
    field oktaSubject Text @unique @nullable;
    field dexSubject Text @unique @nullable;
    field oauthProfiles Text @nullable;
  }
}
```

服务端 `.env.production`：

```dotenv
DATABASE_URL=postgres://user:password@db.example.com:5432/ops
HOST=0.0.0.0
PORT=3000
QIY_DEV_MODE=0
QIY_AUTH_SECRET=<openssl rand -hex 32>

# Okta
QIY_OIDC_OKTA_ISSUER=https://trial-1234567.okta.com/oauth2/default
QIY_OIDC_OKTA_AUDIENCE=api://default
QIY_OIDC_OKTA_JWKS_URL=https://trial-1234567.okta.com/oauth2/default/v1/keys
QIY_OIDC_OKTA_AUTHORIZATION_URL=https://trial-1234567.okta.com/oauth2/default/v1/authorize
QIY_OIDC_OKTA_TOKEN_URL=https://trial-1234567.okta.com/oauth2/default/v1/token
QIY_OIDC_OKTA_CLIENT_ID=<spa client id>
QIY_OIDC_OKTA_SCOPE=openid profile email
QIY_OIDC_OKTA_REDIRECT_URI=https://admin.example.com/auth/callback

# 自建 Dex（以 keycloak Provider 承载）
QIY_OIDC_KEYCLOAK_ISSUER=https://dex.example.com/dex
QIY_OIDC_KEYCLOAK_AUDIENCE=ops-admin
QIY_OIDC_KEYCLOAK_JWKS_URL=https://dex.example.com/dex/keys
QIY_OIDC_KEYCLOAK_AUTHORIZATION_URL=https://dex.example.com/dex/auth
QIY_OIDC_KEYCLOAK_TOKEN_URL=https://dex.example.com/dex/token
QIY_OIDC_KEYCLOAK_CLIENT_ID=ops-admin
QIY_OIDC_KEYCLOAK_REDIRECT_URI=https://admin.example.com/auth/callback

# 混合认证新增账号的默认角色
QIY_OIDC_DEFAULT_ROLE=viewer

# JWKS 时间窗（可按 IdP 调整，非法值启动即失败）
QIY_OIDC_JWKS_TIMEOUT_MS=5000
QIY_OIDC_JWKS_COOLDOWN_MS=30000
QIY_OIDC_JWKS_CACHE_MAX_AGE_MS=600000
```

上线步骤：`bun run db:migrate:production` → `bun run auth:bootstrap-admin` 建初始 admin → 浏览器打开 `/auth/login` 用密码登录 → `/profile` 绑定 Okta/Dex → 在 IdP 侧把测试用户 Assign 到应用 → 用 OAuth 登录验证 onboarding（新身份）与直登（已绑定身份）。

## 环境变量

### Server

| 变量 | 默认 | 何时生成 | 说明 |
| --- | --- | --- | --- |
| `QIY_AUTH_SECRET` | 开发随机，生产空 | local/混合/OTP（需要签发令牌时） | **≥32 字符**，否则启动即抛错；签名密码会话、OTP challenge、onboarding 令牌，并做 API Key 的 HMAC pepper。轮换会使全部会话失效 |
| `QIY_OIDC_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | 空 | 单 OAuth Provider | 单 Provider 模式的三件套；issuer/JWKS 必须 HTTPS（否则启动报错） |
| `QIY_OIDC_<ID>_ISSUER` / `_AUDIENCE` / `_JWKS_URL` | 空 | 混合/多 Provider | 三段齐全该 Provider 才启用；Issuer 按 token `iss` 精确匹配 |
| `QIY_OIDC_<ID>_AUTHORIZATION_URL` / `_TOKEN_URL` / `_CLIENT_ID` | 空 | 混合/多 Provider | 登录页公开字段；缺任一项该 Provider 不出现在 `/auth/providers` |
| `QIY_OIDC_<ID>_SCOPE` | `openid profile email` | 混合/多 Provider | 授权 scope |
| `QIY_OIDC_<ID>_REDIRECT_URI` | 全局 `QIY_OIDC_REDIRECT_URI` | 混合/多 Provider | 必须与 IdP 注册值一致 |
| `QIY_OIDC_<ID>_CLIENT_SECRET` | 空 | confidential client 时 | **只放服务端**；BFF 兑换 code 用；绝不进 `VITE_*` |
| `QIY_OIDC_<ID>_LOGOUT_URL` | 空 | 可选 | 前端登出跳转 |
| `QIY_OIDC_JWKS_TIMEOUT_MS` | `5000` | 有 OAuth Provider | 单次 JWKS 请求超时，最小 1 |
| `QIY_OIDC_JWKS_COOLDOWN_MS` | `30000` | 有 OAuth Provider | 未知 `kid` 后重新拉取的最短间隔，最小 0（新密钥立即生效） |
| `QIY_OIDC_JWKS_CACHE_MAX_AGE_MS` | `600000` | 有 OAuth Provider | 密钥缓存有效期，**同时是撤销的最坏延迟** |
| `QIY_OIDC_DEFAULT_ROLE` | `viewer` | 仅混合 | onboarding 新账号角色，必须 `admin`/`operator`/`viewer` |
| `QIY_OTP_DELIVERY_URL` | 空 | otp | HTTPS 发送适配器；缺失且非开发模式 → 502 |
| `QIY_OTP_DELIVERY_TOKEN` | 空 | otp | 适配器 Bearer 凭据 |
| `QIY_OTP_DELIVERY_TIMEOUT_MS` | `10000` | otp | 100–60000 |
| `QIY_OTP_DEV_CODE` | 开发 `246810`，生产空 | otp | 固定验证码 + 响应回显 `devCode`，仅配合 `QIY_DEV_MODE=1` |
| `QIY_DEV_MODE` | 无 auth 开发 `1`，否则 `0` | — | 无认证项目的启动闸门；OTP 开发码；错误详情 |
| `QIY_CORS_ORIGINS` | 来自 `api { cors { … } }` | `api` 显式 CORS | 跨域部署时必须包含前端 origin |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | 环境默认 | — | Bun `fetch` 自带代理支持；生成代码在 token 端点不可达时明确提示设置 `HTTPS_PROXY`。没有额外的 Qiy 代理变量 |

### Web（仅单 Provider OIDC 模式）

| 变量 | 说明 |
| --- | --- |
| `VITE_QIY_AUTHORIZATION_URL` | 授权端点（必填） |
| `VITE_QIY_TOKEN_URL` | 令牌端点（必填） |
| `VITE_QIY_CLIENT_ID` | 公开 SPA client id（必填） |
| `VITE_QIY_AUTH_SCOPE` | 默认 `openid profile email` |
| `VITE_QIY_REDIRECT_URI` | 默认 `window.location.origin + /auth/callback` |
| `VITE_QIY_LOGOUT_URL` | 可选 RP logout |
| `VITE_QIY_API_TRANSPORT` | `rest` / `graphql`（由 `api { client … }` 生成） |

多 Provider 与混合模式**不生成** `VITE_QIY_*`：这些模式从 `GET /api/v1/auth/providers` 读取公开配置，client secret 永不下发浏览器。

## 生成文件

| 文件 | 内容 |
| --- | --- |
| `apps/server/src/auth/password.ts` | `isRole`、`hashPassword`（Argon2id，≥8 字符）、`verifyPassword`、`signAccessToken`/`verifyAccessToken`（HS256，12h） |
| `auth/local.ts` | `createProductionAuthenticator`（Bearer → 用户行）、`createLocalAuthRoutes`（`/auth/login`，含 dummy-hash 时序防护） |
| `auth/oidc.ts` | 单 Provider：`QIY_OIDC_ISSUER/AUDIENCE/JWKS_URL` + JWKS 验签；多 Provider：`providerConfigs()`、`publicAuthProviders()`、`/auth/providers`、`/auth/exchange`；混合：再加 onboarding/绑定/解绑 |
| `auth/hybrid.ts` | 组合密码会话与 Provider token 的单一 Authenticator |
| `auth/verify.ts` | `createOidcAuthenticator`：验签、subject 解析、claims 扁平化 |
| `auth/account.ts` | `GET /auth/identities`（账号 + 绑定状态） |
| `auth/bootstrap-admin.ts` / `auth/set-password.ts` | 初始管理员、改密 CLI |
| `auth/guard.ts` | `Principal`、`Authenticator`、`createAuthorizationGuard`（认证 + 角色 + `pages`） |
| `auth/permission-routes.ts` / `auth/permissions.ts` | 权限 provider 与校验端点（声明了 `permission` 时） |
| `auth/api-keys.ts` / `auth/api-key-hash.ts` | API Key 认证与生命周期（`features.apiKeys`） |
| `apps/web/app/auth.ts` | Refine `AuthProvider`、`AccessControlProvider`、身份缓存 |
| `apps/web/app/auth/oidc-client.ts` | 单 Provider PKCE 客户端（静默续期、登出） |
| `apps/web/app/auth/oidc-multi.ts` | 多 Provider / 混合 PKCE 客户端（login、bind、onboarding 注册） |
| `apps/web/app/auth/account.ts` | 个人中心数据与解绑调用 |
| `apps/web/app/routes/{login,auth-callback,oauth-callback,auth-onboarding,profile}.tsx` | 登录、回调、onboarding、个人中心 |
| `apps/server/tests/{auth,local-auth,hybrid-auth,otp-auth,api-keys,permissions}.test.ts` | 对应模式的生成测试 |

## 校验错误

| 错误（节选） | 触发 |
| --- | --- |
| `Unsupported auth attribute <k>` / `Duplicate auth attribute <k>` | 拼错或重复属性 |
| `Auth accepts either provider or providers, not both` | 两种写法同时出现 |
| `Auth providers cannot include otp; use provider otp for one-time-password login` | `providers` 里写了 `otp` |
| `Auth providers must be unique` | `providers` 重复 |
| `Unsupported auth provider <id>` | 未知 Provider 名 |
| `Provider mapping requires subjectField` | `provider X { }` 没写 `subjectField` |
| `Provider mapping claim must be a plain claim name: <c>` | claim 含点号（映射 claim 只接受纯名） |
| `Provider mapping <p> is not part of the configured providers` | 映射块与 `providers` 不一致 |
| `Provider mappings must be unique per provider` | 同一 Provider 两个映射块 |
| `Auth requires a user entity` / `Auth requires roleField` | 缺 `user` / `roleField` |
| `Auth requires subjectField for OAuth/OIDC providers` | OAuth 模式缺 `subjectField` |
| `Auth provider local requires usernameField and passwordField` | 本地密码缺列 |
| `Auth provider otp requires usernameField` / `Auth provider otp does not accept passwordField` | OTP 列契约 |
| `Auth provider <p> does not accept usernameField or passwordField` | 纯 OAuth 模式多写了本地列 |
| `Auth profileField requires at least one OAuth/OIDC provider` | 无 OAuth 却声明 `profileField` |
| `Auth: unknown user entity` | `user` 不存在 |
| `Auth: usernameField must be a required unique Text field` | 列契约 |
| `Auth: passwordField must be a nullable Text field storing the password hash` | 列契约 |
| `Auth: usernameField and passwordField must be different fields` | 同列 |
| `Auth: subjectField must be a required unique Text field` | 列契约 |
| `Auth: roleField must be an enum with admin, operator and viewer values` | 角色枚举不匹配 |
| `Auth: provider <p> needs its own nullable subjectField mapping when local password login is combined with OAuth` | 混合模式缺映射 |
| `Auth: provider <p> subjectField <f> must be nullable/unique`、`must be a Text field`、`maps to unknown user field` | 映射列契约 |
| `Auth: OAuth onboarding cannot populate required user fields: …; make them nullable` | 新账号必填列无法自动填 |
| `features apiKeys requires an auth block` / `requires the auth user entity <e>` | API Key 依赖 |
| `Data scope claim <c> needs a matching field on users (expected <f>) …` | 本地/混合模式的 scope claim 无对应列 |

## 安全注意事项

1. **`QIY_AUTH_SECRET` 是根密钥**：密码会话、OTP challenge、onboarding 令牌、API Key pepper 全用它；必须 ≥32 字符、只放服务端 secret manager，轮换会导致所有会话与 API Key（pepper 变化）失效。
2. **不要在 `.qiy` 里写任何密钥**：client secret、OTP 适配器 token、proxy 凭据都通过环境变量注入；生成的 `.env.example` 只放占位值。
3. **client secret 永不下发浏览器**：单 Provider 是公开 PKCE 客户端；confidential client 的 secret 只在服务端 `/auth/exchange` 使用。
4. **onboarding 令牌只证明「IdP 已验证过这个身份」**，10 分钟有效；注册接口不接受客户端自报 provider/subject，避免账号抢占。
5. **最后一种登录方式不能被移除**：`/auth/unbind` 在「无密码 + 无其它绑定」时返回 409，防止账号锁死。
6. **未知账号不泄露**：密码登录统一 401 且执行 dummy hash；OTP 未知标识也返回同构响应。
7. **JWT 有效期 12 小时且无刷新**：这是有意的取舍（避免 localStorage 存 refresh token）；需要更短会话时缩短时长或改用 IdP 会话策略，不要在前端自行延长。
8. **JWKS 缓存 = 撤销延迟**：`QIY_OIDC_JWKS_CACHE_MAX_AGE_MS` 决定「已从 IdP 移除的密钥还能通过验签多久」；轮换请按「先加新键 → 等一个 cache 周期 → 用新键签发 → 再删旧键」操作。
9. **ROPC / password grant 不支持**：Provider 只用 Authorization Code + PKCE；需要脚本登录请用 API Key。
10. **生产必须 `QIY_DEV_MODE=0`**：开发模式会回显 OTP 固定码与适配器错误详情；无认证项目在非开发模式下直接拒绝启动。
11. **多 Provider（非混合）不会建号**：IdP 里合法但系统里无行的身份会在登录后表现为无权限，这属于配置缺口而非漏洞；请先建行。
12. **`role` 的权威是数据库行**：令牌里的 `role` 只作兼容，守卫每次请求重新读取用户行，因此角色变更即时生效。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 启动报 `QIY_AUTH_SECRET must be at least 32 characters…` | 生产未设置或太短 | `openssl rand -hex 32` 写入 secret manager |
| 登录页没有任何 Provider 按钮 | 该 Provider 的 ISSUER/AUDIENCE/JWKS/AUTHORIZATION_URL/CLIENT_ID 未配齐 | 补齐 `QIY_OIDC_<ID>_*`；`/auth/providers` 只列出完整配置 |
| 登录后立刻 401 | token `iss` 与 `QIY_OIDC_<ID>_ISSUER` 不匹配（含尾部斜杠差异以外的路径差异） | 用 discovery 的 issuer 原值；issuer 去掉尾部 `/` 后精确比较 |
| OAuth 回调报 `State mismatch in the provider callback` | 同一浏览器多个标签页并发登录 / sessionStorage 被清 | 重新登录一次 |
| `The provider token exchange failed` | 回调 `redirect_uri` 与 IdP 注册值不一致、client secret 缺失、token 端点不可达（需代理） | 对齐 redirect、补 secret、设置 `HTTPS_PROXY` |
| onboarding 提交 409 | 用户名/邮箱已存在，或该 Provider 身份已绑定到别的账号 | 换用户名，或让用户用原账号登录后在 `/profile` 绑定 |
| 解绑 409 | 这是最后一个登录方式 | 先设置密码（`auth:set-password`）或绑定另一个 Provider |
| `No OIDC provider is configured: set QIY_OIDC_<PROVIDER>_ISSUER…` | 多 Provider 模式一个都没配齐 | 至少配齐一个完整块 |
| OTP 502 `auth.otpDeliveryFailed` | 适配器不可达/非 2xx/超时/非 HTTPS | 检查 `QIY_OTP_DELIVERY_URL`、凭据、超时与网络 |
| `QIY_DEV_MODE` 相关启动失败 | 无 auth 项目以生产模式启动 | 本地设 `QIY_DEV_MODE=1`；生产必须配置真实 auth |

## 覆盖清单

| 构造 | 覆盖位置（本页章节） |
| --- | --- |
| `provider` / `providers` / `local` 推导 / 模式矩阵 | 语法总览、属性表 |
| `user` / `subjectField` / `roleField` / `usernameField` / `passwordField` / `profileField` | 属性表、用户模型契约 |
| `provider <id> { subjectField; claim; }` | 属性表、用户模型契约、Provider 配置表 |
| 五种模式的生成结果 | 登录页与会话行为、端点矩阵、生成文件 |
| 会话/令牌/onboarding/challenge | 会话与令牌模型 |
| 密码策略、bootstrap、set-password | 密码策略与账号运维 |
| OTP 全流程与适配器 | OTP（一次性密码） |
| onboarding / bind / unbind / identities / 个人中心 | 多 Provider 与混合认证 |
| Okta/Keycloak/Google/Kinde/Azure AD B2C/Auth0/Dex/通用 | Provider 配置表 |
| 全部 Server/Web 环境变量、代理 | 环境变量 |
| 校验错误 | 校验错误 |
| 安全边界 | 安全注意事项 |

## 相关

- [application · auth](/dsl/application#auth)：块位置与关键字速查。
- [权限（permission）](/dsl/permissions)：原子权限、权限组、claim/数据库来源、`restrict`/`scope`/`pages`。
- [features](/dsl/features) 与 [API 文档与访问密钥](/guide/api-docs-and-keys)：API Key 生命周期与文档过滤。
- [认证与权限（指南）](/guide/auth)：页面守卫、迁移路径与多 Provider 验收。
- [Refine Providers](/guide/refine-providers)：AuthProvider / AccessControlProvider 的生成约定。
- [真实外部服务验收](/guide/real-services)：Okta/Google/Kinde/Azure/Keycloak/Dex 的离线与真实租户脚本。
- 仓库测试：`tests/auth-providers.test.ts`、`tests/local-auth-generation.test.ts`、`tests/features-api-keys.test.ts`；生成项目 `apps/server/tests/{auth,local-auth,hybrid-auth,otp-auth}.test.ts`。

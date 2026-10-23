# 真实外部服务验收（Ably / 厂商 IdP）

本地开发默认用生成器内置的本地认证与实时实现。要证明"接真实外部服务也能跑"，Qiy 提供了三个可执行的验收路径；前两个**不需要任何外部凭据**，第三个需要在服务商侧创建应用。

## 1. 真实 IdP 协议链路（Docker fixture，无需凭据）

```powershell
bun run tools/verify-oidc-docker.ts --isolated
```

在 Docker 网络里起一个 HTTPS OIDC fixture（discovery / JWKS / token 端点），把生成的 server 放进 `oven/bun` 容器，验证：HTTPS 验签、issuer/audience、JWKS 拉取、`iss|sub` 身份映射、HTTP 授权。这是**协议级**验收，覆盖 OIDC 接入代码路径。

## 2. 真实 OIDC Provider：Dex（Docker，无需外部凭据）

```powershell
docker pull ghcr.io/dexidp/dex:v2.41.1
bun run tools/verify-dex.ts
```

Dex 是 CNCF 的 OIDC 身份提供方，脚本用它做**真实 IdP** 验收（不是自建 fixture）：

1. 用本地镜像里的 openssl 生成 HTTPS 证书（Dex 以非 root 运行，脚本把 key 改为 644）；
2. 以内存存储启动 Dex，导入两个 public client（`qiy-acceptance` 与不带 audience 的 `qiy-other`）和两个静态用户（bcrypt 口令）；
3. 通过 Dex 的 **password grant** token 端点取真实 JWT，校验 `aud` 与 `email` claim；
4. 生成 `auth { provider oidc; ... }` 应用，用真实 issuer/JWKS 构造 `createProductionAuthenticator()`；
5. 断言：合法 token 通过并映射角色；错误 audience 的 token 401；数据库没有 `iss|sub` 映射的 token 401；匿名 401。

成功输出 `Dex real-IdP acceptance passed`（证据在工作区临时目录）。

## 2b. 真实 Keycloak（Docker，已跑通）

```powershell
docker pull keycloak/keycloak:26.0.5
bun run tools/verify-keycloak.ts
```

Keycloak 26 用 HTTPS + realm 导入：`qiy-acceptance` client 带 audience mapper（`aud: qiy-api`）与 **hardcoded claim mapper**（`tenantCustomerId: customer-1`），`qiy-other` client 不带 audience；两个用户需要 `firstName`/`lastName`（否则密码模式报 `Account is not fully set up`）。验收输出 `Keycloak real-IdP acceptance passed`：发现端点、真实 token 的 `aud`、扁平 tenant claim、生成 server 的合法 token 通过 + 错误 audience 401 + 未映射 subject 401 + 匿名 401。

注意：Keycloak 会把含点的 claim 名展开成**嵌套对象**（`tenant.customerId` → `tenant: { customerId }`），而生成器只投影**标量** claim（`string`/`number`/`boolean`），所以接 Keycloak 时租户/角色类自定义 claim 请用扁平名（如 `tenantCustomerId`）；Okta/Auth0 常见的命名空间扁平 claim（如 `https://example.com/roles`）可直接使用。

## 3. 真实厂商租户（Okta / Auth0 / Azure AD B2C / Google / Kinde）

在厂商控制台创建：

| 配置 | 要求 |
| --- | --- |
| 应用类型 | SPA / Public client（浏览器 PKCE），或 confidential client + BFF |
| 回调地址 | 生成 Web 的登录回调（`/login` 后由 Refine auth provider 处理），本地调试加 `http://localhost:5173/**` |
| API / Audience | 与 `QIY_OIDC_AUDIENCE` 一致；Web 端必须请求该 audience 的 token |
| Claims | 角色 claim（映射到生成器的 `roleField`，值为 `admin`/`operator`/`viewer`）与租户 claim（用于 `scope ... claim tenant.customerId`） |
| 用户映射 | 生成器用 `issuer + "|" + sub` 作为 `subjectField`，需要在 `users` 表为用户预置该 subject |

然后把真实值写到生成项目的 `.env.production`：

```env
QIY_OIDC_ISSUER=https://<tenant>/
QIY_OIDC_AUDIENCE=<api audience>
QIY_OIDC_JWKS_URL=https://<tenant>/.well-known/jwks.json
QIY_AUTH_SECRET=<32+ characters>
QIY_STORAGE_METADATA=database
HOST=0.0.0.0
```

验收方式：

- **服务端 token 验签**：把真实 token 放进 `curl -H "Authorization: Bearer <token>" https://<app>/api/v1/auth/me`，应返回映射后的 principal（role + claims）。
- **JWKS 轮换**：在厂商控制台轮换签名密钥后，旧 token 应逐步失效、新 token 立即可用（生成器默认缓存 10 分钟，可用 `QIY_OIDC_JWKS_CACHE_MAX_AGE_MS` 调小）。
- **浏览器 PKCE / 静默续期**：在真实浏览器完成登录 → 刷新页面 → 打开多个标签页；若要自动化，可用 Playwright 驱动真实 IdP 登录页（Qiy 不内置浏览器自动化，脚本需要自备）。
- **错误场景**：换一个没有该 audience 的 client 取 token，应 401；删除 `users` 中的 subject 映射后，应 401。

## 3b. 真实 Auth0 租户（Phase A 已跑通）

```powershell
$env:QIY_AUTH0_DOMAIN="dev-3c3eq3j5rm4meg4p.us.auth0.com"
bun run tools/verify-auth0.ts
```

Phase A（只需要租户域名，不需要客户端密钥）已经跑通：

- 拉取真实 `.well-known/openid-configuration`：issuer/JWKS/token 端点、RS256；
- 拉取真实 `.well-known/jwks.json`：断言包含当前与下一把轮换 key（`0FJCjD5IW4jOsvAUyuqYq`、`hLvPykYxvTS831IEJ1qaJ`）；
- 生成 OIDC 应用并把 issuer/JWKS 指向该租户：用**伪造但 kid 正确**的 token 触发验签失败（证明真实 JWKS 已被拉取并参与校验），缺 token/畸形 token 也被拒绝。

Phase B（真实 token 登录）需要 Auth0 侧凭据：

```powershell
$env:QIY_AUTH0_CLIENT_ID="<application client id>"
$env:QIY_AUTH0_CLIENT_SECRET="<client secret, 仅 confidential 应用需要>"
$env:QIY_AUTH0_AUDIENCE="<API identifier，例如 https://qiy-api>"
$env:QIY_AUTH0_USERNAME="<Username-Password-Authentication 连接里的用户邮箱>"
$env:QIY_AUTH0_PASSWORD="<该用户密码>"
bun run tools/verify-auth0.ts
```

设置后脚本会用 password grant 从 `/oauth/token` 取真实 token（带 API audience），在 `users` 表写入 `iss|sub` 映射后验证：合法 token 通过并映射 admin；不带 audience 的 token 被拒；篡改签名被拒。

> Auth0 默认应用类型是 SPA（无 client_secret，不能 password grant）。要跑 Phase B，请在 Auth0 控制台创建一个 **Regular Web Application 或 Machine-to-Machine** 并启用 Password Grant，或在 Application → Advanced → Grant Types 勾选 Password；同时确保该应用被授权 API（audience）。

## 3c. 真实 Kinde 租户（Phase A 已跑通）

```powershell
$env:QIY_KINDE_DOMAIN="https://windshage.kinde.com"
$env:QIY_KINDE_CLIENT_ID="84551a42d0e04c5aabcbfb04f00aa7c6"
$env:QIY_KINDE_REDIRECT_URL="http://localhost:3000"
bun run tools/verify-kinde.ts
```

Kinde 只支持 authorization_code / client_credentials / device_code（**没有 password grant**），所以无人值守的用户 token 必须走浏览器或 device flow。脚本验证不需要浏览器登录的部分：

- 真实 discovery：issuer、JWKS（`/.well-known/jwks`）、authorization/token 端点、RS256，并确认 password grant 未开启；
- 真实 JWKS 可拉取且包含 RS256 签名 key；
- **提供的 public client id 被授权端点接受**（PKCE + 强 state），未知 client id 被拒绝；
- 生成 OIDC 应用指向该租户：伪造 token（kid 正确、签名错误）被真实 JWKS 验签拒绝，缺/畸形 token 被拒。

Phase B（真实用户登录）在浏览器完成：打开脚本构造的授权 URL（或生成 Web 的登录页）→ 登录 → 回调 code → 用 PKCE verifier 换 token → 打 `/api/v1/auth/me`；Kinde 也支持 device code flow 可做半自动验证。这些属于浏览器交互，Qiy 不内置浏览器自动化。

## 3d. 真实 Google OpenID Connect（Phase A 已跑通）

```powershell
$env:QIY_GOOGLE_CLIENT_ID="<client id>"
$env:QIY_GOOGLE_CLIENT_SECRET="<client secret>"
$env:QIY_GOOGLE_REDIRECT_URI="http://localhost:8000/oauth/google"
# 受限网络下 Bun fetch 需要代理（生成器服务端也一样）：
$env:HTTPS_PROXY="http://127.0.0.1:10090"
$env:HTTP_PROXY="http://127.0.0.1:10090"
bun run tools/verify-google.ts
```

已验证（Phase A）：

- 真实 discovery：issuer=accounts.google.com、JWKS（`www.googleapis.com/oauth2/v3/certs`）、authorization/token 端点、RS256；
- 真实 JWKS 可拉取且含 RS256 签名 key；
- **PKCE 授权请求被 Google 接受**（client_id + redirect_uri 已注册，未返回 `redirect_uri_mismatch`/`invalid_client`）；
- **token 端点验证 client_id/secret/redirect_uri**：用伪造 code 请求返回 `invalid_grant`（而非 `invalid_client`），说明客户端凭据与重定向地址都有效；
- 生成 OIDC 应用指向 Google：伪造 token（kid 正确、签名错误）被真实 Google JWKS 验签拒绝，缺/畸形 token 被拒。

Phase B（真实用户 ID token）需要浏览器授权（Google 不支持 password grant）。可选做法：在 [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) 用该 client 授权后复制 `id_token`，然后：

```powershell
$env:QIY_GOOGLE_ID_TOKEN="<id_token>"
bun run tools/verify-google.ts
```

脚本会校验 token 的 IANA/audience、按 `iss|sub` 写入 users 表映射，并验证生成 server 接受该真实 token。

## 3e. 真实 Okta 租户（Phase A 已跑通）

```powershell
$env:QIY_OKTA_DOMAIN="https://trial-6051350.okta.com/"
# 受限网络下 Bun fetch 需要代理（生成器服务端同理）
$env:HTTPS_PROXY="http://127.0.0.1:10090"
bun run tools/verify-okta.ts
```

Phase A（只需要 org 域名）已验证：

- 默认授权服务器 `/oauth2/default` 的 discovery：issuer、`/v1/keys`、`/v1/authorize`、`/v1/token`、RS256；
- 真实 JWKS 可拉取且含 RS256 签名 key；org authorization server discovery 也确认已启用；
- 生成 OIDC 应用（`provider okta`）指向该授权服务器：伪造 token（kid 正确、签名错误）被真实 Okta JWKS 验签拒绝，缺/畸形 token 被拒。

Phase B（真实用户 token，Resource Owner Password grant）需要 Okta 侧：

```powershell
$env:QIY_OKTA_CLIENT_ID="<OIDC Web Application client id>"
$env:QIY_OKTA_CLIENT_SECRET="<client secret>"
$env:QIY_OKTA_AUDIENCE="api://default"          # 或自定义 AS 的 audience
$env:QIY_OKTA_USERNAME="<已 Assign 到该应用的测试用户邮箱>"
$env:QIY_OKTA_PASSWORD="<该用户密码>"
bun run tools/verify-okta.ts
```

Okta 配置步骤：

1. Applications → Create App Integration → **OIDC - OpenID Connect** → **Web Application**；
2. Sign-in redirect URI 填生成 Web 的登录回调（如 `http://localhost:3000/login`）；
3. General → Grant types 勾选 **Resource Owner Password**（以及 Authorization Code）；
4. Assignments 里把测试用户分配给该应用（未分配会返回 `access_denied`）；
5. Security → API → Authorization Servers：用 `default`（audience `api://default`）或自定义 AS（自定义 audience）。

脚本用 password grant 从 `/v1/token` 取真实 token，写入 `iss|sub` 用户映射后验证：合法 token 通过并映射 admin；伪造签名被拒。

## 3f. Azure AD B2C / Microsoft Entra External ID 创建与验收

> 微软已把新建 B2C 租户的入口逐步迁移到 **Microsoft Entra External ID**（`ciamlogin.com`）。新订阅里如果找不到 "Azure AD B2C" 创建入口，请直接用下面的 External ID 步骤；已存在的 B2C 租户仍按 B2C 步骤测试。两种都能用 `provider azure-ad-b2c`。

### A. 传统 Azure AD B2C（b2clogin.com）

1. Azure Portal → Create a resource → **Azure AD B2C**（或 Microsoft Entra ID → External Identities 里的 B2C 租户），创建后记下 **租户域名** `contoso.onmicrosoft.com` 与 **租户 ID**。
2. **App registrations → New registration**：
   - Supported account types 选 B2C 的 "Accounts in any identity provider or organizational directory"；
   - Redirect URI 选 **SPA** 或 **Web**，填生成 Web 的登录回调（本地可用 `http://localhost:3000/login`）；
   - 记下 **Application (client) ID**；Web 类型再生成一个 **client secret**。
3. （可选）**Expose an API** 添加 scope（如 `https://contoso.onmicrosoft.com/api/read`），用于 access token 的 API audience。
4. **User flows → New user flow**：
   - 浏览器登录测试：**Sign up and sign in**（名如 `B2C_1_signupsignin`）；
   - 无人值守测试：**Resource Owner Password**（名如 `B2C_1_ropc`，Local accounts only）——只有它能让脚本直接换到真实 token，不依赖浏览器。
5. **Users → New user** 建一个本地账号（`user@contoso.onmicrosoft.com` + 密码），并在 user flow / app 中允许本地账号登录。
6. B2C 的 OIDC 元数据**按 user flow 区分**：
   - discovery：`https://contoso.b2clogin.com/contoso.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_ropc`
   - JWKS：`https://contoso.b2clogin.com/contoso.onmicrosoft.com/discovery/v2.0/keys?p=B2C_1_ropc`
   - issuer：`https://contoso.b2clogin.com/<tenant-id>/v2.0/`
7. 运行验收：

```powershell
$env:QIY_AZURE_TENANT_DOMAIN="contoso.onmicrosoft.com"
$env:QIY_AZURE_POLICY="B2C_1_ropc"                 # 浏览器登录测试时填 signupsignin 的流程名
$env:QIY_AZURE_CLIENT_ID="<application client id>"
$env:QIY_AZURE_CLIENT_SECRET="<client secret，SPA 可省略>"
$env:QIY_AZURE_USERNAME="user@contoso.onmicrosoft.com"
$env:QIY_AZURE_PASSWORD="<password>"
bun run tools/verify-azure-b2c.ts
```

脚本验证：按 policy 拉取真实 discovery 与 JWKS（RS256）→ 生成 `provider azure-ad-b2c` 服务用真实 JWKS 拒绝伪造 token → 若提供用户则走 **ROPC** 取真实 id_token，按 `iss|sub` 写入 users 映射并验证角色。没有用户凭据时 Phase A 仍会跑（只需 tenant domain + policy + client id）。

B2C ROPC 限制：只支持本地账号；MFA/密码过期/需同意/被锁定的账号会失败（错误会原样打印）。不想用 ROPC 时跳过用户变量即可，Phase B 改用浏览器。

### B. Microsoft Entra External ID（ciamlogin.com，新租户推荐）

1. Azure Portal → **Microsoft Entra External ID** → **External tenants** → Create；记下 `<tenant>.ciamlogin.com` 与 tenant id。
2. **App registrations** 创建应用（同上，Redirect URI 用 `http://localhost:3000/login`）。
3. **User flows → New user flow**：Sign up and sign in（External ID 目前不提供 ROPC，Phase B 需浏览器）。
4. 直接用脚本（脚本根据域名是否含 `.ciamlogin.com` 自动选择 discovery）：

```powershell
$env:QIY_AZURE_TENANT_DOMAIN="myexternal.ciamlogin.com"
$env:QIY_AZURE_TENANT_ID="<tenant id>"
$env:QIY_AZURE_CLIENT_ID="<application client id>"
bun run tools/verify-azure-b2c.ts
# 也可用 QIY_AZURE_ISSUER / QIY_AZURE_JWKS_URL 显式覆盖
```

Phase A 会校验 discovery（issuer/JWKS/token）、真实 JWKS 与生成服务对该租户的验签；Phase B 需浏览器登录拿到真实 id_token（可粘贴到 `QIY_AZURE_ID_TOKEN` 后由脚本校验，若需要我可加上该开关）。

## 4. 真实 Ably（需要 API Key）

Ably 没有本地服务器，必须用真实账号：

1. 在 <https://ably.com> 创建免费 app，复制 API key（`<appId>.<keyId>:<secret>`）；
2. 运行：

```powershell
$env:QIY_ABLY_API_KEY="<your key>"
bun run tools/verify-ably.ts
```

没有设置 key 时脚本会打印同样的说明并以 0 退出（明确 skip，不会假装通过）。**已用真实 Ably 账号跑通**：publish 写入后 REST history 能读到消息；token 端点签发的 capability 只有 `{ "qiy:orders": ["subscribe"] }`，用该 token publish 被 Ably 拒绝（40160 `Unauthorized to publish to channel`）；`viewer` 请求 token 得 403；错误 key 被拒。设置了 key 后它会验证：

- 生成器 publisher 通过真实 Ably REST 写入 `qiy:orders` channel，REST 读取 history 能看到该消息；
- 生成器 `/api/v1/realtime/token` 用真实 Ably `createTokenRequest` 签发 **subscribe-only** capability：能读 history，但 publish 会被 Ably 拒绝（40160）；
- `viewer` 角色请求 token 得到 403；
- 错误 key 会被 Ably 拒绝。

浏览器端重连：生成 Web 使用 Ably JS SDK 2.x，SDK 自带断线重连；GraphQL Subscription 的 SSE / graphql-ws 客户端有 Qiy 自己的指数退避重连（见 `docs/guide/api.md`）。

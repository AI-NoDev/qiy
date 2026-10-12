# 认证与权限

## 声明身份来源

```ts
auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
```

OIDC、OAuth2 和企业 SSO 也可以使用 `subjectField` 映射外部身份：

```ts
auth { provider oidc; user users; subjectField externalSubject; roleField role; }
```

| 字段 | 说明 |
| --- | --- |
| `provider` | `local`、`otp`、`oidc`、`oauth2`、`sso`、`okta`、`auth0`、`azure-ad-b2c`、`keycloak`、`google` 或 `kinde` |
| `user` | 用户实体名，必须存在 |
| `subjectField` | 外部身份 ID 映射到的字段，通常对应 `sub` |
| `roleField` | 角色字段，通常引用枚举 |
| `usernameField` | 本地密码或 OTP 登录标识字段；必须是唯一、非空的 Text 字段 |
| `passwordField` | 本地密码哈希字段；只用于服务端验证，不进入 API schema |

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

## OTP

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

OTP 生成 `/api/v1/auth/otp/request` 和 `/api/v1/auth/otp/verify`。challenge 是 5 分钟签名令牌，不依赖进程内存；验证成功后签发 12 小时 Bearer access token。生产环境必须配置 HTTPS 发送适配器：

```dotenv
QIY_AUTH_SECRET=<至少 32 字符随机值>
QIY_OTP_DELIVERY_URL=https://notification.example.com/otp
QIY_OTP_DELIVERY_TOKEN=<发送适配器凭据>
```

开发环境可设置 `QIY_DEV_MODE=1` 和 `QIY_OTP_DEV_CODE`；生产环境不得启用固定验证码。发送适配器负责邮件、短信、频率限制和供应商错误处理，Qiy 不绑定特定短信厂商。

## 生成结果

- server：本地 Argon2id 密码验证、OTP challenge/verify，或 OIDC/OAuth2/SSO 的 JWKS、issuer、audience 校验与角色守卫；
- web：Refine `AuthProvider`、`AccessControlProvider`、`Authenticated` 与登录页；
- 路由：本地 `AuthPage`、OTP 两阶段登录页，以及外部身份的 PKCE 登录与 callback 页面。

审计、通知、权限、认证和数据访问的生成约定见 [Refine providers](./refine-providers)。

受保护的生产 API 请求必须携带通过验证的 Bearer JWT。生产应保持 `QIY_DEV_MODE=0` 并配置所选认证 provider；没有认证配置的生成应用会拒绝生产启动，开发 preview 不能替代生产认证。

## 源码仓库认证验收

```sh
bun tools/verify-oidc-docker.ts --isolated
```

需要 Docker。命令创建临时网络、短期自签名证书和仅供测试的 HTTPS IdP，再从 `.qiy` 生成 SQLite/OIDC 应用，在 Docker 内安装依赖、测试 HTTP 认证和检查服务端类型。生成服务只通过临时 `NODE_EXTRA_CA_CERTS` 信任该测试证书，仍验证 TLS、签名、issuer、audience 和用户映射；结束后删除临时容器、网络及工作目录。

若指定已有测试容器，例如 `bun tools/verify-oidc-docker.ts qiy-oidc`，工具要求其测试环境提供 issuer/audience、Docker 网络及映射的 8443 端口。工具会提取该本机端口的公开证书作为测试信任根，并拒绝过期证书；此方式只用于已知本机测试容器，生产 IdP 必须使用受信任的证书链。

:::warning 当前限制

生成器与本地模拟已覆盖这些 provider，但真实 Okta/Auth0/Azure/Keycloak/Google/Kinde 租户、JWKS 轮换、claim/audience、退出登录和第三方 Cookie 策略仍需逐个环境验收。OTP 发送适配器也需真实邮件/短信供应商验收。

:::

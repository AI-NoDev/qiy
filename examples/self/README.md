# 供应链 + ERP + WMS 一体化（examples/self）

一个模型同时覆盖供应链、ERP 与 WMS，并演示 Qiy 的**混合认证**：同一张登录页同时提供账号密码登录、多个 OAuth/OIDC Provider 按钮、首次 OAuth 登录的账号开通（onboarding），以及登录后在个人中心绑定/解绑更多 Provider。所有身份都落在同一张 `users` 表上——每个 Provider 一个可空唯一身份列，密码哈希列与 Provider 身份列共存。

## 模型内容

- **供应链**：供应商、客户、采购单/明细、收货、销售单/明细、发运、单据状态机；
- **ERP**：产品、BOM、工作单（生产/领料/产出流水）、成本与价格字段（字段级 mask）、仪表盘分布/趋势指标；
- **WMS**：组织（scope tree claim）、仓库、库位、库存（在手/预留/批次）、库存流水、上架/调拨/盘点/预留/发运等 dataflow 命令（幂等 + 审计 + 事务回滚）；
- **实时**：库存、库存流水、发运的 realtime outbox；
- **权限**：pages 页面级角色、restrict 字段 mask、scope 按 claim 过滤仓库；
- **实体显示文本（Django 风格）**：每个实体都声明 `@singular` / `@plural` / `@display` / `@tableDisplay` / `@relationDetail`，外键列显示目标记录的显示文本并链接到 Drawer/详情页，不再显示 UUID；
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

## 模块化模型

模型不再是一个单文件：`app.qiy` 只保留 `application` 头、`database` / `api` / `realtime` / `auth` 配置和 `include` 语句，其余内容按领域拆到 `modules/`：

```text
examples/self/app.qiy                 # 配置 + include + scope/restrict
examples/self/modules/platform.qiy    # 共享 enum + auth users 实体
examples/self/modules/scm/entities.qiy  # 组织、供应商、客户、产品、BOM
examples/self/modules/erp/entities.qiy  # 采购单/行、收货、销售单/行、发运
examples/self/modules/wms/entities.qiy  # 仓库、库位、库存、库存流水、工单
examples/self/modules/relations.qiy   # 全部 relation（必须在所有实体之后）
examples/self/modules/messages.qiy    # zh-CN / en-US 完整词典
examples/self/modules/pages.qiy       # 页面级角色规则（在 scope/restrict 之后）
examples/self/modules/dashboard.qiy   # 仪表盘指标
examples/self/modules/dataflows.qiy   # 事务型业务命令
examples/self/modules/actions.qiy     # 绑定到 dataflow 的列表/详情按钮
```

被引入的文件是 application 片段，不写 `qiy v0;` / `application {}`。展开后的模型仍必须满足 V0 的声明顺序，因此 `app.qiy` 按如下顺序 include：

```qiy
include "modules/messages.qiy";        // messages 在配置块之后、enum/entity 之前
include "modules/platform.qiy";        // enum + users
include "modules/scm/entities.qiy";
include "modules/erp/entities.qiy";
include "modules/wms/entities.qiy";
include "modules/relations.qiy";       // 所有 relation 在实体之后
scope warehouses orgId claim org.id;   // scope/restrict 留在主文件
restrict products { ... }
include "modules/pages.qiy";           // pages 在 restrict 之后
include "modules/dashboard.qiy";
include "modules/dataflows.qiy";
include "modules/actions.qiy";
```

`include` 路径只能使用项目根目录内的相对 `.qiy` 路径，循环引用、`..` 穿越和符号链接逃逸都会在生成前报错；`include "modules/messages.qiy" @messages;` 可以只导入目标文件唯一的顶层 `messages` 块。回归测试见 `tests/qiy-include.test.ts` 与 `tests/example-modules.test.ts`（后者断言模块拆分后实体/字段/关系/动作数量与拆分前一致）。

## 多语言（zh-CN / en-US）

`modules/messages.qiy` 为模型里所有会被界面渲染的字符串提供完整中英词典；生成页面不再直接渲染裸 label，而是用稳定 key 查词典、缺失时回退到 DSL 里声明的原文：

| Key | 覆盖内容 |
| --- | --- |
| `qiy.resources.<resource>.label` | 菜单、面包屑、列表/表单/详情页标题 |
| `qiy.resources.<resource>.singular` / `.plural` | 新建/编辑/详情/抽屉标题、新建按钮（单数）与菜单、列表标题（复数） |
| `qiy.resources.<resource>.fields.<field>.label` | 列表列头、详情 label、表单 label、筛选占位符 |
| `qiy.enums.<enum>.label` / `qiy.enums.<enum>.values.<value>` | 枚举值 Tag、下拉选项（显示模板中的枚举字段同样使用） |
| `qiy.menu.<group>.label` | 菜单分组（本示例没有 menu 块） |
| `qiy.dashboard.<metric>.label` | 仪表盘指标卡 |
| `qiy.actions.<action>.label` / `.confirm` / `.inputs.<input>.label` | 业务命令按钮、确认框、命令表单字段 |
| `errors.*`（本示例自定义） | `@error(t("key"))` 业务规则错误：服务端返回默认语言文案 + `errorKey`，前端按当前语言再翻译 |

实体显示模板（`@display` / `@tableDisplay` / `@relationDetail`）由字段引用和分隔符组成，本身不参与翻译；单数/复数名通过 `singular` / `plural` 键切换语言。示例里所有 17 个实体都带完整显示注解，`tests/example-modules.test.ts` 会断言每个外键目标实体都有表格文本与 Drawer 正文。

静态页面文字（列表工具栏/导入导出/已存视图、分页、主题与明暗模式、403 页、个人中心、登录/onboarding 页面等 UI chrome）使用生成器内置的中英词典，项目 `messages` 可用同名 `qiy.*` key 覆盖，缺省回退内置值。语言选择写在生成 header 的 Select 中：切换后 Ant Design `ConfigProvider`、Refine i18n、`document.documentElement.lang` 同步更新，选择保存在 `localStorage` 的 `qiy.locale`，刷新后保持；未声明的语言回退到默认语言。生成的 `apps/web/tests/model-i18n.test.ts` 会断言每个模型 label 都有稳定 key、中文/英文词典分别解析、以及切换语言后存储值更新；`apps/web/tests/chrome-i18n.test.ts` 断言工具栏、主题控件、分页和登录/个人中心 chrome 在中英文下都能解析。

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

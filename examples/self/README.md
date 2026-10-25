# 供应链 + ERP + WMS 一体化（examples/self）

一个模型同时覆盖供应链、ERP 与 WMS，并演示 Qiy 的**混合认证**：同一张登录页同时提供账号密码登录、多个 OAuth/OIDC Provider 按钮、首次 OAuth 登录的账号开通（onboarding），以及登录后在个人中心绑定/解绑更多 Provider。所有身份都落在同一张 `users` 表上——每个 Provider 一个可空唯一身份列，密码哈希列与 Provider 身份列共存。

## 模型内容

- **供应链**：供应商、客户、采购单/明细、收货、销售单/明细、发运、单据状态机；
- **ERP**：产品、BOM、工作单（生产/领料/产出流水）、成本与价格字段（字段级 mask）、仪表盘分布/趋势指标；
- **WMS**：组织（scope tree claim）、仓库、库位、库存（在手/预留/批次）、库存流水、上架/调拨/盘点/预留/发运等 dataflow 命令（幂等 + 审计 + 事务回滚）；
- **实时**：库存、库存流水、发运的 realtime outbox；
- **权限**：原子权限 + 权限组（角色即权限组）+ 数据库列/OAuth claim provider + 权限校验块；pages 页面级角色、restrict 字段 mask、scope 按 claim 过滤仓库仍然保留；
- **实体显示文本（Django 风格）**：每个实体都声明 `@singular` / `@plural` / `@display` / `@tableDisplay` / `@relationDetail`，外键列显示目标记录的显示文本并链接到 Drawer/详情页，不再显示 UUID；外键 Drawer 与详情页共用 `app/components/record-details.tsx` 的 `RecordDetails`，按当前角色渲染全部 `showVisible` 字段（枚举 Tag、外键 `RelationCell`、日期/时间本地化、文件下载链接、Vector/空值占位），`@relationDetail` 摘要保留在字段详情上方，头部面包屑是「目标资源列表 → 当前记录详情页」并叠加嵌套 Drawer；**外键批量加载**：列表页把当前页外键值按目标资源分组，通过 `RelationBatchProvider` 的 `useMany`/`getMany` 用一条 `filters=[{"field":"id","operator":"in","value":"..."}]` 列表请求取回（例如库存流水的仓库/库位/产品三列只要 1~3 条请求），单元格自身的 `useOne` 查询被禁用；详情页关联表、抽屉正文和外键下拉仍走单条 `useOne`；
- **日期与时间类型**：采购单 `expectedDate Date`、发运 `departureTime Time` 与既有的 `orderedAt` / `shippedAt` / `plannedAt` 等 `DateTime` 字段一起演示三种时间粒度 —— 创建/编辑表单分别渲染日期 picker、时间 picker、日期时间 picker，列表/详情按当前语言格式化，seed 提供真实值，服务端对非法日期/时间返回 400；
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
examples/self/modules/permissions.qiy # 权限字段/组/provider 来源/校验块
examples/self/modules/pages.qiy       # 页面级角色规则（在 scope/restrict 之后）
examples/self/modules/dashboard.qiy   # 仪表盘指标
examples/self/modules/dataflows.qiy   # 事务型业务命令
examples/self/modules/actions.qiy     # 绑定到 dataflow 的列表/详情按钮
```

被引入的文件是 application 片段，不写 `qiy v0;` / `application {}`。展开后的模型仍必须满足 V0 的声明顺序，因此 `app.qiy` 按如下顺序 include：

```qiy
include "modules/messages.qiy";        // messages 在配置块之后、enum/entity 之前
include "modules/permissions.qiy";     // permission 在 messages 之后、enum/entity 之前
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

## 已存视图（saved views）

列表页的 **Saved views / 已存视图** 下拉同时承载两种视图，来源用标签区分：

| 标签 | 来源 | 存储 | 删除规则 |
| --- | --- | --- | --- |
| **个人**（`qiy.viewMine`） | 浏览器本地视图 | `localStorage` 的 `qiy.views.<resource>` | 任何能打开列表页的用户都可以删除自己的本地视图 |
| **发布**（`qiy.viewPublishedTag`） | 服务端私有视图（`shared: false`） | 生成的 `qiy_saved_views` 表 | 只有 `ownerId` 本人；`role = admin` 也可以清理他人的共享视图 |
| **共享**（`qiy.viewSharedTag`） | 服务端共享视图（`shared: true`） | 生成的 `qiy_saved_views` 表 | 本人或 admin；其他用户只读，UI 不显示删除入口 |

- 同名保存/发布是 **upsert**：同一用户在同一资源下用相同名称再次保存会更新既有行（筛选、排序、列、共享标记、`updatedAt`），不会产生重复的下拉项；旧版本残留的重复同名行会在下一次发布时合并。每人每资源最多 100 个不同名称的视图（同名更新不计入）。
- 共享语义：`共享` 视图对**所有能读取该资源的登录用户可见**（列表接口返回自己的视图 + 所有人的共享视图），`发布` 视图只对本人可见；两者都只暴露数据快照（search/filters/sorters/columns）和 `mine` 所有权标记，不泄露其他用户身份。
- 删除：下拉中每一项右侧有删除图标 + Popconfirm；本地视图直接改 `localStorage`，服务端 `server:<id>` 视图调用 `DELETE /api/v1/saved-views/:id` 后重新拉取列表，成功/失败都有本地化通知。删除当前选中的视图会清空选择。
- 发布后本地副本会被服务端行取代，避免同名"个人 + 共享"两条并存；把已共享视图再次发布为 `shared: false` 即可取消共享（当前未提供单独的"取消共享"按钮）。
- `examples/self/dex/seed.ts` 在重置演示数据时会一并清空 `qiy_saved_views`，所以重新 seed 后不会残留上一轮的共享/发布视图。

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
| 本地密码 | `admin@example.com` / `admin-password` | `POST /api/v1/auth/login`；seed 里的管理员，role=admin（角色组授予全部权限） |
| 本地密码 | `operator@example.com` / `operator-password` | seed 里的仓库操作员，role=operator；无采购审批权限，用于 403 验收 |
| 本地密码 | `viewer@example.com` / `viewer-password` | seed 里的只读报表用户，role=viewer；仅 `report:read` |
| Dex A（`okta` Provider） | `admin@example.com` / `admin-password` | 已绑定 `oktaSubject`，直接登录并拿到 Qiy 会话（与本地会话相同的权限并集） |
| Dex A（`okta` Provider） | `viewer@example.com` / `viewer-password` | 未绑定任何行：用于演示登录后从 `/profile` 绑定新 Provider |
| Dex B（`keycloak` Provider） | `admin@example.com` / `admin-password` | 已绑定 `keycloakSubject`，不同 issuer 的第二个租户 |
| Dex B（`keycloak` Provider） | `operator@example.com` / `operator-password` | 未绑定该 Provider：首次 OAuth 登录仍会触发 onboarding（本地密码账号与 Provider 绑定互不影响） |
| Google / Kinde / Azure AD B2C | 各自租户账号 | 首次登录同样走 onboarding；绑定/解绑规则一致 |

两个 Dex 租户（issuer 分别是 `http://localhost:5556/dex` 和 `http://localhost:5557/dex`）用于本地真实 OAuth 登录；Google/Kinde/Azure 三个按钮需要各自租户可用（client id/secret 见下）。

## 权限模型（permission）

`modules/permissions.qiy` 声明 12 个原子权限、6 个权限组、3 个 OAuth claim 来源、1 个数据库列来源和 4 个校验块；`users` 表新增可空 `permissions` 列作为数据库 provider：
"角色组 ∪ 数据库列 ∪ 已验证 id_token claims" 只做加法，本地密码会话没有 claims。

| 角色（权限组） | 生效权限（权限值） | 说明 |
| --- | --- | --- |
| `admin` | 全部 12 个权限 | 组内嵌套 `SuperAdminManager = UserApiPermissionGroup & ManagerRole`（`&` 为并集） |
| `operator` | `inventory:receive/putaway/reserve/adjust/transfer`、`sales:ship`、`workorder:complete`、`report:read` | seed 的数据库列额外给 `ReportReadPermission` + `InventoryAdjustPermission`（幂等并集） |
| `viewer` | `report:read` | seed 的数据库列同样给 `ReportReadPermission` |

示例校验块：`CanAccessUserApi`（数组输入，`all included in self.permissions`）、`CanManageUsers`（组或权限）、`CanShipOrders`（`self.role`）、`CanAdjustStock`（`Text` 输入）。

dataflow 迁移矩阵：

| dataflow | allow 形式 |
| --- | --- |
| `receiveInventory` / `putawayStock` / `adjustStock` / `transferInventory` / `completeWorkOrder` | `allow permission <Inventory...Permission>` |
| `approvePurchaseOrder`（新增） | `allow permission PurchaseApprovePermission`（operator 403、admin 200） |
| `shipSalesOrder` | `allow verification CanShipOrders`（operator/admin 200、viewer 403） |
| `reserveStock` | 保留 `allow roles admin, operator;` 证明旧写法继续工作 |

HTTP 验收接口：`GET /api/v1/auth/permissions`、`POST /api/v1/auth/verify-permission`，以及 `/auth/me` 新增的 `permissions` / `groups` 字段。脚本 `tmp/verify-permissions.ts`（不提交）覆盖三种角色登录、权限并集、校验真值表、dataflow 200/403 矩阵与真实 Dex token 登录。

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

# 4) 演示数据：admin/operator/viewer 三个本地账号（admin 绑定两个 Dex 身份），
#    以及权限列、两张采购单（一张 draft 供审批权限验收；含 expectedDate 日期）
#    和一条带 departureTime 时间的发运单
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

## 日期与时间字段（Date / Time / DateTime）

| 资源 | 字段 | 类型 | 表单 | seed 值 |
| --- | --- | --- | --- | --- |
| 采购单 `purchase_orders` | `expectedDate` | `Date` | `DatePicker`（`YYYY-MM-DD`） | `PO-2026-001` → `2026-12-05`、`PO-2026-002` → `2026-12-18` |
| 采购单 `purchase_orders` | `orderedAt` | `DateTime` | `DatePicker showTime`（`YYYY-MM-DD HH:mm:ss`） | 下单时间戳 |
| 发运单 `shipments` | `departureTime` | `Time` | `TimePicker`（`HH:mm:ss`） | `09:30:00` |
| 发运单 `shipments` | `shippedAt` | `DateTime` | `DatePicker showTime` | 发运时间戳 |
| 工单 `work_orders` | `plannedAt` | `DateTime` | `DatePicker showTime` | 计划时间戳 |

- picker 页面：`/purchase_orders/create`、`/purchase_orders/:id/edit`、`/shipments/create`、`/shipments/:id/edit`；`/work_orders/:id/edit` 继续演示 `DateTime`。
- HTTP 契约：REST `POST /api/v1/purchase_orders/` 接受 `expectedDate: "2026-11-30"` 与 `orderedAt` ISO 字符串并原样读回；`2026-02-31` / `not-a-date` 返回 400 `Invalid Date value for expectedDate`。`POST /api/v1/shipments/` 接受 `departureTime: "09:30"` 并规范化为 `"09:30:00"`，`25:61:00` 返回 400。GraphQL 中两个字段都是 `String` 标量，非法日期通过 service 校验返回 GraphQL error。
- 种子脚本 `examples/self/dex/seed.ts` 会写入上述 Date/Time 值；生成器侧回归见 `tests/temporal-fields.test.ts` 与 `apps/web/tests/date-fields.test.ts`（往返/非法输入/本地化格式）。

## 业务编码与组织层级（@code / @generated）

业务单据号与系统引用不再由用户手工输入，模型声明生成规则，服务端在创建时渲染；新建/编辑表单隐藏这些字段（编辑页只读），列表/详情正常显示：

| 资源 | 字段 | 注解 | 生成结果示例 |
| --- | --- | --- | --- |
| 组织 `orgs` | `code` | `@code("ORG-{YYYY}{MM}-{seq:4}")` | `ORG-202611-0001`（按月重置） |
| 组织 `orgs` | `externalId` | `@generated(uuid)` + `@listVisible(false)` | UUIDv4 |
| 供应商 `suppliers` | `code` | `@code("SUP-{YYYYMMDD}-{seq:4}")` | `SUP-20261130-0001`（按天重置） |
| 客户 `customers` | `code` | `@code("CUS-{YYYYMMDD}-{seq:4}")` | `CUS-20261130-0001` |
| 采购单 `purchase_orders` | `number` | `@code("PO-{YYYYMMDD}-{seq:4}")` | `PO-20261130-0001` |

- **组织层级**：`modules/relations.qiy` 声明自关联 `relation orgParent orgs parentId orgs id one @onDelete(setNull);`。三种 Drizzle 方言都会生成带显式 `Any*Column` 回调的 `references()`，因此 `/orgs/create` 的 `上级组织` 渲染为组织显示文本的 RelationSelect；文本 `parentId` 从 UI 已不可能提交，直接构造非法 JSON 只会得到 422。
- **序号**：`qiy_code_sequences` 表按 `(entity, field, bucket)` 递增，日期 token 决定桶（`{YYYYMMDD}` 按天）。PostgreSQL/SQLite 用原子 upsert、MySQL 用事务内 `FOR UPDATE`，并发创建不会重复；唯一冲突重试 5 次后返回 409。
- **种子**：`seed.ts` 直接写表，因此保留 `ACME`、`SUP-1`、`PO-2026-001` 等人工编码；生成规则只作用于之后新建的记录，CSV 导入/GraphQL 创建同样走服务端生成。
- **配置**：日期 token 使用 `QIY_CODE_TIMEZONE`（缺省 `UTC`）。
- 生成器回归：`tests/code-template.test.ts`、`tests/generated-values.test.ts`；生成应用回归：`apps/server/tests/generated-values.test.ts`（日期桶重置、随机字符集、并发 25 行唯一编码、UUID、忽略客户端值）与 `apps/web/tests/generated-fields.test.ts`（新建隐藏/编辑只读/中英提示）。

## 验收

仓库内脚本 `tmp/verify-hybrid-demo.ts`（不提交）会驱动两个真实 Dex 租户完成：匿名 401、Provider 列表 5 项、密码登录、已有身份 OAuth 登录、新身份 onboarding → 注册 → `/auth/me`、绑定/解绑/最后登录方式保护。仓库测试覆盖生成器侧的 DSL、路由、鉴权与页面生成（`bun test tests/auth-providers.test.ts`）。

权限矩阵由 `tmp/verify-permissions.ts`（不提交）驱动真实 Dex 与运行中的 demo：admin/operator/viewer 本地登录、`/auth/me` 与 `/auth/permissions` 并集、`/auth/verify-permission` 真值表、dataflow 的 200/403 矩阵（operator 发运 200、viewer 发运 403、operator 审批 403、admin 审批 200、viewer 预留 403），以及 Dex 真实 id_token 验签后的 OAuth 会话权限并集。生成器侧测试：`bun test tests/permissions.test.ts`；生成应用测试：`apps/server/tests/permissions.test.ts`（provider/真值表/HTTP/`/auth/me`）、`apps/web/tests/auth.test.ts`（命令按钮权限可见性）。

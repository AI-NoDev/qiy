<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/public/qiy-logo-dark.svg">
    <img src="docs/public/qiy-logo-light.svg" width="88" height="88" alt="Qiy logo">
  </picture>
</p>

<h1 align="center">Qiy</h1>

<p align="center">
  <strong>以数据为中心的全栈应用生成语言</strong><br>
  一份 <code>.qiy</code> 业务模型，生成可二次开发的 Admin、API、数据库 Schema 与部署配置。
</p>

<p align="center">
  <a href="https://ai-nodev.github.io/qiy/"><strong>文档站</strong></a> ·
  <a href="https://ai-nodev.github.io/qiy/guide/getting-started"><strong>快速开始</strong></a> ·
  <a href="https://ai-nodev.github.io/qiy/guide/best-practice-warehouse"><strong>最佳实践</strong></a> ·
  <a href="https://ai-nodev.github.io/qiy/dsl/overview"><strong>DSL 参考</strong></a>
</p>

<p align="center">
  <a href="https://github.com/AI-NoDev/qiy/actions/workflows/deploy-docs.yml"><img src="https://github.com/AI-NoDev/qiy/actions/workflows/deploy-docs.yml/badge.svg" alt="Documentation deployment status"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun&logoColor=white" alt="Bun native">
  <img src="https://img.shields.io/badge/DSL-v0-059669" alt="DSL version 0">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2563eb" alt="MIT license"></a>
</p>

> **从数据模型开始，生成完整应用；从业务模型继续，演进复杂系统。**

## 为什么是 Qiy

| 一份模型 | 生成的应用层 | 可持续演进 |
| --- | --- | --- |
| `entity`、`field`、`relation`、权限与菜单 | Refine 管理后台、Bun + Elysia API、Drizzle Schema 与迁移 | 输出是普通 TypeScript 项目，可由团队继续维护和扩展 |

- **Bun-native**：后端采用 Bun + Elysia，命令行可打包为 Windows、Linux、macOS 独立可执行文件。
- **数据驱动**：字段、关联、枚举、表单、列表、筛选、权限与 API 契约从同一份模型生成。
- **业务可演进**：V0 聚焦 CRUD 与 Dashboard；V1 用工作流、事务、审计与领域命令覆盖 ERP 类复杂业务。
- **开放生态**：前端使用 Refine + React Router，数据层使用 Drizzle，存储支持 local 和 S3-compatible。

## 30 秒体验

```powershell
bun install
bun run qiy -- generate examples/catalog/app.qiy out/catalog-admin

cd out/catalog-admin
bun install
bun run build
bun run preview
```

生成的工作区包含 `apps/web`（Refine 管理端）与 `apps/server`（Bun + Elysia API）。更多可运行示例见 [`examples/catalog/`](examples/catalog/) 和 [`examples/erpadmin/`](examples/erpadmin/)。

## 导航

| 想了解什么 | 从这里开始 |
| --- | --- |
| Qiy 的定位与边界 | [项目介绍](https://ai-nodev.github.io/qiy/guide/what-is-qiy) |
| 从 `.qiy` 生成项目 | [快速开始](https://ai-nodev.github.io/qiy/guide/getting-started) · [CLI](https://ai-nodev.github.io/qiy/guide/cli) |
| 组织大型模型 | [模块化 include](https://ai-nodev.github.io/qiy/guide/modules) · [仓储系统最佳实践](https://ai-nodev.github.io/qiy/guide/best-practice-warehouse) |
| 理解语言语法 | [DSL 参考](https://ai-nodev.github.io/qiy/dsl/overview) |
| 运行、部署与分发 | [部署指南](https://ai-nodev.github.io/qiy/guide/deployment) · [Android 分发](https://ai-nodev.github.io/qiy/guide/android-distribution) |

## 获取可执行文件

每次更新 `package.json` 的版本号后，GitHub Actions 会自动构建并发布 Windows x64、Linux x64/ARM64、macOS x64/ARM64 五个平台的独立可执行文件。Release Tag 使用 `v<package.json.version>`；如果该 Tag 已经存在，工作流会跳过，不会重复创建版本。

- [下载最新 Release](https://github.com/AI-NoDev/qiy/releases)
- 手动发布：在 GitHub Actions 中运行 **Release Qiy CLI**
- 发布前改版本：更新 `package.json` 的 `version`，再推送到 `main`

## 当前状态

| 范围 | 状态 |
| --- | --- |
| `.qiy` → Turborepo + Bun 工作区 | 可用 |
| Refine Admin、REST / GraphQL、Drizzle | 可用，按模型按需生成 |
| SQLite、PostgreSQL、MySQL 生成路径 | 可用，能力依方言校验 |
| OIDC / OAuth2 / SSO 与本地密码登录 | 已生成基础集成，真实 IdP 需项目验收 |
| 复杂 ERP 工作流与 MPS 内置生成器 | 持续演进中 |

完整能力边界、真实验收状态和后续优先级见 [V3 状态与规划](openwiki/v3-status.md)。

---

## 详细说明

### 官网与文档

完整文档站位于 [`docs/`](docs/)，基于 VitePress 构建，与 Vue、React 官网同一套技术栈：

```powershell
bun run docs:dev      # 本地预览 http://localhost:5173
bun run docs:build    # 构建静态站点到 docs/.vitepress/dist
bun run docs:preview  # 预览构建产物
```

内容分为「指南」（定位、快速开始、项目结构、数据建模、API、认证、菜单与 Dashboard、工作流、存储、部署、MPS）与「DSL 参考」（application、entity/field、relation/index、enum/menu/dashboard），并附路线图。

### Qiy CLI 与发布

所有生成工具统一收敛为 `qiy` 命令：

```powershell
# 在仓库中使用
bun run qiy -- generate examples/catalog/app.qiy out/catalog-admin

# 构建当前平台的独立可执行文件（无需安装 Bun）
bun run build:exe
./dist/qiy-0.1.0-windows-x64.exe generate examples/catalog/app.qiy out/catalog-admin

# 构建 Windows x64、Linux x64/ARM64、macOS x64/ARM64 发布包
bun run build:exe -- --all
```

CLI 命令包括：`generate`、`validate`、`export-ir`、`export-qiy`、`drizzle`。执行 `qiy --help` 查看完整说明。可执行文件内联 Admin 模板与 MPS structure 模型，因此在仓库外也能从 `.qiy` 或 `.mps` 输入生成项目。发布前运行：

```powershell
bun install
bun run template:build
bun run check
bun test
bun run build:exe -- --all
npm publish
```

生成的 S3 存储适配器使用 **Bun 原生 `Bun.S3Client`**，不引入 AWS SDK；支持 AWS S3、R2、MinIO 等兼容端点。配置 `QIY_S3_BUCKET`、`QIY_S3_REGION`、`QIY_S3_ENDPOINT`、`QIY_S3_ACCESS_KEY_ID`、`QIY_S3_SECRET_ACCESS_KEY`，临时凭据额外配置 `QIY_S3_SESSION_TOKEN`。

当前仓库包含 MPS 语言骨架和一个已可运行的外部 Bun 生成器切片；完整 DSL、业务模型与生产级安全能力仍待实现。实际实现进度与 V3 剩余验收门槛见 [V3 状态与规划](openwiki/v3-status.md)。

### 现在就看生成的 Admin

示例输入是 [`examples/catalog/app.qiy`](examples/catalog/app.qiy)：V0 的受限文本语法已经支持 `application`、`database`、`entity`、`field`、`index`，仍非完整 DSL。已生成的**Turborepo + Bun workspace** 位于 [`examples/catalog/admin/`](examples/catalog/admin/)，包括 `apps/server/`、`apps/web/`、根 `package.json`、`turbo.json` 和 Drizzle migration。稳定骨架来自 [`templates/admin/`](templates/admin/)，Qiy 只填充与模型相关的切片。`apps/web/build/client/` 是可重建的前端构建产物。

```powershell
cd examples/catalog/admin
bun install
bun run test
bun run typecheck
bun run build
bun run preview
```

打开 `http://127.0.0.1:3000/products`：可看到产品列表和完整 CRUD，无需数据库，数据只在内存中。预览仅绑定本机，**不可部署到公网**。真数据库路径需要 PostgreSQL、预先由数据库管理员启用 `vector` 扩展、配置 `apps/server/.env`、运行 `bun run db:migrate`，之后启动 `bun run dev:server` 和 `bun run dev:web`。正式 API 在未设置 `QIY_DEV_MODE=1` 时拒绝启动；V0 尚未接入认证。

重新从 `.qiy` 生成到一个**新的空目录**：

```powershell
cd ../../..
bun run tools/generate-app.ts examples/catalog/app.qiy out/catalog-admin
```

从 MPS 合法模型也可执行 `bun run tools/generate-app.ts languages/qiy.sandbox/models/qiy.catalog.mps out/mps-admin`。这两种输入经同一 Database IR 与生成器，但当前样例各自维护，**尚未双向同步**；MPS 内置 generator 和真正独立的 Qiy 文本解析器仍未实现。

当前已落地的数据库结构 Concept 包括：`Application`、`DatabaseConfig`、`DatabaseExtension`、`DatabaseOptimization`、`Entity`、`Field`、`Index`、`IndexColumn`、`Constraint` 和 `CapabilityRequirement`。这些 Concept 先承载数据库语义；基础编辑器和部分类型检查已经接入，外部 Bun 桥接器可导出 IR 并由 Drizzle Kit 生成 migration，MPS 内置 generator 尚未接入。

### ERP Admin 压力示例

[`examples/erpadmin/app.qiy`](examples/erpadmin/app.qiy) 目前包含 7 个实体、6 条显式关系：用户、客户、仓库、产品、库存、订单和订单明细，包含 UUID 外键、金额、枚举、唯一索引和多列索引。已生成的可二次开发 Turborepo 位于 [`examples/erpadmin/admin/`](examples/erpadmin/admin/)，包括独立 server/web package、Refine + Ant Design 管理界面、REST/GraphQL API、Drizzle schema 与部署模板，并生成了 OIDC 守卫和订单工作流切片；它仍不代表真实 IdP、PostgreSQL 事务和生产部署已经完成。

```powershell
bun run tools/generate-app.ts examples/erpadmin/app.qiy out/erpadmin
cd out/erpadmin
bun install
bun run typecheck
bun run test -- --force
bun run build
bun run db:generate
```

当前 ERP 压力示例已验证：7 个资源模块、11 张表（含审计、订单分仓预占、持久化幂等回执和附件元数据表）、10 个业务外键、6 个 Dashboard 指标（含服务端订单状态分布）、34 个 API 测试、17 个 Web 测试、server/web 类型检查、Refine SPA 构建和 Drizzle migration 检查均可通过。列表支持多枚举筛选、字段显示切换、可选分页尺寸、权限化操作按钮和批量删除；详情页展示关联明细并支持订单提交、审批、出库、取消工作流；文件上传返回并保护 Attachment 元数据；`bun run preview` 仅绑定本机，预览使用内存仓库并关闭数据库工作流，local 存储文件 API 可用于本机上传/下载测试；真实 PostgreSQL/MySQL 事务、并发和 IdP 仍须另行验收。

受限 `.qiy` 文本语法目前还支持 `api { client rest; }` 或 `api { client graphql; }` 选择**一个**前端 DataProvider，以及 `auth { provider oidc|oauth2|sso; user users; subjectField externalSubject; roleField role; }` 声明外部身份映射。服务端同时挂载 `/api/v1/*` 和 `/graphql`，生产请求必须通过 Bearer JWT 的 issuer、audience、JWKS 签名验证；Refine 生成 `AuthProvider` 与 `AccessControlProvider`。枚举、字段可见性、搜索、排序、过滤、批量删除、`relation ... one;` 外键/关联选择器、`menu { group ... }` 多级菜单、local/S3 存储适配器、基础 `File` 字段与受保护文件上传/下载/删除端点已落地；ERP 产品资料字段可生成上传控件和迁移。业务工作流需在模型中显式声明，例如 `workflow orderInventory;`；只有声明后，PostgreSQL ERP 模型才会生成订单提交/审批/出库/取消、库存预占释放、事务、状态条件、持久化幂等回执和对应前端操作。该工作流目前要求 `orders`、`orderItems`、`inventoryItems` 约定实体，暂不支持 SQLite/MySQL，并非任意业务流程 DSL。PostgreSQL、SQLite、MySQL 已有可编译和 migration 生成路径及事务内 CRUD 审计切片；SQLite 生成包使用 Bun 原生 Drizzle migrator，已在真实 SQLite 文件中验证建表，SQLite 内存数据库也已验证审计失败回滚。完整数据范围策略、真实 S3/IdP、PostgreSQL/MySQL 实库审计验收以及 MPS 内置 generator 仍未落地。

当前已验证的语义规则包括：`IndexColumn.fieldName`、`Field.type` 和 `Index.method` 不能为空；`Field(type = Vector)` 必须声明 `extension = pgvector`，且 `dimension` 必须大于 0；Decimal/Money 的 `precision > 0`，`0 <= scale <= precision`。规则由 MPS typesystem 生成并编译为运行时代码，sandbox 中保留合法和非法字段样例。MPS Make 尚不能替代 sandbox 的 IDE 诊断测试。

Database IR 的首个独立验证切片位于 `tools/database-ir.ts`，Drizzle 方言适配器位于 `tools/drizzle-pg.ts`、`tools/drizzle-sqlite.ts` 和 `tools/drizzle-mysql.ts`。PostgreSQL 路径支持 UUID、Text、Integer、Decimal/Money、Vector、B-tree 和向量索引；SQLite/MySQL 路径对不支持的 pgvector 能力在生成前报错，并分别生成 Bun SQLite/MySQL2 连接和 migration 配置：

```powershell
bun test tests/database-ir.test.ts
bun run tools/generate-drizzle.ts examples/catalog.ir.json
```

目前增加了从 MPS 持久化模型读取 registry、按 `qiy.structure` ID 校验并导出 IR 的外部 Bun 桥接器：

```powershell
bun install
bun run tools/export-mps-ir.ts languages/qiy.sandbox/models/qiy.catalog.mps
bun run tools/generate-drizzle.ts languages/qiy.sandbox/models/qiy.catalog.mps
```

`qiy.catalog.mps` 是合法的 Product Catalog 示例；`qiy.sandbox.mps` 故意包含语义错误，只用于诊断回归，不可用于生成。桥接器**还不是 MPS 内置 generator**；外部 Bun 生成器已能输出 PostgreSQL Drizzle schema、Elysia REST、Refine SPA 和 Drizzle Kit migration。`examples/catalog.ir.json` 是 IR 回归输入，`examples/catalog/app.qiy` 是目前受限文本语法的示例项目配置。未实现的字段/索引语义会明确报错而不是被忽略，MPS 规则仍未覆盖 IR 中全部跨节点能力检查。

MPS smoke build 使用 MPS 自带 JBR 运行：

```powershell
$env:MPS_HOME = "D:\IDE\MPS"
& "$env:MPS_HOME\jbr\bin\java.exe" -cp "$env:MPS_HOME\lib\ant\lib\ant-launcher.jar;$env:MPS_HOME\lib\util-8.jar" org.apache.tools.ant.launch.Launcher -f tests/mps-smoke.xml make
```

---

## 1. 项目定位

Qiy 不是单纯的 CRUD 生成器，也不是 Refine 的页面模板集合。

目标架构是：

```text
Qiy DSL / Qiy Model
        │
        ▼
   Qiy Semantic IR
        │
        ├── Refine + React Router 前端
        ├── Elysia + Bun REST / GraphQL API
        ├── Drizzle + 目标数据库 Schema
        ├── File Storage Provider
        ├── Deployment Targets
        ├── 权限与数据访问策略
        ├── OpenAPI / 类型定义
        └── 测试、迁移和部署配置
```

Qiy 要解决的问题不是“如何写一个列表页面”，而是避免以下内容在多个地方重复定义：

```text
数据库字段
API 参数
表单字段
列表列
过滤器
关联关系
用户与外部身份
枚举展示元数据
菜单与布局
组件库配置
权限规则
校验规则
状态流转
审计要求
```

这些内容应该由同一份模型驱动，并且在编译或生成阶段进行一致性检查。

---

## 2. 设计目标

### 2.1 V0：以数据为中心的 Dashboard

V0 面向以下场景：

- 内部管理后台；
- 数据运营 Dashboard；
- 基础 CRM、CMS、ERP 数据模块；
- PostgreSQL、MySQL、SQLite、MSSQL、CockroachDB 等数据库管理系统；
- 常规的列表、详情、创建、编辑和删除页面。

V0 的目标是让一份数据定义生成一个可运行的应用：

```text
Qiy Entity
    ↓
Drizzle Schema
    ↓
Dialect Migration
    ↓
Elysia REST API
    ↓
Refine Resource
    ↓
List / Show / Create / Edit 页面
```

V0 优先支持：

- Entity、Field、Enum；
- 一对一、一对多、多对多关系；
- 主键、唯一索引、默认值、可空性；
- 文本、数字、金额、布尔、日期、JSON、文件等字段；
- 列表、详情、创建、编辑页面；
- 搜索、分页、排序、过滤；
- 关联选择器和嵌套展示；
- 用户模型、登录模式和外部身份映射；
- OAuth2、OIDC/SSO 和本地登录配置；
- 基础认证、角色和资源级权限；
- 有限枚举的 label、tag 颜色、icon 和排序配置；
- 默认菜单、多级自定义菜单、菜单分组和权限可见性；
- Mantine、Ant Design、Material UI 等前端组件适配边界；
- 数据校验和错误展示；
- 目标数据库的 Drizzle schema 与 migration；
- Elysia API 与 Refine DataProvider；
- OpenAPI 和基础测试生成。

V0 不试图解决完整 ERP 业务，也不把所有业务逻辑塞进表单配置。

### 2.3 V2：Dashboard 概览和可配置布局

V2 再实现真正的概览页和排版能力。概览页不是简单的资源 CRUD 页面，而是由多个可配置区块组成：

- KPI、统计卡片和趋势指标；
- 图表、排行、聚合表和最近活动；
- 多列栅格、响应式布局和可折叠分组；
- 面向角色、租户和数据范围的区块可见性；
- 默认概览模板与项目自定义布局；
- 查询参数、刷新策略和加载状态。

V2 的 Dashboard 配置应建立在 V0/V1 的数据查询和权限模型之上，不能在页面配置中重新定义一套独立的数据访问规则。

### 2.2 V1：以业务为中心的复杂应用

V1 面向订单、库存、采购、财务、审批、工单等复杂业务。

V1 要支持：

- 状态机和业务状态转换；
- 命令、业务动作和事务边界；
- 跨表联动和聚合根；
- 字段计算和派生数据；
- 权限、数据范围和条件策略；
- 审批、会签、驳回、转交和加签；
- 库存预占、释放、扣减和回滚；
- 订单、支付、发货等多阶段流程；
- 同步事务和异步事件；
- Outbox、任务和重试；
- 幂等、并发控制和审计；
- 前端根据业务状态自动生成可用操作；
- 服务端作为最终业务规则来源。

V1 的重要原则是：

> **复杂业务不能只靠页面联动实现，必须有服务端可执行的业务模型。**

前端可以根据模型生成交互体验，但不能成为业务规则的唯一实现位置。

---

## 3. 目标技术架构

### 3.1 前端：Refine + React Router Framework Mode

Refine 负责 Admin 应用中的资源、DataProvider、AuthProvider、AccessControl、CRUD hooks、表格和表单逻辑。Refine 本身是 router-agnostic，可以通过 `routerProvider` 集成 React Router。详见 [Refine Routing](https://refine.dev/core/docs/guides-concepts/routing/)。

Qiy 不会重新发明 Refine 的核心抽象，而是围绕 Refine 的标准生态生成配置和代码：

```text
@refinedev/core
├── Refine
├── resources
├── dataProvider
├── authProvider
├── accessControlProvider
├── notificationProvider
└── liveProvider

@refinedev/react-router
└── routerProvider

@refinedev/mantine
└── V0 默认 UI 组件
```

V0 默认选择 Mantine 作为 UI 组件库。Refine 的 UI 集成、图标组件和表单/表格组件属于同一个前端适配器选择；一个生成项目只能选择一个主要 UI 体系，不混用 Mantine、Ant Design、Material UI 等多个 UI 包。以后可以增加更多适配器，但 `ui.componentLibrary` 必须是单值配置。

前端 UI 选择和后端 API 选择是两个独立维度：

```text
frontend.ui.componentLibrary
    只能选择一个：mantine | antd | mui | chakra

backend.api.transports
    可以同时启用：rest + graphql
```

Qiy 生成的 Refine 根组件概念上类似：

```tsx
export function QiyApp() {
  return (
    <Refine
      dataProvider={qiyDataProvider({ baseUrl: "/api/v1" })}
      authProvider={qiyAuthProvider()}
      accessControlProvider={qiyAccessControlProvider()}
      routerProvider={qiyRouterProvider()}
      resources={qiyResources}
    >
      <Outlet />
    </Refine>
  );
}
```

生成的页面必须通过 Refine DataProvider 和 hooks 访问数据：

```text
useTable     → 列表、分页、排序、过滤
useForm      → 创建和编辑
useList      → 自定义列表查询
useOne       → 详情和关联对象
useCreate    → 创建操作
useUpdate    → 更新操作
useDelete    → 删除操作
useSelect    → 关联选择器
```

Qiy 不允许生成页面绕过 DataProvider 直接调用数据库或硬编码 API URL。这样可以保证前端资源定义、API 适配器、权限和测试仍然遵循 Refine 的生态契约。Refine 的核心模型和推荐工作流可参考 [Refine Framework Skill](https://www.skills.sh/itechmeat/llm-code/refine-dev)。

React Router 使用 Framework Mode，提供 route modules、类型安全路由、loader/action、代码分割和 SPA/SSR/静态构建能力。详见 [React Router Modes](https://reactrouter.com/start/modes)。

Qiy 的第一阶段部署模式为：

```text
React Router Framework Mode
        │
        └── ssr: false
                │
                ▼
        纯前端 build/client
                │
                ▼
        Nginx 或 Elysia 静态服务
```

配置目标：

```ts
// react-router.config.ts
import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
} satisfies Config;
```

`ssr: false` 表示最终运行时不需要 React Router Server；前端通过浏览器请求 Elysia 的 API。React Router SPA Mode 仍然会在构建阶段生成 `index.html`，因此路由模块必须保持构建期 SSR-safe。详见 [React Router SPA Mode](https://reactrouter.com/how-to/spa)。

Qiy 的前端不使用 `HashRouter`，而使用真实路径：

```text
/admin
/admin/users
/admin/users/create
/admin/users/42/edit
```

### 3.2 后端：Bun + Elysia

Elysia 是 Qiy 的第一后端实现，负责：

- REST API 和 GraphQL API；
- 请求校验；
- 认证和授权；
- 事务；
- 业务命令；
- 业务事件；
- 文件和任务接口；
- OpenAPI；
- 错误格式和日志。

Elysia 官方插件按生成配置选择性启用，而不是全部打进默认依赖。Bearer、JWT、Cron、Server Timing、Static、HTML 以及 GraphQL Apollo/Yoga 各自解决不同问题；是否生成某个插件取决于 Qiy 的业务模型、认证边界和部署方式。尤其 Bearer 只提取 token，不验证身份；JWT 插件也不等同于 OIDC/JWKS 登录。

### API 传输层

Qiy 的业务模型、权限、校验和查询语义只定义一次，后端可以从同一份 IR 同时生成 REST 和 GraphQL：

```text
Qiy Entity / Resource / Business Model
              │
              ▼
          API IR
          ├── REST routes + OpenAPI
          └── GraphQL schema + resolvers
```

REST 和 GraphQL 是两个 API 表达层，不应各自重新实现业务逻辑：

```text
REST /api/v1/* ───────┐
                      ├── Application Service → Domain → Drizzle
GraphQL /graphql ─────┘
```

Elysia 作为统一宿主，同时挂载 REST 路由和 GraphQL 处理器。当前生成器使用自有 GraphQL HTTP/schema/resolver 实现，并让 resolver 复用同一套 service、事务与授权边界；Apollo 与 Yoga 是可替代的 Elysia GraphQL HTTP adapter，不是同时叠加的插件。DSL 选择 `graphqlAdapter yoga|apollo` 时，生成器会写入官方依赖、`Query`/`Mutation` resolver adapter 和 `/graphql` 路由；Yoga 已完成生成包级真实 Query 验证，Apollo 仍需独立运行时验收。

前端在一个生成项目中选择一个主要 DataProvider：

```text
api.client rest       → Qiy REST DataProvider
api.client graphql    → Qiy GraphQL DataProvider
```

后端可以同时开放两种 API，但前端默认只启用其中一种，避免同一个页面混用两套缓存、错误和分页语义。

API 统一使用版本前缀：

```text
/api/v1/users
/api/v1/users/:id
/api/v1/orders
/api/v1/orders/:id/submit
```

建议的 API 分层：

```text
server/
├── index.ts
├── api/
│   ├── rest/
│   │   ├── users.gen.ts
│   │   ├── orders.gen.ts
│   │   └── commands.gen.ts
│   └── graphql/
│       ├── schema.gen.ts
│       ├── resolvers.gen.ts
│       └── context.gen.ts
├── application/
│   ├── users.service.gen.ts
│   ├── orders.service.gen.ts
│   └── commands.gen.ts
├── domain/
│   ├── users/
│   └── orders/
├── policies/
├── workflows/
└── db/
    ├── client.ts
    ├── schema.gen.ts
    ├── relations.gen.ts
    └── queries.gen.ts
```

服务器代码分为三类：

```text
*.gen.ts
    由 Qiy 生成，可以通过重新生成覆盖

application/domain
    允许开发者扩展复杂业务，不应被 CRUD 生成器限制

server/index.ts
    负责装配 Elysia、认证、错误处理、日志和路由
```

V0 的普通资源可以生成标准 CRUD；V1 的复杂业务通过 `application` 和 `domain` 层生成命令入口，并允许人工扩展实现。Qiy 不应该把复杂 ERP 逻辑全部压缩成一组自动生成的表格回调。

V0 中，普通资源可以直接生成 CRUD API。V1 中，复杂写操作应生成命令接口，而不是让客户端直接修改多张表：

```text
PATCH /api/v1/orders/:id

POST /api/v1/orders/:id/submit
POST /api/v1/orders/:id/approve
POST /api/v1/orders/:id/cancel
```

### 3.3 数据库：Drizzle + 多数据库方言

Qiy 的数据库模型由 Qiy Model 产生，Drizzle 是第一阶段的 TypeScript 数据访问、schema 和 migration 表达层。数据库方言不应该写死为 PostgreSQL，而应该成为编译配置：

```text
Qiy Entity
    ↓
Database IR
    ↓
Drizzle Schema（目标方言）
    ↓
Dialect Migration
    ↓
目标数据库平台
```

Drizzle 官方入门文档当前覆盖的主要数据库方向包括：

```text
PostgreSQL
MySQL
SQLite
MSSQL
CockroachDB
```

具体驱动、连接方式和迁移能力必须以 [Drizzle Get Started](https://orm.drizzle.team/docs/get-started) 为准。Supabase 仍然作为 PostgreSQL 平台接入 Drizzle，不单独成为 Qiy 的业务数据库抽象。

Qiy 的数据库 Provider 分层：

```text
@qiy/database
    方言无关的 Entity、Field、Relation、Index、Migration IR

@qiy/drizzle
    Drizzle schema、查询、relations 和 migration 生成

@qiy/database-postgres
    PostgreSQL / Supabase / 其他 PostgreSQL 平台

@qiy/database-mysql
    MySQL / MariaDB 兼容目标

@qiy/database-sqlite
    SQLite 本地、嵌入式和测试目标

@qiy/database-mssql
    Microsoft SQL Server 目标

@qiy/database-cockroach
    CockroachDB 目标
```

Oracle 等暂时没有在 Qiy 的 Drizzle Provider 中直接承诺支持。未来可以通过独立 `@qiy/database-oracle` Provider 接入其他 ORM 或官方驱动，但不能把它误标为 Drizzle 原生方言。

数据库能力需要有显式矩阵：

```text
feature              postgres  mysql  sqlite  mssql  cockroach
transactions         ✓         ✓      ✓       ✓      ✓
relations             ✓         ✓      ✓       ✓      ✓
json                  ✓         ✓      ✓       ?      ✓
fullTextSearch        ✓         ?      ?       ✓      ?
databaseEnum          opt       opt    no      opt    opt
```

如果模型使用了目标方言不支持的能力，Qiy 应该在编译期报错或要求显式降级，而不是生成看似成功但无法迁移的 SQL。

数据库配置示例：

```text
database {
    orm drizzle
    dialect postgres
    provider supabase
    url env("DATABASE_URL")
}
```

可用方言配置目标：

```text
database.dialect   postgres | mysql | sqlite | mssql | cockroachdb
database.provider  generic | supabase | awsRds | planetscale | turso
database.driver    drizzle
```

数据库 schema 的唯一来源必须明确为 Qiy Model，不能同时让 Qiy、Drizzle migration 和云平台 Dashboard 无约束地修改同一套 schema。

#### 数据库字段与扩展能力

Database IR 不只描述“字符串、数字、日期”这类基础类型，还要保留目标数据库需要的语义和物理属性。逻辑类型与方言类型分开：例如 `Money` 可以映射为带精度的 `decimal`，`Vector(1536)` 则必须声明 `pgvector` 能力，不能悄悄退化成普通文本。

第一阶段的特殊字段包括：

```text
UUID                    主键、外部标识和分布式生成
JSON / JSONB            结构化扩展数据；JSONB 允许 PostgreSQL 索引
Array                   原生数组或 Provider 定义的集合映射
Decimal / Money         精度和小数位明确，禁止用浮点表示金额
TimestampWithTimezone   带时区时间戳，统一时区策略
Binary / Blob           二进制值；大文件应使用 Storage 而不是数据库 Blob
Generated               数据库生成列或生成表达式
FullText                全文搜索语义，由方言 Provider 选择实现
Vector / Embedding      向量维度、距离函数和索引类型
SoftDelete              逻辑删除字段与默认查询过滤
Version                 乐观锁版本号或版本时间戳
```

PostgreSQL 的扩展必须是显式声明，而不是由生成器偷偷安装：

```text
database {
    dialect postgres
    extensions [pgvector, pg_trgm, citext]
}

entity Document {
    id: UUID primaryKey generated
    content: Text required
    embedding: Vector(1536) extension pgvector
    deletedAt: TimestampWithTimezone softDelete
    version: Integer optimisticLock
}
```

Qiy 第一阶段重点覆盖 `pgvector`、`pg_trgm`、`postgis` 和 `citext`，同时保留通用扩展声明机制。扩展声明至少要包含名称、所需方言、启用方式、版本约束和缺失时的编译行为；Qiy 不应在生产环境自动以应用账号执行任意 `CREATE EXTENSION`。

#### 索引、约束与物理优化

索引和约束是模型的一部分，因为它们直接影响唯一性、查询计划和迁移结果。Index IR 至少支持：

- 普通 B-tree、唯一索引和多列组合索引；
- Partial/Filtered index 和表达式索引；
- GIN、GIST、BRIN 等方言索引方法；
- 全文搜索索引；
- `pgvector` 的 HNSW 与 IVFFlat 索引，以及明确的 operator class；
- 索引排序、NULLS FIRST/LAST、包含列和 Provider-specific options。

约束至少支持主键、外键、唯一约束、Check、PostgreSQL Exclusion Constraint，以及 `onDelete`/`onUpdate` 策略。索引和约束名称由 Qiy 稳定生成，迁移必须可追踪、可重复生成，并在删除或重命名时给出显式 diff，而不是依据字段顺序猜测。

```text
index DocumentEmbeddingHnsw {
    on Document.embedding
    method hnsw
    opclass vector_cosine_ops
    options { m 16; efConstruction 64 }
}

index ActiveDocumentSlug {
    on Document.slug
    unique true
    where Document.deletedAt is null
}

constraint OrderTotalPositive {
    on Order
    check total >= 0
}
```

数据库运行时配置也进入 Database IR 或 deployment profile，而不是散落在生成后的连接文件中。至少应覆盖：连接池大小、空闲回收、查询/语句/锁超时、读副本、事务隔离级别、prepared statements、批量大小、缓存策略、游标分页、软删除默认过滤、乐观锁和审计字段。物化视图、分区表、在线索引变更等属于后续阶段，但 IR 要保留扩展点。

能力检查遵循三条规则：

1. 跨数据库能力进入通用 Database IR；
2. 方言特性必须显式声明，并由 Provider 负责生成 SQL、Drizzle schema 和 migration；
3. 目标数据库不支持某能力时，编译期报错，或只有在模型写出 `fallback`/`degrade` 后才生成近似实现。

下面是设计期能力矩阵，最终结果由具体 Provider、驱动版本和部署平台校验：

```text
feature              postgres          mysql             sqlite            mssql             cockroach
transactions         ✓                 ✓                 ✓                 ✓                 ✓
json                 ✓                 ✓                 json1/provider    ✓                 ✓
fullTextSearch       native/provider   native             FTS5/provider     native            provider
vector               pgvector          provider          provider          provider          provider
gin/gist              native            provider          —                 —                 provider
brin                  native            —                 —                 —                 —
hnsw                  pgvector          —                 —                 —                 provider
partialIndex          ✓                 provider          ✓                 filtered/provider provider
```

其中 `provider` 表示不能仅由 Qiy 的通用语义保证，必须由数据库 Provider 验证；`—` 表示当前目标不提供该能力。这个矩阵不是承诺所有数据库都具备相同特性，而是编译器生成诊断的输入。

### 3.4 文件存储：Django Storage 风格

文件存储不应该直接绑定本地磁盘或 AWS SDK。Qiy 采用类似 Django Storage 的抽象：业务模型声明文件字段和存储能力，具体 Provider 决定文件放在哪里。Django 的 `FileSystemStorage`、默认 storage 和可扩展 Storage API 是这个设计的参考。详见 [Django File Storage](https://docs.djangoproject.com/en/stable/topics/files/)。

```text
FileField / ImageField / Attachment
              ↓
       Qiy Storage API
              ↓
 ┌────────────┼─────────────┐
 │            │             │
local       s3            memory
 │            │             │
本地磁盘   AWS S3 / MinIO / R2 / B2   测试
```

Storage Provider 的稳定接口：

```text
save(name, content, metadata)
open(name)
exists(name)
delete(name)
copy(source, target)
move(source, target)
url(name)
signedUrl(name, expires)
list(prefix)
```

目标 Provider：

```text
local
    本地文件系统，适合开发、单机和测试

s3
    AWS S3 以及 S3-compatible 服务

memory
    测试用临时存储
```

S3 Provider 应通过 endpoint、bucket、region、credentials 和 path-style 等配置兼容 AWS S3、MinIO、Cloudflare R2、Backblaze B2 等 S3-compatible 服务。Supabase Storage 不作为独立 Qiy 业务层；如果使用 S3 兼容接口，可以作为 S3 Provider 的一个 endpoint，其他 Supabase 专属能力通过独立扩展接入。

业务模型示例：

```text
storage media {
    backend s3
    bucket env("MEDIA_BUCKET")
    endpoint env("MEDIA_ENDPOINT")
    private true
    signedUrl expires 15m
}

entity User {
    id: UUID primaryKey generated
    avatar: Image storage media optional
}

entity Document {
    id: UUID primaryKey generated
    file: File storage media required
    originalName: String
    contentType: String
    size: Int
    checksum: String
}
```

文件上传默认采用两阶段流程：

```text
1. 浏览器请求 Elysia 获取上传授权
2. 浏览器直传 Storage Provider
3. 浏览器提交文件元数据
4. 服务端校验并写入 Attachment/File 记录
```

这样大文件不会默认穿过 API 服务。local Provider 可以退化为 Elysia multipart 上传；生产环境的 private 文件默认使用签名 URL，不能把用户提交的路径直接拼接为磁盘路径。

### 3.5 部署 Targets 和生成文件

部署不是业务模型的一部分，但 Qiy 配置可以选择一个或多个输出 Target。每个 Target 生成独立的部署文件，不改变应用代码和业务模型。

```text
Qiy Application
      ↓
Deployment IR
      ├── Docker
      ├── Kubernetes
      ├── Vercel
      ├── AWS ECS/Fargate
      ├── AWS Lambda/API Gateway
      └── 其他 Serverless
```

目标文件结构：

```text
deploy/
├── docker/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .dockerignore
├── kubernetes/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   └── secret.example.yaml
├── vercel/
│   ├── vercel.json
│   └── api/
├── aws/
│   ├── ecs-task-definition.json
│   ├── lambda-adapter.ts
│   ├── api-gateway.yaml
│   └── iam-policy.json
└── serverless/
    └── provider-config.yaml
```

Vercel、Lambda 等 Serverless Target 必须将 Elysia 应用适配为标准 `fetch(Request) → Response` handler，不应假设有持久化本地文件系统或长驻进程。Vercel 的 Bun runtime 和函数部署可以作为一个独立 Target；AWS Target 则分别支持容器化长驻服务和 Lambda/API Gateway 无服务器服务。

部署配置示例：

```text
deployment {
    targets [docker, kubernetes]

    docker {
        image "qiy-admin"
        port 3000
    }

    kubernetes {
        replicas 2
        ingressHost "admin.example.com"
        storageClass "gp3"
    }
}
```

部署生成器只输出配置模板和非敏感的环境变量示例，不生成真实密码、Token、Access Key 或私钥。多副本 Kubernetes 和 Serverless 默认不使用 local storage 保存持久文件，应要求选择 S3-compatible Provider。

---

## 4. 生成项目结构

Qiy 生成的目标项目应保持普通 TypeScript 项目的可读性，不生成无法维护的黑盒代码。V0 已落地的结构是：

```text
admin/
├── apps/
│   ├── server/
│   │   ├── src/{app,server,preview,http,db,schema,repositories}.ts
│   │   ├── src/routes/
│   │   └── drizzle/
│   └── web/
│       ├── app/{root,routes,resources,data-provider}.tsx|ts
│       ├── app/routes/
│       └── build/client/
├── package.json
├── turbo.json
└── bun.lock
```

`templates/admin/` 包含 Turborepo 配置、前后端依赖及稳定的运行时/页面骨架；生成器从同一份 IR 写入 Drizzle schema、Elysia 路由、Repository、Refine Resource 和模型相关测试。应用生成之后与模板仓库脱钩。React Router Framework Mode 输出 `apps/web/build/client`，仅客户端产物参与运行时托管。认证、业务层和部署文件仍属于后续扩展。

---

## 5. Qiy DSL 总体设计

Qiy DSL 分成三层：

```text
Application Layer
    应用、运行时、部署、数据库、认证和 UI 适配器

Data Layer
    实体、字段、枚举、关系、索引、资源、用户和外部身份

Presentation Layer
    页面、菜单、布局、组件、图标和枚举展示

Business Layer
    命令、状态、规则、策略、流程、事件、事务
```

### 5.1 应用配置

下面是概念性语法，最终语法以 MPS Concept 和 Editor 定义为准：

```text
application Admin {
    runtime {
        platform bun
        frontend refine
        router reactRouter.framework
        render spa
        basePath "/admin"
    }

    backend {
        framework elysia
        apiPrefix "/api/v1"

        api {
            transports [rest, graphql]
            graphqlPath "/graphql"
            restOpenApi true
        }
    }

    database {
        dialect postgres
        orm drizzle
        provider postgres
        url env("DATABASE_URL")
    }

    auth {
        session cookie
        defaultProvider local
        userModel User
    }

    ui {
        componentLibrary mantine
        iconLibrary lucide
    }

    storage {
        default media
        media {
            backend local
            root "./var/media"
        }
    }

    deployment {
        targets [docker]
    }
}
```

配置项分为：

```text
runtime.platform       bun
frontend.framework     refine
router.mode            reactRouter.framework
render.mode            spa
api.prefix             /api/v1
api.transports         [rest, graphql]
api.client             rest | graphql
api.graphql.path       /graphql
api.rest.openApi       true
database.dialect       postgres | mysql | sqlite | mssql | cockroachdb
database.orm           drizzle
database.provider      generic | supabase | awsRds | planetscale | turso
auth.session           cookie | bearer
auth.providers         local | oauth2 | oidc | sso
auth.userModel         User
ui.componentLibrary   mantine | antd | mui | chakra
ui.iconLibrary         lucide | custom
storage.backend        local | s3 | memory
storage.default        media
deployment.targets     docker | kubernetes | vercel | aws.ecs | aws.lambda
deployment.staticRoot  build/client
deployment.basePath    /admin
```

Supabase 不单独作为 Qiy 的业务层。Qiy 的业务数据层使用 Drizzle + 目标数据库；Supabase 只是 PostgreSQL 托管平台，登录、Storage 或 Realtime 等能力通过独立 Provider 接入，不影响 Entity、Resource 和业务模型的核心抽象。

### 5.2 数据模型

```text
enum UserStatus {
    active {
        label "启用"
        tagColor green
        icon "CircleCheck"
        order 1
    }

    disabled {
        label "停用"
        tagColor gray
        icon "CircleX"
        order 2
    }
}

entity User {
    id: UUID primaryKey generated
    name: String required maxLength(120)
    email: Email required unique
    status: UserStatus = active
    roles: Role relation many
    identities: ExternalIdentity relation many
    createdAt: DateTime generated

    group profile {
        label "基础资料"
        fields [name, email, status]
    }
}

entity Product {
    id: UUID primaryKey generated
    name: String required
    price: Decimal required min(0)
    stock: Int required min(0)
    category: Category relation required
}
```

有限枚举不仅是数据库值，还包含客户端展示元数据。Qiy 需要将枚举的 `label`、`tagColor`、`icon` 和 `order` 同时用于：

```text
数据库/TypeScript 枚举
Refine Select、Filter 和表格 Tag
状态颜色和图标
排序和默认值
```

图标在 DSL 中只保存稳定的图标标识，不直接保存 React 组件。V0 默认使用 Lucide 图标名，并保留 `custom` 图标 Provider，以便项目替换图标库。

### 5.3 认证、用户和外部身份

认证配置和业务用户模型必须分开：认证 Provider 负责证明身份，`User` 负责业务用户；`ExternalIdentity` 负责将多个 OAuth2/OIDC/SSO 来源映射到同一个用户。

```text
auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }

entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable @visible(false);
    field role userRole;
}

// External bearer-token validation remains an alternative provider:
auth { provider oidc; user users; subjectField externalSubject; roleField role; }

entity ExternalIdentity {
    id: UUID primaryKey generated
    provider: String required
    issuer: String required
    subject: String required
    user: User relation required
    profile: JSON

    unique [provider, issuer, subject]
}
```

登录模式的目标范围：

```text
local password
email code / magic link
OAuth2
OIDC
企业 SSO
```

外部用户不能只通过 email 绑定。稳定关联键应优先使用 `issuer + subject` 或 Provider 明确提供的 OpenID 标识；email 只作为可变的资料字段或首次匹配辅助信息。

### 5.4 默认配置、分组和自定义配置

Qiy 的配置需要区分“默认生成”和“项目覆盖”，而不是把所有配置都强制写出来：

```text
defaults {
    resource.list.pagination true
    resource.list.pageSize 20
    ui.componentLibrary mantine
    ui.iconLibrary lucide
    menu.fromResources true
}

resource Product {
    useDefaults true

    list {
        columns [name, price, stock, category]
        pageSize 50
    }
}
```

模型中的 `group` 可以用于：

```text
表单字段分组
详情页分组
菜单分组
权限分组
Dashboard 区块分组
```

### 5.5 菜单、布局和导航

默认情况下，Qiy 可以根据 Resource 生成一级菜单；项目也可以完全接管菜单并定义多级结构：

```text
menu AdminMenu {
    useDefaults false

    group "业务管理" icon "Briefcase" order 1 {
        item "产品" resource Product route "/products" icon "Package"
        item "订单" resource Order route "/orders" icon "ShoppingCart"

        group "客户" icon "Users" {
            item "客户列表" resource Customer route "/customers"
            item "客户分组" resource CustomerGroup route "/customer-groups"
        }
    }

    item "系统设置" route "/settings" icon "Settings" when user.hasRole(Admin)
}
```

菜单配置至少需要支持：

- 默认菜单和自定义菜单；
- 多级菜单和分组；
- 顺序、标题、图标和路由；
- Resource 菜单项和自定义页面；
- 角色、权限、租户和特征开关可见性；
- 面包屑、页面标题和布局区域。

### 5.6 Dashboard 和 Resource

```text
resource Product {
    route "/products"

    list {
        columns [name, price, stock, category]
        search [name]
        filters [category]
        sort [createdAt desc]
        pagination true
    }

    show {
        fields [name, price, stock, category]
    }

    create {
        fields [name, price, stock, category]
    }

    edit {
        fields [name, price, stock, category]
    }
}
```

这部分应该生成：

```text
Refine resources
React Router routes
列表页面
详情页面
创建页面
编辑页面
过滤器
表单校验
Elysia CRUD API
```

### 5.4 权限和数据范围

```text
role Admin
role Operator
role Viewer

policy ProductAccess {
    list Product when user.hasRole(Admin, Operator, Viewer)
    create Product when user.hasRole(Admin, Operator)
    update Product when user.hasRole(Admin, Operator)
    delete Product when user.hasRole(Admin)
}
```

后续需要同时生成：

```text
前端按钮显示条件
Refine access control
Elysia 服务端权限检查
数据库查询条件
审计事件
```

前端权限只能改善用户体验，不能作为安全边界。最终权限必须在服务端重新校验。

---

## 6. V1 复杂业务模型

V1 不应该继续把所有内容表达为“字段和页面配置”，而是增加业务语义。

### 6.1 状态机

```text
entity Order {
    id: UUID primaryKey generated
    status: OrderStatus = draft
    totalAmount: Money generated
}

stateMachine OrderLifecycle for Order.status {
    state draft
    state pendingReview
    state approved
    state rejected
    state completed
    state cancelled

    transition submit {
        from draft
        to pendingReview
        command submitOrder
        require items.length > 0
    }

    transition approve {
        from pendingReview
        to approved
        command approveOrder
        require user.hasRole(Manager)
    }
}
```

生成结果包括：

```text
服务端状态转换校验
命令接口
前端可用操作
状态对应的按钮
状态对应的字段可编辑性
审计事件
测试用例
```

### 6.2 跨表联动

复杂 ERP 场景不能只生成一个 `PATCH` 请求。例如订单提交可能需要：

```text
订单状态修改
订单总金额重算
库存预占
客户额度检查
审批记录创建
操作日志记录
领域事件发布
```

Qiy 应该将它建模为一个业务命令：

```text
command submitOrder(Order order) {
    transaction required

    validate order.items notEmpty
    validate customer.creditAvailable >= order.totalAmount
    reserve inventory for order.items
    calculate order.totalAmount
    transition order to pendingReview
    audit "order.submitted"
    emit OrderSubmitted(order.id)
}
```

服务端生成目标：

```text
POST /api/v1/orders/:id/submit
```

而不是让前端分别调用多个表的更新接口。

### 6.3 同步和异步边界

Qiy 需要明确区分：

```text
transaction {
    必须在同一事务中完成
}

emit Event {
    事务提交后异步处理
}

job {
    可重试、可延迟、可观测
}
```

例如：

```text
command payOrder(Order order) {
    transaction required
    lock order
    transition order to paid
    emit OrderPaid(order.id)
}

eventHandler OrderPaidHandler for OrderPaid {
    job retry(5)
    create shipment
    notify warehouse
}
```

### 6.4 复杂业务的实现原则

V1 遵循以下原则：

1. **数据库约束保证数据底线。**
2. **服务端领域命令保证业务不变量。**
3. **状态机保证流程合法性。**
4. **策略保证角色和数据范围。**
5. **事务保证强一致写操作。**
6. **事件和任务承载异步副作用。**
7. **前端根据模型生成交互，不拥有最终业务权威。**

---

## 7. 编译与生成流程

MPS 中的语言 aspect 对应如下职责：

```text
qiy.structure
    Concept、属性、关系和业务模型结构

qiy.editor
    Qiy DSL 的投影编辑器

qiy.constraints
    Scope、引用约束和结构约束

qiy.typesystem
    类型、字段、关系、策略和命令检查

qiy.behavior
    模型查询、派生值和公共行为

qiy.generator
    Qiy Model → Qiy IR → TypeScript / SQL / JSON

qiy.runtime
    生成代码所需的运行时契约

qiy.sandbox
    示例模型、生成测试和回归验证
```

目标编译链：

```text
MPS Qiy Model
      ↓
Semantic Analysis
      ↓
Qiy IR
      ├── Data IR
      ├── UI IR
      ├── API IR
      ├── Policy IR
      └── Business IR
      ↓
Code Generators
      ├── React Router / Refine
      ├── Elysia
      ├── Drizzle
      ├── SQL Migration
      ├── OpenAPI
      └── Tests
```

生成代码应当是普通、可阅读、可调试、可二次修改的 TypeScript 和 SQL。Qiy 生成器不应要求用户依赖 MPS 才能运行生成后的应用。

---

## 8. 部署模型

### 8.1 推荐生产部署

```text
Browser
   │
   ├── /api/v1/* ──> Nginx ──> Elysia / Bun
   │                              │
   │                              └── Drizzle → 目标数据库
   │
   └── /* ────────> Nginx ──> build/client
```

Nginx 核心规则：

```nginx
location ^~ /api/ {
    proxy_pass http://127.0.0.1:3000;
}

location / {
    root /var/www/qiy-app/build/client;
    try_files $uri $uri/ /index.html;
}
```

必须保证 `/api/*` 不会 fallback 到 `index.html`。

### 8.2 单进程部署

开发环境或简单部署可以由 Elysia 同时提供 API 和静态文件：

```text
Elysia
├── /api/v1/* → API
└── /*        → build/client
```

生产环境默认推荐 Nginx 静态服务 + Elysia API，以便独立处理静态缓存、压缩、TLS 和流量转发。

---

## 9. 目标包结构

Qiy 最终希望形成以下生态：

```text
@qiy/core
    Resource、Schema、Provider、运行时契约

@qiy/react
    React 基础组件和 Qiy UI 绑定

@qiy/refine
    Refine 集成、DataProvider、AuthProvider、AccessControl

@qiy/react-router
    React Router Framework Mode 路由和生成绑定

@qiy/bun
    Bun CLI、开发服务、构建和测试集成

@qiy/elysia
    Elysia 服务端运行时，同时承载 REST 和 GraphQL

@qiy/api-rest
    REST DataProvider、路由、OpenAPI 和查询参数协议

@qiy/api-graphql
    GraphQL DataProvider、schema、resolver 和查询协议

@qiy/drizzle
    多数据库 Drizzle schema、查询和 migration 适配

@qiy/database
    方言无关的数据库 IR、能力矩阵和 Provider 契约

@qiy/auth
    本地登录、OAuth2、OIDC、SSO、会话和用户身份映射

@qiy/ui
    Mantine、Ant Design、Material UI 等组件适配器

@qiy/navigation
    默认菜单、多级菜单、布局和权限可见性

@qiy/storage
    local、S3-compatible、memory 文件存储 Provider

@qiy/deploy
    Docker、Kubernetes、Vercel、AWS 和 Serverless 部署目标

@qiy/cli
    generate、dev、build、db、check、test 命令

@qiy/mps-generator
    MPS Model 到 Qiy IR 和 TypeScript 的生成器
```

用户最终期望的体验：

```bash
bun install
bun qiy dev
bun qiy check
bun qiy generate
bun qiy db migrate
bun qiy build
bun test
```

---

## 10. V0 验收标准

V0 不以“支持多少 Concept”为标准，而以端到端闭环为标准。

必须完成：

1. 定义一个 `User` 或 `Product` Entity。
2. 生成 Drizzle schema。
3. 生成目标数据库 migration。
4. 从同一份模型生成 Elysia REST API 和 GraphQL schema/resolver。
5. 生成 Refine Resource 和一种选定的 DataProvider。
6. 选择且只选择一个前端 UI 组件适配器。
7. 生成 React Router 页面路由。
8. 生成列表、创建、编辑和详情页面。
9. 生成搜索、分页、排序和过滤。
10. 生成有限枚举的 Select、Filter、Tag、颜色和图标展示。
11. 生成用户、角色、登录配置和基础外部身份映射。
12. 生成默认菜单并支持多级自定义菜单。
13. 生成基础权限检查。
14. 使用 `ssr: false` 输出纯前端构建结果。
15. 使用 Nginx 将前端路径 fallback 到 `index.html`。
16. 前端选定的 DataProvider 能够访问 Elysia API。
17. 生成 local Storage 和 S3-compatible Storage 配置。
18. 生成 Dockerfile 和非敏感环境变量模板。
19. 生成项目可以脱离 MPS 使用 Bun 运行。

建议的第一个示例：

```text
Product Catalog
├── Category
├── Product
├── ProductImage
└── ProductStatus
```

第二个示例：

```text
Helpdesk
├── User
├── Ticket
├── TicketComment
├── TicketStatus
└── TicketAssignment
```

---

## 11. V1 验收标准

V1 至少需要完成一个具备真实联动的业务闭环：

```text
订单创建
    ↓
库存检查
    ↓
订单提交
    ↓
审批
    ↓
库存预占
    ↓
发货
    ↓
订单完成
```

验收内容：

- 同一业务命令更新多个实体；
- 服务端事务和回滚；
- 状态转换校验；
- 角色和数据范围校验；
- 前端操作按钮根据状态生成；
- 业务操作自动写入审计日志；
- 异步事件和失败重试；
- 重复请求幂等；
- 并发更新检测；
- 生成 API、页面、数据库和测试。

---

## 12. 当前技术风险

### React Router Framework Mode 与 Bun 构建

React Router Framework Mode 官方通过 Vite 插件提供完整框架能力。最终运行时可以是纯静态 SPA，但构建阶段仍然可能需要 React Router 的构建依赖和构建期服务端渲染能力。

因此 Qiy 需要尽早完成一个技术验证：

```text
bun install
bun run dev
bun run build
```

需要确认：

- 是否可以由 Bun 直接执行；
- 是否会启动 Node 子进程；
- 是否会生成额外的服务器运行时；
- `build/client` 是否可以独立部署；
- Qiy 需要保留官方构建链，还是开发 Bun-native 构建适配层。

如果严格要求构建阶段也完全不依赖 Vite/Node，则需要在后续评估：

```text
React Router Data Mode + Qiy/Bun 自定义构建层
```

这不是当前 V0 的默认实现，而是一个独立的技术路线选择。

### 业务模型的复杂度

不能在 V0 过早设计完整 ERP 语言。应该先验证：

```text
Entity → Resource → API → Database → Dashboard
```

然后用一个真实跨表业务进入 V1。否则 DSL 会在没有真实业务反馈的情况下快速膨胀。

---

## 13. 当前仓库状态

当前项目包含一个 MPS Language Project 骨架：

```text
languages/qiy/
├── models/qiy.structure.mps
├── models/qiy.editor.mps
├── models/qiy.constraints.mps
├── models/qiy.typesystem.mps
├── models/qiy.behavior.mps
├── generator/templates/
└── qiy.mpl
```

当前数据库结构、基础编辑器和部分校验已实现；外部 Bun 生成器具备 Catalog 最小闭环，但 MPS 内置 generator 和 V0 业务 Concept 仍未实现。下一步应优先完成：

1. `Application`；
2. `Entity`；
3. `Field`；
4. `Enum`；
5. `Relation`；
6. `Resource`；
7. `ListView`、`CreateView`、`EditView`、`ShowView`；
8. Drizzle 多数据库方言类型映射；
9. Refine Resource 生成；
10. Elysia CRUD API 生成。

---

## 14. 一句话总结

Qiy 的目标不是成为另一个 Flutter、KMP 或普通 CRUD 代码生成器，而是：

> **用一份可验证的数据和业务模型，生成可维护的 Refine Dashboard、Bun/Elysia API、Drizzle 数据层和后续复杂业务系统。**

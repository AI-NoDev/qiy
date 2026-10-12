# Qiy OpenWiki

## 项目是什么

Qiy 是面向数据中心业务应用的文本 DSL 与全栈应用生成框架。公开编译入口为 `.qiy`，由 Bun 实现 Parser、校验、IR 和代码生成；JetBrains MPS 是可选建模工作台，导出 `.qiy` 后进入同一链路。

当前仓库已有 MPS 数据库建模、语义校验、Bun `.qiy` 编译器与 ERP/Catalog Admin 示例。MPS 原生 `qiy.textGen` 只保留 Catalog、双实体 Relations 和 PostgreSQL ERP workflow 既有结构切片的兼容 smoke；权威路径是 MPS 持久化模型经 Bun exporter 输出 `.qiy`，再驱动同一个 Bun Parser、IR 与生成器。该样例仍非完整 ERP，`qiy.generator` 的 create-root mapping 仅用于证明 MPS generator 可执行，不是第二套业务生成器。产品方向见 [README](../README.md)：

```text
Qiy Model
  → Refine + React Router 前端
  → Bun + Elysia API
  → Drizzle + 目标数据库方言
  → local/S3-compatible 文件存储
  → Docker/Kubernetes/Vercel/AWS/Serverless 部署 Target
  → Dashboard 与复杂业务应用
```

## 当前状态

- `languages/qiy/qiy.mpl` 定义 `qiy` 语言和 `qiy.generator` generator。
- `languages/qiy/models/` 包含 structure、editor、constraints、typesystem、behavior 和 legacy textGen MPS aspect model；MPS Make 可加载模型，并验证三个原生属性校验器、generator marker、旧 TextGen 结构子集和 Bun 权威导出。
- `qiy.structure` 已包含数据库建模 Concept：`Application`、`DatabaseConfig`、`DatabaseExtension`、`DatabaseOptimization`、`Entity`、`Field`、`Relation`、`Index`、`IndexColumn`、`Constraint` 和 `CapabilityRequirement`；MPS 外部桥接器会将关系语义解析到 Database IR 并复用共享生成器，`Relation` 有专属编辑器行。
- `editor` 已覆盖数据库核心 Concept；`constraints` 已加入 `IndexColumn.fieldName`、`Field.type` 和 `Index.method` 非空校验；`typesystem` 已加入向量维度和 Decimal/Money 精度、小数位的诊断规则；`behavior` 及 MPS generator 仍处于后续实现阶段。
- `languages/qiy/generator/templates/qiy.generator.templates@generator.mps` 已包含最小 `CreateRootRule`，生成独立的 `QiyGenerationMarker.java`，不会替换源模型根；MPS smoke 同时验证 marker 与旧 `.qiy` TextGen 输出存在。业务目标文件只由 Bun `.qiy` 编译链路生成。
- `languages/qiy.runtime/` 是未来生成代码运行时依赖的 solution。
- `languages/qiy.sandbox/` 是语言试用和回归模型的 sandbox solution，目前引用 `qiy` 语言。
- `tools/mps-database-ir.ts` 与 `tools/mps-qiy.ts` 构成 MPS 持久化模型 → canonical `.qiy` 的 Bun exporter；该文本随后进入 `tools/qiy-project.ts`、Database IR 和共享 generators。原生 `qiy.textGen` 只对已存在的 Catalog/Relations/ERP 结构子集做去除文档属性后的兼容比较，不再随新业务语法同步扩展。
- `languages/qiy.sandbox/models/qiy.catalog.mps` 和 `languages/qiy.sandbox/models/qiy.relations.mps` 是合法的生成示例；`qiy.sandbox.mps` 保留故意无效字段用于诊断，不能作为生成源。
- `examples/catalog/app.qiy` 是 V0 受限文本语法的声明式项目配置；运行 `bun run tools/generate-app.ts examples/catalog/app.qiy out/catalog-admin` 可产生完整 Bun workspace。
- `examples/plugin-matrix/app.qiy` 是 SQLite + OIDC + Yoga 的按需 Elysia 插件组合回归模型；运行 `bun run tools/generate-app.ts examples/plugin-matrix/app.qiy tmp/v3-elysia-plugin-matrix --sync`，再在生成包中测试。JWT 测试 secret 仅供测试，生产仍须设置对应环境变量；Static 只开放 `public` 目录下文件。
- `examples/auth-providers/` 提供 Auth0 PKCE 与 OTP 两个完整认证样例；默认 Refine 模板同时启用 `@refinedev/kbar`。外部 provider 仍需真实 tenant redirect/audience/JWKS 验收，OTP 仍需真实邮件/短信 adapter 与限流验收。
- MPS sandbox 模型可用 `bun run tools/export-mps-qiy.ts <model.mps> <output.qiy>` 导出文本投影，再由公开 `.qiy` 生成链路创建完整 Bun workspace。ERP workflow 样例覆盖 PostgreSQL 订单、订单项、库存项、OIDC 用户/角色、彩色状态枚举、分层菜单、Dashboard 指标及预占流程，并贯通 TextGen、IR 对比及共享生成器。它仍不是完整 ERP，真实 IdP 未验收，`qiy.generator` 已验证最小 create-root mapping，业务模板仍待扩展。
- `languages/qiy.sandbox/models/qiy.erpworkflow.mps` 是 PostgreSQL MPS ERP 切片，包含 `users`、`orders`、`orderItems`、`inventoryItems`、OIDC `AuthConfig`、彩色状态/角色枚举、订单审批关系、分层菜单、count/distribution/trend dashboard、字段级可见性、label/icon、sortable/filterable 与 `orderInventory`；先由 Bun exporter 导出 `.qiy`，再使用 `qiy generate` 或 `qiy create` 生成工作区。MPS smoke 验证旧 TextGen 的结构子集，并单独验证权威导出保留完整注释等语义。
- `templates/admin/` 是稳定的 Turborepo + Bun 模板；`tools/generate-project.ts` 将 Qiy 模型生成的业务切片填入模板。
- `examples/catalog/admin/` 是早期已生成的 Catalog Admin；最新压力样例 `examples/erpadmin/admin/` 是从 `.qiy` 生成的实际 Turborepo，包含 `apps/server/` 的 Elysia REST/GraphQL、Drizzle schema 和静态托管，以及 `apps/web/` 的 Refine + Ant Design + React Router SPA。运行 `bun install`、`bun run typecheck`、`bun run test`、`bun run build`、`bun run preview`，打开 `http://127.0.0.1:3000/orders`。
- `examples/erpadmin/app.qiy` 声明 7 个资源模块和 6 条显式关系；生成 11 张表（含审计、订单预占、持久化幂等回执和附件元数据表）、10 个业务外键、独立的 contract/repository/service/routes 文件与关联 Select、五张可配置 Dashboard 指标卡（含服务端枚举分布），并生成订单提交/审批/出库/取消的多仓库存事务切片。ERP 默认使用本地用户名/密码，OIDC/OAuth2/SSO 仍是可选 provider；`examples/plugin-matrix/app.qiy` 保留 OIDC 组合回归。
- 预览仅供本机开发，不可公开部署。Catalog 的 pgvector 真实数据库路径需要管理员安装扩展并配置连接。ERP 生成包已有 OIDC/OAuth2/SSO 角色守卫、订单事务、Attachment 元数据 API、基础 File 字段上传/下载和 PostgreSQL/SQLite/MySQL 生成切片；通用 Dataflow 已完成 PostgreSQL/MySQL 实库并发与回滚 smoke，但完整 ERP 工作流、真实 IdP、多对多模型与 MPS 内置业务 generator 尚未完成。准确进度见 [V3 状态与规划](v3-status.md)。

### MPS 构建验证

在 Windows 上使用 MPS 自带 JBR，避免系统 Java 版本过低：

```powershell
$env:MPS_HOME = "D:\IDE\MPS"
& "$env:MPS_HOME\jbr\bin\java.exe" -cp "$env:MPS_HOME\lib\ant\lib\ant-launcher.jar;$env:MPS_HOME\lib\util-8.jar" org.apache.tools.ant.launch.Launcher -f tests/mps-smoke.xml make
```

成功标准是 `BUILD SUCCESSFUL`：结构/editor/constraints 能加载，三个属性校验器与 generator marker 生效，旧 TextGen 的既有结构子集与 Bun exporter 一致，并且 exporter 输出的规范 `.qiy` 保留完整注释。应用生成统一使用 exporter 输出的 `.qiy`；更广泛的用户/权限、完整 ERP 配置及 MPS 业务结构仍未完成。

安装依赖并运行 `bun test` 与 `bun run check`；使用 `bun run tools/export-mps-ir.ts languages/qiy.sandbox/models/qiy.catalog.mps` 导出 IR，再用 `bun run tools/generate-drizzle.ts languages/qiy.sandbox/models/qiy.catalog.mps` 查看 Drizzle schema。

## 文档导航

- [官网文档站](../docs/index.md)：`bun run docs:dev` 本地预览，`bun run docs:build` 构建静态站点；`.github/workflows/deploy-docs.yml` 会在 `main` 推送后发布到 GitHub Pages，内容覆盖指南与 DSL 参考。
- [编辑器高亮与社区插件](../docs/guide/editor-support.md)：官网 Qiy TextMate 高亮、可打包的 VS Code 扩展、IntelliJ Platform 插件与 Marketplace 发布工作流。
- [Android 国内应用商店分发](../docs/guide/android-distribution.md)：`deploy/config.ts` 的安全凭据引用、可多选平台的发布 CLI、华为/小米直连和其他渠道的独立 relay 适配器。
- [架构与演进路线](architecture.md)：当前 MPS 结构、目标生成架构、V0/V1 和扩展边界。
- [V3 状态与规划](v3-status.md)：实际落地、尚未完成的验收项与下一阶段顺序。
- [根目录 README](../README.md)：完整的产品方案、DSL 草案、部署方式和验收标准。

## 项目级 Skill

仓库自带 Refine 参考 skill，供实现 Dashboard、Resource、DataProvider、路由、认证和表单时查阅：

- `.agents/skills/refine-dev/SKILL.md`
- `.agents/skills/refine-dev/references/`

仓库同时自带 Drizzle schema 参考 skill，供实现多数据库 schema、relations、查询和 migration 边界时查阅：

- `.agents/skills/drizzle/SKILL.md`

仓库还包含 Qiy 的 Bun 参考 skill，使用 Bun 官方文档作为来源，并记录项目的 Bun-native 约束：

- `.agents/skills/bun/SKILL.md`

Elysia 官方 skill 用于 API、插件、GraphQL、部署和 Bun 集成：

- `.agents/skills/elysia/SKILL.md`
- `.agents/skills/elysia/plugins/`
- `.agents/skills/elysia/references/`

项目级副本是开发参考资料，不属于 Qiy 运行时或生成应用的依赖。

仓库自己的 Qiy Agent Skill 位于 `.agents/skills/qiy/SKILL.md`，面向用户使用 Qiy CLI，并可从 `AI-NoDev/qiy` 安装：

```powershell
npx skills add AI-NoDev/qiy --skill qiy
```

使用 Qiy 可执行文件时，也可在目标项目根目录运行 `qiy skill install`，离线安装官方 Skill 到 `.agent/skills/qiy/`。生成应用同时包含 Agent 入口和独立 OpenWiki 文档，具体路径、同步保护及验收见 [AI 开发入口与官方 Skill 安装](v3-status.md#ai-开发入口与官方-skill-安装2026-10-11)。

该 Skill 面向 CLI 使用者，包含可直接照做的安装/生成/运行步骤、完整多文件仓储系统示例、`.qiy` 与 `include` 规则、现有 Bun workspace alias/Docker 集成、manifest 同步边界及生产检查；详细内容全部随 `.agents/skills/qiy/` 发布，不依赖仓库外文档。

现有 Bun 项目的集成别名属于 `.qiy` 文件的 `workspace` 块，不再使用 `qiy.admin.config.ts` 等额外用户配置文件。

## 从哪里开始

### 修改语言结构

从 `languages/qiy/models/qiy.structure.mps` 开始。数据库结构切片已经完成，下一步按以下顺序扩展：

```text
Application
DatabaseConfig
DatabaseExtension
DatabaseOptimization
Entity
Field
Index
IndexColumn
Constraint
CapabilityRequirement
Relation
Resource
ListView
CreateView
EditView
ShowView
```

### 修改编辑体验

在 `languages/qiy/models/qiy.editor.mps` 中为结构 Concept 增加投影编辑器。编辑器应优先服务于模型可读性和快速录入，而不是模拟普通文本语法。

### 增加语义校验

- `languages/qiy/models/qiy.constraints.mps`：引用、唯一性和结构约束。
- `languages/qiy/models/qiy.typesystem.mps`：字段类型、数据库 capability、关系、权限和表达式检查。
- `languages/qiy/models/qiy.behavior.mps`：模型查询、派生信息和公共行为。

### 增加可建模能力

先在 MPS structure/editor/constraints 中表达节点，再扩展 `tools/mps-database-ir.ts` 和 `tools/mps-qiy.ts`，确保模型导出为 Bun Parser 可接受的规范 `.qiy`。新功能的 Parser、验证、Qiy IR 和目标代码生成只在 Bun 链路实现。除修复已有结构子集的兼容问题外，不再扩展 `qiy.textGen.mps` 或 `qiy.generator` 来复制业务生成逻辑。

## 设计边界

Qiy 的第一版不是新的 Flutter、KMP 或通用前端框架，也不是把任意 Vue `dist` 反编译成原生代码。Qiy 的价值在于让一份数据和业务模型驱动多个应用层：

```text
数据库 Schema
API
Refine Resource
路由
表单与列表
权限
校验
审计和业务命令
```

复杂业务必须以服务端规则为最终权威，前端生成的联动只负责交互体验，不能成为安全或业务一致性的唯一保证。

## 贡献时的检查清单

1. 先确认修改属于 structure、editor、constraints、typesystem、behavior 还是 generator。
2. 不要直接修改 `source_gen`、`classes_gen` 或 `source_gen.caches` 中的 MPS 生成文件。
3. 新增 Concept 时，同时考虑它的编辑器、引用 Scope、类型检查和生成目标。
4. V0 功能优先验证 `Entity → Resource → API → Database → Dashboard` 的完整闭环。
5. V1 功能优先使用真实跨表业务验证事务、状态机、权限、审计和异步事件。

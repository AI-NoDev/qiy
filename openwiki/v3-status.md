# V3 实施状态与验收规划

## Bun Workspace 集成与生成边界（2026-10-11）

CLI 新增 `qiy create -f <model.qiy> -n <name> -o <directory>` 用于创建独立 Turborepo + Bun workspace，以及 `qiy init -f <model.qiy> [-n <name>] [--sync]` 用于挂载现有 Bun workspace。别名、集成名称和 package name 直接写在 `.qiy` 的 `workspace` 块中，不需要额外的用户 TS 配置文件。`init` 要求根 `package.json.packageManager` 为 `bun@...`，将 server/web 放入可配置的 `apps/<alias>`，允许独立 npm package alias，并把 deploy、Dockerfile、Compose 重命名到 deploy alias 下；它保留现有 workspace pattern，补入 `apps/*` 与不冲突的 `qiy:<name>:*` scripts，并合并 ignore 文件。

环境变量由 `.qiy` 的 `env` 块声明，并在每个 Admin 包内生成 `.env.development`、`.env.production`、`.env.example`。独立 `create` 默认使用 `apps/server/` 与 `apps/web/`；`init` 根据 alias 改为例如 `apps/ops-api/.env.production` 和 `apps/ops-console/.env.development`，Compose 同步引用 alias 后的 server env 路径。宿主仓库根目录已有 `.env*` 文件不读取、不覆盖、不合并。开发 secret 新建时随机生成；`--sync` 保留 development/production 已有键值并补入新增声明；`.env.example` 不携带真实 secret。`VITE_` 变量仅写入 Web 环境文件且禁止标记为 secret。

每个挂载 Admin 使用独立 `.qiy-<name>.generated.json` manifest。`--sync` 仅重写 manifest 已登记文件并清理由模型移除的登记文件；任何未登记的同路径文件都 fail-closed，因此不覆盖宿主手写扩展。专项 Bun 测试验证 alias、package/workspace 合并、部署文件改名、手写扩展保留和非 Bun 根拒绝；根仓 `bun run check`、103 项 `bun test` 与 `bun run docs:build` 通过。独立 Catalog/ERP 在干净目录中已重新执行生成、`bun install` 与 server/web typecheck，未复现“Storage 模块缺失”报告；但这不等同既有 API、认证、真实数据库/IdP/S3 的生产验收。现有 JWT、refresh Cookie、请求/响应契约、权限和领域流程仍须以未由 Qiy 管理的扩展实现并独立测试。

## 本地用户名/密码认证（2026-10-11）

ERP 示例从 OIDC-only 改为 `auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }`，用户表的 password hash 可空且不进入 Refine 字段表单。生成器提供 `Bun.password` Argon2id 校验、12 小时 HS256 access token、`POST /api/v1/auth/login`、用户名/密码登录界面、`QIY_AUTH_SECRET` 配置、`auth:bootstrap-admin` 与 `auth:set-password` 本机交互命令。密码管理不开放 HTTP endpoint；首个管理员只允许在不存在管理员时从部署主机初始化。

密码 hash 不进入生成的 REST schema / GraphQL schema、列表检索 allowlist 或用户 CRUD 输入；REST 输出还做字段脱敏，原始 POST/PATCH 在 Elysia 请求解析前拒绝 password hash 字段。生成 ERP 的本地登录 API 测试验证正确密码发 token、错误及未知用户返回相同 401、旧匿名密码管理路径不存在；用户 API 测试验证 hash 不被读出/写入。Refine local auth 测试、ERP API 6 项相关测试、web auth 2 项测试和工作区 typecheck 通过。首次管理账户脚本已生成并通过类型检查，但尚未连接 PostgreSQL 实例实跑初始化/登录；无真实 IdP 的 OIDC 部署仍需独立验收。运行需先迁移数据库、设置至少 32 字符的 `QIY_AUTH_SECRET`，再执行 `bun run --cwd apps/server auth:bootstrap-admin`。

## Docker + PostgreSQL + OIDC 容器验收（2026-10-09）

`examples/erpadmin/admin` 已在 Docker Desktop Linux engine 进行非缓存镜像构建并成功运行。生成的 Dockerfile 现在以 Bun 安装依赖和运行 Elysia API；仅在构建阶段使用 `node:22-alpine` 执行 React Router 的 SPA 打包，因为 Linux Bun 1.3.13 和 1.4.2 都会在 React Router 即将删除的 SSR 中间产物阶段加载 `react-dom/server.bun.js` 并触发 CJS wrapper 错误。运行阶段没有 Node 服务或 Node 子进程，仍为 Bun + Elysia。Dockerfile 和 Compose 同时明确 `HOST=0.0.0.0`，容器发布端口与 K8s/Compose 访问不再被 `127.0.0.1` 绑定阻断。

生成器还为 PostgreSQL 项目加入 `postgres` 迁移驱动：应用运行时继续使用 Bun `SQL` + `drizzle-orm/bun-sql`，但 `drizzle-kit migrate` 需要独立的 PostgreSQL driver；此前容器和本机都会报缺少 `pg`/`postgres` driver。新的 ERP 包已重新生成并在容器内迁移成功，数据库实际包含 11 张表（业务表、审计、附件、预占和幂等回执）。

本轮端到端实测使用隔离 Docker network、PostgreSQL 16、仅供测试的 HTTPS JWKS/OIDC fixture 和有范围 claim 的管理员用户：Health、静态 SPA、Refine 登录页、OIDC `/auth/me`、REST Products/Orders、GraphQL Products 均返回预期结果；订单流程实际创建 warehouse/product/inventory/order/order item，完成 draft → submitted → approved → shipped，库存从 100 降至 98。测试 IdP 是自签本地夹具，绝不代表接入真实第三方 IdP；生产仍应使用受信任 HTTPS issuer/JWKS、真实密钥和持久化数据库。已运行的本地演示仅发布到 `127.0.0.1:3010`。

## 最新验收：原生 generator 最小闭环（2026-10-07）

生成包 SDL 实际验收：最新 ERP native、Apollo、Yoga 配置分别重新生成 132/134/134 个 application files，在各自 server 工作目录执行 `bun test --preload ./tests/setup.ts tests/graphql-schema.test.ts`，三者均 1 pass / 0 fail。测试实际导入生成的 `graphqlTypeDefs`，经安装的 GraphQL 库构建 schema 并通过 `validateSchema`，补齐上一轮仅生成测试、未执行的证据。此次没有重跑 CRUD/API/Web/build；这不等同 adapter 路由实测或数据库连接验收。正式 ERP 示例已同步新增 schema 测试，V3 仍未满足发布门槛。

GraphQL schema 契约补充：生成器现在拒绝空实体模型、没有可写字段的 CRUD 输入、重复 mutation 名，并为每个 server 生成包写入 `api/tests/graphql-schema.test.ts`，使用 `graphql` 的 `validateSchema(buildSchema(...))` 检查实际 SDL。10 项服务端生成测试和类型检查通过（`tmp/graphql-schema-contract.log`）；这只是生成包验收契约，未重复已通过的 Apollo/Yoga ERP 运行测试，真实数据库/IdP 组合仍未完成。

GraphQL 生成命名校验（2026-10-07）：生成前注册内建 scalar、根类型、Qiy 聚合类型、实体类型及 Page/CreateInput/UpdateInput 派生类型，拒绝首字母大写后的名称碰撞；同时检查派生 Query 名、字段名、保留 `__` 前缀及 enum 的 true/false/null 等非法值。9 项服务端生成测试及类型检查通过，涵盖实体/枚举冲突、派生类型/查询冲突和合法枚举。顺带修正上一轮 MySQL bigint 改动遗漏的 import 断言；未重复 ERP 构建。此为生成期检查，完整 GraphQL schema 实例化验证和 V3 发布验收仍待完成。

枚举契约补充（2026-10-07）：Database IR 拒绝空/非数组枚举值集合、无效值项，以及非 Text 存储字段绑定当前字符串枚举，避免生成不可用 GraphQL enum 或 API 字符串契约与数据库数值类型冲突。合法 Text 枚举保持原行为。数据库、MPS 桥接、文本 DSL 三个测试集共 61 项/384 个断言及类型检查通过（`tmp/enum-capability-tests.log`）；未修改模板和原生 aspect，不重复 ERP 构建或 Make。此为编译期契约补充，数值枚举、实库 enum 约束和 V3 完整验收仍未完成。

独立生成等价验收修复：此前 `verify-mps-textgen.ts` 将原生配置同时传给两条生成路径，可能掩盖桥接菜单/Dashboard 差异。现在两条路径各用自身项目配置，并显式比较完整 menuGroups/dashboardMetrics；修正桥接指标属性顺序以保持生成源码字节一致。现有三份原生投影与独立桥接的完整文件集比较通过（`tmp/mps-independent-options.log`），22 项桥接测试与类型检查通过；新增修改菜单/指标标签的负例确认文件集比较能检出变化。未修改 MPS aspect，因此未重复 Make。V3 未完成，原生业务扩面与外部服务验收仍待推进。

原生 Make 入口预检（2026-10-07）：新增 `bun run tools/check-mps.ts <model.mps> [...models.mps]`，只在内存生成目标文件以验证桥接、Database IR 与应用生成契约，不写应用产物。MPS smoke 在删除旧投影和启动 Make 前检查 Catalog/Relations/ERP 三个输入，非法配置不再等到 TextGen 输出后才被发现；刻意无效的 sandbox 诊断模型不在预检列表。CLI 回归验证索引维度非法、缺失文件、批量错误汇总和三个有效输入，类型检查通过；修改后的两阶段 MPS smoke、三个 Java 校验器与三条 marker/TextGen/桥接对比均通过，证据 `tmp/mps-preflight-check.log`。这属于构建入口保护，MPS IDE 直接 Make 的原生诊断仍需扩展，V3 未完成。

原生桥接配置丢失修复：此前 `Application.description/basePath` 与 `DatabaseConfig.provider/url` 虽在允许列表内，却未进入输出 IR，导致配置被静默忽略。当前 `.mps` 导出/生成入口明确拒绝这四个未实现的属性，错误只包含节点/属性，不回显连接 URL。21 项 MPS 桥接测试、150 个断言及类型检查通过，现有三类样例继续通过。连接仍采用生成包运行时 `DATABASE_URL`；自定义 basePath/driver 及描述元数据的完整 IR/TextGen 支持仍待实现。原生 TextGen 单独运行尚未增加同样诊断，不能将本次桥接修复等同所有入口完成；V3 仍未完成。

pgvector 能力边界已补齐当前 `Vector` 目标：按 [pgvector v0.8.0 官方说明](https://github.com/pgvector/pgvector/blob/v0.8.0/README.md)，普通 vector 列最多 16000 维，HNSW/IVFFlat 的 vector 索引最多 2000 维。Database IR 在生成前分别检查两种上限；不带近似索引的高维列仍允许生成，不会错误地统一限制为 2000。13 项数据库测试、53 个断言及类型检查通过，覆盖两类索引的边界与越界、16000 维存储上界。尚未支持 halfvec、量化或表达式索引降级，未执行实库扩展安装/迁移；不将编译期校验当作生产验收，V3 仍未完成。

数值 capability 校验补充：Database IR 对 Decimal/Money 限制 MySQL precision ≤ 65、scale ≤ 30，PostgreSQL 显式 precision ≤ 1000；精度、小数位和向量维度要求 JavaScript 安全整数。非 Decimal/Money 字段声明 precision/scale、非 Vector 字段声明 dimension 均在生成前拒绝，避免生成器静默忽略参数。12 项数据库测试及类型检查通过，包含合法上界和超界生成拒绝；未重复 ERP/MPS 验收。SQLite REAL 金额精度、pgvector 类型/索引维度上限和真实数据库迁移仍需独立处理，V3 未完成。

MySQL Drizzle 生成修复（2026-10-07）：审计与附件的 `createdAt` 原先使用 32 位 `int` 却写入 `Date.now()` 毫秒值，存在 2038 前后及当前范围溢出风险；现在改用 `bigint("createdAt", { mode: "number" })`，业务实体的 DateTime 仍使用 `datetime(..., { mode: "date" })`。数据库回归测试覆盖两个通用时间列、默认值语义、旧 `int` 形态不存在，10 项数据库测试及类型检查通过。真实 MySQL migration/事务仍受外部服务不可用阻断。

生成包同步边界补充（2026-10-07）：检查 `tools/generate-app.ts` 时发现旧 manifest 可通过 `../` 越界删除文件，生成目标中的目录链接也可将写入引向外部。本轮新增 `tools/generated-paths.ts`，在任何删除/写入前校验全部生成目标、manifest 文件与清理候选，拒绝绝对路径、父目录跳转、Windows 路径别名、符号链接/junction、非文件目标和非目录父路径；损坏 manifest 明确失败。隔离临时目录中的实际 Bun CLI 测试覆盖整批预检、外部文件保留、链接目录拒绝、正常旧文件清理和自定义文件保留，3 项测试/30 个断言及类型检查通过。该检查不是文件系统事务，不承诺抵御同时修改目录的其他进程；`--sync` 仍覆盖当前生成文件，且保留既有两条 legacy 路径清理规则，二次开发应使用扩展目录。未重复 MPS Make/ERP 构建。原生业务配置扩展仍是下一主线，V3 保持未完成。

最新桥接校验补充：`tools/mps-database-ir.ts` 现在拒绝重复/空节点 ID、未实现的 `<ref>` 节点引用，以及同一 Concept 内重复 property/child registry 索引或名称，避免导出时静默丢弃引用或覆盖字段语义。`tests/mps-database-ir.test.ts` 的 20 项测试及 `bun run check` 通过，涵盖本地/外部引用、节点冲突、registry 别名冲突和现有 Catalog/Relations/ERP 正向生成。此处只校验桥接输入，不声称解决 MPS 对所有非规范节点 ID 的编码归一化；当前关系仍使用显式实体/字段配置。未修改 MPS aspect 和应用模板，因此未重复 Make 或 ERP 构建。

`qiy.generator` 已加入真实 `CreateRootRule`，生成独立 `QiyGenerationMarker.java`，保留源模型根和 `.qiy` TextGen。`tests/mps-smoke.xml` 每次删除旧 marker 与三个 `.qiy`，先构建语言，再在独立 MPS 进程生成 sandbox，避免同进程重建语言后 generator 未进入 sandbox 生成计划。最新 smoke 为 `BUILD SUCCESSFUL`，Catalog、Relations、ERP workflow 均验证 marker 与投影并存，投影 IR 和生成文件集与外部桥接一致。日志仍有 constraints partial-model 与 classloading teardown 告警，未出现 `Failed to load model`。

最小 mapping 执行已验证，但 marker 仅是执行证据；业务序列化仍由 TextGen 完成，完整业务 generator 模板尚未实现。本轮根仓 `bun run check` 与 `bun test`（70 pass，0 fail）通过，没有重复 ERP 的未受影响验收。下一 P0 是扩展原生业务配置与有效性诊断；V3 保持未完成。证据：`tmp/mps-generator-check.log`、`tmp/v3-generator-root-tests.log`，测试契约：`tests/verify-mps-textgen.ts`。当前目录没有 Git 元数据，此次文档更新依据实际源码与执行日志。

## Elysia 官方能力取舍（2026-10-06）

2026-10-07 后续原生校验验收：修复 `qiy.constraints.mps` 过长节点 ID 在 MPS 持久化解析中的冲突；此前 Field/Index 生成类悄然丢失属性校验器，不能将原来的 Make 成功视为这些约束生效。三个约束现使用短且唯一的节点 ID，并将字符串引用比较改为 null 检查与值比较。`tests/MpsConstraintsSmoke.java` 直接调用生成的 Java 校验器，验证 `Field.type`、`Index.method`、`IndexColumn.fieldName` 拒绝 null、空串及独立分配的空串，接受非空值。`tests/mps-smoke.xml` 同时禁止 constraints partial-model 丢节点告警。两阶段 Make、三个校验器、三个 marker/投影及 IR/生成文件集对比全部通过（`tmp/mps-constraints-check.log`，`BUILD SUCCESSFUL`）；classloading teardown 告警仍存在。根仓类型检查与 70 项测试通过（`tmp/v3-constraints-root-tests.log`）；未重复 ERP 验收；V3 仍未完成。

| 官方能力 | 当前处理 | 后续边界 |
| --- | --- | --- |
| Bearer / Server Timing | DSL 与 MPS 可按需生成官方插件 | Bearer 仅提取 token，仍须 `jose` 验签、角色与数据授权；Timing 不应暴露敏感信息 |
| Cron | 仅允许 `cleanupMissingAttachments`，需显式 `QIY_CRON_ENABLED=1` | 多副本部署需独立 worker 或分布式锁 |
| JWT | `.qiy`/MPS 可显式启用 `@elysia/jwt`（默认 `QIY_JWT_SECRET`）；组合样例实测签发/验证与缺密钥拒绝启动；外部 OIDC/OAuth2/SSO 的 JWKS 验证仍使用 `jose` | 插件接入不等于自签 token/session 登录闭环，不能当外部 IdP 登录器 |
| GraphQL Yoga / Apollo | DSL 可选择 adapter；生成器已写入官方依赖、resolver adapter 与 `/graphql` 路由；两个独立 ERP Bun workspace 均通过 typecheck、44 项 API 测试，真实调用生成的 Refine GraphQL provider 完成 CRUD/batch-delete、distribution/trend 与工作流 REST 命令，并覆盖租户 claim、分页上限、禁用排序/筛选及 GET 页面拒绝 | GraphQL adapter 按 GraphQL 约定将 resolver 失败作为错误结果返回（Yoga 会屏蔽内部错误文案）；仍需统一 native/adapter 错误格式与日志，以及真实数据库/IdP 组合验收 |
| Static | 可显式生成官方 Static 独立资源前缀，异步注册后已实测公开文件可读、源码路径 404；限制目录为 `public` 下且禁止 `/api`、`/graphql`、`/assets` 前缀；SPA 仍由 Bun `createHandler` 处理 API 优先、history fallback 和路径约束 | 官方 Static 的默认语义与 history fallback 不等价，部署仍需验证缓存策略与反向代理路由 |
| HTML | 可显式注册 `@elysia/html`，默认仍是构建后的 React Router SPA | 仅服务端 HTML/SSR 目标才实际需要此插件 |
| Drizzle 集成 | 可显式把生成的 Drizzle `db` 注册到 Elysia context | 官方是集成模式，不是独立数据库插件；repository 仍显式使用 Drizzle |

官方参考：[插件目录](https://elysiajs.com/plugins/overview.html)、[Bearer](https://elysiajs.com/plugins/bearer.html)、[Cron](https://elysiajs.com/plugins/cron.html)、[JWT](https://elysiajs.com/plugins/jwt.html)、[Yoga](https://elysiajs.com/plugins/graphql-yoga.html)、[Apollo](https://elysiajs.com/plugins/graphql-apollo.html)、[Static](https://elysiajs.com/plugins/static.html)、[Server Timing](https://elysiajs.com/plugins/server-timing.html)、[HTML](https://elysiajs.com/plugins/html.html)、[Drizzle 集成](https://elysiajs.com/integrations/drizzle.html)。

这些集成按需组合，不作为默认模板的固定依赖。Qiy 只为经过版本、类型与安全验证的插件提供有类型的 DSL 配置；当前 DSL/MPS 覆盖上表列出的主要插件能力，尚不支持从任意 npm 包名动态安装/执行插件。Frontend `apiClient` 与 Elysia GraphQL adapter 是不同选择：前者每个项目只能选择一种 API transport，后者只影响服务端 GraphQL 实现。

MPS `AuthConfig` 现在能表达 provider、userEntity、subjectField、roleField，并经编辑器、TextGen、外部桥接器往返；回归测试验证无效 provider 和缺少 user entity 都会失败。MPS `ScopeConfig` 已在 Relations sandbox 实例化 `products.categoryId → tenant.categoryId`，TextGen 与外部桥接严格等价，直连生成包已通过 SQLite scoped CRUD、REST/GraphQL claim 测试。原生 sandbox 还没有含用户角色枚举的完整认证模型，也没有真实 IdP 验收，不等于认证闭环。S3 缺少 bucket 时 fail-closed，生成测试使用 local 替代真实对象存储；SQLite `Money` 映射 `REAL`，不保证精确小数。

本页以**已验证的生成结果**为准，不把 README 的远期目标当作已实现功能。截至 2026 年 10 月 7 日，V3 仍未完成生产验收。MPS 原生 Catalog 与双实体 Relations 数据库切片现已由 Make 动态输出 `.qiy`，并与外部 MPS 桥接的 Database IR 严格相等；Catalog 的 78 文件 Bun/Turborepo 已通过 typecheck、API 14/Web 7 tests、SPA build 和 Drizzle migration，迁移 SQL 包含 HNSW 与 B-tree 索引；最新 Relations 的 90 文件 Bun/Turborepo 已通过 typecheck、API 24/Web 7 tests（强制无缓存）、SPA build（强制无缓存）和 SQLite Drizzle migration，迁移 SQL 含 `ON DELETE set null` 外键。ERP 样例本轮重新生成 131 application files，workspace typecheck、API 42/Web 17 项测试、SPA build 与 Drizzle Kit 11 表 schema 检查通过（没有新的 schema 变更）；这不等于 PostgreSQL 实库迁移或事务验收。真实 PostgreSQL/MySQL、IdP/S3、MPS 全业务配置与原生 generator 业务模板尚未完成，不能公开部署。

`sortable=false` / `filterable=false` 已从 Qiy 字段定义贯通 API 执行面：REST 拒绝非法列表参数，GraphQL resolver 与 Drizzle repository 使用字段 allowlist，scope 字段映射独立保留。专门的原生 GraphQL 回归测试使用有效 scope claim 后分别验证禁用排序与过滤；根仓本轮 `bun run check`、70 项测试通过。MPS TextGen 已 Make 刷新并通过投影校验；本轮修复 typesystem registry 重复声明后，Make 日志未再报告原先的 typesystem 模型加载错误；仍须继续覆盖原生 generator mapping。

Relations 变体还在隔离 SQLite 文件完成真实迁移，并经 `PRAGMA foreign_key_list(products)` 确认 `categoryId → categories.id` 的 `SET NULL` 外键。样例构建的服务端中间产物在 `ssr: false` 下被移除，最终托管 `build/client`。

新增的 Relations 压力样例现还覆盖双列 `@unique` 索引、字段级唯一约束与逻辑字段 `title` → 物理列 `product_title`。MPS Make 与外部桥接 IR 等价；从原生 `.qiy` 新生成的 86 文件 workspace 在 `tmp/v3-mps-rich-20261006/` 完成 typecheck、API 17/Web 7 tests、SPA build、Drizzle migration。隔离 SQLite 文件的 `PRAGMA table_info`/`index_info` 确认列名及索引列次序，仍不能替代 ERP 实库业务验收。

显式布尔三态改动后重新运行 MPS Make/IR 等价检查，生成的 Catalog/Relations 使用 `@id(true/false)`、`@nullable(true/false)`、`@unique(true/false)`、`@concurrently(false)`，而不是将 false 误认为未设置。较早的 Relations `.qiy` 在 `tmp/v3-mps-tristate-20261006/` 独立创建 86 文件包，已通过 typecheck、API 17/Web 7 tests、SPA build 和 SQLite migration；`PRAGMA index_list(products)` 显示预期的唯一与非唯一索引。随后加入 MPS 原生 `apiClient=graphql`、Elysia `bearer/serverTiming/cron` 配置；`.qiy` 与 `.mps` 两条入口插件文件一致。现又加入原生 GraphQL adapter、storage/S3 与 AuthConfig 结构；AuthConfig 仅通过模拟 registry 的桥接回归，尚未在 sandbox 中实例化。`PRAGMA table_info(products)` 确认新增 Money(10,0) 的列；SQLite 金额列目前映射 `REAL`，不具备十进制精确金额语义。

## 已落地

本轮插件组合验收：`examples/plugin-matrix/app.qiy` 显式声明 Bearer、Server Timing、HTML、Drizzle context、JWT、Static、Yoga、Cron，生成到 `tmp/v3-elysia-plugin-matrix/`。最新重生成包 workspace typecheck、API 28/Web 11 项测试和 React Router SPA build 通过；在隔离 SQLite 文件执行 Bun 迁移，并验证 `users`、`documents`、`attachments`、`audit_events` 与迁移历史表落盘。实测 JWT 签发/验证与缺密钥拒绝启动、Bearer 提取、Static 公开文件与源码 404；Static 的官方工厂必须先 `await` 再交给 Elysia `use`。生成器限制 Static 目录为 `public` 下、前缀不得与 API/GraphQL/SPA assets 重叠。生成测试 setup 按 SQLite/MySQL/PostgreSQL 方言选择默认数据库，仅在测试中注入固定 JWT secret；生产仍要求真实密钥。该组合测试不是 PostgreSQL/MySQL、IdP/S3 或部署验收。

同日 Apollo/Yoga 分别重新生成 132 文件 ERP 工作区，服务端 typecheck 与 40/40 API 测试通过；新增生成包测试直接通过 Refine GraphQL provider 请求 distribution/trend，与 REST 返回和 scope 传递比较，同时验证无效字段/天数及缺少 claim 时不触达 repository。本轮再次以同一 ERP DSL 分别生成 133 文件 Apollo/Yoga 工作区，各通过服务端 typecheck 与 44/44 API 测试；新增 REST 与 GraphQL Refine provider 在三种服务端实现下的工作流安全路径、权限和幂等键边界检查。Yoga 对预期的 GraphQL 验证/租户错误仍在测试日志打印堆栈，后续需统一安全错误格式与日志策略。MPS 官方样例的 `Application → Java` 根映射实验替换了原始根，导致现有 `.qiy` TextGen 消失；已撤销该映射并重新运行 MPS Make，Catalog/Relations/ERP workflow 三模型 TextGen 与桥接 IR 校验恢复成功。随后修复 `qiy.typesystem.mps` registry 中重复的 `NotExpression` 声明，本轮 MPS Make 日志不再出现该模型加载失败，并通过三模型校验。下一步原生 mapping 必须保留 DSL 输入根或使用独立产物阶段，不能以简单 root mapping 覆盖当前链路。

| 能力 | 证据 / 验收方式 |
| --- | --- |
| `.qiy` 受限文本模型、枚举和关系 IR | `examples/erpadmin/app.qiy`；支持 MPS 风格 Application 名称归一化及 `@column(...)` 物理列名，避免投影丢失包名/列映射；`bun test tests/qiy-project.test.ts tests/database-ir.test.ts` |
| PostgreSQL Drizzle schema、索引和外键迁移生成 | `examples/erpadmin/admin/apps/server/src/schema.ts`；`bun run db:generate` 输出 11 表（含 `audit_events`、`order_reservations`、`order_idempotency` 与 `attachments`）、10 个业务 FK；真实 PostgreSQL 连接验收仍未完成 |
| Bun + Elysia REST、GraphQL、OpenAPI 与 CORS | `/api/v1/*`、`/graphql`、`/api/v1/openapi/json`；OpenAPI 使用官方 `@elysia/openapi`，CORS 使用官方 `@elysia/cors` 且仅在 `.qiy`/环境显式提供来源白名单时启用；生成的 repository/service/routes 与 GraphQL resolver 共用 service；REST 与 GraphQL 分页均限制 page/pageSize 整数范围及每页最多 100 条 |
| Refine + Ant Design + React Router SPA | 默认资源菜单及 `.qiy` 自定义多级分组/图标、`dashboard` 计数、枚举分布与按 UTC 日趋势卡（Refine `useList`/`useCustom`，REST/GraphQL）、列表/详情/新建/编辑、枚举配色/图标 Tag 和 Select、关系 Select、详情页反向关系明细表（按外键过滤并复用带 scope 的列表 API）、隐藏字段、搜索/排序/多枚举过滤、权限化新建/编辑/删除/批量删除、可选每页 10/20/50/100 条、中英文切换；前端趋势测试覆盖两种 DataProvider |
| 可选前端传输 | `.qiy` 的 `api { client rest; }` 或 `api { client graphql; }`；服务端同时开放两种传输 |
| MPS 原生 TextGen 与外部桥接 | Catalog、Relations、ERP workflow 路径：MPS Make → 原生 `.qiy` → Bun workspace → typecheck/API + Web tests/SPA build/Drizzle migration 已实跑；`tests/verify-mps-textgen.ts` 对比原生输出与独立桥接 IR。数据库字段/索引/关系、workflow、前端 transport、Elysia 插件、storage/S3、scope、菜单/dashboard、Field 的 visible/list/show/form 可见性均已覆盖；ERP workflow 原生 MPS 样例包含 OIDC AuthConfig、角色枚举、彩色状态、分层菜单、Dashboard count/distribution/trend，并验证敏感字段隐藏后完整生成。仍非完整 ERP；真实 IdP、完整授权配置及 `qiy.generator` 业务模板尚未完成。 |
| 数据库方言切片 | PostgreSQL/Bun SQL、SQLite/Bun SQLite、MySQL/MySQL2 的 schema、连接、repository 查询和 Drizzle migration 生成；SQLite 迁移走 `drizzle-orm/bun-sqlite/migrator`，不要求 Drizzle Kit 的 `better-sqlite3`/libsql 连接器，已对真实 SQLite 文件跑通；pgvector 非 PostgreSQL 会在生成前拒绝。ERP 示例的多仓订单状态机目前仅在 PostgreSQL 目标下生成，SQLite 变体不包含该业务工作流/预占表，须显式视为能力差异，不能仅凭 CRUD 测试宣称跨方言业务等价 |
| 关系删除策略 | `relation ... one @onDelete(restrict|cascade|setNull)` 三方言生成及可空校验；ERP 订单明细级联、库存产品限制删除，Drizzle 已生成 FK 变更迁移；多对多目前要求显式中间实体 |
| OIDC 与 Refine 权限切片 | `.qiy` 的 `auth` 配置；OIDC issuer/audience/JWKS 校验、外部 subject 映射、服务端角色守卫、Refine `AuthProvider` / `AccessControlProvider`，`CanAccess` 路由与操作控件、拒绝原因及隐藏未授权按钮；匿名请求与 viewer 写操作测试 |
| ERP 业务事务切片 | `.qiy` 显式声明 `workflow orderInventory;` 后才生成 `src/workflows/order.ts` 与 `allocation.ts`：提交时跨仓拆分预占、`order_reservations` 跟踪明细、取消按原库存行释放、审批后出库扣减、审计同事务；`order_idempotency` 持久化请求回执，分仓算法和生成包 API 单测通过。工作流当前要求 PostgreSQL 与 `orders`、`orderItems`、`inventoryItems` 约定实体；缺少契约或使用 SQLite/MySQL 均明确拒绝。PostgreSQL 实库并发/回滚尚未验收 |
| 三方言 CRUD 审计切片 | REST/GraphQL 写操作透传操作者 ID；PostgreSQL、SQLite、MySQL create/update/delete/batch delete 与 `audit_events` 在同一事务写入，记录资源、记录 ID、动作和更新字段；SQLite 内存数据库已验证审计失败导致新增回滚，PostgreSQL/MySQL 真实数据库回滚尚未验收 |
| 细粒度数据范围 | `.qiy` 支持 `scope <resource> <field> claim <claim>;`；REST、GraphQL 按资源解析 claim，列表/分布/详情/新增/更新/删除/批量删除均传递 scope，缺少 claim fail-closed；ERP 订单四条工作流也在事务读写中加入 scope，缺失 claim 返回 403；PostgreSQL、SQLite、MySQL repository 均生成 scope 条件；`examples/scoped-sqlite/` 已用真实 Bun SQLite 验证租户隔离和写入绑定。PostgreSQL 工作流跨租户实库测试仍未完成 |
| 文件存储与 Attachment 元数据 | `.qiy` 的 `storage { provider local; }` 或 `s3`；生成 local 与 Bun S3-compatible Provider、路径校验、受保护文件上传/下载/删除端点、Attachment 元数据查询、owner 访问控制、重复 key 防护和 `attachments:cleanup`（默认 dry-run，`--apply` 才删除数据库孤儿记录）；受保护签名读取路由和前端下载 helper 已完成，local 自动回退代理下载；`File` 映射为数据库文本列及 Ant Design 上传控件；ERP 已生成 `attachments` 表和迁移，本机 local API 测试通过 |
| 可二次开发 Turborepo | `examples/erpadmin/admin/apps/{server,web}`，包含 `modules/`、`hooks/`、`plugins/`、`features/` 和部署文件 |
| 部署静态产物 | `ssr: false` 构建 `apps/web/build/client`，Elysia 同源静态托管与 SPA fallback；Docker/Compose/Nginx/K8s/Vercel 示例 |

## Elysia 插件采用策略

根据 [Elysia 插件目录](https://elysiajs.com/plugins/overview.html)，生成器同时评估官方插件和社区插件，但插件进入生成包前必须通过 Bun/Elysia 版本兼容、维护状态、类型体验、安全边界和生成样例测试；不把插件清单全部塞进默认模板：

- **已直接采用**：OpenAPI 使用官方 `@elysia/openapi`，替换旧命名的 `@elysiajs/openapi`；模板和 Catalog/ERP 生成样例已同步，保持 `/api/v1/openapi/json` 路径。
- **已条件启用**：CORS (`@elysia/cors`) 仅在 `.qiy` `api { cors { origin "https://..."; } }` 或 `QIY_CORS_ORIGINS` 明确给出精确来源白名单时启用；默认同源托管不放宽跨域。DSL 与运行时都拒绝 wildcard、路径和非 HTTP(S) Origin；生成配置关闭 credentials，并仅允许 REST/GraphQL 所需方法及 `Authorization`、`Content-Type`、`Idempotency-Key` 请求头。API 测试覆盖允许/拒绝来源和预检请求。
- **已实现的插件注册**：[Bearer](https://elysiajs.com/plugins/bearer.html)、[Server Timing](https://elysiajs.com/plugins/server-timing.html) 和 [Cron](https://elysiajs.com/plugins/cron.html) 可由 `.qiy` 按需生成。Bearer 只提取 token，不负责签名/权限；Cron 仅支持显式 `cleanupMissingAttachments` 任务，生成包测试通过官方插件 `trigger()` 验证调用与错误日志，隔离 SQLite 文件实跑确认缺失对象元数据被删除、现存对象记录保留。默认不调度，需 `QIY_CRON_ENABLED=1`、数据库元数据、迁移完成的 `DATABASE_URL` 与存储配置。
- **GraphQL adapter 状态**：[GraphQL Yoga](https://elysiajs.com/plugins/graphql-yoga.html) 与 [Apollo](https://elysiajs.com/plugins/graphql-apollo.html) 已可由 DSL 选择并生成官方依赖、`Query`/`Mutation` resolver adapter 和 `/graphql` 路由；两者均已完成生成包 typecheck、路由挂载、真实 Query 和匿名授权测试。仍需补齐 OIDC 身份/context、资源 scope、错误格式、分页上限、GraphiQL 暴露策略及 Refine DataProvider 契约的等价测试。
- **MPS 桥接**：`ElysiaConfig` 的 JWT、Static、HTML、Drizzle 布尔属性已有原生结构与 TextGen；外部桥接现按文本 DSL 的默认配置映射，并验证正向导出、生成依赖和非法布尔拒绝。自定义 JWT 名称/secret 环境变量及 Static 路径目前仍需文本 `.qiy` 配置，MPS 原生尚不能表达。
- **本轮回归（2026-10-06）**：Apollo/Yoga 分别独立生成并安装 Bun server 包，`graphql-adapter.test.ts` 与 `typecheck` 均通过；仓库 `bun run check`、`bun test`（63 pass）通过。MPS Make smoke 为 `BUILD SUCCESSFUL`，Catalog/Relations TextGen 与外部桥接 IR 等价；MPS 日志仍有 `qiy.typesystem.mps` 加载 AssertionError 和 constraints 局部模型告警，不能据此宣称 typesystem 健康。
- **ERP 工作流显式化（2026-10-06）**：`.qiy` 现需声明 `workflow orderInventory;` 才生成工作流 API、表和 Refine 操作；增加无声明不生成、重复/未知声明、SQLite 拒绝和 status enum/字段类型契约负例。`examples/erpadmin/admin/` 已从模型重生成 129 个文件；直接 server typecheck、34 API tests、web typecheck、17 Web tests、SPA build、Drizzle `db:generate`（no schema changes）以及根仓 `bun run check`、`bun test`（64 pass）均通过。
- **MPS workflow 桥接与插件 workspace 验收（2026-10-06）**：新增原生 PostgreSQL ERP workflow 样例，贯通 `WorkflowConfig` 的结构/editor/TextGen、外部桥接、`.qiy` serializer 和完整 workspace 生成；MPS smoke 对 workflow TextGen 与桥接 IR 做等价校验。生成 workflow workspace 已通过 typecheck、API/Web 测试和 SPA build。此样例仅覆盖订单/订单项/库存项 workflow 切片，不代表完整 ERP 的用户权限、菜单或 dashboard 都由 MPS 建模。
- **原生 MPS ERP 与字段可见性闭环（2026-10-06）**：在前一 ERP 配置切片上，新增 `Field.visible/listVisible/formVisible/showVisible` 结构、编辑器、TextGen 和外部桥接，显式 `false` 保留到 Refine resource metadata。MPS Make、原生 `.qiy`、bridge IR 与完整生成文件集等价；110 文件 Turborepo typecheck、API 25/Web 17 tests、SPA build 和 Drizzle Kit 8 表 migration generation 通过。真实 IdP 和 PostgreSQL 事务仍未验收。
- **MPS 字段呈现元数据闭环**：ERP workflow MPS 增加字段 `label`、`icon`、`sortable`、`filterable`，并通过结构、编辑器、TextGen 与 bridge 输出到 Refine resource metadata；MPS Make、`.qiy` 投影和桥接 IR 一致。重新生成的 110 文件 workspace 通过 typecheck、API 25/Web 17 tests 与 SPA build；根仓 `bun run check` 和 `bun test`（66 tests）通过。文本 ERP 示例也展示了枚举状态字段的图标、排序与筛选配置。
- **保留自有 SPA 与外部认证边界**：[Static](https://elysiajs.com/plugins/static.html) 可按需注册独立静态目录，但不替换受路径约束的 Bun SPA handler；对静态插件自身仍需回归目录穿越、防缓存和 404。[JWT](https://elysiajs.com/plugins/jwt.html) 可按需注册，默认不替代 `jose` 的 OIDC issuer/audience/JWKS 验签及 key rotation；尚未构成本地签发/会话功能。Bearer 仍只是 token 提取辅助，不替代认证授权。
- **Cron / Server Timing 边界**：Cron 使用 `unref` 与进程内 `protect`，单实例不会让计时器阻塞测试退出或在同一进程重入；失败记录日志，错误不会被静默吞掉。多副本没有分布式锁，部署默认关闭，只能在单个专用副本启用。官方插件触发测试与本地 SQLite 元数据清理已验收，多副本故障恢复和真实 S3 仍未验收。Server Timing 可按配置启用，不默认暴露内部阶段耗时。
- **Drizzle 集成**：[官方集成](https://elysiajs.com/integrations/drizzle.html)是数据库接入与 schema 复用模式参考，不是必须加入的 Elysia 插件；可显式注册生成的 `db`，但生成器继续显式生成 Drizzle schema、连接、repository 和迁移，避免额外抽象掩盖方言和事务语义。
- **HTML 插件**：[HTML](https://elysiajs.com/plugins/html.html) 适用于 Elysia 服务端动态返回 HTML/JSX；当前目标是 Refine/React Router 纯 SPA，不需要 SSR，因此默认不生成 `@elysia/html`，仅显式配置时加入依赖和注册。
- **优先评估的社区候选**：OAuth2 Resource Server 可与现有 OIDC/JWKS 校验实现做安全及 claim/scope 映射对照；Helmet、安全响应头、Rate Limit、Healthcheck、结构化 Logger、CSRF 和 Request ID 可作为 server 配置项候选。候选插件未经兼容性和回归验证前不改变现有生产路径，尤其认证、跨租户授权、限流分布式语义及 CSRF 策略不得仅凭插件名称视为已覆盖。
- **不纳入当前生成目标**：Nuxt/Remix/Vite SSR、文件系统路由及面向 Node/Deno 的 polyfill 集成，与当前 Refine SPA + Bun/Elysia API 边界不符；除非后续目标明确变化，否则不进入模板依赖。

## 尚未满足 V3 验收

### 本轮工程能力更新（2026-10-11）

- 文档站已具备 GitHub Pages 的 GitHub Actions 发布流程；VitePress 在 CI 中按仓库名设置 `base`，本地仍以 `/` 预览。首次发布仍需仓库管理员在 GitHub Pages 设置中选择 GitHub Actions。
- 文本 `.qiy` 支持安全的模块片段 `include "relative/path.qiy";`：支持递归展开与循环链诊断，拒绝绝对路径、`..` 穿越和越出项目根目录的链接；模块内容仍需遵循 V0 应用体声明顺序。`examples/modular-catalog/` 与专项测试覆盖此路径。
- 根目录 `deploy/` 现提供 Android 国内商店发布框架：`deploy/config.ts` 只保存 `env:NAME` 凭据引用与应用元数据，`deploy/index.ts` 可选择一个或多个目标并要求 `--confirm` 才提交。华为 AppGallery Connect 与小米应用商店适配器按官方自动发布契约生成请求；OPPO、vivo、腾讯应用宝、荣耀各自有独立适配器，通过已配置的企业 relay 对接权限化/合作伙伴 API，否则 fail-closed 并提示门户操作。发布前须以真实开发者资质、商店审核与 CI Secret 验收，不能把 dry-run 视为真实上架完成。

1. **身份与安全**：OIDC/OAuth2/企业 SSO Bearer JWT、外部 subject 映射、基础角色守卫、Refine Provider 和细粒度数据范围已有生成与本地验证；`auth { provider local; ... }` 已生成用户名/密码登录、Argon2id hash 校验、12 小时本地签名 access token、首个管理员 bootstrap、Refine 表单和 `QIY_AUTH_SECRET` 配置，并通过生成 API 路由测试。PostgreSQL/MySQL 实库的管理员初始化与登录验收、跨租户关系推导、数据范围组合策略和真实 IdP 集成仍未完成。生产 server 仍需真实数据库及相应认证环境变量，不能把本地 preview 公开。
2. **业务一致性**：`workflow orderInventory;` 显式启用订单提交/审批/出库/取消事务，多仓预占与按原库存行释放、状态条件、行锁、审计事件和持久化幂等回执；分配函数与生成包 API 已单测，并测试未声明时不生成、SQLite 明确拒绝。真实 PostgreSQL 事务集成、端到端并发/回滚和重复请求验收仍未完成。
3. **模型能力**：文本 DSL 支持有限字段类型、单向 UUID FK；MPS 数据模型现也可声明并导出 `Relation`，删除级联策略已覆盖第一版。基于现有 FK 的详情页反向明细表已生成，但独立反向关系 API、隐式多对多、复杂约束、默认值、MSSQL/CockroachDB 和完整方言能力矩阵仍未完成。
4. **后台配置**：多级菜单/分组、字段显示配置、权限化操作和数量/枚举状态分布卡、DateTime UTC 按日趋势卡已生成；三方言 `GROUP BY` 仓库及 REST/GraphQL 聚合端点已生成，SQLite 实库趋势验证了 UTC 日边界与租户隔离；列表每页选项已支持 10/20/50/100。持久化的用户字段布局与其他 UI 适配器尚未生成，PostgreSQL/MySQL 趋势实库验收仍缺失。当前工作台仍不是完整的分析 Dashboard。
5. **平台集成**：local/S3 Provider、基础 File 字段、Attachment 元数据 API、owner 访问控制、受保护签名读取与前端下载 helper、数据库孤儿记录清理脚本已完成切片；真实 S3 集成测试、对象存储孤儿扫描、GraphQL schema 文档门户、异步任务、生产部署验收和严格 Bun-only 子进程审计尚未完成。Vercel 文件仍是静态站点与远程 API rewrite 草案。
6. **MPS 一体化**：Catalog、Relations 与 PostgreSQL ERP workflow 切片已有 MPS Make → `.qiy` → Bun workspace → typecheck/tests/build/migration 验收；workflow、AuthConfig、角色枚举、菜单、dashboard 和字段级可见性 TextGen 与桥接 IR 已对比。完整 ERP 的更多业务配置、真实 IdP 验收仍未完成；`qiy.generator` 已验证最小 create-root mapping，完整业务模板仍待扩展。不能把三个已验证切片等同 V3 全部 MPS 模型完成。

## 下一阶段顺序

1. **MPS 原生生成扩面（当前 P0）**：Catalog/Relations 数据库切片及 PostgreSQL ERP workflow 切片均已打通 MPS Make → `.qiy` → Bun workspace；workflow、AuthConfig、枚举、菜单、dashboard 与字段级可见性 TextGen 和外部桥接 IR 等价，生成包已通过 workspace 验收。接下来扩展更完整 ERP 业务配置与 MPS generator 业务模板；已完成的切片不代表 V3 完成。
2. **Elysia 插件生态验证（P1）**：OpenAPI/CORS 已使用官方插件；Bearer、Server Timing、受限 Cron、JWT、Static、HTML、Drizzle schema 集成及 Apollo/Yoga 均已可按 `.qiy` 配置生成。Apollo 与 Yoga 已分别在独立 Bun ERP workspace 安装官方依赖，最新各通过 typecheck 与 44 项 API 测试；adapter 实测调用生成的 Refine GraphQL data provider 完成 CRUD/batch-delete、distribution/trend；REST/GraphQL provider 的工作流命令均保持同源 REST 路径并经服务端权限、scope 与幂等键验证。下一步统一 native/adapter 错误格式和日志、完成真实数据库/IdP 组合验收。Cron 仅允许显式 `cleanupMissingAttachments`，且 `QIY_CRON_ENABLED=1` 后调度；SQLite 生成包通过官方 `trigger()` 调用/异常回归，独立 SQLite 文件实跑清理了缺失对象元数据，保留现存对象记录。尚需多副本分布式锁、故障恢复与真实 S3。Static 仍由安全约束的 Bun handler 托管，官方 Static 插件仅提供显式配置的独立静态前缀；OIDC/JWKS 继续由 `jose` 验证；Drizzle 是集成模式而非 Elysia 插件；HTML 不适用于当前纯 SPA。
3. **业务工作流 DSL 与数据库闭环（P1）**：首个 `workflow orderInventory;` 已在 `.qiy` 与原生 MPS 路径生成工作流路由、预占/幂等表和 Refine 操作，但仍绑定现有 ERP 实体/字段约定。接下来抽象角色字段映射与状态转移声明，再明确 SQLite/MySQL 支持策略；覆盖预占/释放/出库、事务回滚、幂等重复请求、审计失败回滚、租户范围与关联查询。将已有算法/API 单测和真实数据库事务测试分开报告，不得把 SQLite CRUD 等同完整 ERP 验收。
4. **外部服务验收（环境门槛）**：PostgreSQL/MySQL 需要可用服务或 Docker daemon 后才能执行跨方言并发、锁、回滚及审计验收；OIDC 需测试 IdP/issuer/JWKS，S3 需兼容对象存储。当前端口 5432/3306 不通且 Docker Desktop Linux engine pipe 不存在，不能把这些标成已验收。
5. **生产与平台边界**：完成 Bun-only 启动/构建子进程审计、Docker/K8s 部署实跑、S3 签名上传与孤儿清理、SSO/local session 支持边界、多副本限制与安全配置审计。
6. **V3 发布门槛**：MPS 原生路径必须端到端生成；ERP 生成包须通过 typecheck、server/web tests、build、migration 与适配环境的实库/IdP/S3 验收；剩余不可测试目标必须列为明确限制。未满足时保持 V3 未完成。

## 目前可执行的验收

```powershell
bun run check
bun test
cd examples/erpadmin/admin
bun install
bun run typecheck
bun run test
bun run build
bun run db:generate
bun run preview
```

以上生成包命令在 2026-10-06 已串行以 `--force` 绕过 Turborepo 缓存复验；Drizzle Kit 检测到 schema 与现有迁移一致（no schema changes）。并行强制启动 typecheck/build 曾触发子进程异常，拆成串行后均通过，因此验收采用串行执行。

SQLite ERP 变体的实际迁移验收目录为 `tmp/v3-erp-sqlite-20261006/`；它是临时证据，不是正式示例或跨方言 workflow 的支持声明。SQLite 迁移命令由生成器设为 Bun 原生执行，验证时在独立 `DATABASE_URL` 文件中创建了迁移历史表及 9 张业务表。

租户隔离样例：

```powershell
bun run tools/generate-app.ts examples/scoped-sqlite/app.qiy examples/scoped-sqlite/admin --sync
bun run --cwd examples/scoped-sqlite/admin typecheck
bun run --cwd examples/scoped-sqlite/admin test
```

打开 `http://127.0.0.1:3000/orders`。预览只绑定 `127.0.0.1`，使用内存仓库并关闭数据库工作流；数据库 server 需要 `DATABASE_URL`，启用 OIDC 的生成包还需要 `QIY_OIDC_ISSUER`、`QIY_OIDC_AUDIENCE`、`QIY_OIDC_JWKS_URL`。不要把通过上述命令解读为 V3 已完成。


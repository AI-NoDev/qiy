# Qiy 架构

Qiy 只有一条编译链路：`.qiy` 文本 → Bun 解析与校验 → IR → 多目标生成。没有第二套建模工作台或语法前端；新增语义只在这条链路上实现。

## 编译链路

```text
app.qiy + include 片段
  → tools/qiy-include.ts      展开 include（相对路径、防穿越、循环诊断）
  → tools/qiy-project.ts      词法/语法解析 → QiyProject；也负责规范化序列化（qiy fmt）
  → tools/database-ir.ts      Database IR：字段类型、关系、索引、方言能力校验
  → tools/generate-project.ts 编排各生成器，写入 templates/admin 模板
       ├── generate-server.ts      服务端编排：组装 apps/server 文件，按领域调用 tools/server/*
       ├── generate-web.ts         前端编排：Refine + Ant Design + React Router SPA，按领域调用 tools/web/*
       ├── drizzle-{pg,mysql,sqlite}.ts  三方言 schema
       ├── generate-values.ts / permissions.ts / generate-view-routes.ts / generate-audit.ts
       ├── environment-files.ts    .env 模板与部署文件
       └── generated-wiki.ts       生成应用自带的 OpenWiki
  → tools/generated-paths.ts  .qiy-generated.json manifest：--sync 只覆盖自己生成过的文件
```

中间表示是关键边界：所有生成器读同一个 `QiyProject`/Database IR，REST 与 GraphQL 共用同一 service 层，前后端的权限、字段与 i18n 元数据都从同一份模型派生，避免语义漂移。

## 源码地图

| 位置 | 作用 |
| --- | --- |
| `tools/cli.ts`、`tools/commands/` | `qiy` CLI：create/init/generate/check/diff/explain/schema/fmt/add/dev/build/test/preview/skill/mcp/agent/doctor |
| `tools/qiy-project.ts` | DSL 解析器、类型定义与序列化；语法变化从这里开始 |
| `tools/database-ir.ts` | 方言无关的数据模型校验 |
| `tools/roles.ts` | 角色声明校验、默认角色、`RoleContext`，以及生成的 `api/src/auth/roles.ts` |
| `tools/generate-server.ts` | 服务端编排：`generateServer` 组装 `apps/server` 的文件表，具体渲染交给 `tools/server/` |
| `tools/server/` | 服务端按领域的渲染器：`shared`（字段 schema、principal claims、树形 scope）、`routes`、`repository`、`graphql`、`permissions`（行策略、数据范围、权限模型）、`dataflows`（含场景测试）、`jobs-realtime`（导入导出、保存视图、SSE）、`database-ops`（drift/备份/迁移/回滚）、`auth` 与 `auth-files`、`api-keys-docs`、`sqlite-tests` |
| `tools/delivery.ts` | webhook / notification / cron dataflow：校验、`qiy_deliveries` 与 `qiy_job_leases` schema、投递 worker、租约与定时执行模块及其生成测试 |
| `tools/generate-relation-links.ts` | 多对多：连接表读写模块 `api/src/relation-links.ts`、repository 注入、数据范围校验 |
| `tools/generate-web.ts` | 前端编排：`generateWeb` 组装 `apps/web` 的文件表 |
| `tools/web/` | 前端按领域的渲染器：`shared`（`WebOptions`）、`auth`、`realtime`（live provider）、`views`（保存视图与树）、`export`、`i18n`、`api-keys-docs`（功能总览、API 文档、访问密钥页面） |
| `tools/generate-project.ts` | 生成编排、workspace 组装、插件钩子 |
| `tools/admin-template.data.ts` | `templates/admin` 打包后的模板（`bun run template:build` 重建） |
| `tools/qiy-skill.data.ts` | 打包进 CLI 的官方 Skill（同上） |
| `tools/mcp.ts`、`tools/agent-api.ts` | `qiy mcp` 与 `qiy agent` 只读接口 |
| `tools/qiy-test.ts` | `app.test.qiy` 声明式场景 → 生成应用测试 |
| `tools/verify-*.ts` | 维护者验收脚本：生成真实工作区并在其中跑测试，见 [MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md) |
| `tests/` | 根仓单元/快照测试（`bun test`） |
| `e2e/` | 文档站与生成应用的 Playwright 测试 |
| `docs/` | VitePress 用户文档；`bun run docs:assets` 生成 `llms*.txt` 与静态 Skill |

## 生成应用结构

```text
<project>/
├── apps/server/src/
│   ├── app.ts / server.ts         Elysia 组装与启动
│   ├── schema.ts / db.ts          Drizzle schema 与连接（按方言）
│   ├── modules/<table>/           contract / repository / service / routes
│   ├── graphql.ts                 Yoga 或 Apollo adapter，调用同一 service
│   ├── auth/                      roles.ts（声明的角色与访问级别）/ local / oidc / hybrid / API Key / 权限 provider / 会话吊销
│   ├── dataflows/                 声明式业务命令（事务、审计、emit）
│   ├── realtime.ts / realtime-bus.ts  outbox 轮询 + SSE
│   ├── delivery/ / jobs/          webhook 与通知投递 worker；cron 租约与定时 dataflow
│   ├── import-jobs.ts / export-jobs.ts / storage/
│   └── db-migrate / db-check / db-backup / db-restore / db-rollback
├── apps/web/app/
│   ├── resources.ts / routes.ts / root.tsx
│   ├── routes/                    list / show / create / edit / home / login / system 页面
│   ├── components/ / providers/   Refine 组件与 data/auth/access/live provider
│   └── charts.ts / i18n.ts / icons.tsx / display-template.ts
├── deploy/                        Docker / Compose / Nginx / K8s 示例
├── openwiki/ 与 AGENTS.md         生成应用自己的 Agent 入口
└── .qiy-generated.json            生成文件所有权 manifest
```

手写扩展放在不在 manifest 里的文件中（例如 `apps/*/src/extensions/`、`apps/web/app/plugins/<name>.ts`），再从生成的插件、hooks 或领域层显式接入；`--sync` 只写入、删除 manifest 登记过的文件。规则见 [项目结构](../docs/guide/project-structure.md)。

## 设计原则

- **服务端是最终权威**：权限、数据范围、校验与业务一致性都在服务端执行；前端的按钮隐藏与表单联动只服务体验。
- **REST 与 GraphQL 同源**：两者调用同一 service；一个生成的前端只选一种 DataProvider（`api { client rest|graphql; }`）。
- **跨表写操作走命令**：用 Dataflow 声明事务、审计和幂等，而不是让前端连续调用多个 CRUD 接口。
- **方言差异显式化**：方言不支持的能力在生成前报错，不静默降级。
- **单一 UI adapter**：当前只生成 Ant Design；其他 adapter 在完整实现前不提供。
- **实时无外部依赖**：mutation 与 outbox 写入同一事务，进程内轮询 outbox 后用 SSE 推送；频道授权与 REST 共用同一策略。
- **外部投递在提交之后**：事务内只写投递记录，网络调用由 worker 在提交后执行并重试；业务事务不等待、也不因外部服务失败而回滚。

## 系统管理功能：功能总览、OpenAPI 与 API Key

`.qiy` 的 `features { overview true; apiDocs true; apiKeys true; }`（`overview` 默认 true，`apiDocs`/`apiKeys` 默认 false，需要 `auth` 才能开 `apiKeys`）生成一套配置门控的系统管理能力：三个独立菜单页——功能总览 `/system/overview`（仅 `overview && (apiDocs || apiKeys)` 时生成）、API 文档 `/system/api-docs`（`apiDocs`）、访问密钥 `/system/api-keys`（`apiKeys`）；`overview` 页面的模型数据来自 `/api/v1/docs/model`（在 `apiDocs` 或功能总览需要时生成），`/api/v1/openapi.json` 只在 `apiDocs` 时生成。菜单链接由 `app/features.ts` 的 `qiyMenuLinks` 提供，`buildMenuTree` 按顺序追加到「系统管理」分组，不会产生死路由。

- **DSL/IR**：`tools/qiy-project.ts` 解析 `QiyFeaturesConfig` 并纳入 `QiyProject.features`；parser/序列化/校验在 `tests/features-api-keys.test.ts`。
- **Web**：`/system/overview`（`app/routes/docs.tsx` + `app/components/docs-page.tsx`）只包含实体系（`app/docs.ts` 的纯函数 `buildEntityDiagram` 输出 Mermaid `classDiagram`）、Dataflow（`buildDataflowDiagram` 输出 `flowchart`）与权限模型；API 文档是独立全页 `app/routes/api-docs.tsx` + `app/components/api-docs-page.tsx`（`groupOpenApiOperations`/`filterOpenApiOperations`，tag 列表带计数、搜索、操作卡含参数/请求体/响应/安全标签/curl 与 Tooltip）；访问密钥是独立全页 `app/routes/api-keys.tsx` + `app/components/api-keys-page.tsx`（`app/api-keys.ts` 的搜索/状态/权限标签/相对时间/curl 纯函数、一次性密钥、撤销确认）。`app/components/mermaid.tsx` 用 `import("mermaid")` 延迟在浏览器渲染（10 秒超时/异常时回退原始源码），SSR 保留 `data-diagram` 源码；`app/features.ts` 保存开关、`qiyMenuLinks`（`menu.tsx` 把它插入「系统管理」子菜单）。两者都关闭时不生成页面/路由/依赖。
- **Server**：`api/src/docs.ts` 是生成期嵌入的模型元数据与纯函数 `buildOpenApiDocument`/`buildDocsModel`（按 principal 的 role、restrict.roles、pages 规则与 dataflow allow 规则过滤，附 `x-qiy-*` 元数据）；`docs-routes.ts` 提供受认证的 `/api/v1/openapi.json` 与 `/api/v1/docs/model`（Elysia 自带 `/api/v1/openapi` 仍公开，guard 只豁免它）。`auth/api-key-hash.ts` 负责 HMAC-SHA256（`QIY_AUTH_SECRET` pepper）与格式/上限校验；`auth/api-keys.ts` 提供 `qiy_api_keys` 的列出/创建/撤销与 `withApiKeyAuthentication`（在原有 authenticator 之后接受 `Authorization: Bearer qiy_...` / `X-API-Key`，按用户行解析 role/claims、节流更新 `lastUsedAt`）。`createApp` 内部统一用包装后的 authenticator，因此 REST、GraphQL、realtime 与 storage 共享同一 principal。
- **生成物/测试**：`api/tests/docs.test.ts` 断言 OpenAPI 3.1 合法、过滤规则与端点认证；`api/tests/api-keys.test.ts` 覆盖密钥生命周期、哈希不含明文、过期/撤销、上限与 app guard 继承权限；web `tests/features.test.ts`（开关与菜单链接顺序）、`tests/docs.test.ts`（Mermaid 构建 + 三页签）、`tests/docs-render.test.tsx`（SSR 仅挂载活动页签、单图）、`tests/api-docs.test.ts`/`tests/api-docs-render.test.tsx`（搜索/过滤/curl/操作卡）、`tests/api-keys.test.ts`/`tests/api-keys-render.test.tsx`（搜索/状态/权限标签/一次性密钥 UI）覆盖前端。
- **限制**：带 `allow verification` 的命令在 OpenAPI 中仅 `full` 角色可见；资源级数据 scope 只影响真实请求；文档页对任意已登录用户开放但内容按权限过滤。

## 部署边界

推荐生产拓扑：

```text
Browser
  ├── /api/v1/* → Nginx → Elysia/Bun → Drizzle → 目标数据库
  └── /*        → Nginx → React Router build/client
```

前端使用真实路径而不是 HashRouter，因此 Nginx 必须将非资源路径 fallback 到 `index.html`，同时 `/api/*` 必须先匹配并保持 JSON 错误响应。

需要区分两个“纯前端”要求：

1. **部署纯前端**：运行时只部署 `build/client`，不运行 React Router Server。
2. **运行时 Bun，构建期 Node 回退**：生成应用的 API 与静态托管运行时为 Bun + Elysia；Linux 上 React Router 的 SPA 构建会经过其 SSR 中间阶段，而 Bun 解析 `react-dom/server.bun.js` 时仍会失败，因此 `apps/web` 的生产构建显式使用 Node.js 20+。Dockerfile 已隔离 Node 构建阶段，最终运行镜像没有 Node 服务或 Node 子进程。

不能把“运行时不需要 Node 服务”误认为“构建阶段完全不需要 Node/Vite”；用户文档和发布验收都必须明确这一边界。

## Agent Skill 分发

仓库提供 `.agents/skills/qiy/` 作为面向 Qiy CLI 用户的公开 Skill。它把 `.qiy` 建模、`qiy create` 与 `qiy init` 的选择、Bun workspace 集成、生成 manifest 的所有权边界和生产验收限制集中为可复用指导。Skill 不属于生成应用运行时依赖；通过公开 GitHub 仓库由 [skills.sh](https://www.skills.sh/ai-nodev/qiy/qiy) 索引，更新方式是提交并推送 Skill 文件。

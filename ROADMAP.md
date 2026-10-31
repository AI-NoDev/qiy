# Qiy Roadmap（维护者视角）

> 本文件记录发布质量审计后的待办，按 P0 → P1 → P2 顺序逐项推进。
> 面向维护者与 AI Agent，不属于文档站用户内容；用户文档见 `docs/`。
> 当前版本：`0.2.1`（tag `v0.2.1`，已发布）。

## 状态图例

- `[x]` 已完成并验证
- `[ ]` 未开始
- `[~]` 进行中

每项完成后必须在此更新状态、验证方式和对应提交/PR。

> P0 已完成（2026-10-26）：PR CI、发布前验收/不可变 tag 流程、CHANGELOG/Release Notes、逐页 SEO 与 llms 校验。
> 产品方向（2026-10-26）：CLI-first、项目优先、模块默认；Phase 1 已完成 `qiy create project` + 项目内命令 + 新快速开始。
> 下一步从 P1 开始，按清单顺序推进。

## P0：下一次发布前必须完成

### P0-1 PR CI 覆盖全部改动 `[x]`

- 现状：只有 `database-smoke` 在部分路径上有 `pull_request`；`release` 只在 main/版本变更触发。
- 目标：新增 `.github/workflows/ci.yml`，所有 PR 与 main push 跑
  `bun install --frozen-lockfile`、`bun run check`、`bun test`、`bun run docs:assets`、`bun run docs:build`。
- 验收：PR 上出现绿勾；故意失败的测试能阻断 PR。
- 完成：`.github/workflows/ci.yml`；本地复跑 354 tests / `bun run check` / `docs:build` 通过。

### P0-2 发布前验收 + 不可变 tag `[x]`

- 现状：`v0.2.0` 曾因发布后才发现生成器缺陷而多次 force-move tag。
- 目标：
  1. 发布前用 `Release Qiy CLI` 的 `dry_run=true` 跑完整验收
     （check / test / docs build / template build / 全平台可执行文件构建 / standalone 与 integration acceptance）；
  2. 验收通过后才允许打 annotated tag；tag 一旦推送不再移动；
  3. 新增 `RELEASING.md` 写清顺序：验收 → tag → Release workflow → release-smoke。
- 验收：用该流程发布一个 patch 版本，tag 全程未移动。
- 完成：`release.yml` 支持 `workflow_dispatch` 的 `dry_run` 输入并可由 tag 触发；`RELEASING.md` 固化流程。2026-10-26 通过该流程发布 **v0.2.2**：dry-run 全矩阵通过（publish skipped），随后 tag → Release（11m，5 平台）成功，tag 未移动；release-smoke 新增“无已发布 Release 则跳过”的 gate。

### P0-3 CHANGELOG 与 Release Notes `[x]`

- 现状：GitHub Release body 只有 auto `Full Changelog` 链接；没有 `CHANGELOG.md`。
- 目标：
  1. 新增 `CHANGELOG.md`（Keep a Changelog 格式），至少回填 `0.2.1`、`0.2.0`；
  2. 新增 `tools/release-notes.ts` 从 CHANGELOG 提取当前版本段落；
  3. `release.yml` 创建 Release 时优先使用该段落，缺失才回退 `--generate-notes`；
  4. 回填 `v0.2.1` 的 GitHub Release notes。
- 验收：`gh release view v0.2.1` 显示人工整理的内容；下一次 Release 自动复用 CHANGELOG。
- 完成：`CHANGELOG.md`、`tools/release-notes.ts`、`tests/release-notes.test.ts`；`v0.2.0`/`v0.2.1` Release notes 已回填为 UTF-8 正文。

### P0-4 逐页 SEO 与 llms 校验 `[x]`

- 现状：所有页面继承同一句站点 description；`llms.txt`/`llms-full.txt` 没有自动校验。
- 目标：
  1. 新增 `docs/.vitepress/seo.ts`，为每个文档页提供独立 description；
  2. `transformHead` 输出逐页 `description`/OG/Twitter/JSON-LD（TechArticle）；
  3. 新增测试校验 `llms.txt`：必需页面齐全、无 localhost、站点 URL/base 正确、每个链接可达；
  4. 新增测试校验 docs 页面都有 description（新增页面漏写会失败）。
- 验收：`bun test` 覆盖上述断言；`docs:build` 后抽查 3 个页面的 meta。
- 完成：`docs/.vitepress/seo.ts`（48 页独立描述）、`tests/docs-seo.test.ts`、`transformHead` 增加 `og:type/article`、Twitter、canonical、JSON-LD；`docs:build` 抽查 `dsl/overview` 与首页 meta 通过。

## P1：0.3.0 之前

- [x] `qiy explain`（文本/`--json` 规范化模型摘要）+ `qiy schema`（draft 2020-12 JSON Schema，发布到 `/schema/qiy-explanation-1.json`）
- [x] 错误码目录：`QIY1001–QIY1016`，`qiy explain --errors [--json]`，文档 `/dsl/errors`，`explain --json` 自动附带 code/fix
- [x] `qiy skill list/update/uninstall`（含 `--json`、本地修改保护、保留手写文件）
- [x] 官方 bun/drizzle/elysia/refine-dev skill 纳入分发（CLI `skill install [name] --all` + 文档站静态下载）
- [x] API docs：OpenAPI 下载（当前账号过滤后的 spec）
- [x] API docs：无 auth 时不再生成缺失的 `app/auth` 引用（apiDocs-only 项目可 typecheck）
- [x] API docs：try-it 请求（会话 token / 手动 API Key、原始响应、20k 截断）
- [x] API docs：verification 隐藏操作原因说明（`x-qiy-hidden` + 页面提示）
- [x] API Key 轮换（`POST /auth/api-keys/:id/rotate`，旧 key 立即撤销）与审计轨迹（created/rotated/revoked）
- [x] API Key 权限 scopes（创建/轮换可选，与用户权限取交集；只收窄不提权）
- [x] 本地密码限流/锁定（默认 5 次/15 分钟窗口，锁 15 分钟，429 + Retry-After）
- [x] 会话吊销（`qiy_session_revocations` + `POST /auth/logout-all` + 个人中心按钮）
- [x] chart area 视图（trend 数据 + SVG 面积填充）
- [x] chart scatter 视图（numeric list + 点击下钻）
- [x] `sum/avg ... group by` 分组聚合（bar/pie）
- [x] chart color / legend 配置
- [x] chart stacked（客户端 group/series/value 聚合）
- [x] 字段类型扩展：Boolean（parser/IR/Drizzle/API/GraphQL/Web Switch/文档）
- [x] 字段类型扩展：Email / URL（text 存储 + REST email/uri 校验 + 表单 input）
- [x] 字段类型扩展：JSON（jsonb / text JSON / mysql json + GraphQL JSON scalar + textarea）
- [x] 专用数组字段：`Text[]` / `Email[]` / `URL[]` / `Integer[]`
- [ ] 专用数组字段的 CSV/批量导入语义
- [x] 文档多语言：English 核心页（getting-started / CLI）+ 隐藏未翻译语言入口
- [x] 文档版本化（`/v0.6/` 归档，独立 base/canonical，导航切换）
- [x] `qiy diff` / dry-run 预览（内存渲染、added/changed/removed、`--check`/`--json`）+ `qiy generate --incremental` 只写变化文件
- [x] 任务文档索引（`/guide/tasks`）+ llms 分段（`llms-dsl.txt` / `llms-guides.txt`）
- [x] 每页 OG 图（sharp 生成 `/og/<page>.png`）

## 产品体验 Phase 2（CLI-first 之后）

- [x] `qiy add module/entity/feature` 的结构化增量建模（`add entity`、`add field`、`add module`、`add feature`，写入后校验并回滚）
- [x] `qiy fmt [--check]`：保留语义的空白规范化（缩进/空行/行尾/末尾换行）
- [x] 友好语法 v1 RFC：设计理念页记录提案（project/module、name:type、内联关系、可选分号、v0 兼容）
- [x] v1 语法最小版：v1 → v0 预处理器（project/module、name:type、自动主键、one、one-to-many、many-to-many、常用配置块 v0 透传、include v1 片段），`explain/generate/fmt` 自动识别；`add entity/field/module/feature` 支持 v1
- [x] v1 注解透传 + 自定义关系名/onDelete（one / one-to-many）
- [ ] 文档按任务重构：每页目标 → 命令 → 语法；仓库内部工具退出用户文档
- [x] `qiy dev --watch`：模型变更防抖后自动重新生成、迁移，dev server 重新加载

## P2：长期
- [x] 测试审计（`AUDIT.md`）：400 tests、覆盖率 89.44% funcs / 93.12% lines、docs build、生成项目验收、依赖审计
- [x] Playwright docs E2E + axe a11y + docs bundle budget
- [x] 生成应用的 Playwright CRUD E2E（CI 生成 + 安装 + 浏览器）
- [ ] 生成应用的视觉回归
- [ ] a11y、bundle size 预算、负载测试
- [ ] lint/format、coverage 阈值、依赖扫描 / SBOM / CodeQL
- [x] MCP server（`qiy mcp`，explain/schema/error catalog）
- [ ] 结构化 Agent API（除 MCP 外的 HTTP/Agent 接口）
- [x] 生成器插件机制（`qiy.project.json` plugins，追加文件/路径保护）
- [x] 软删除（`@softDelete` nullable DateTime；读取过滤 + delete 写时间戳）
- [ ] 租户 DSL、计算字段、DB view

## 已完成（审计后）

- [x] `database-smoke` fixture：`tenantId` 改为加在 auth userEntity；v0.2.1 CI 已绿。
- [x] JetBrains 插件发布：Gradle 固定 8.10.2；v0.2.1 `Publish editor plugins` 成功。
- [x] v0.2.0 发布后暴露的生成器 typecheck/return 接受度缺陷（无 `@code` 序列 fallback、docs 路由 Elysia 泛型、fixture 专属测试、集成模式 `bun test` 退出码、只读列表图标）。
- [x] `v0.2.2`：`qiy skill list/update/uninstall`（含 `--json`、本地修改保护、保留手写文件）；通过 dry-run → tag → Release 流程发布。
- [x] `v0.2.3`：`qiy explain` / `qiy schema`，机器可读模型摘要 + 已发布 JSON Schema。
- [x] `v0.2.4`：稳定错误码目录 `QIY1001–QIY1016`、`qiy explain --errors`、文档 `/dsl/errors`、`explain --json` 自动附带 code/fix。
- [x] `v0.19.0`：软删除（`@softDelete` nullable DateTime）。
- [x] `v0.18.0`：生成器插件机制（`qiy.project.json` plugins）。
- [x] `v0.17.0`：`qiy mcp` stdio MCP server（explain/schema/error catalog）。
- [x] `v0.16.0`：生成应用 Playwright CRUD E2E（CI 生成 + 安装 + 浏览器）。
- [x] `v0.15.0`：stacked bar（客户端 group/series/value 聚合）。
- [x] `v0.14.0`：chart color / legend 配置。
- [x] `v0.13.0`：bar/pie 分组聚合（`sum/avg/min/max ... group by`）。
- [x] `v0.12.0`：scatter chart、每页 OG 图、Playwright E2E/a11y、bundle budget。
- [x] `v0.11.0`：标量数组字段（`Text[]` / `Email[]` / `URL[]` / `Integer[]`）。
- [x] `v0.10.0`：area chart、任务文档索引、llms 分段、coverage gate、SBOM、CodeQL。
- [x] `v0.9.0`：JSON 字段类型（jsonb / SQLite text JSON / MySQL json、GraphQL JSON scalar、textarea）。
- [x] `v0.8.0`：Email/URL 字段类型（text 存储、REST email/uri 校验、表单 input）。
- [x] `v0.7.0`：Boolean 字段类型端到端（parser/IR/Drizzle/REST/GraphQL/Web Switch/文档）。
- [x] `v0.6.5`：English 核心文档（getting-started / CLI），隐藏未翻译语言入口。
- [x] `v0.6.4`：文档版本化归档（`/v0.6/`，独立 base/canonical，导航 Latest/Archive）。
- [x] `v0.6.3`：测试审计（`AUDIT.md`）+ 依赖安全加固（Vue XSS override）+ 生成测试临时目录/turbo 串行化。
- [x] `v0.6.2`：`qiy generate --incremental` 只写内容变化的文件（保留 mtime，仍清理过期文件）。
- [x] `v0.6.1`：`qiy diff [--check] [--json]` 内存预览生成差异（added/changed/removed，忽略 .env）。
- [x] `v0.6.0`：内置分发 5 个官方 skill（qiy/refine-dev/bun/drizzle/elysia），`skill install [name] --all`、`list --all`、`update/uninstall [name]`，文档站发布每个 skill 与 tarball。
- [x] `v0.5.3`：v1 注解透传 + 自定义关系名/onDelete（one / one-to-many）。
- [x] `v0.5.2`：本地密码登录限流/锁定（429 + Retry-After）与会话吊销（`POST /auth/logout-all` + 个人中心按钮）。
- [x] `v0.5.1`：API docs 显示 verification 隐藏操作原因（`x-qiy-hidden`），并修复 realtime audit 测试的共享 SQLite 抖动。
- [x] `v0.5.0`：API Key 权限 scopes（创建/轮换可选，与用户权限取交集，只收窄不提权）。
- [x] `v0.4.9`：API Key 轮换（旧 key 立即撤销、`rotatedFromId`）与审计轨迹（`qiy_api_key_events`，created/rotated/revoked）。
- [x] `v0.4.8`：修复 apiDocs-only（无 auth）生成缺失 `app/auth` 引用的问题。
- [x] `v0.4.7`：API docs Try it（会话 token / 手动 API Key、原始响应、20k 截断）。
- [x] `v0.4.6`：`qiy add module/feature` 支持 v1（创建片段 + include / 写入 features 块，失败回滚）。
- [x] `v0.4.5`：v1 入口支持 include 相对 v1 片段（展开后仍按 v1 规则校验）。
- [x] `v0.4.4`：v1 常用配置块 v0 透传（features/auth/enum/menu/chart/dataflow 等按规范顺序），v1 可表达认证/开发者页/菜单/图表。
- [x] `v0.4.3`：v1 双向数组自动生成 many-to-many join 实体（两条 one 关系）。
- [x] `v0.4.2`：`qiy add entity/field` 支持 v1 入口（写入 v1 文本，经预处理器校验，失败回滚）。
- [x] `v0.4.1`：v1 预览支持一对多（`lines: OrderLine[]` 自动生成子表外键 + 关系）。
- [x] `v0.4.0`：v1 友好语法预览（v1→v0 预处理器，project/module、name:type、自动主键、内联 one 关系；explain/generate/fmt 自动识别）。
- [x] `v0.3.4`：`qiy add module`（按 kind 插入 include）与 `qiy add feature`（overview/apiDocs/apiKeys，校验失败回滚）。
- [x] `v0.3.3`：`qiy fmt [--check]` 保留语义的空白规范化；设计理念页发布 v1 友好语法 RFC（解析器待实现）。
- [x] `v0.3.2`：`qiy add entity` / `qiy add field` 结构化增量建模（写入后全项目校验、失败回滚）。
- [x] `v0.3.1`：`qiy dev --watch` 模型变更防抖自动重生成/迁移，dev server 重载。
- [x] `v0.3.0`：CLI-first 项目工作流：`qiy create project` + `qiy check/generate/dev/test/build/preview`、模块化标准模板、CLI-first 快速开始与设计理念页；发布后二进制实测 `create project` 可用。
- [x] `v0.2.5`：API 文档页下载当前账号过滤后的 OpenAPI JSON（`<title>.openapi.json`）。
- [x] `v0.2.1`：补全官方 Agent Skill（router + 12 个 references），release + release-smoke 通过。

## 验证命令

```bash
bun run check
bun test
bun run docs:assets
bun run docs:build
```

发布相关见 `RELEASING.md`。

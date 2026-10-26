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
- [ ] 官方 bun/drizzle/elysia/refine-dev skill 纳入分发
- [ ] API docs：OpenAPI 下载、try-it、解释 verification 隐藏原因
- [ ] API Key：scopes、轮换、调用审计
- [ ] 本地密码限流/锁定、会话吊销
- [ ] `sum/avg ... group by` 聚合 + chart 扩展（area/stacked/scatter、颜色/图例、下钻）
- [ ] 字段类型扩展（Boolean/Email/URL/JSON/数组）与迁移策略
- [ ] 文档多语言：翻译核心页或隐藏未翻译语言入口
- [ ] 文档版本化（`/v0.2/` 归档）
- [ ] `qiy diff` / dry-run 预览、增量生成
- [ ] 每页 OG 图、llms 分段（llms-full 已 ~484KB）

## P2：长期

- [ ] Playwright E2E（登录、FK 批量、功能总览、API Key、Mermaid）+ 视觉回归
- [ ] a11y、bundle size 预算、负载测试
- [ ] lint/format、coverage 阈值、依赖扫描 / SBOM / CodeQL
- [ ] MCP server 与结构化 Agent API
- [ ] 生成器插件机制
- [ ] 软删除、租户 DSL、计算字段、DB view

## 已完成（审计后）

- [x] `database-smoke` fixture：`tenantId` 改为加在 auth userEntity；v0.2.1 CI 已绿。
- [x] JetBrains 插件发布：Gradle 固定 8.10.2；v0.2.1 `Publish editor plugins` 成功。
- [x] v0.2.0 发布后暴露的生成器 typecheck/return 接受度缺陷（无 `@code` 序列 fallback、docs 路由 Elysia 泛型、fixture 专属测试、集成模式 `bun test` 退出码、只读列表图标）。
- [x] `v0.2.2`：`qiy skill list/update/uninstall`（含 `--json`、本地修改保护、保留手写文件）；通过 dry-run → tag → Release 流程发布。
- [x] `v0.2.3`：`qiy explain` / `qiy schema`，机器可读模型摘要 + 已发布 JSON Schema。
- [x] `v0.2.1`：补全官方 Agent Skill（router + 12 个 references），release + release-smoke 通过。

## 验证命令

```bash
bun run check
bun test
bun run docs:assets
bun run docs:build
```

发布相关见 `RELEASING.md`。

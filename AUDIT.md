# Qiy 测试与发布审计

审计对象：Qiy **0.36.0**（tag `v0.36.0`）  
审计日期：2026-11-06  
执行者：Qiy maintainer session  
范围：仓库测试、类型检查、lint、覆盖率、文档构建、Agent Skill 打包、生成项目验收（三方言实库）、生成应用 E2E 与像素回归、负载、依赖漏洞与发布流水线。

## 结论

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 仓库单元/集成测试 | **449 pass / 0 fail**，70 文件 | `bun test` |
| 覆盖率 | **90.11% 函数 / 93.30% 行**（门槛 78/85） | `bun run coverage:check` |
| TypeScript | 干净（含重新生成的 `examples/self/admin`） | `bun run check` |
| Lint | **0 warning / 0 error** | `bun run lint` |
| 文档构建 | 成功 | `bun run docs:build` |
| 文档 bundle | 3144.3 KiB（预算 3906 KiB） | `bun run bundle:check` |
| 文档 E2E | **3 pass**（含无障碍检查） | `bun run e2e` |
| Agent Skill 打包 | 88 个文件 / 5 个 skill | `bun run skill:build` |
| 生成应用 E2E | **3 pass**：CRUD + 数值计算字段、软删除→回收站→恢复、只读 view 布局快照 | `bun run e2e:generated` |
| 像素视觉回归 | **2 pass**（亮/暗主题），Docker 固定浏览器 | `bun run e2e:visual` |
| 生成应用根测试 | `turbo run test` 通过，`TEMP`/`TMP` 指向不可写目录时仍通过 | `examples/self/admin` |
| 三方言运行时冒烟 | SQLite / PostgreSQL 16 / MySQL 8.4 各 21 项通过（登录、租户 claim 映射、计算字段、软删除审计/回收站/恢复、view 行过滤与 mask） | 本地 Docker 实库 |
| 依赖漏洞 | **0**（仓库与生成应用） | `bun audit` |

## 已验证能力

- 软删除：DELETE 审计 `<table>.deleted`；`?deleted=true` 回收站列表、`POST /:id/restore` 恢复并审计 `<table>.restored`；按 delete 权限授权；Web 回收站页。
- DB view：REST/GraphQL 继承源实体软删除、`scope`/`@tenant`、`restrict when` 行条件与 `restrict mask`；有行规则的源要求视图选择 `id`。
- 计算字段：Text 模板 + Integer/Decimal/Money 四则运算（null/除零 → null，Integer 向零取整）。
- 租户 DSL：`auth { claim <claim> <field>; }` 把 claim 映射到任意 users 列，本地/OTP/API Key 会话一致。
- 视觉回归：布局快照（DOM/文本）+ 像素快照（PNG，`mcr.microsoft.com/playwright` 容器渲染，跨宿主机一份基线）。
- 负载：按时长/预热、p95/p99/错误率/吞吐阈值、多机报告按原始样本合并；CI 追加数据库列表端点门禁。
- MCP server、HTTP Agent API、生成器插件、CSV 导入、DB view 迁移（三方言）。

## 已知边界（非发布阻塞）

1. **像素基线依赖 Docker**：`e2e:visual` 需要本机 Docker；Playwright 升级后需重新生成并审阅基线。像素快照覆盖新建表单的亮/暗主题，列表页由布局快照与 CRUD E2E 覆盖。
2. **容量结论**：仓库给出本地实测量级与多机合并工具，生产容量仍需在预发环境用真实数据库与网关复测。
3. **数据库直连**：view 的行规则在生成的 API 层执行；直接用 SQL 访问数据库视图不受这些规则约束。

## 复现命令

```bash
# 仓库
bun run check
bun run lint
bun test
bun run coverage:check
bun run docs:build
bun run bundle:check
bun run e2e
bun audit

# 生成应用
bun run e2e:generated
bun run e2e:visual          # 需要 Docker

# 生成项目
bun run tools/cli.ts generate <model.qiy> <dir> --sync
cd <dir> && bun install && bun run test
```

## 剩余 ROADMAP

| 优先级 | 项 |
| --- | --- |
| — | 无未完成 ROADMAP 项 |

v0.35.0 审计登记的 7 个产品边界已在 0.36.0 关闭，见 [ROADMAP](ROADMAP.md) 与 [CHANGELOG](CHANGELOG.md)。

## 审计判定

- 0.36.0 的质量门槛（测试、类型、lint、文档、生成应用、像素回归、发布验收）通过；
- 没有阻断发布的缺陷；
- 上面列出的边界是环境前提，不应表述为“全部完美完成”；
- 生产使用前仍需对目标数据库、认证 provider、对象存储和网关限流做真实环境验收。

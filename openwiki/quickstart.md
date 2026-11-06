# Qiy OpenWiki

## 项目是什么

Qiy 是面向数据中心业务应用的文本 DSL 与全栈应用生成框架。一份 `.qiy` 模型生成可二次开发的 TypeScript 工作区：

```text
.qiy 模型
  → Refine + React Router + Ant Design 管理后台
  → Bun + Elysia REST / GraphQL API
  → Drizzle schema 与 PostgreSQL / MySQL / SQLite 迁移
  → local / S3-compatible 文件存储
  → 测试、OpenWiki、Docker / Compose / Nginx / K8s 部署示例
```

解析、校验、IR 与生成全部由 Bun 实现，只有 `.qiy` 一个入口。产品介绍见 [README](../README.md)，用户文档见 [docs/](../docs/index.md)。

## 先读这些

- [架构](architecture.md)：编译链路、源码地图、生成应用结构与设计原则。
- [能力现状与待办](v3-status.md)：已交付能力、已知边界、0.37 删除项与下一步顺序。
- [CHANGELOG](../CHANGELOG.md)：每个版本的变化；[AUDIT](../AUDIT.md)：发布审计；[ROADMAP](../ROADMAP.md)：维护者待办。
- [RELEASING](../RELEASING.md)：发版流程；[CONTRIBUTING](../CONTRIBUTING.md)：贡献约定；[MAINTAINER_VERIFICATION](../MAINTAINER_VERIFICATION.md)：真实服务验收。

## 常用命令

```powershell
bun install
bun run check          # tsc --noEmit（大仓库需要 NODE_OPTIONS=--max-old-space-size=8192）
bun run lint           # oxlint --deny-warnings
bun test               # 根仓测试
bun run template:build # 修改 templates/admin 或 .agents/skills 后重建打包数据
bun run docs:assets    # 重建 llms*.txt、静态 Skill 与 OG 图
bun run docs:dev       # 本地预览文档站
bun run qiy generate examples/self/app.qiy examples/self/admin --sync
```

`tools/verify-*.ts` 会生成真实工作区并在里面安装依赖、跑测试；它们比 `bun test` 慢，按改动范围挑选运行。

## 示例

| 目录 | 用途 |
| --- | --- |
| `examples/self/` | 最完整的联调环境：混合认证、权限、ERP/SCM 模块、图表、i18n；`admin/` 是提交在仓库里的生成结果 |
| `examples/erpadmin/` | ERP 压力样例：订单库存事务（`workflow orderInventory`）、图表概览 |
| `examples/warehouse-admin/` | 多文件模块化最佳实践（文档 [best-practice-warehouse](../docs/guide/best-practice-warehouse.md) 逐段引用） |
| `examples/dataflow/`、`resource-policy/`、`scoped-sqlite/`、`realtime/`、`auth-providers/`、`filters/`、`themes/`、`multilingual/`、`plugin-matrix/` | 单一主题的回归模型 |

`examples/catalog/admin`、`erpadmin/admin`、`scoped-sqlite/admin` 是早期提交的生成快照，没有随生成器更新；以重新生成的结果为准。

## 从哪里开始改

- **语法**：`tools/qiy-project.ts`（解析、类型、序列化）→ `tools/database-ir.ts`（数据校验）→ 对应生成器 → `tests/` → `docs/dsl/` 与 `.agents/skills/qiy/references/`。
- **服务端行为**：`tools/generate-server.ts`；生成结果用 `tools/verify-*.ts` 在真实工作区验证。
- **前端行为**：`tools/generate-web.ts`；模板外壳在 `templates/admin/`（改完运行 `template:build`）。
- **CLI**：`tools/cli.ts` 与 `tools/commands/`。

## 项目级 Skill

仓库自带 Refine 参考 skill，供实现 Resource、DataProvider、路由、认证和表单时查阅：

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

使用 Qiy 可执行文件时，也可在目标项目根目录运行 `qiy skill install`，离线安装官方 Skill 到 `.agent/skills/qiy/`。生成应用同时包含 Agent 入口和独立 OpenWiki 文档，安装与使用见 [Agent Skill 指南](../docs/guide/agent-skill.md)。

该 Skill 面向 CLI 使用者，包含可直接照做的安装/生成/运行步骤、完整多文件仓储系统示例、`.qiy` 与 `include` 规则、现有 Bun workspace alias/Docker 集成、manifest 同步边界及生产检查；详细内容全部随 `.agents/skills/qiy/` 发布，不依赖仓库外文档。

现有 Bun 项目的集成别名属于 `.qiy` 文件的 `workspace` 块，不再使用 `qiy.admin.config.ts` 等额外用户配置文件。

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

1. 语法变化同时更新解析、序列化、错误信息、`docs/dsl/`、Skill references 与测试；删除语法时解析器要给出带迁移提示的错误。
2. 服务端是最终权威；新增能力先考虑权限、数据范围与审计，再考虑界面。
3. 三方言都要能生成；方言不支持时在生成前报错。
4. 提交前运行 `check`、`lint`、`bun test`；改了模板或 Skill 要先 `template:build`，改了文档要 `docs:assets`。
5. 发版按 [RELEASING](../RELEASING.md)，并同步 CHANGELOG、ROADMAP、AUDIT 与本目录。

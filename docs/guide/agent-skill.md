# Qiy Agent Skill

Qiy 提供一个**标准 Agent Skill**，供 Claude Code、Codex、Cursor 等 AI Agent 在生成/维护 Qiy 应用时按需加载。它不是给人类阅读的另一个文档站入口，而是一个遵循 [Agent Skills](https://agentskills.io) 约定的包：`SKILL.md` 负责检索与路由，`references/` 放模块化细节，`examples/` 放可运行示例。

Skill 随 Qiy 版本一起打包（`tools/qiy-skill.data.ts`），安装不依赖网络；文档站同时提供静态下载。

CLI 内置 5 个官方 skill：`qiy`（默认）、`refine-dev`、`bun`、`drizzle`、`elysia`。

## 安装（推荐）

```powershell
# 当前项目：<project>/.agents/skills/qiy
qiy skill install

# 其他官方 skill（默认安装到 <project>/.agents/skills/<name>）
qiy skill install refine-dev
qiy skill install bun
qiy skill install drizzle
qiy skill install elysia

# 一次安装全部官方 skill
qiy skill install --all

# 用户级：~/.agents/skills/<name>（适合希望全局加载 skill 的 Agent）
qiy skill install --global
qiy skill install drizzle --global

# 任意 Agent 的 skills 目录（--dir 是最终 skill 目录）
qiy skill install --dir .claude/skills/qiy
qiy skill install drizzle --dir .claude/skills/drizzle

# Qiy 升级后更新官方文件
qiy skill install --force

# 查看当前安装、修改状态与版本（--all 列出全部官方 skill）
qiy skill list
qiy skill list --all
qiy skill list --json

# 只更新已存在的安装（--force 覆盖本地修改）
qiy skill update
qiy skill update drizzle --force

# 卸载官方文件（手写文件会保留）
qiy skill uninstall
qiy skill uninstall drizzle
```

| 参数 | 作用 |
| --- | --- |
| 无参数 | 安装/更新/卸载 `qiy`，当前项目 `.agents/skills/qiy` |
| `<name>` | `refine-dev` / `bun` / `drizzle` / `elysia` / `qiy` |
| `--all` | `install`/`list` 覆盖全部 5 个官方 skill |
| `--global` | 安装/查看/更新 `~/.agents/skills/<name>` |
| `--dir <path>` | 指定**最终 skill 目录**（相对项目、绝对路径或 `~/...`） |
| `--force` | 强制覆盖被本地修改过的官方文件；无关文件始终保留 |
| `list --json` | 输出机器可读的安装位置、`upToDate`、modified/missing/unrelated 列表 |

行为说明：

- 重复执行相同版本的安装是幂等的；
- 官方文件被改动时默认拒绝覆盖并提示使用 `--force`（避免悄悄丢失自定义修改）；
- 旧版本安装目录 `.agent/skills/qiy` 会在检测到时原地更新，便于平滑升级；
- 安装的是所选 skill 的 `SKILL.md`、`references/`、`plugins/` 与 `examples/` 全部文件；`--all` 安装 5 个目录；
- 非 `qiy` skill 安装到 `.agents/skills/<name>`；不同 skill 互不覆盖。

安装后可用以下命令确认：

```powershell
Get-ChildItem .agents/skills/qiy -Recurse   # Windows
find .agents/skills/qiy -type f             # macOS/Linux
```

不同 Agent 的 skill 发现目录不同：支持项目级 `.agents/skills` 的 Agent 无需配置；Claude Code 使用 `--dir .claude/skills/qiy`，Codex 使用 `--dir ~/.codex/skills/qiy`，其他工具把其 skills 目录传给 `--dir` 即可。

## 下载静态资源

不想运行 CLI，或需要在隔离环境中使用，可以直接从文档站下载：

| 资源 | 地址 |
| --- | --- |
| Skill 入口（可直接查看） | `/skills/qiy/SKILL.md` |
| 完整 Skill 包（tar.gz） | `/skills/qiy-skill.tar.gz` |
| 全部参考文件 | `/skills/qiy/references/` |
| 可运行示例 | `/skills/qiy/examples/warehouse-admin/README.md` |
| LLM 文档索引 | `/llms.txt` |
| LLM 全文 | `/llms-full.txt` |

本地部署时地址为 `http://localhost:5173/...`；生产站点为 `https://ai-nodev.github.io/qiy/...`。解压到 Agent 的 skills 目录：

```bash
tar -xzf qiy-skill.tar.gz -C .agents/skills
# 得到 .agents/skills/qiy/SKILL.md 与 references/、examples/
```

静态包由文档构建脚本从 `.agents/skills/qiy` 生成（`bun run docs:assets`），因此与当前 Qiy 版本的 skill 内容一致。

## 结构（标准 skill 写法）

```text
qiy/
├── SKILL.md                         # 必需：frontmatter + 使用路由 + 安全规则
├── references/
│   ├── language-reference.md        # DSL 全量地图：词法、声明顺序、全部块/设置、注解矩阵
│   ├── modeling-and-generation.md   # 数据建模：include、字段、关系、索引、@code、显示模板、限制
│   ├── auth-permissions.md          # 认证模式、Provider、permission/verification/restrict/scope/pages
│   ├── refine-providers.md          # 生成后的 Refine Provider：DataProvider/AuthProvider/can()/Live/Audit
│   ├── dataflows-actions.md         # dataflow、action、批量、workflow、app.test.qiy
│   ├── ui-charts-i18n.md            # ui/主题、menu、dashboard、chart/chart panels、messages/i18n
│   ├── system-features.md           # features、系统页、OpenAPI 过滤、API Key 生命周期
│   ├── storage-realtime.md          # 文件存储/上传/清理、realtime/outbox 运维
│   ├── testing-deployment.md        # typecheck/test/build、迁移、部署、真实服务验收
│   ├── cli-workflows.md             # create/init/generate/--sync/doctor/skill install
│   ├── workspace-integration.md     # 现有 Bun 工程集成、alias、宿主适配、integration 契约
│   └── troubleshooting.md           # 跨模块错误对照表
└── examples/warehouse-admin/        # 完整可运行的多文件仓储 Admin
```

`SKILL.md` frontmatter 采用标准字段：

| 字段 | 说明 |
| --- | --- |
| `name` | `qiy`，小写、稳定 |
| `description` | 同时说明“做什么 + 何时使用”，包含 `.qiy`、`qiy create`、Refine、Bun、Elysia、Drizzle 等检索关键词 |
| `license` | MIT |
| `metadata.version` / `homepage` / `skill-docs` / `llms-txt` | 版本与检索入口，便于 Agent 定位最新文档 |

**渐进式加载**是这套 skill 的核心：Agent 先读 `SKILL.md`（很小，含“任务 → 读哪个 reference”表），只在需要时加载对应 reference；`examples/` 只在需要完整可运行模型时读取。这样检索成本低、上下文占用少，也不会把全部细节一次性塞进 prompt。

每个 reference 都是自包含的离线资料：包含可复制的语法片段、参数/默认值表、校验错误与安全边界，并在末尾给出对应文档站的权威链接；相对链接（包括指向 `SKILL.md` 与 `examples/` 的链接）由 `tests/ai-development.test.ts` 校验。

## 给 AI Agent 的使用约定

1. 先确认 `qiy --version` 与 `qiy --help`；skill 不安装 CLI。
2. 任何 `.qiy` 语法问题先读 `references/language-reference.md`（词法、声明顺序、全部块与注解）；建模细节读 `references/modeling-and-generation.md`。不要凭记忆发明 DSL 语法；权威语法见文档站 [DSL 参考](/dsl/overview)。
3. 生成后必须运行 typecheck、测试、build，再声称完成；`preview` 只用于本地验证。
4. `.qiy` 中不写任何密码/密钥；认证、存储、数据库凭据只通过环境变量与部署 secret 注入。
5. 修改已有生成项目时优先 `--sync`，尊重 `.qiy-generated.json` 的所有权边界；自定义逻辑放到不受管理目录（如 `extensions/`）。
6. 需要发现更多 Qiy 文档时，优先请求文档站的 [llms.txt](/llms.txt)（精选索引）或 [llms-full.txt](/llms-full.txt)（全文），而不是逐页爬取。
7. 不确定的错误先查 `references/troubleshooting.md`；它按校验/认证/命令/存储/CLI/部署分组给出精确错误串与修复方式。

## 更新与版本

- Skill 内容随 Qiy 发行版打包；升级 CLI 后运行 `qiy skill install --force` 即可同步。
- 本版本重构了参考文件：早期单一的 `references/production-boundaries.md` 扩展并更名为 `references/testing-deployment.md`，并新增 `language-reference.md`、`auth-permissions.md`、`refine-providers.md`、`dataflows-actions.md`、`ui-charts-i18n.md`、`system-features.md`、`storage-realtime.md`、`troubleshooting.md`；`modeling-and-generation.md`、`cli-workflows.md`、`workspace-integration.md` 同步补全 0.2 能力。安装只覆盖官方文件、不删除本地遗留文件，因此从旧版本升级后可手动删除旧的 `production-boundaries.md`。
- 文档站的静态 skill 与 `llms.txt` 在每次 `bun run docs:build` 时重新生成，不需要额外发布流水线或第三方 skill 市场。
- 发布版本以 Git tag（如 `vX.Y.Z`）与 GitHub Release 为准。

## 相关

- [CLI 与发布](/guide/cli)：`qiy skill install` 与其他命令。
- [完整语言参考](/dsl/overview)：skill 引用的 DSL 权威来源。
- [DSL 用法手册](/guide/dsl-cookbook)：按目标分组的可复制配方。
- [Refine Providers](/guide/refine-providers)：生成后如何扩展数据/认证/实时层。
- [示例仓库](/guide/best-practice-warehouse)：完整仓储 Admin 实践。

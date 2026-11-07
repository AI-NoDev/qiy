# Qiy Roadmap（维护者视角）

> 面向维护者与 AI Agent，不属于文档站用户内容；用户文档见 `docs/`。
> 当前版本：`1.0.0`（tag `v1.0.0`）。已交付能力与已知边界见 [openwiki/v3-status.md](openwiki/v3-status.md)，发布审计见 [AUDIT.md](AUDIT.md)。

## 状态图例

- `[x]` 已完成并验证
- `[~]` 进行中
- `[ ]` 未开始

每项完成后在此更新状态和验证方式。

## 待办

当前没有排队中的功能项。新需求按下面的格式加入：

```md
### 标题 `[ ]`

- 目标：用户能做到什么
- 验收：哪些测试 / 命令证明完成
```

## 发布门槛

- PR CI 覆盖类型检查、lint、测试、覆盖率门槛、文档构建与锚点检查、示例快照一致性、三方言 `database-smoke`、生成应用 E2E 与像素回归。
- 发布先跑 `Release Qiy CLI` dry run，通过后在同一提交上打不可变 tag（见 `RELEASING.md`）。
- 每个版本在 `CHANGELOG.md` 写一节发布说明，GitHub Release 正文由它生成。

## 验证命令

```bash
bun run check
bun run lint
bun test
bun run coverage:check
bun run docs:build
bun run examples:check
```

发布相关见 `RELEASING.md`。

# Qiy Agent Skill

Qiy 提供一个可公开安装的 Agent Skill，用于指导用户通过 `qiy` CLI 使用 `.qiy` 模型、生成 Admin、集成现有 Bun 项目并完成部署前检查。

## 安装

仓库公开后，可以使用 Vercel 的 skills CLI 从 GitHub 仓库安装：

```bash
npx skills add AI-NoDev/qiy --skill qiy
```

安装到当前项目时去掉 `-g`；需要用户级安装时使用：

```bash
npx skills add AI-NoDev/qiy --skill qiy -g
```

也可以直接打开 [skills.sh 上的 Qiy Skill](https://www.skills.sh/ai-nodev/qiy/qiy) 查看索引状态。`/docs/api` 是 skills.sh 的目录查询、搜索和审计 API，不是 Skill 上传接口。更新 Skill 的方式是提交并推送 `.agents/skills/qiy/` 中的文件，之后等待索引刷新，不需要额外部署服务。

## Skill 会做什么

- 帮用户选择 `qiy create`（独立 workspace）或 `qiy init`（现有 Bun workspace）；
- 指导 `.qiy`、`include`、Refine 资源、Elysia API、Drizzle schema 与部署配置的使用；
- 在 `qiy init --sync` 时解释 `.qiy-<name>.generated.json` manifest，避免覆盖宿主扩展；
- 区分类型检查/单元测试/本地 preview 与真实数据库、IdP、S3、并发和生产部署验收；
- 提醒用户现有 JWT、刷新 Cookie、API envelope、连接器授权和队列需要自己接入。

Skill 源码位于仓库的 `.agents/skills/qiy/`，包含主入口和按需加载的建模、workspace 集成、生产边界参考资料。

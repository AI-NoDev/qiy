# 按任务查找文档

不想从头读 DSL？从你要完成的任务进入。

## 开始与运行

| 任务 | 入口 |
| --- | --- |
| 安装 Qiy、创建第一个项目 | [快速开始](./getting-started) |
| 选择 project / check / diff / generate / dev 命令 | [CLI 参考](./cli) |
| 理解生成出来的目录和可修改边界 | [项目结构](./project-structure) |
| 把 Qiy 接入已有 Bun 项目 | [已有 Bun 项目](./existing-bun-project) |

## 建模

| 任务 | 入口 |
| --- | --- |
| 定义实体、字段、枚举、索引 | [entity 与 field](../dsl/entity) |
| 定义一对一 / 一对多 / 多对多 | [relation](../dsl/relation-index) |
| 生成业务编码、UUID | [自动生成值](../dsl/generated-values) |
| 软删除、租户隔离、计算字段 | [entity 与 field](../dsl/entity) |
| 声明只读 DB view（REST/GraphQL/Web） | [DB view](../dsl/views) |
| 校验模型并预览变更 | [CLI：check / diff / explain](./cli) |

## 权限与登录

| 任务 | 入口 |
| --- | --- |
| 配置本地账号或 OAuth/OIDC | [认证与登录](./auth) |
| 定义权限、角色、字段级可见性 | [权限 DSL](../dsl/permissions) |
| 保护 dataflow 或命令 | [dataflow](../dsl/dataflow) |

## 界面与数据

| 任务 | 入口 |
| --- | --- |
| 配置菜单、概览页图表 | [菜单与概览页](../guide/menu-dashboard) |
| 配置图表和 panel | [chart](../dsl/charts) |
| 配置多语言 messages | [i18n](../dsl/i18n) |
| 配置文件上传 | [storage](../dsl/storage) |
| 使用保存视图与列表筛选 | [API 指南](./api) |

## 集成与部署

| 任务 | 入口 |
| --- | --- |
| 数据流、审批、事务 | [dataflow](../dsl/dataflow) |
| 集成外部 HTTP API | [认证与登录](./auth) |
| 部署到 Docker / Kubernetes / Vercel | [部署](./deployment) |
| 配置 API 文档与 API Key | [API 文档与密钥](./api-docs-and-keys) |

## 质量与发布

| 任务 | 入口 |
| --- | --- |
| 运行 lint / TypeScript / 测试 | [Lint 与格式](./lint-format) |
| 压测生成应用 | [负载测试](./load-testing) |
| 检查生成应用布局/像素回归 | [视觉回归](./visual-regression) |
| 生成器插件追加文件 | [生成器插件](./plugins) |

## AI Agent

| 任务 | 入口 |
| --- | --- |
| 安装官方 Qiy Skill | [Agent Skill](./agent-skill) |
| 通过 MCP 让 Agent 调用 Qiy | [MCP server](./mcp) |
| 通过本机 HTTP API 调用 Qiy | [HTTP Agent API](./agent-api) |
| 让 Agent 读取机器可读文档 | [llms.txt](https://ai-nodev.github.io/qiy/llms.txt)、[llms-dsl.txt](https://ai-nodev.github.io/qiy/llms-dsl.txt)、[llms-guides.txt](https://ai-nodev.github.io/qiy/llms-guides.txt) |
| 校验 `qiy explain --json` | [CLI](./cli) |

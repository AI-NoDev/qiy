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
| 使用 v1 友好语法 | [v1 语法](./syntax-v1) |
| 生成业务编码、UUID | [自动生成值](../dsl/generated-values) |
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
| 配置菜单、页面、Dashboard | [菜单与 Dashboard](../dsl/enum-menu-dashboard) |
| 配置图表和 panel | [chart](../dsl/charts) |
| 配置多语言 messages | [i18n](../dsl/i18n) |
| 配置文件上传 | [storage](../dsl/storage) |
| 使用保存视图与列表筛选 | [API 指南](./api) |

## 集成与部署

| 任务 | 入口 |
| --- | --- |
| 数据流、审批、事务 | [dataflow](../dsl/dataflow) |
| 集成外部 HTTP API | [integration](./real-services) |
| 部署到 Docker / Kubernetes / Vercel | [部署](./deployment) |
| 配置 API 文档与 API Key | [API 文档与密钥](./api-docs-and-keys) |

## AI Agent

| 任务 | 入口 |
| --- | --- |
| 安装官方 Qiy Skill | [Agent Skill](./agent-skill) |
| 让 Agent 读取机器可读文档 | [llms.txt](https://ai-nodev.github.io/qiy/llms.txt)、[llms-full.txt](https://ai-nodev.github.io/qiy/llms-full.txt) |
| 校验 `qiy explain --json` | [CLI](./cli) |

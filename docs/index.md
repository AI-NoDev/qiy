---
layout: home

hero:
  name: Qiy
  text: 数据中心的全栈生成语言
  tagline: 一份业务模型，生成 Refine 管理后台、Bun + Elysia API、Drizzle 数据层与部署配置。
  image:
    light: /qiy-logo-light.svg
    dark: /qiy-logo-dark.svg
    alt: Qiy
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: Qiy 是什么
      link: /guide/what-is-qiy
    - theme: alt
      text: DSL 参考
      link: /dsl/overview

features:
  - title: 以数据为中心
    details: 用 entity、field、relation 描述业务数据，一次定义同时驱动数据库 schema、API、表单、列表与权限，消灭多端重复定义。
  - title: Bun-native 全栈
    details: 后端运行时是 Bun + Elysia，前端是 Refine + React Router，数据层是 Drizzle。Node 只用于前端生产构建，不存在 Node 常驻服务或 Next.js 服务器。
  - title: 多数据库
    details: 同一份模型面向 PostgreSQL、SQLite、MySQL 生成 Drizzle schema 与 migration，不支持的方言能力在生成前报错。
  - title: 复杂业务可演进
    details: V0 是数据与配置驱动的 Dashboard；V1 转向业务中心，支持联动、事务工作流与持久化幂等。
  - title: 认证与权限
    details: OIDC / OAuth2 / SSO 映射到用户模型，生成 AuthProvider、AccessControlProvider 与 Bearer JWT 守卫。
  - title: 跨平台 CLI
    details: Qiy 可打包为 Windows、Linux 与 macOS 独立可执行文件；在任何支持的系统上用同一条命令从 .qiy 生成完整应用。
  - title: 完整语言参考
    details: 从 application、entity/field、relation/index 到 permissions、dataflow、charts、i18n、annotations，逐项覆盖语法、默认值、校验、生成结果与进阶用法。
    link: /dsl/overview
    linkText: 打开 DSL 参考
  - title: 按目标分组的用法手册
    details: 数据建模、权限与多角色、业务自动化、概览图表、多语言主题、系统管理等可直接复制的配方与生成前检查清单。
    link: /guide/dsl-cookbook
    linkText: 查看用法手册
  - title: AI Agent 就绪
    details: 标准 Agent Skill（SKILL.md + 模块化 references + 可运行示例）可用 qiy skill install 安装到项目或全局；llms.txt / llms-full.txt 提供面向 Agent 的检索入口。
    link: /guide/agent-skill
    linkText: 安装 Agent Skill
---

<div class="qiy-home">

## 一份模型，一条流水线

```text
Qiy DSL / Qiy Model
        │
        ▼
   Qiy Semantic IR
        │
        ├── Refine + React Router 前端
        ├── Elysia + Bun REST / GraphQL API
        ├── Drizzle + 目标数据库 Schema
        ├── File Storage Provider
        ├── Deployment Targets
        ├── 权限与数据访问策略
        └── 测试、迁移和部署配置
```

## 最小示例

```ts
qiy v0;

application qiy-catalog-admin {
  database postgresql {
    extension pgvector;
  }

  entity products {
    field id UUID @id;
    field title Text;
    field price Decimal(12, 2);
    field embedding Vector(1536) @nullable @extension(pgvector);

    index products_embedding_hnsw hnsw(embedding vector_cosine_ops);
    index products_title_idx btree(title);
  }
}
```

```powershell
qiy generate examples/catalog/app.qiy out/catalog-admin
```

## 文档读者与范围

Qiy 文档面向三类读者：

- **Qiy 使用者**：从 [快速开始](/guide/getting-started)、[定义数据模型](/guide/data-modeling)、[仓储最佳实践](/guide/best-practice-warehouse) 入手，用 `.qiy` 生成并运行完整应用。
- **应用开发者**：查 [DSL 语言参考](/dsl/overview)、[用法手册](/guide/dsl-cookbook)、[Refine Providers](/guide/refine-providers)、[API 与数据源](/guide/api)、[认证与权限](/guide/auth)、[部署](/guide/deployment)，在生成物之上集成、扩展与发布。
- **AI Agent**：使用 [Agent Skill](/guide/agent-skill) 与仓库内 `tools/qiy-skill.data.ts` 的机器可读说明；生成物由 `.qiy-generated.json` 标记所有权，reference、生成器与测试是唯一事实来源。

文档只覆盖 Qiy DSL、CLI、生成物与生成应用的运行/集成/部署。仓库内与 Qiy 产品无关的工具（例如 `deploy/` 下的国内应用商店分发脚本）不属于本档范围。

</div>

<style>
.qiy-home :deep(h2) {
  margin: 48px 0 16px;
  border-top: none;
}
</style>

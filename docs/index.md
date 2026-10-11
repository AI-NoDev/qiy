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

</div>

<style>
.qiy-home :deep(h2) {
  margin: 48px 0 16px;
  border-top: none;
}
</style>

# Qiy 是什么

Qiy 是一个面向**数据中心业务应用**的领域语言与全栈应用框架。

它的目标不是重新实现 Flutter、KMP 或通用前端框架，而是让你写一份业务模型，然后持续生成并维护一整套可二次开发的应用：

- 基于 **Refine** 的管理后台与 Dashboard；
- 基于 **React Router Framework Mode** 的前端路由与页面模块；
- 基于 **Bun + Elysia** 的后端 API；
- 基于 **Drizzle** 的多数据库数据访问与迁移；
- 权限、校验、关联、审计与复杂业务流程；
- Docker、Kubernetes、Vercel、AWS 等部署目标。

## 核心思想

> **以数据为中心快速构建应用，以业务模型为中心演进复杂系统。**

## 它解决什么问题

传统后台项目中，同一份信息往往要在多个地方重复定义：

```text
数据库字段        → migration
API 参数         → 路由 / zod / openapi
表单字段         → 表单组件
列表列           → 表格配置
校验规则         → 前后端各写一遍
权限             → 按钮、路由、API 三处判断
类型             → 后端 schema、前端 props、API client 各写一遍
```

这些内容一旦不同步，就会出现「后端有字段、前端没展示」「表里有列、API 不返回」这类漂移。Qiy 把它们全部收敛到一份模型里：

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
        ├── OpenAPI / 类型定义
        └── 测试、迁移和部署配置
```

## 和 Django Admin 的关系

Django Admin 的价值在于「模型即后台」。Qiy 想做的是同一个方向的通用化，但把它从 Python/Django 生态里拿出来，变成一门可以生成到 **Web + API + 数据库** 三端的领域语言，并允许用户二次开发前端与后端代码，而不是生成一个黑盒管理页。

## 和 Prisma 的关系

Prisma 定义数据模型并生成数据库 client 与迁移；Qiy 的 schema 层与它相似，但生成目标是一个**完整的全栈应用**，包含 Refine 前端、Elysia API、权限、菜单、Dashboard、工作流和部署配置。

## 当前状态

Qiy 仍处于 V0 到 V1 的演进期：数据库建模、多方言生成、认证、菜单、Dashboard、枚举配色、文件存储、订单工作流和部署模板已经可用。官网只记录面向使用者的 `.qiy` 与 CLI 能力；实现层进度保留在仓库开发文档中。

## 下一步

- [快速开始](/guide/getting-started)：10 分钟生成第一个 Admin
- [定义数据模型](/guide/data-modeling)：实体、字段、索引、关系
- [DSL 参考](/dsl/overview)：完整的语法说明

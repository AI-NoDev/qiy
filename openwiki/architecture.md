# Qiy 架构与演进路线

## Agent Skill 分发

仓库提供 `.agents/skills/qiy/` 作为面向 Qiy CLI 用户的公开 Skill。它把 `.qiy` 建模、`qiy create` 与 `qiy init` 的选择、Bun workspace 集成、生成 manifest 的所有权边界和生产验收限制集中为可复用指导。Skill 不属于生成应用运行时依赖；通过公开 GitHub 仓库由 [skills.sh](https://www.skills.sh/ai-nodev/qiy/qiy) 索引，更新方式是提交并推送 Skill 文件。

## 现有 MPS 模块

### `qiy` language

`languages/qiy/qiy.mpl` 是主语言模块，namespace 为 `qiy`。它声明了 language aspect model，并注册了 namespace 为 `qiy.generator` 的 `main` generator。

主语言目前依赖 MPS 的 structure、editor、constraints、typesystem、behavior、model API 和 generator 相关语言，同时将 `qiy.runtime` 声明为运行时依赖。

### Aspect models

| 文件 | 当前作用 | 目标职责 |
| --- | --- | --- |
| `languages/qiy/models/qiy.structure.mps` | 已定义第一批数据库 Concept | 扩展 Resource 和业务 Concept |
| `languages/qiy/models/qiy.editor.mps` | 已有核心数据库投影编辑器 | 扩展编辑动作和表单配置 |
| `languages/qiy/models/qiy.constraints.mps` | 已有字段和索引非空约束 | 扩展 Scope、引用和结构约束 |
| `languages/qiy/models/qiy.typesystem.mps` | 已有 Vector、Decimal/Money 数值规则 | 扩展跨节点数据库 capability、关系和权限检查 |
| `languages/qiy/models/qiy.behavior.mps` | 空的 behavior aspect model | 定义模型查询、派生值和公共行为 |

### Generator、runtime 和 sandbox

- `languages/qiy/generator/templates/qiy.generator.templates@generator.mps` 包含最小 `CreateRootRule` mapping，输出独立的 `QiyGenerationMarker.java` 作为原生 generator 执行证据；它与 `.qiy` TextGen 输出并存，避免替换源根。业务生成仍通过 TextGen/Database IR 桥接。
- `languages/qiy.runtime/` 是一个没有实际 runtime model 的 solution，未来用于生成应用的公共运行时契约。
- `languages/qiy.sandbox/` 是一个未编译 Java 的 sandbox solution，引用 `qiy` 语言并保留字段规则的正反样例。
- `tools/database-ir.ts` 是 Database IR 校验切片，`tools/mps-database-ir.ts` 以持久化 registry 与 structure ID 映射 MPS Model → IR；MPS 入口已覆盖数据库、关系、前端 transport、Elysia 插件、storage、auth、scope、workflow、菜单、Dashboard 和字段可见性，并通过共享 Bun generators 输出完整 Turborepo。文本 DSL 新增的 Dataflow、Action、环境变量、消息字典和 UI 主题配置尚未全部进入 MPS 原生结构；MPS 内置 generator 仍只有最小执行 marker，业务文件继续由 TextGen/IR 桥接生成。

## 目标生成架构

```text
MPS Qiy Model
      ↓
语义分析与约束检查
      ↓
Qiy IR
  ├── Data IR
  ├── UI/Resource IR
  ├── API IR
  ├── Policy IR
  └── Business IR
      ↓
多目标生成
  ├── Refine + React Router 前端
  ├── Bun + Elysia API
  ├── Drizzle schema 与 queries
  ├── 目标方言 migration
  ├── OpenAPI
  └── 测试和部署配置
```

中间表示是重要边界。不要从每一个 MPS Concept 直接拼接某个目标文件，否则未来增加 API、业务命令或其他前端实现时会让 generator 互相耦合。

## 数据库方言

数据库模型先进入方言无关的 Database IR，再由 Drizzle Provider 生成目标 schema 和 migration。当前规划的 Drizzle 目标包括：

```text
PostgreSQL
MySQL
SQLite
MSSQL
CockroachDB
```

Supabase 作为 PostgreSQL 平台接入，不单独成为业务数据库抽象。Oracle 暂不标记为 Drizzle 原生目标；未来如需支持，应通过独立数据库 Provider 接入其他 ORM 或驱动。

目标数据库不支持的能力必须由能力矩阵在生成前报告，例如事务、关系、JSON、全文搜索和数据库枚举。不能把一个方言的 schema 直接当成所有数据库都兼容。

Database IR 还要保留字段的存储语义和物理优化信息。除基础标量外，V0 规划支持 `UUID`、`JSON/JSONB`、`Array`、`Decimal/Money`、带时区时间戳、`Binary/Blob`、数据库生成列、全文搜索字段、`Vector/Embedding`、软删除和乐观锁版本字段。金额必须使用明确精度的 Decimal；大文件默认进入 Storage Provider，而不是直接写入 Blob。

PostgreSQL 扩展采用显式声明，首批关注 `pgvector`、`pg_trgm`、`postgis` 和 `citext`。扩展需要声明方言、版本约束和缺失时的编译行为，生成器不应假设生产应用账号可以自动安装扩展。

```text
database {
    dialect postgres
    extensions [pgvector, pg_trgm]
}

entity Document {
    id: UUID primaryKey generated
    content: Text required
    embedding: Vector(1536) extension pgvector
}

index DocumentEmbeddingHnsw {
    on Document.embedding
    method hnsw
    opclass vector_cosine_ops
    options { m 16; efConstruction 64 }
}
```

Index IR 至少包括 B-tree、唯一索引、多列组合索引、Partial/Filtered index、表达式索引、GIN、GIST、BRIN、全文索引、`pgvector` HNSW 和 IVFFlat。Constraint IR 至少包括主键、外键、唯一、Check、Exclusion Constraint，以及 `onDelete`/`onUpdate` 策略。索引和约束名称必须稳定生成，migration 必须可重复生成，并能对重命名、删除和扩展启用产生明确 diff。

数据库优化配置属于 Database IR 或 deployment profile，至少覆盖连接池、查询/语句/锁超时、读副本、事务隔离、prepared statements、批量写入、缓存、游标分页、软删除默认过滤和乐观锁。物化视图、分区表和在线索引变更可以作为后续阶段能力，但不能阻塞通用 IR 扩展。

设计期能力矩阵如下，实际生成仍由具体 Provider、驱动版本和部署平台复核：

```text
feature              postgres          mysql             sqlite            mssql             cockroach
transactions         ✓                 ✓                 ✓                 ✓                 ✓
json                 ✓                 ✓                 json1/provider    ✓                 ✓
fullTextSearch       native/provider   native             FTS5/provider     native            provider
vector               pgvector          provider          provider          provider          provider
gin/gist              native            provider          —                 —                 provider
brin                  native            —                 —                 —                 —
hnsw                  pgvector          —                 —                 —                 provider
partialIndex          ✓                 provider          ✓                 filtered/provider provider
```

编译器必须把跨数据库能力放入通用 IR，把方言能力标记为显式 capability；不支持时默认报错，只有模型明确写出降级策略才允许生成近似实现。这样 PostgreSQL 的 schema 不会被错误地当成所有数据库的通用 schema。

## 目标前端结构

前端使用 Refine 的资源和 Provider 抽象，使用 React Router Framework Mode 管理 route modules。第一阶段使用 `ssr: false`，部署时只发布客户端构建结果，不部署 React Router Server。

目标结构：

```text
app/
├── root.tsx
├── routes.ts
├── routes/
│   ├── dashboard.tsx
│   ├── users.list.tsx
│   ├── users.create.tsx
│   ├── users.edit.tsx
│   └── orders.show.tsx
├── components/
├── layouts/
├── providers/
│   ├── data-provider.ts
│   ├── auth-provider.ts
│   ├── access-control.ts
│   └── notification-provider.ts
├── resources.gen.ts
└── api-client.gen.ts
```

Refine 层的稳定契约包括：

```text
resources
dataProvider
authProvider
accessControlProvider
routerProvider
useTable / useForm / useList / useOne
useCreate / useUpdate / useDelete / useSelect
```

生成页面必须通过 DataProvider 访问后端，不应在页面里硬编码数据库访问或散落 API URL。一个生成项目只能选择一个主要 UI adapter；当前实际生成和验收的是 Ant Design，其他 adapter 在完整实现前保持 fail-closed。

前端 UI 组件库和后端 API 传输层是独立配置：

```text
UI 适配器：只能选一个
    Ant Design（当前已实现）
    Material UI | Mantine | Chakra UI（规划中）

API 传输层：可以同时生成
    REST + GraphQL
```

### 认证、用户和外部身份

认证 Provider 与业务用户模型分离：

```text
AuthProvider
    负责登录、登出、会话和身份验证

User
    负责业务用户、状态、角色和资料

ExternalIdentity
    负责 provider + issuer + subject 到 User 的稳定映射
```

目标登录模式包括本地密码、邮箱验证码/OIDC、OAuth2 和企业 SSO。外部身份不能只依赖 email 绑定，稳定主键应优先使用 `issuer + subject` 或 Provider 的 OpenID 标识。

### 枚举、图标和展示元数据

有限枚举除了数据库值，还需要包含 `label`、`tagColor`、`icon` 和 `order`。这些元数据由前端生成 Select、Filter、Tag 和表格展示使用。

当前生成器使用 Ant Design Icons 的稳定组件名，并在生成前校验名称；DSL 保存图标名而不是序列化 React 组件。未来其他 UI adapter 需要各自的 Icon Provider 映射，不能直接混用当前 Ant Design 组件。

### 菜单、布局和默认配置

Qiy 需要同时支持：

- 从 Resource 自动生成默认菜单；
- 项目自定义多级菜单和菜单分组；
- 图标、顺序、路由、面包屑和页面标题；
- 按角色、权限、租户或特征开关控制可见性；
- 默认配置与项目覆盖配置；
- 表单、详情页和 Dashboard 区块分组。

前端组件库通过 adapter 选择，当前默认且唯一已实现的是 Ant Design。生成的 `app/ui/` 集中管理主题 key、light/dark/system 模式和 Header 切换；后续 adapter 必须覆盖相同 Refine Provider、Layout、CRUD、表单和认证契约后才能标记支持。

## 目标服务器结构

```text
server/
├── index.ts
├── api/
│   ├── rest/
│   │   ├── users.gen.ts
│   │   ├── products.gen.ts
│   │   ├── orders.gen.ts
│   │   └── commands.gen.ts
│   └── graphql/
│       ├── schema.gen.ts
│       ├── resolvers.gen.ts
│       └── context.gen.ts
├── application/
│   ├── users.service.gen.ts
│   ├── orders.service.gen.ts
│   └── commands.gen.ts
├── domain/
│   ├── users/
│   ├── products/
│   └── orders/
├── policies/
├── workflows/
└── db/
    ├── client.ts
    ├── schema.gen.ts
    ├── relations.gen.ts
    └── queries.gen.ts
```

服务器职责分层：

```text
api
    HTTP 路由、输入输出和错误格式

application
    用例、事务边界和命令编排

domain
    状态机、业务不变量和聚合逻辑

policies
    身份、角色、数据范围和操作权限

workflows
    审批、任务、事件和异步副作用

db
    Drizzle client、schema、relations 和查询
```

REST 和 GraphQL 都从同一个 Qiy API IR 生成：

```text
Qiy Entity / Resource / Business Model
              │
              ▼
          API IR
          ├── REST routes + OpenAPI
          └── GraphQL schema + resolvers
              │
              ▼
     Application Service → Domain → Drizzle
```

Elysia 同时承载 `/api/v1/*` 和 `/graphql`。GraphQL resolver 不应重新实现业务逻辑，而应调用和 REST 相同的 application/domain 服务。

后端可以同时开放 REST 与 GraphQL，但一个生成的前端应用默认只选择一种 DataProvider，避免同一页面混用两套缓存、分页和错误协议。

## 文件存储

文件存储采用类似 Django Storage 的 Provider 抽象，业务模型只声明 `File`、`Image` 或 `Attachment` 字段，不直接绑定本地磁盘或 AWS SDK。

```text
Qiy Storage API
    ├── local   → 本地文件系统
    ├── s3      → AWS S3 / MinIO / R2 / B2 等 S3-compatible 服务
    └── memory  → 测试临时存储
```

Storage Provider 至少需要提供 `save`、`open`、`exists`、`delete`、`copy`、`move`、`url`、`signedUrl` 和 `list`。生产环境的 private 文件默认采用签名 URL；多副本 Kubernetes 和 Serverless 不应使用 local storage 保存持久文件。

推荐上传流程：

```text
浏览器 → Elysia 获取上传授权
浏览器 → 直接上传 Storage Provider
浏览器 → Elysia 提交文件元数据
Elysia → 校验并写入 Attachment/File 记录
```

本地开发可以使用 Elysia multipart + local storage；生产大文件不默认穿过 API 服务。用户提供的文件名和路径必须经过规范化，不能直接拼接为磁盘路径。

## 部署 Targets

部署配置从应用模型独立出来，生成器根据选定 Target 输出文件：

```text
deploy/
├── docker/       Dockerfile、compose、dockerignore
├── kubernetes/   Deployment、Service、Ingress、HPA、配置模板
├── vercel/       vercel.json 和函数适配入口
├── aws/          ECS/Fargate、Lambda/API Gateway、IAM 模板
└── serverless/   其他 Serverless provider 配置
```

部署 Target 必须通过标准 `fetch(Request) → Response` 边界适配 Elysia；Serverless 不应依赖长驻进程或持久化本地文件系统。生成器只输出非敏感环境变量模板，不生成真实密码、Token、Access Key 或私钥。

V0 优先生成 Dockerfile、docker-compose 和 local/S3 配置；Kubernetes、Vercel、AWS ECS/Lambda 和其他 Serverless 目标逐步增加。

V0 可以生成资源 CRUD；V1 的跨表写操作应生成业务命令，例如：

```text
POST /api/v1/orders/:id/submit
POST /api/v1/orders/:id/approve
POST /api/v1/orders/:id/cancel
```

命令由服务端负责事务、权限、状态转换、审计和幂等，不能依赖前端连续调用多个表的更新接口来维持一致性。

## V0：数据中心 Dashboard

V0 的最小闭环：

```text
Entity
  → Drizzle schema
  → SQL migration
  → Elysia CRUD API
  → Refine Resource
  → List / Show / Create / Edit
```

优先支持：

- 标量字段、枚举、主键、唯一约束和默认值；
- 一对一、一对多和多对多关系；
- 列表列、搜索、排序、分页和过滤；
- 表单字段、校验和关联选择器；
- 基础 RBAC 和资源级权限；
- Drizzle 支持的目标数据库连接；
- OpenAPI、类型和基本测试生成。

V0 的第一个建议示例是 `Product Catalog`，第二个建议示例是 `Helpdesk`。这两个示例足以覆盖常见资源、关联、过滤和权限，而不会过早进入完整 ERP 的复杂度。

## V2：Dashboard 概览

概览页放在 V2，避免在 V0 将资源 CRUD 和自由排版混在一起。V2 的 Dashboard 由数据查询驱动的区块组成：

```text
KPI
Trend
Chart
Ranking
AggregateTable
RecentActivity
```

布局需要支持多列栅格、响应式、折叠分组、默认模板和项目自定义配置；区块的权限、租户和数据范围仍然复用统一的数据访问模型。

## V1：业务中心的复杂系统

V1 增加以下模型：

```text
StateMachine
State
Transition
Command
Rule
Policy
Transaction
DomainEvent
EventHandler
Job
Audit
Idempotency
Concurrency
```

复杂 ERP 场景需要把“跨表联动”拆成明确的业务命令：

```text
submitOrder
  ├── 校验订单项
  ├── 检查客户额度
  ├── 计算订单金额
  ├── 预占库存
  ├── 修改订单状态
  ├── 写入审计
  └── 发布 OrderSubmitted
```

强一致步骤进入数据库事务；通知、同步第三方、生成发货任务等副作用通过事件或任务处理。前端可以由模型生成字段联动和可用按钮，但服务端命令是最终规则来源。

## 部署边界

推荐生产拓扑：

```text
Browser
  ├── /api/v1/* → Nginx → Elysia/Bun → Drizzle → 目标数据库
  └── /*        → Nginx → React Router build/client
```

前端使用真实路径而不是 HashRouter，因此 Nginx 必须将非资源路径 fallback 到 `index.html`，同时 `/api/*` 必须先匹配并保持 JSON 错误响应。

需要区分两个“纯前端”要求：

1. **部署纯前端**：V0 目标，运行时只部署 `build/client`，不运行 React Router Server。
2. **运行时 Bun，构建期 Node 回退**：生成应用的 API 与静态托管运行时为 Bun + Elysia；Linux 上 React Router 的 SPA 构建会经过其 SSR 中间阶段，而 Bun 解析 `react-dom/server.bun.js` 时仍会失败，因此 `apps/web` 的生产构建显式使用 Node.js 20+。Dockerfile 已隔离 Node 构建阶段，最终运行镜像没有 Node 服务或 Node 子进程。

不能把“运行时不需要 Node 服务”误认为“构建阶段完全不需要 Node/Vite”；用户文档和发布验收都必须明确这一边界。

## 下一步实现顺序

下列是早期架构路线，不能作为当前完成度清单。外部 Bun 生成器已生成 PostgreSQL Drizzle schema/FK、Elysia REST/GraphQL、Refine + Ant Design SPA，并在 ERP 示例通过类型检查、测试、构建和迁移生成。MPS 内置 generator、认证/授权、复杂业务事务、存储和多数据库仍未完成；逐项验收状态见 [V3 状态与规划](v3-status.md)。

1. 在 `qiy.structure.mps` 中定义 `Application`、`Entity`、`Field` 和 `Enum`。
2. 增加 editor，使 sandbox 可以录入一个最小 Product 模型。
3. 增加基础类型映射和约束。
4. 生成 Drizzle schema 和目标方言 migration。
5. 生成 Elysia CRUD API。
6. 生成 Refine resource、路由和四类页面。
7. 在 `qiy.sandbox` 中建立 Product Catalog 回归模型。
8. 再实现 Relation、Permission 和 V0 的过滤/排序。

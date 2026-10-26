# 项目结构

Qiy 项目由**模型**和**生成物**两部分组成。模型由你和 AI Agent 维护，生成物由 Qiy 管理。

## 项目根（`qiy create project`）

```text
shop/
├── qiy.project.json       # 项目名、模型入口、生成目录
├── model/
│   ├── app.qiy            # 入口：database + include
│   └── modules/           # 按业务域拆分的模型片段
│       ├── 10-catalog.qiy
│       ├── 20-relations.qiy
│       ├── 30-ui.qiy
│       ├── 40-permissions.qiy   # 示例，默认注释
│       ├── 50-dataflows.qiy     # 示例，默认注释
│       └── 60-messages.qiy      # 示例，默认注释
├── admin/                 # 生成工作区（由 qiy generate 管理）
├── README.md
└── .gitignore
```

- 所有 `qiy` 项目命令从 `qiy.project.json` 读取模型与输出路径；
- 可以在子目录运行，CLI 会向上查找项目根；
- `admin/` 是生成物，手写扩展放在 `admin/apps/*/src/extensions/` 与 `admin/apps/web/app/extensions/`，`qiy generate --sync` 不会覆盖它们。

## 生成的工作区（`admin/`）

`admin/` 是一个可二次开发的 **Turborepo + Bun workspace**，不是压缩包式的黑盒产物。

```text
admin/
├── apps/
│   ├── server/                 # Bun + Elysia API
│   │   ├── src/
│   │   │   ├── db.ts           # Drizzle 连接
│   │   │   ├── contracts/      # Zod 校验与类型契约
│   │   │   ├── repositories/   # 数据访问层
│   │   │   ├── services/       # 业务逻辑
│   │   │   ├── routes/         # REST / GraphQL 路由
│   │   │   ├── auth/           # OIDC 守卫与令牌校验
│   │   │   ├── storage/        # local / S3 存储适配
│   │   │   └── http.ts
│   │   ├── drizzle.config.ts
│   │   └── tests/
│   └── web/                    # Refine + React Router SPA
│       ├── app/
│       │   ├── routes/         # list / create / edit / show / login
│       │   ├── components/     # 动态表单、业务 Action、审计等通用组件
│       │   ├── hooks/          # 列可见性、文件下载等
│       │   ├── providers/      # AuditLog 等 Refine Provider
│       │   ├── ui/             # UI adapter、主题 key、明暗模式与 Header 控件
│       │   ├── extensions/     # Qiy sync 不覆盖的手写业务页面
│       │   ├── data-provider.ts
│       │   └── root.tsx
│       └── tests/
├── deploy/
│   ├── kubernetes/
│   ├── nginx.conf
│   └── vercel.json
├── Dockerfile
├── docker-compose.yml
├── turbo.json
└── package.json
```

## 为什么是 monorepo

- `apps/server` 与 `apps/web` 可以独立安装、运行和发布；
- 类型契约可以在共享包里复用的同时保持 server / web 的职责边界；
- Turborepo 提供统一的 `typecheck`、`test`、`build`、`preview` 编排；
- Dockerfile 与 Kubernetes 清单直接针对这套结构，不需要二次改造。

## 二次开发约定

独立生成项目的 `.qiy-generated.json` 记录 Qiy 拥有的文件；其中包含模型生成的 schema、路由、DataProvider、资源页面以及部分共享组件。`--sync` 会重写这些登记文件以保持模型一致性，因此不要直接修改它们后期待自动合并。

将定制内容放到未登记的扩展文件，并从生成应用的插件、hooks 或领域层显式接入；例如 `apps/server/src/integrations/`、`apps/server/src/host-extension.ts`、`apps/web/app/plugins/<name>.ts`、`apps/web/app/hooks/<name>.ts`。要将生成后台挂到已有 Bun 项目而非新建根仓，请使用[集成现有 Bun 项目](./existing-bun-project)。

`.qiy-generated.json` 记录了本次生成拥有的文件清单，配合 `--sync` 可以安全地同步模型变化：

```powershell
bun run tools/generate-app.ts examples/erpadmin/app.qiy out/erpadmin --sync
```

`--sync` 会写入新文件、删除被模型移除的登记文件，但不会触碰不在 manifest 中的自定义文件。

## 前后端如何连接

前端是**纯前端模式**的 Refine SPA，通过 `/api/v1/*`（REST）或 `/graphql`（GraphQL）访问后端。生产部署时把 `apps/web/build/client` 的静态产物交给 server 或 nginx/Nginx 反向代理托管，路由回退到 `index.html`，API 前缀转发到 Elysia。示例配置见 `deploy/nginx.conf`。

当前已验收的 UI adapter 是 Ant Design。`apps/web/app/ui/` 负责品牌主题、light/dark/system 模式与持久化；资源页面优先使用 `@refinedev/antd` 官方页面壳和按钮，再使用 Ant Design 原生组件补足动态过滤、批量操作和业务 Action。其他 UI adapter 在完整实现前会被生成器拒绝。

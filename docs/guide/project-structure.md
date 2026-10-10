# 生成的项目结构

Qiy 生成的是一个可二次开发的 **Turborepo + Bun workspace**，不是压缩包式的黑盒产物。

```text
my-admin/
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
│       │   ├── components/     # layout、表单等通用组件
│       │   ├── hooks/          # 列可见性、文件下载等
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

生成器只拥有它能保证一致性的文件：模型、契约、路由、schema、配置。业务逻辑与 UI 组件放在 `services/`、`components/`、`hooks/` 中，重生成时不会被覆盖。

`.qiy-generated.json` 记录了本次生成拥有的文件清单，配合 `--sync` 可以安全地同步模型变化：

```powershell
bun run tools/generate-app.ts examples/erpadmin/app.qiy out/erpadmin --sync
```

--sync 会写入新文件、删除被模型移除的过时文件，但不会触碰你自己新增的文件。

## 前后端如何连接

前端是**纯前端模式**的 Refine SPA，通过 `/api/v1/*`（REST）或 `/graphql`（GraphQL）访问后端。生产部署时把 `apps/web/build/client` 的静态产物交给 server 或 nginx/Nginx 反向代理托管，路由回退到 `index.html`，API 前缀转发到 Elysia。示例配置见 `deploy/nginx.conf`。

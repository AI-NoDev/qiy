# 部署

## GitHub Pages 文档站

仓库已提供 [GitHub Actions workflow](../../.github/workflows/deploy-docs.yml)，推送到 `main` 时会构建 `docs/` 并发布 VitePress 静态站点。

首次启用时，在 GitHub 仓库的 **Settings → Pages** 中把 Source 选择为 **GitHub Actions**。项目页默认发布到：

```text
https://<owner>.github.io/<repository>/
```

工作流会自动把 VitePress 的 `base` 设置为仓库名；本地预览仍使用根路径。发布前可先执行：

```powershell
bun run docs:build
```

每个生成包都带有 `Dockerfile`、`docker-compose.yml` 与 `deploy/` 目录。

## Docker

独立 `create` 项目的默认路径是 `apps/server/.env.production`。通过 `init` 集成到已有 Bun 项目时，路径使用 `.qiy` 中配置的 server alias，例如 `apps/ops-api/.env.production`。填写数据库、认证和存储配置；Compose 会加载对应 alias 下的生产环境文件，不依赖项目根目录 `.env`，也不会覆盖宿主项目的任何 `.env*` 文件。

```powershell
cd out/erpadmin
docker compose build
docker compose up
```

生产环境数据库迁移：

```powershell
bun run --cwd apps/<server-alias> db:migrate:production
```

## Kubernetes

```text
deploy/kubernetes/
|-- deployment.yaml
|-- service.yaml
|-- persistent-volume-claim.yaml
-- secret.example.yaml
```

## Nginx 反向代理

前端是纯 SPA，不使用 HashRouter，服务器需要把未知路径回退到 `index.html`，同时把 API 前缀转发给 Elysia：

```nginx
location /api/     { proxy_pass http://server:3000; }
location /graphql { proxy_pass http://server:3000; }
location /         { try_files $uri $uri/ /index.html; }
```

## 第三方平台

| 目标 | 文件 |
| --- | --- |
| Vercel | `deploy/vercel.json` |
| AWS | 参考 Dockerfile 配合 ECR/ECS |
| 任意 Bun 平台 | `bun run build` 产物加 `bun run preview` |

:::warning 预览不等于生产

`bun run preview` 只绑定本机回环并使用内存仓库，它用于本地验收，不可公开部署。

:::

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

## 迁移、并发与回滚

`db:migrate` 与 `db:migrate:production` 现在运行生成的 `src/db-migrate.ts`，而不只是调用 Drizzle CLI：

1. **并发保护**：PostgreSQL 用专用单连接会话持有 `pg_advisory_lock`，MySQL 用专用连接执行 `GET_LOCK('qiy_migrate', 60)`，因此多副本同时启动时只有一个真正执行迁移，另一个等待后复用同一结果。SQLite 是单写者文件数据库，没有跨进程锁，**必须只让一个进程执行迁移**（脚本会打印这条提示）。
2. **迁移后校验**：迁移完成后立即用与 `db:check` 相同的对比逻辑检查实际结构与 `src/schema.ts`。迁移"跑完了"不等于结构正确（SQL 被手工改过、只应用了一部分、或数据库比代码旧都会在这里暴露），不一致时退出码为 1 并打印 `drift: ...`。
3. **输出账本**：打印迁移前后的已应用数量。

回滚是**受审查的操作**，Qiy 只提供机制与安全约束，不猜测逆向 SQL（数据破坏性变更无法安全自动推导）：

```powershell
# 1. 为要回滚的迁移编写并审查逆向 SQL
#    drizzle/down/<tag>.sql（tag 见 drizzle/meta/_journal.json）
#    多条语句用 drizzle 的语句分隔符隔开：--> statement-breakpoint
# 2. 执行
bun run --cwd apps/<server-alias> db:rollback -- --confirm
```

约束与行为：

- 不加 `--confirm` 直接拒绝执行。
- 最新已应用迁移缺少对应的 `drizzle/down/<tag>.sql` 时拒绝执行，并打印**需要创建的完整路径**。
- 逆向 SQL 在单个事务里执行，并删除该迁移的记录行；任一步失败则整体回滚。
- 回滚后需要同步撤回 `src/schema.ts` 与生成代码中对应的改动，再用 `db:check` 确认。

## 逻辑备份与恢复

生成包包含不依赖外部客户端的逻辑备份：`db:backup` 把每张表按外键依赖顺序导出为单个 JSON 文件，`db:restore` 用它覆盖恢复。

```powershell
bun run --cwd apps/<server-alias> db:backup                      # 写入 backups/qiy-<时间戳>.json
bun run --cwd apps/<server-alias> db:restore -- --file backups/qiy-....json --confirm
```

- `db:backup` 只读取数据；`--out-dir` 可改目录，`--out` 可指定文件名。写完按 `QIY_BACKUP_RETENTION`（默认 7，`0` 表示不清理，非法值 fail-closed）保留最新的若干个 `qiy-*.json`，其余删除并报告删除数量。
- `db:restore` **必须**同时提供 `--file` 与 `--confirm`；备份文件的 `dialect` 与当前项目不一致、备份的表集合与 `src/schema.ts` 不一致（缺表/多表）都会拒绝执行，避免把不匹配的数据写进库。
- 恢复在单个事务内先按依赖倒序清空、再按依赖正序插入（先被引用的表先写），失败整体回滚。因此它是"替换"而不是"追加"。
- `createdAt`/`Date`、二进制列与 bigint 会被打上 `$qiy` 标记以便无损往返；`api/tests/backup-codec.test.ts` 覆盖这些编码。

适用边界：这是**逻辑**备份，按行导出并逐行插入，适合中小数据量与迁移前的快速还原点，**不适合作大库或灾备**，也不含 DDL（结构由迁移管理）。大库请使用 `pg_dump`/`mysqldump` 或存储层快照。恢复要求 `src/schema.ts` 已迁移到与备份一致的结构。

`backups/` 已在生成包的 `.gitignore` 中忽略——备份包含生产数据，不要提交。

## 数据库漂移检查
生成包包含 `db:check`，把**实际数据库结构**与 `src/schema.ts` 的期望结构对比，并报告迁移是否落后：

```powershell
bun run --cwd apps/<server-alias> db:check
```

对比项：表是否存在、列是否存在（缺失列报错，多余的列只警告）、`NULL`/`NOT NULL` 是否一致、主键列是否一致，以及列类型类别（text/integer/bigint/decimal/boolean/timestamp/date/time/json/uuid/vector/binary）。类型只在双方都能确定映射时比较，无法确定的列输出 `unverified` 而**不会**误报漂移；SQLite 的类型亲和性与 MySQL 的 `tinyint(1)` 布尔等已知存储等价关系被显式容忍。

同时输出 `migrations applied X/Y`：`Y` 来自 `drizzle/meta/_journal.json`，`X` 来自数据库的迁移记录表（表不存在按 0 计）。`Y > X` 报错（有未应用的迁移），`X > Y` 只警告（数据库比当前代码新）。

退出码为 0 表示没有错误（警告不算失败），有漂移或未应用迁移时退出 1 并逐条打印 `drift: <表>.<列>: ...`。适合放在发布前检查或部署后的健康校验里；它只读数据库结构，不修改数据，也不替代迁移本身。

```powershell
# 部署后确认数据库与当前代码一致
bun run --cwd apps/<server-alias> db:check; if ($LASTEXITCODE -ne 0) { throw "schema drift detected" }
```

## Kubernetes

```text
deploy/kubernetes/
|-- deployment.yaml
|-- service.yaml
|-- persistent-volume-claim.yaml
-- secret.example.yaml
```

## Realtime 监控

声明 REST Realtime 后还会生成 ServiceMonitor、PrometheusRule 和 Grafana Dashboard。配置应用 Secret 中的 `QIY_REALTIME_METRICS_TOKEN`，并让 Prometheus Operator 的 selector 选中生成对象；该凭据只允许读取 Prometheus 文本指标。安装要求、凭据轮换和当前验收边界见 [Realtime 监控](../dsl/realtime.md#prometheus-operator-与-grafana)。

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
| 常规主机 | Node.js 20+ 执行 `bun run build`，Bun 执行 `bun run preview` |

:::warning 预览不等于生产

`bun run preview` 只绑定本机回环并使用内存仓库，它用于本地验收，不可公开部署。

:::

# Deployment

Every generated workspace ships with a `Dockerfile`, `docker-compose.yml` and a `deploy/` directory (nginx, Kubernetes manifests, Vercel config). The API is one Bun process; the admin is a static single-page app.

## Docker

Fill in `apps/server/.env.production` (database, auth secret, storage, delivery settings), then:

```bash
docker compose build
docker compose up
```

Compose loads the server's production env file; it never reads or overwrites a root `.env`. When Qiy was integrated into an existing Bun project with `qiy init`, the path uses the configured server alias, for example `apps/ops-api/.env.production`.

## Migrations

```bash
bun run --cwd apps/server db:generate             # create a migration from the schema, then review it
bun run --cwd apps/server db:migrate:production   # apply it in production
bun run --cwd apps/server db:check                # compare the live database with the schema
```

- `db:migrate` takes a lock (`pg_advisory_lock` on PostgreSQL, `GET_LOCK` on MySQL), so replicas starting together apply each migration once. SQLite has no cross-process lock: run migrations from one process only.
- After migrating, the script compares the live structure with `src/schema.ts` and exits 1 on drift.
- `db:check` reports missing tables and columns, nullability, primary keys, column type families and unapplied migrations. It reads structure only; use it after deploys.

Rollback is a reviewed operation: write the reverse SQL in `drizzle/down/<tag>.sql`, then run `bun run db:rollback -- --confirm`. It refuses to run without the file or the flag, and runs in one transaction.

## Backups

```bash
bun run --cwd apps/server db:backup
bun run --cwd apps/server db:restore -- --file backups/qiy-<timestamp>.json --confirm
```

The logical backup exports every table to one JSON file in dependency order and keeps the newest `QIY_BACKUP_RETENTION` files (default 7). Restore replaces all rows in one transaction and refuses a backup from another dialect or schema. It suits small and medium databases and pre-migration restore points; use `pg_dump`, `mysqldump` or storage snapshots for large databases and disaster recovery. `backups/` is git-ignored because it holds production data.

## Reverse proxy

The admin uses browser routing, so unknown paths fall back to `index.html`, and the API prefixes go to the server:

```nginx
location /api/     { proxy_pass http://server:3000; }
location /graphql { proxy_pass http://server:3000; }
location /         { try_files $uri $uri/ /index.html; }
```

Realtime uses server-sent events on `/api/v1/realtime/stream` and `/graphql/subscribe`. The generated nginx config needs no change; other proxies and CDNs must disable response buffering and allow reads longer than the 25-second keep-alive on those paths.

## Background work

- **Deliveries.** With `webhook` or `notification` declarations, every server instance runs a delivery worker; rows are claimed before sending, so replicas never send the same delivery twice. Set `QIY_DELIVERY_DISABLED=1` on instances that should not send. Set each webhook's URL and secret variables and the provider's variables (`QIY_SMTP_URL`, `QIY_RESEND_API_KEY`, or `QIY_NOTIFY_WEBHOOK_URL` and `QIY_NOTIFY_WEBHOOK_SECRET`).
- **Cron.** Set `QIY_CRON_ENABLED=1`. All replicas may enable it; a lease table runs each tick once, provided the clocks are synchronized.

## Production checklist

- `QIY_AUTH_SECRET` has at least 32 characters and `DATABASE_URL` points at the target database.
- Migrations are applied, `db:check` passes and `/api/v1/health` returns 200.
- The first administrator exists (`bun run auth:bootstrap-admin`).
- Unauthenticated requests get 401 and wrong credentials get 4xx.
- File storage (local or S3) reads and writes, and attachment downloads work.
- With webhooks or notifications, `qiy_deliveries` has no long-lived `pending` or `failed` rows.
- The proxy forwards `/api/v1/*` and `/graphql`, and other paths fall back to `index.html`.

`bun run preview` binds to loopback and uses in-memory repositories. It is for local acceptance only, never a deployment target.

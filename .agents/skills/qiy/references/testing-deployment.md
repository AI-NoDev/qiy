# Testing, acceptance and deployment

Use this file before claiming a generated project is usable or deploying it. It lists the generated scripts, what the generated test suites actually prove, migration/rollback/backup operations, deployment requirements, the real-service acceptance commands, and the common failure modes.

Canonical reference: https://ai-nodev.github.io/qiy/guide/deployment (`/guide/real-services`, `/guide/cli`)

## Contents

- [Generated workspace and scripts](#generated-workspace-and-scripts)
- [Verification pipeline](#verification-pipeline)
- [What generated tests cover](#what-generated-tests-cover)
- [Migrations, drift and rollback](#migrations-drift-and-rollback)
- [Backup and restore](#backup-and-restore)
- [Docker, Kubernetes and reverse proxies](#docker-kubernetes-and-reverse-proxies)
- [Production environment requirements](#production-environment-requirements)
- [Real-service acceptance](#real-service-acceptance)
- [Production verification checklist](#production-verification-checklist)
- [Common failure modes](#common-failure-modes)
- [Release acceptance (maintainers)](#release-acceptance-maintainers)

## Generated workspace and scripts

Standalone `create`/`generate` produces a Turborepo + Bun workspace; `init` mounts the two packages into an existing Bun workspace under the configured aliases.

```text
my-admin/
├── apps/
│   ├── server/   bun + Elysia API, Drizzle schema/repositories/services/routes/auth/storage, tests/
│   └── web/      Refine + React Router SPA, app/{routes,components,hooks,providers,ui,extensions}, tests/
├── deploy/       nginx.conf, vercel.json, kubernetes/{deployment,service,pvc,secret.example}, observability/grafana
├── Dockerfile, docker-compose.yml, turbo.json, package.json
└── .qiy-generated.json
```

Root scripts (exact names from a generated project):

| Script | Command | Purpose |
| --- | --- | --- |
| `dev` | `turbo run dev` | Run server + web together |
| `dev:server` / `dev:web` | per-package dev | Run one side |
| `build` | `turbo run build` | Build both packages |
| `preview` | server preview | Local demo server (loopback only, in-memory repository) |
| `test` | `turbo run test` | Server + web tests |
| `typecheck` | `turbo run typecheck` | `tsc --noEmit` in both packages |
| `db:generate` / `db:migrate` | Drizzle generate + generated migration runner | Local schema/migration |
| `db:migrate:production` | generated runner with `.env.production` | Production migration with locking |

Server-package scripts: `dev`, `start`, `preview`, `test`, `typecheck`, `db:generate`, `db:migrate`, `db:migrate:production`, `db:rollback`, `db:backup`, `db:restore`, `db:check`, `attachments:cleanup`, `attachments:orphans`, `auth:bootstrap-admin`, `auth:set-password`, `realtime:admin`. Web-package scripts: `dev`, `build`, `typecheck`, `test`.

`preview` binds only to loopback and keeps data in memory. It is a local demo, never a deployment target.

## Verification pipeline

Run in this order inside the generated workspace:

```bash
bun install
bun run typecheck
bun run test
bun run build
# optional local smoke
bun run preview
```

Then, before any deployment claim: apply migrations to a real database, start the server with production-like env, probe `/api/v1/health`, verify anonymous requests are 401, and exercise one list/create/update/delete plus one command and one file upload with real credentials. A green `typecheck`/`test`/`build` proves structure and generated behavior, not your database, IdP, S3 bucket, backups, concurrency or browser flows.

| Check | Proves | Does not prove |
| --- | --- | --- |
| `qiy create` / `qiy init` succeeds | Model and packages were generated | Runtime, database, identity, storage or business correctness |
| `bun run typecheck` | Generated TypeScript is structurally valid | Transactions, authorization, real queries |
| `bun test` | Included tests pass in their configured environment | Real PostgreSQL/MySQL, IdP, S3, concurrency, rollback |
| `bun run build` | The build pipeline completes | Production health |
| `preview` opens | The local demo path works | Public exposure, durable data, secrets, multi-replica safety |
| Generated scenario tests | Dataflow authorization/isolation after principal injection | Real login/token verification, browser flows |

## What generated tests cover

The generated `apps/server/tests/` and `apps/web/tests/` suites scale with the model and enabled features. Typical coverage (file names vary by model):

- Server: per-resource CRUD/contract tests, pagination, filtering, distribution/trend/aggregate, GraphQL schema and queries, `dataflow.test.ts` (success, permission denial, idempotent replay/conflict, rollback, audit, outbox), `generated-values.test.ts`, `data-scope.test.ts`, `permissions.test.ts`, `auth.test.ts`, `local-auth.test.ts`, `hybrid-auth.test.ts`, `api-keys.test.ts`, `storage.test.ts`, `storage-metadata.test.ts`, `realtime.test.ts`, `realtime-admin.test.ts`, `realtime-outbox-transaction.test.ts`, `saved-views.test.ts`, `docs.test.ts`, `schema-drift.test.ts`, `backup-codec.test.ts`, `bins.test.ts`.
- Web: `data-provider.test.ts`, `auth.test.ts`, `menu-tree.test.ts`, `column-visibility.test.ts`, `field-rules.test.ts`, `display-template.test.ts`, `relation-batch.test.ts`, `relation-options.test.ts`, `download-file.test.ts`, `export.test.ts`, `views.test.ts`, `i18n.test.ts`, `model-i18n.test.ts`, `chrome-i18n.test.ts`, `project-messages.test.ts`, `charts.test.ts`, `charts-render.test.tsx`, `features.test.ts`, `api-docs.test.ts`, `api-docs-render.test.tsx`, `api-keys.test.ts`, `api-keys-render.test.tsx`, `audit-provider.test.ts`, `tree.test.ts`, `date-fields.test.ts`, `generated-fields.test.ts`, `live-provider.test.ts`, `sider-state.test.ts`, `record-details.test.tsx`, `relation-cell.test.tsx`, `actions.test.ts`.
- `app.test.qiy` scenarios compile into `apps/server/tests/qiy-scenarios.test.ts`; run them in the server package. See [dataflows-actions.md](dataflows-actions.md) for grammar, database requirements and isolation rules.
- Realtime tests force `QIY_REALTIME_DISABLED=1` so they do not depend on Ably; they are not real-provider acceptance.
- Hybrid/OIDC tests inject principals and tokens; they do not perform a real browser login.

## Migrations, drift and rollback

`db:migrate` and `db:migrate:production` run the generated `src/db-migrate.ts` rather than calling Drizzle directly:

1. **Concurrency guard**: PostgreSQL holds `pg_advisory_lock` on a dedicated connection; MySQL uses `GET_LOCK('qiy_migrate', 60)`. With multiple replicas, only one migrates and the rest wait and reuse the result. SQLite has no cross-process lock - run migrations from exactly one process (the script prints this warning).
2. **Post-migration drift check**: after migrating, the same comparison as `db:check` runs; a mismatch exits 1 with `drift: ...`. "Migration ran" does not mean the schema is correct.
3. **Ledger output**: prints applied counts before and after.

Rollback is a reviewed operation; Qiy does not guess reverse SQL:

```powershell
# 1) Write and review drizzle/down/<tag>.sql (tag from drizzle/meta/_journal.json)
#    Separate multiple statements with --> statement-breakpoint
# 2) Execute
bun run --cwd apps/<server-alias> db:rollback -- --confirm
```

- Without `--confirm` the command refuses to run.
- If the latest applied migration has no `drizzle/down/<tag>.sql`, it refuses and prints the exact path to create.
- Reverse SQL runs in one transaction and deletes that migration's ledger row; any failure rolls back.
- After rolling back, revert the corresponding `src/schema.ts`/generated code changes and confirm with `db:check`.

Drift check:

```bash
bun run --cwd apps/<server-alias> db:check
```

It compares actual tables/columns (`NULL`/`NOT NULL`, primary keys, type classes) with `src/schema.ts`, tolerates known storage equivalences (SQLite affinity, MySQL `tinyint(1)` booleans), reports indeterminate columns as `unverified` (never a false drift), and prints `migrations applied X/Y`. `Y > X` is an error (unapplied migrations); `X > Y` is a warning (database newer than code). Exit 1 means drift or unapplied migrations.

## Backup and restore

```powershell
bun run --cwd apps/<server-alias> db:backup
bun run --cwd apps/<server-alias> db:restore -- --file backups/qiy-<timestamp>.json --confirm
```

- `db:backup` writes one JSON file ordered by foreign-key dependencies (`--out-dir`, `--out` allowed) and keeps the newest `QIY_BACKUP_RETENTION` files (default 7; `0` disables cleanup; invalid values fail closed).
- `db:restore` requires both `--file` and `--confirm`; it refuses when the backup `dialect` or table set does not match `src/schema.ts`, empties tables in reverse dependency order and inserts in forward order inside one transaction - a replace, not an append.
- `createdAt`/`Date`, binary columns and bigints are tagged with `$qiy` for lossless round-trips (generated `apps/server/tests/backup-codec.test.ts`).
- This is a **logical** backup for small/medium data and pre-migration restore points, not disaster recovery and not DDL. Use `pg_dump`/`mysqldump` or storage snapshots for large databases. `backups/` is gitignored because it contains production data.

## Docker, Kubernetes and reverse proxies

Docker/Compose use `apps/<server-alias>/.env.production` (default alias `server`); `init` projects keep the alias path and never touch host `.env*` files.

```powershell
cd out/erpadmin
docker compose build
docker compose up
```

Container startup pattern: `bun src/db-migrate.ts && bun src/server.ts`. Health endpoint `/api/v1/health` returns 200; anonymous API requests return 401; wrong credentials return 4xx.

Kubernetes manifests: `deploy/kubernetes/{deployment,service,persistent-volume-claim,secret.example}.yaml`. The PVC is `ReadWriteOnce` (a default storage class satisfies it) and the Deployment sets `HOST=0.0.0.0`. Replace the image with your registry and create the Secret from `secret.example.yaml` (`DATABASE_URL`, `QIY_AUTH_SECRET` >= 32 chars, `QIY_STORAGE_*`).

Nginx: forward `/api/` and `/graphql` to the server, and fall back all other paths to `index.html` (the SPA uses browser routing, not hash routing).

Other targets: `deploy/vercel.json` for Vercel; AWS via the Dockerfile + ECR/ECS; generic hosts run `bun run build` (Node 20+ can build) and Bun for the server.

## Production environment requirements

| Requirement | Why |
| --- | --- |
| `DATABASE_URL` | Real database; SQLite is single-writer and unsuitable for multi-replica production |
| `QIY_DEV_MODE=0` | Production gate; no-auth apps refuse to start, and OTP dev codes/verbose errors are disabled |
| `QIY_AUTH_SECRET` (>= 32 chars) | Sessions, OTP challenges, onboarding tokens, API-key pepper; rotation invalidates all sessions and keys |
| `QIY_STORAGE_METADATA=database` | In-memory attachment metadata loses ownership across restarts/replicas and fails the production startup check |
| `QIY_S3_*` (when `provider s3`) | Bucket, region, endpoint, credentials; server only |
| `QIY_ABLY_API_KEY` (when realtime) | Server only; the browser receives short-lived subscribe-only tokens |
| `QIY_CORS_ORIGINS` (when cross-origin) | Exact origins including ports; wildcards are rejected |
| `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` | Bun `fetch` proxy for IdP token endpoints in restricted networks |
| Reverse-proxy TLS, SPA fallback, API forwarding | Browser routing and secure cookies/headers |

Never put secrets in `.qiy`; they belong in generated `.env` files, secret managers and deployment manifests. Do not expose `QIY_S3_*`, `QIY_ABLY_API_KEY`, `QIY_AUTH_SECRET` or `QIY_OIDC_<ID>_CLIENT_SECRET` to the browser.

## Real-service acceptance

These repository scripts prove protocol shape and, in some cases, real tenants. They are starting points: passing them does not mean your environment is accepted.

| Area | Command | Notes |
| --- | --- | --- |
| OIDC protocol (Docker fixture) | `bun run tools/verify-oidc-docker.ts --isolated` | HTTPS discovery/JWKS/token, `iss|sub` mapping, 401 paths |
| Dex (real IdP, local) | `bun run tools/verify-dex.ts` | Real issuer/JWKS; wrong audience and unmapped subject rejected |
| Keycloak | `bun run tools/verify-keycloak.ts` | Realm import, audience mapper, flattened tenant claim. Keycloak nests dotted claims (`tenant.customerId` -> object) while Qiy projects scalar claims only - use flat claim names |
| Vendor tenants | `verify-okta.ts`, `verify-auth0.ts`, `verify-google.ts`, `verify-kinde.ts`, `verify-azure-b2c.ts`, `verify-azure-b2c-browser.ts` | Phase A discovery/JWKS/PKCE; Phase B needs tenant credentials or a browser |
| Ably | `bun run tools/verify-ably.ts` | Real publish/history, subscribe-only capability, viewer 403; skips (exit 0) without `QIY_ABLY_API_KEY` |
| S3 storage | `bun run tools/verify-s3-storage.ts`, `tools/verify-s3-acceptance.ts` | Real bucket upload/download/presign/ownership |
| Resumable uploads | `bun run tools/verify-resumable-upload.ts` | Offset rules, complete, failure recovery |
| Attachment cleanup | `bun run tools/verify-orphan-cleanup.ts` | Orphan and missing-object directions |
| PostgreSQL/MySQL dataflow | `bun run tools/verify-postgres-dataflow.ts`, `tools/verify-mysql-dataflow.ts` | Real transactions, locking, rollback |
| orderInventory workflow | `bun run tools/verify-postgres-erp.ts qiy-erp-pg` | Reservation/release/deduction, idempotency, tenant denial |
| Realtime outbox | `bun run tools/verify-realtime-outbox.ts <dialect>`, `verify-realtime-claim.ts`, `verify-realtime-policy.ts` | Lease/SKIP LOCKED/backoff/dead letter, claim channels, mask trimming |
| Multi-replica | `bun run tools/verify-multi-replica.ts` | Import/export job claiming across replicas |
| Saved views / scope / policies | `verify-saved-views.ts`, `verify-scope-policy.ts`, `verify-org-scope.ts`, `verify-policy-expression.ts`, `verify-policy-or.ts`, `verify-resource-policy.ts` | Cross-tenant and expression semantics |
| Container/Kubernetes deploy | `bun run tools/verify-docker-deploy.ts`, `tools/verify-k8s-deploy.ts` | Build image, migrate, health probe, 401 probe, PVC/service |
| Migration ops / backup | `bun run tools/verify-migration-ops.ts`, `tools/verify-backup-restore.ts`, `verify-db-check.ts` | Locking, drift, rollback, restore |

Docker-based database/IdP fixtures need a local Docker daemon. Browser flows (PKCE, silent renewal, multi-tab) need a real browser; Qiy ships no browser automation.

## Production verification checklist

Before saying "ready to deploy", verify in the target environment:

1. **Database**: dialect, extensions, migrations applied, `db:check` clean, indexes present, transaction/rollback behavior, concurrent writes, backup and restore rehearsed, retention policy.
2. **Identity**: the real issuer/audience/JWKS, redirect/logout allowlists, JWKS rotation, claim mapping, session lifetime, role change propagation, tenant scope, onboarding/bind/unbind, and for OTP the delivery adapter, its rate limits, replay resistance and failure behavior.
3. **Policy**: effective permissions per role (`/api/v1/auth/permissions`), verification boundaries, `restrict` row/mask behavior on list/detail/export/realtime, `pages` 403s, `allow` denials, and that command resources have no `restrict` block.
4. **Storage**: bucket/permissions, upload size/MIME modes, signed URL TTL, ownership 404s, orphan/missing-object cleanup, retention, failure recovery.
5. **Realtime**: real Ably capability is subscribe-only, claim channels segment tenants, masked fields are absent, dead letters/health/metrics alerting wired, replay audited.
6. **API contract**: generated endpoints against the real web build, host adapters (integration mode), CORS, CSV import/export limits, saved views.
7. **Operations**: TLS, SPA fallback, health checks, secrets injection/rotation, logging without secrets, metrics/alerts, backups, rollback runbook, multi-replica safety (storage metadata database, migration lock, realtime lease, import/export job claiming).

Anything outside CRUD (connector authorization, queues, token encryption, revocation, audit policy, synchronization) belongs in domain services and must be tested independently. CRUD generation does not implement it.

## Common failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits at startup in production | No `auth` and `QIY_DEV_MODE` unset | Configure auth; never ship `QIY_DEV_MODE=1` |
| `QIY_AUTH_SECRET must be at least 32 characters` | Missing/short secret | Set 32+ chars from a secret manager |
| `QIY_STORAGE_METADATA=database is required for production file metadata` | In-memory metadata in production | Set the variable and migrate |
| Migration says applied but `db:check` reports `drift:` | Partial/manual schema change | Generate a corrective migration; never hand-edit applied SQL |
| Concurrent replicas crash during migration | SQLite (no cross-process lock) or missing DB lock privileges | Migrate from one process; grant advisory/GET_LOCK privileges |
| Rollback refuses | Missing `drizzle/down/<tag>.sql` or `--confirm` | Create/review reverse SQL; pass `--confirm` |
| Restore refuses | Dialect/table-set mismatch or missing `--confirm` | Restore into a matching schema; pass both flags |
| Export returns 400 `export.tooLarge` | Row cap (default 1000, `QIY_EXPORT_MAX_ROWS` 1..100000) | Narrow filters or raise the cap deliberately |
| Import partially applied | Per-row writes with compensating delete; a failure returns 4xx | Inspect `import.*` error and the reported line; no partial rows remain |
| Health 503 / dead letters grow | Ably or DB unavailable, retry cap exceeded | Check realtime health/dead endpoints, fix, replay |
| Browser deep link 404 | Reverse proxy has no SPA fallback | `try_files $uri $uri/ /index.html` |
| 401 on every cross-origin request | Missing exact CORS origin or token header | Configure `api { cors { ... } }`; allow `Authorization`, `Content-Type`, `Idempotency-Key`, `X-API-Key` |
| IdP token exchange fails behind a proxy | Bun `fetch` cannot reach the token endpoint | Set `HTTPS_PROXY`/`HTTP_PROXY` |
| `preview` works but production data is empty | Preview uses an in-memory repository | Migrate and start with the production env file |

## Release acceptance (maintainers)

Repository-level gate before a release (do not run a release from an application task):

```powershell
bun install
bun run template:build
bun run check
bun test
bun run docs:build
bun run build:exe -- --all
```

Standalone black-box acceptance also starts the built preview server and checks the home page, static assets, SPA deep links, resource API, OpenAPI, unknown API 404s, and that a no-auth production entry refuses to start. Release artifacts are validated per platform (version, generation, clean install, typecheck/test/build, sync protection, offline skill) before a tag/release is created. Never create a duplicate tag for the same version.

## Related references

- [CLI workflows](cli-workflows.md) - create/init/generate, install, run, upgrade
- [Storage and realtime](storage-realtime.md) - attachment and outbox operations
- [Auth and permissions](auth-permissions.md) - identity, policy and security boundaries
- [Dataflows and actions](dataflows-actions.md) - scenario tests and command contracts
- [Troubleshooting](troubleshooting.md) - cross-area error table

## Canonical docs

- [deployment](https://ai-nodev.github.io/qiy/guide/deployment)
- [real services acceptance](https://ai-nodev.github.io/qiy/guide/real-services)
- [CLI and release](https://ai-nodev.github.io/qiy/guide/cli)
- [project structure](https://ai-nodev.github.io/qiy/guide/project-structure)

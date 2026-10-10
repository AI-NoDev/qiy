# qiy-erp-admin

Generated Qiy Bun workspace. This is editable admin application source, not a mockup. It is a local preview scaffold, not a production-secured deployment.

`apps/server/`: Elysia REST/GraphQL API, Drizzle schema and same-origin static hosting.  
`apps/web/`: Refine + Ant Design + React Router SPA with Refine's standard ThemedLayoutV2.

The first generated resource is available at `http://127.0.0.1:3000/users` after `bun run preview`.

```sh
bun install
bun run test
bun run typecheck
bun run build
bun run preview
bun run db:generate
```

Use `api { client graphql; }` in the source `.qiy` to select the GraphQL Refine DataProvider; the default is REST. The server exposes both `/api/v1/*` and `/graphql`. You can override the frontend selection at build time with `VITE_QIY_API_TRANSPORT=graphql`.

The API serves the Refine SPA from the same origin by default, so CORS stays disabled. For a separately hosted frontend, configure `api { client rest; cors { origin "https://admin.example"; } }` in `.qiy`, repeating `origin` for each exact allowed origin. `QIY_CORS_ORIGINS` can replace that list per deployment with a comma-separated allowlist. The generated server uses Elysia's official CORS plugin only when the effective list is non-empty; do not use `*` for authenticated deployments.

Use `storage { provider local; }` or `storage { provider s3; }` to choose the default `apps/server/src/storage` adapter. Local files use `QIY_STORAGE_ROOT`; S3-compatible storage reads `QIY_S3_*` from the environment. Production applications expose authenticated `POST/GET/DELETE /api/v1/files?key=...` endpoints with a 25 MiB limit and `/api/v1/files/metadata?key=...` for owner-scoped Attachment metadata. Set `QIY_STORAGE_METADATA=database` and run `bun run --cwd apps/server db:generate` followed by the migration command before production startup. `bun run --cwd apps/server attachments:cleanup` performs a dry-run database metadata cleanup; append `-- --apply` only after reviewing the result. Object-store orphan scanning is not automatic. Do not persist local files on ephemeral or multi-replica deployments; use S3-compatible storage for that topology.

For a model with `elysia { cron { job cleanup pattern "0 * * * *" task cleanupMissingAttachments; } }`, the job is registered only when `QIY_CRON_ENABLED=1`. It requires `QIY_STORAGE_METADATA=database`, a migrated `DATABASE_URL`, and storage access. Enable it in at most one dedicated server replica: process-local `protect` prevents overlapping executions in one process but does not provide a distributed lock, retries, or cross-replica coordination. Docker Compose and Kubernetes default to disabled.

`preview` binds only to `127.0.0.1`, uses in-memory records, and disables database-backed workflows. The production `start` command requires `QIY_STORAGE_METADATA=database`, a migrated `DATABASE_URL`, and (for a model without `auth`) explicit `QIY_DEV_MODE=1`. Local-password models require a random `QIY_AUTH_SECRET` with at least 32 characters and store only Argon2id password hashes. OIDC models additionally require `QIY_OIDC_ISSUER`, `QIY_OIDC_AUDIENCE`, and `QIY_OIDC_JWKS_URL`. Docker/Kubernetes/Vercel files are starting points, not a production security claim.

For `auth { provider local; ... }`, after applying database migrations and configuring `QIY_AUTH_SECRET`, create the first administrator with `bun run --cwd apps/server auth:bootstrap-admin`. This command refuses to create another initial admin once an admin exists. Change a user's password with `bun run --cwd apps/server auth:set-password`; both commands prompt for credentials locally and no password-management HTTP endpoint is exposed.

For `elysia { static { assets "public/images"; prefix "/images"; } }`, only the `public` subtree can be mounted; `/api`, `/graphql`, and `/assets` are reserved. The plugin serves an independent public prefix, not the SPA fallback. `jwt { name accessToken; secretEnv QIY_ACCESS_SECRET; }` requires the configured secret at runtime; generated tests use a test-only value and do not enable local login or replace OIDC validation.

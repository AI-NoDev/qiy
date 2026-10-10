# qiy-scoped-sqlite

Generated Qiy Bun workspace. This is editable admin application source, not a mockup. It is a local preview scaffold, not a production-secured deployment.

`apps/server/`: Elysia REST/GraphQL API, Drizzle schema and same-origin static hosting.  
`apps/web/`: Refine + Ant Design + React Router SPA with Refine's standard ThemedLayoutV2.

The first generated resource is available at `http://127.0.0.1:3000/records` after `bun run preview`.

```sh
bun install
bun run test
bun run typecheck
bun run build
bun run preview
bun run db:generate
```

Use `api { client graphql; }` in the source `.qiy` to select the GraphQL Refine DataProvider; the default is REST. The server exposes both `/api/v1/*` and `/graphql`. You can override the frontend selection at build time with `VITE_QIY_API_TRANSPORT=graphql`.

Use `storage { provider local; }` or `storage { provider s3; }` to choose the default `apps/server/src/storage` adapter. Local files use `QIY_STORAGE_ROOT`; S3-compatible storage reads `QIY_S3_*` from the environment. Production applications expose authenticated `POST/GET/DELETE /api/v1/files?key=...` endpoints with a 25 MiB limit and `/api/v1/files/metadata?key=...` for owner-scoped Attachment metadata. Set `QIY_STORAGE_METADATA=database` and run `bun run --cwd apps/server db:generate` followed by the migration command before production startup. `bun run --cwd apps/server attachments:cleanup` performs a dry-run database metadata cleanup; append `-- --apply` only after reviewing the result. Object-store orphan scanning is not automatic. Do not persist local files on ephemeral or multi-replica deployments; use S3-compatible storage for that topology.

`preview` binds only to `127.0.0.1`, uses in-memory records, and disables database-backed workflows. The production `start` command requires `QIY_STORAGE_METADATA=database`, a migrated `DATABASE_URL`, and (for a model without `auth`) explicit `QIY_DEV_MODE=1`; generated OIDC models additionally require `QIY_OIDC_ISSUER`, `QIY_OIDC_AUDIENCE`, and `QIY_OIDC_JWKS_URL`. Docker/Kubernetes/Vercel files are starting points, not a production security claim.

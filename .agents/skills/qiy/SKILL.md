---
name: qiy
description: "Help users use the Qiy CLI to turn .qiy models into Refine admin applications, Bun/Elysia APIs, Drizzle database projects, or a namespaced admin inside an existing Bun workspace."
metadata:
  short-description: "Use the Qiy CLI to generate and integrate admin apps"
  version: "0.1.0"
---

# Use Qiy

Use this skill when a user wants to create, configure, integrate, run, or deploy an application generated from a public `.qiy` model. Qiy generates an ordinary TypeScript project: a Refine + React Router admin web app, a Bun + Elysia server, Drizzle schema/migrations, tests, and deployment examples.

This is a user-operation skill. Use the installed `qiy` executable or `bunx qiy`; do not ask the user to edit Qiy's generator source, MPS models, generated snapshots, or internal test fixtures unless they explicitly ask to develop Qiy itself.

## Start safely

1. Confirm the user has a `.qiy` file and identify its project root. Qiy's public workflow uses `.qiy`; reusable model fragments use relative `include "path/file.qiy";` statements.
2. Check the CLI before generating:

```powershell
qiy --version
qiy --help
```

3. Put existing-workspace aliases in the `.qiy` model itself; do not create a separate `qiy.admin.config.ts` file:

```qiy [models/admin.qiy]
workspace {
  name admin;
  aliases { server ops-api; web ops-console; deploy ops-admin; }
  packages { server "@example/ops-api"; web "@example/ops-console"; }
}
```

4. Choose one workflow:
   - New project: `qiy create -f <model.qiy> -n <name> -o <empty-directory>`.
   - Existing Bun project: `qiy init -f <model.qiy> [-n <name>]`.
5. Keep credentials out of `.qiy`. Use the generated `.env.example` as a checklist and provide secrets through the host environment or secret manager.

## Create a new project

Use `create` for a complete, isolated Turborepo + Bun workspace:

```powershell
qiy create -f ./models/catalog.qiy -n catalog-admin -o ./catalog-admin
cd catalog-admin
bun install
bun run typecheck
bun run test
bun run build
bun run preview
```

The generated project normally contains `apps/server`, `apps/web`, `deploy`, `Dockerfile`, `docker-compose.yml`, `turbo.json`, and a root `package.json`. `preview` is local-only and is not a production deployment.

Use `qiy generate <model.qiy> <directory>` only for compatibility with older instructions. `create` is the preferred user-facing command because the name and destination are explicit.

## Integrate into an existing Bun project

Run `init` from the existing project's root. It requires `package.json.packageManager` to start with `bun@`:

```json
{
  "packageManager": "bun@1.3.13"
}
```

```powershell
qiy init -f ./models/admin.qiy
bun install
bun run qiy:admin:typecheck
bun run qiy:admin:test
```

`init` reads the optional `workspace` block from the `.qiy` file, then adds namespaced server/web packages under `apps/`, deployment files under `deploy/<alias>/`, an aliased Dockerfile and Compose file, `apps/*` workspace support, and `qiy:<name>:*` scripts. It merges ignore files instead of replacing them.

## Update generated output

Each integrated admin has a `.qiy-<name>.generated.json` ownership manifest:

```powershell
qiy init -f ./models/admin.qiy --sync
```

`--sync` updates only manifest-owned files. Put custom auth, API adapters, hooks, plugins, connector logic, and business commands in files outside the manifest. Do not directly edit a generated DataProvider or auth file and expect Qiy to merge it automatically.

## Explain integration limits

When a user wants to connect Qiy to an existing product, state these limits clearly:

- Qiy's generated DataProvider follows the Qiy REST or GraphQL contract; CORS does not translate an unrelated API.
- Existing JWT, refresh cookies, request headers, response envelopes, pagination, permissions, and resource mappings need an explicit adapter.
- Connector authorization, queues, encrypted tokens, revocation, synchronization, audit, and other domain workflows are not inferred from CRUD entities.
- A successful generation, typecheck, local test, or preview does not prove real PostgreSQL/MySQL, OIDC/OAuth2/SSO, S3, concurrency, rollback, or production deployment readiness.

## User verification

After generation, run the checks appropriate to the selected project:

```powershell
bun install
bun run typecheck
bun run test
bun run build
bun run db:generate
```

For a real deployment, ask for or verify the actual database, identity provider, object storage, secrets, migrations, SPA/API proxy, health checks, backups, and concurrency behavior. Report unavailable external services as unverified rather than treating `preview` as proof.

## References

- [Model and include syntax](references/modeling-and-generation.md)
- [Existing Bun project and aliases](references/workspace-integration.md)
- [Production verification checklist](references/production-boundaries.md)

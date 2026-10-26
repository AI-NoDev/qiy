# Workspace integration (existing Bun projects and host APIs)

Use this file when Qiy output must live inside an existing Bun repository, when aliases/scripts/paths collide with host files, or when the host already owns the API and only the Refine admin should be generated (`mode integration`).

Canonical reference: https://ai-nodev.github.io/qiy/guide/existing-bun-project (`/dsl/application` for `mode`/`integration`)

## Contents

- [Decide: create, init or integration](#decide-create-init-or-integration)
- [init prerequisites](#init-prerequisites)
- [workspace block and aliases](#workspace-block-and-aliases)
- [Mounted layout](#mounted-layout)
- [Scripts and dependencies](#scripts-and-dependencies)
- [Sync and ownership boundary](#sync-and-ownership-boundary)
- [Integration mode contract](#integration-mode-contract)
- [Host auth bridge and error contract](#host-auth-bridge-and-error-contract)
- [CSRF, envelopes and tenant forwarding](#csrf-envelopes-and-tenant-forwarding)
- [Path collisions](#path-collisions)
- [Extension points](#extension-points)
- [Limits](#limits)
- [Pitfalls](#pitfalls)

## Decide: create, init or integration

| Situation | Command | Result |
| --- | --- | --- |
| New project, no existing repository | `qiy create -f model.qiy -n name -o dir` | Standalone Turborepo + Bun workspace, server + web + deploy |
| Existing Bun repo, Qiy should own API + DB + admin | `qiy init -f model.qiy` | `apps/<server-alias>` + `apps/<web-alias>` + aliased deploy files |
| Existing Bun repo with its own API/users/database | `qiy init` with `mode integration` | Only a Refine web package + host adapters; no Qiy server |

Do not use `create` to "add" Qiy to an existing repository: it would write a second root workspace. Do not use `init` on a standalone project Qiy already generated - use `generate ... --sync` there.

## init prerequisites

- Run from the host project root (or pass `-o <project-root>`).
- Root `package.json` must declare Bun, e.g. `"packageManager": "bun@1.3.13"`. `qiy init` refuses to write otherwise.
- Existing workspace patterns are preserved; `apps/*` is added only when missing.
- Root scripts are not replaced. Qiy adds direct `bun --cwd` scripts under `qiy:<name>:*`; a conflicting existing script with a different command makes the command fail.
- Qiy never writes the host root `.env*` files.

```bash
cd /path/to/existing-bun-project
qiy init -f ./models/admin.qiy
bun install
bun run qiy:admin:typecheck
bun run qiy:admin:test
```

## workspace block and aliases

```qiy
workspace {
  name admin;
  aliases {
    server ops-api;
    web ops-console;
    deploy ops-admin;
  }
  packages {
    server "@example/ops-api";
    web "@example/ops-console";
  }
}
```

| Key | Allowed | Default |
| --- | --- | --- |
| `name` | Identifier | Application name |
| `aliases.server` / `.web` / `.deploy` | Lowercase letters, digits, hyphens | `<name>-server`, `<name>-web`, `<name>` |
| `packages.server` / `.web` | Valid npm package name (scope allowed) | Derived from the workspace name |

Only `name`, `aliases` (`server`/`web`/`deploy`) and `packages` (`server`/`web`) are allowed; duplicates and invalid identifiers fail. `aliases` affects `init` only; `create`/`generate` always use `apps/server` and `apps/web`. `-n` overrides the name once at the command line; prefer setting `workspace.name` in the model.

## Mounted layout

```text
host-project/
├── apps/
│   ├── ops-api/                 # Bun + Elysia API (Qiy)
│   └── ops-console/             # Refine SPA (Qiy)
├── deploy/ops-admin/            # nginx, Kubernetes, Vercel examples
├── ops-admin.Dockerfile
├── docker-compose.ops-admin.yml
├── .qiy-admin.generated.json    # manifest of Qiy-owned files
├── openwiki/qiy-admin/          # namespaced generated wiki
└── package.json                 # keeps host workspaces/scripts; adds apps/* and qiy:admin:*
```

- Agent entrypoints go into `apps/<web-alias>/` (`AGENTS.md`, `AGENT.MD`) so host root instructions are untouched.
- Generated OpenWiki docs go to `openwiki/qiy-<name>/`; host `openwiki/` files are preserved.
- Env files: `apps/<server-alias>/.env.{development,production,example}`, `apps/<web-alias>/.env.*`.
- Docker/Compose are named from the deploy alias and build from the host root without requiring Turborepo.

## Scripts and dependencies

- Qiy adds `qiy:<name>:<script>` entries (for example `qiy:admin:typecheck`, `qiy:admin:test`, `qiy:admin:preview`) that call `bun --cwd apps/<alias> ...`.
- It does not add `turbo.json`, a `turbo` dependency, or replace root scripts.
- Deployment uses `docker-compose.<deploy-alias>.yml`; production migrations use `bun run --cwd apps/<server-alias> db:migrate:production`.

## Sync and ownership boundary

`--sync` (re-run the same `init` command) updates only files listed in `.qiy-<name>.generated.json`, deletes registered files the model no longer generates, and never overwrites unowned host files. A path collision fails instead of merging. Put custom code in unowned files:

```text
apps/ops-api/src/host-extension.ts
apps/ops-api/src/integrations/example-auth.ts
apps/ops-api/src/modules/connectors/
apps/ops-console/app/plugins/host-data-provider.ts
apps/ops-console/app/hooks/use-connector-status.ts
apps/ops-console/app/extensions/
```

For `mode integration`, a generated `app/host/data-provider.ts`, `auth.ts` and `access-control.ts` are unowned adapters that `--sync` will not overwrite. When upgrading, review them manually and port any new host-contract behavior; Qiy will not patch unowned files.

## Integration mode contract

```qiy
qiy v0;
application catalog-admin {
  database sqlite {}
  mode integration;
  integration {
    apiBase "/api/v2";
    auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; };
    response { data "items"; total "meta.count"; error "message"; };
    pagination offset;
    tenant { header "X-Tenant-Id"; identity "tenantId"; };
  }
  workspace {
    name catalog;
    aliases { web host-admin; }
    packages { web "@example/host-admin"; }
  }
  entity products { field id UUID @id; field title Text; }
}
```

```text
integration {
  apiBase "<absolute http(s) URL or /path>" ;
  auth none | bearer | cookie | portal ;
  auth cookie { csrfCookie "<name>" ; csrfHeader "<header>" ; } ;
  response { data "<path>" ; total "<path>" ; error "<path>" ; } ;
  pagination page | offset | none ;
  tenant { header "<header>" ; identity "<identity-key>" ; } ;
}
```

| Setting | Values | Default | Behavior |
| --- | --- | --- | --- |
| `apiBase` | `https://...`, `http://...`, or a path starting with `/` | required | Host API prefix; `VITE_QIY_API_BASE` affects both DataProvider and auth requests |
| `auth none` | - | yes | No credentials attached |
| `auth bearer` | - | - | `Authorization: Bearer <token>` from the host bridge |
| `auth cookie` | optional `csrfCookie`/`csrfHeader` | - | Same-origin cookies; CSRF options are only valid here |
| `auth portal` | - | - | Host portal/BFF injects identity |
| `response.data/total/error` | dotted JSON keys (`items`, `meta.count`) | `data`, no total, `error` | Read-envelope paths; `$.items` is rejected (`dotted JSON path`) |
| `pagination` | `page`, `offset`, `none` | `page` | `page`+`pageSize`, `offset`+`limit`, or no parameters |
| `tenant.header` | simple HTTP header name | none | Header that carries the host tenant |
| `tenant.identity` | simple identity key | none | Key read from `window.qiyHostAuth.getIdentity()` |

Generated baseline: `apps/<web-alias>/app/host/data-provider.ts` implements `getList`/`getOne`/`create`/`update`/`deleteOne` using `apiBase`, the entity table name, the response envelope, pagination and the tenant header. Sorting, filtering, nested resources and bulk endpoints stay in the unowned adapter.

Validation and ordering: `mode integration` requires an `integration` block (`application mode integration requires an integration block`), and an `integration` block requires `mode integration`. Each key appears once; `response` needs at least one path; paths are dotted keys only. Integration mode **rejects** `api { cors }`, `auth`, `scope`, `restrict`, `workflow`, `dataflow`, `permission`, `storage`, `elysia`, `env` and `realtime` with `application mode integration cannot configure generated server features; use integration auth and host adapters instead.` (`api { client ... }` itself is allowed). It also cannot be generated standalone: `application mode integration must be mounted with qiy init inside an existing Bun workspace`.

Integration output: only the web package plus `apps/<web-alias>/QIY_INTEGRATION.md`, host adapters, and default list/show pages. No server, Drizzle schema, migrations, Docker/Compose or deploy files.

## Host auth bridge and error contract

The generated app expects a host bridge object. Implement it in unowned files:

```ts
// apps/host-admin/app/host/auth.ts
window.qiyHostAuth = {
  ...window.qiyHostAuth,
  getAccessToken: async () => sessionToken,
  getIdentity: async () => ({ id: userId, tenantId: currentTenant }),
};
```

```ts
// apps/host-admin/app/host/access-control.ts
import type { QiyHostAuthBridge } from "./auth";

window.qiyHostAuth = {
  ...window.qiyHostAuth,
  can: async ({ resource, action }) => ({ can: resource === "products" && ["list", "show"].includes(action) }),
} satisfies QiyHostAuthBridge;
```

- `getAccessToken` supplies bearer/portal tokens; `getIdentity` supplies the object the `tenant.identity` key is read from.
- `can` is the single visibility source for navigation actions and pages in integration mode (`action allow` cannot replace host policy). A missing, throwing or non-`{ can: true }` response denies access.
- `hostRequest` errors keep `statusCode`; the Refine AuthProvider passes them to the optional `window.qiyHostAuth.onError(error)`. Without the hook, 401 redirects to `/auth/login`, 403/server errors do not. Qiy never refreshes tokens or replays requests (especially not commands with side effects); the caller retries explicitly.
- Requests are confined to the `apiBase` origin/path and automatic redirects are rejected, so tokens/CSRF values are not sent elsewhere. Hosts must still enforce server-side permissions and session refresh.

## CSRF, envelopes and tenant forwarding

- `auth cookie` requires the admin and API to be same-origin. Non-GET/HEAD/OPTIONS requests must include a readable CSRF cookie configured by `csrfCookie`; the session cookie itself should stay HttpOnly host-side.
- `response` describes the **read** envelope only; write requests assume the host returns the record itself. If `total` is omitted, the current page length is used as the total. If a declared path is missing, list unwrapping falls back to the whole body as an array (record: as an object).
- `tenant` forwards a host identity value as a required header. If the identity value is missing, empty or not a string, the request is **not sent** (fail-closed: `Host tenant identity is missing`). Hosts must still validate tenant ownership server-side.
- CORS only solves browser origin checks; it does not adapt API contracts.

## Path collisions

Collisions fail the command instead of overwriting host content. Resolve them in the model, not by deleting host files:

1. Change `workspace.aliases.server/web/deploy` to unused lowercase names.
2. Change `workspace.packages.*` if the host already uses those package names.
3. If an existing root script uses a `qiy:<name>:*` name with a different command, rename the Qiy workspace (`workspace.name`) or the host script.
4. Re-run `qiy init`; then `bun install` so the new workspace packages are linked.

Do not delete host files just to let generation pass, and do not point Qiy at a directory that already contains a different project.

## Extension points

| Need | Put it in |
| --- | --- |
| Host-specific URL mapping, sorting, filters, nested/bulk endpoints | `apps/<web>/app/host/data-provider.ts` (integration) |
| Host identity, refresh, logout | `apps/<web>/app/host/auth.ts` (integration) |
| Host authorization bridge | `apps/<web>/app/host/access-control.ts` (integration) |
| Custom command/page | `apps/<web>/app/extensions/` via `action ... page manual` |
| Server plugin/domain logic | `apps/<server>/src/integrations/`, `src/modules/`, `src/extensions/`, `src/host-extension.ts` |
| Refine providers/hooks | `apps/<web>/app/plugins/`, `app/hooks/`, `app/providers/` (unowned files only) |

Always verify which files are in `.qiy-<name>.generated.json` before editing; those are rewritten by `--sync`.

## Limits

- Integration mode generates no Qiy server, so there is no Qiy auth, permission, scope, restrict, dataflow, storage or realtime enforcement. The host API is authoritative.
- The generated host DataProvider is a baseline; sorting/filtering/nested/bulk calls need adapter work.
- `can` is client-side visibility only; it does not secure host data.
- Qiy does not implement host token refresh, CSRF validation, tenant authorization or audit; implement and test them in the host.
- Mounting multiple Qiy admins into one Bun workspace is possible via distinct aliases, but each has its own manifest and env files; script names must not collide.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `qiy init requires packageManager to declare Bun` | No Bun declaration | Add `"packageManager": "bun@<version>"` and `bun install` |
| `Refusing to overwrite existing host file` | Alias/script collision | Change `workspace.aliases`/`name`; never delete host files |
| `application mode integration requires an integration block` | `mode integration` without settings | Add `integration { apiBase ... }` |
| `integration block requires application mode integration` | Block without the mode | Add `mode integration;` |
| `integration apiBase must be an absolute http(s) URL or a path starting with /` | Relative path | Use `/api/v2` or a full URL |
| `Integration auth options are only supported for cookie transport` | `csrfCookie` under bearer/portal | Move them into `auth cookie { ... }` |
| `integration tenant requires header and identity` | Only one tenant key | Provide both |
| `application mode integration cannot configure generated server features` | `auth`/`storage`/`env`/`dataflow` in an integration model | Remove them; implement in the host |
| `application mode integration must be mounted with qiy init ...` | `create`/`generate` with integration mode | Run `qiy init` in the host project |
| Requests fail before being sent | Tenant identity missing/empty/non-string | Fix `getIdentity()` |
| Host calls 401 loop | `onError` not implemented or token refresh expected from Qiy | Implement the hook and retry from the caller |
| Custom host adapter overwritten | File was in the manifest | Move it to an unowned path |
| `qiy:admin:*` script missing after install | Workspace not installed | `bun install` at the host root |

## Related references

- [CLI workflows](cli-workflows.md) - `init` flags, doctor, skill install, sync
- [Language reference](language-reference.md) - `mode`/`integration`/`workspace` settings
- [Auth and permissions](auth-permissions.md) - what Qiy enforces in standalone mode
- [Testing and deployment](testing-deployment.md) - aliased Docker/Compose and migrations
- [Troubleshooting](troubleshooting.md) - cross-area errors

## Canonical docs

- [existing Bun project](https://ai-nodev.github.io/qiy/guide/existing-bun-project)
- [application: mode and integration](https://ai-nodev.github.io/qiy/dsl/application)
- [CLI](https://ai-nodev.github.io/qiy/guide/cli)

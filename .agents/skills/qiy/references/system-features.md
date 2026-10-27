# System features, OpenAPI and API keys

Use this file when you enable the generated developer/system pages, need to know exactly which routes, menus, endpoints, dependencies and tables exist for a feature flag combination, or you administer API keys.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/features (`/guide/api-docs-and-keys`)

## Contents

- [features block](#features-block)
- [Gating matrix](#gating-matrix)
- [The three system pages](#the-three-system-pages)
- [REST and data endpoints](#rest-and-data-endpoints)
- [OpenAPI filtering](#openapi-filtering)
- [API keys](#api-keys)
- [Environment variables](#environment-variables)
- [Limits and security](#limits-and-security)
- [CI recipes](#ci-recipes)
- [Pitfalls](#pitfalls)

## features block

```text
features "{" ( "overview" | "apiDocs" | "apiKeys" ) ( "true" | "false" ) ";" "}"
```

```qiy
features {
  overview true;   # /system/overview + menu entry (default true)
  apiDocs true;    # /system/api-docs + OpenAPI endpoint (default false)
  apiKeys true;    # /system/api-keys + key table/auth (default false)
}
```

| Key | Default | Generates | Dependency |
| --- | --- | --- | --- |
| `overview` | `true` | `/system/overview` (entities / dataflows / permission model) + menu entry | At least one of `apiDocs`/`apiKeys` must be on |
| `apiDocs` | `false` | `/system/api-docs`, `GET /api/v1/openapi.json`, OpenAPI browser | Requires auth for access |
| `apiKeys` | `false` | `/system/api-keys`, `qiy_api_keys` table, `/api/v1/auth/api-keys`, Bearer/`X-API-Key` fallback auth | **Requires an `auth` block** with an existing user entity |

Rules: only these three keys (`Unsupported features setting X; expected overview, apiDocs or apiKeys`); values must be `true`/`false`; duplicates fail; omit the block and no developer pages are generated (equivalent to `overview true; apiDocs false; apiKeys false;` with no `features.ts` menu links). `apiKeys true` without `auth` fails at parse time (`features apiKeys requires an auth block`); an unknown user entity fails at generation (`features apiKeys requires the auth user entity X`). `features` sits after `api` and before `realtime`/`elysia`/`storage`/`auth`.

## Gating matrix

| overview | apiDocs | apiKeys | Pages | Endpoints / tables |
| --- | --- | --- | --- | --- |
| true | true | true | All three + three menu entries | `openapi.json`, `docs/model`, `api-keys`, `qiy_api_keys` |
| true | true | false | Overview + API docs | `openapi.json`, `docs/model`; no key table/auth |
| true | false | true | Overview + API keys | `docs/model`, `api-keys`, table; **no** `openapi.json` |
| false | true | true | API docs + API keys | As row 1, without overview page/menu |
| true/false | false | false | None | `features.ts` menu links empty; no `mermaid` dependency |

Generator formulas: `overviewRequested = overview && (apiDocs || apiKeys)`; `docsModelEnabled = apiDocs || overviewRequested`; `openapi.json` is generated only when `apiDocs` is true.

Dependency gating to remember:

- `/api/v1/docs/model` exists when overview is requested **or** `apiDocs` is on.
- `/api/v1/openapi.json` exists **only** with `apiDocs`.
- `/api/v1/auth/api-keys` exists **only** with `apiKeys` (otherwise 404) and key headers are not parsed.
- When all three pages are off, no developer routes, menu links or `mermaid` dependency are generated.

Menu links come from `apps/web/app/features.ts` (`qiyMenuLinks`, plus `qiyFeatureFlags`). `buildMenuTree` appends them to a `System` group (creating it if needed) in fixed order. A link exists only when its page exists, so there are no dead routes.

## The three system pages

| Page | Route | Content |
| --- | --- | --- |
| Overview | `/system/overview` | Tabs: **entities** (Mermaid `classDiagram`, field/annotation table, relation table), **dataflows** (Mermaid `flowchart` per flow, allow rules, inputs, steps), **permissions** (fields/groups/verifications + the current user's effective permissions). No API-doc or key tab |
| API docs | `/system/api-docs` | Full-page Ant Design OpenAPI 3.1 browser: tag list with operation counts, operation cards (method/path/summary/parameters/request body/responses/security/role+permission tags/copyable curl), case-insensitive search, empty state. **Read-only** - no try-it requests |
| API keys | `/system/api-keys` | Full-page key management: explanation and curl examples (`Authorization: Bearer qiy_...` / `X-API-Key`), search/filter by name/prefix/status, active count/limit hint, permission tags (role/permission group + tooltips), create dialog (name + optional expiry), one-time secret display with copy, revoke confirmation |

All three live inside the `<Authenticated>` layout: unauthenticated access redirects to `/auth/login` (not 403). Their data comes from protected APIs (`/api/v1/docs/model`, `/api/v1/openapi.json`, `/api/v1/auth/api-keys`), so content is filtered by the current principal. Mermaid rendering falls back to raw source after a 10-second timeout or an error.

## REST and data endpoints

The server always exposes REST under `/api/v1` and GraphQL under `/graphql`; `api { client ... }` only selects the Web transport.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/:resources` | List: pagination, sort, search, filters |
| POST | `/api/v1/:resources` | Create |
| GET | `/api/v1/:resources/:id` | Detail |
| PATCH | `/api/v1/:resources/:id` | Partial update (no PUT; empty body -> 400 `Empty update`) |
| DELETE | `/api/v1/:resources/:id` | Delete one |
| DELETE | `/api/v1/:resources?ids=` | Delete many |
| GET | `/api/v1/:resources/export` | Permission-constrained CSV export |
| POST | `/api/v1/:resources/import` | Permission-constrained CSV import |
| GET | `/api/v1/:resources/distribution` | Enum distribution |
| GET | `/api/v1/:resources/trend` | Date trend |
| GET | `/api/v1/:resources/aggregate?field&op` | Sum/avg/min/max (numeric fields) |
| GET | `/api/v1/graphql/subscribe` | GraphQL subscription over SSE (graphql client + realtime) |
| GET | `/api/v1/health` | Health probe (200) |

CSV export uses the same query path as the list, so filters, `scope`, `restrict` rows and masks apply. `mask mode omit` drops the whole column (header included); `null`/`redact` keep masked values. Options: `ids=` (max 500), `columns=` (max 100), streaming in 250-row pages, default row cap 1000 (`QIY_EXPORT_MAX_ROWS`, 1..100000) with 400 `export.tooLarge`. Async mode (`?async=1`) returns 202 `{ jobId, total }` with `qiy_export_jobs`, admin-only job list/run endpoints, `409 export.claimed`/`export.notQueued`, and CSV built from the creator's principal snapshot. Every export writes a `<resource>.exported` audit event; out-of-scope writes return 403 `policy.outsideScope`.

CSV import accepts `text/csv` with a header row and writes each row through the normal create path (masks and row predicates apply). Failures: 400 `import.unknownField`/`duplicateColumn`/`maskedField`/`rowLength`/`invalidRow`/`empty`, 403 `policy.outsideScope`; row cap 1000 (`QIY_IMPORT_MAX_ROWS`). Failures compensate by deleting rows created in that request (not one cross-row transaction); success returns 201 `{ imported }` and a `<resource>.imported` audit event. Async jobs live in `qiy_import_jobs` with progress/cancel/stale-job recovery (`QIY_IMPORT_JOB_STALE_MS`).

Saved views (server-side, cross-device): `GET /api/v1/saved-views?resource=` returns own + shared views with `mine`; `POST /api/v1/saved-views` upserts by name (name <= 80, filters <= 50, sorters <= 10, columns <= 100); `DELETE /api/v1/saved-views/:id` allows the owner or an admin for shared views (`403 views.forbidden` otherwise). Persisted in `qiy_saved_views`; per-user limit 100 distinct names per resource (`400 views.limit`).

GraphQL subscriptions: SSE at `/api/v1/graphql/subscribe`, or graphql-ws at `/graphql/ws` with `connection_init` token auth, subscribe/next/error/complete frames, ping/pong and exponential reconnect. Both respect realtime capability channels; see [storage-realtime.md](storage-realtime.md).

## OpenAPI filtering

`GET /api/v1/openapi.json` and `GET /api/v1/docs/model` are protected (`Cache-Control: no-store`; unauthenticated 401) and are generated per principal:

| Rule | Behavior |
| --- | --- |
| admin | All resources (including the user resource) and all commands |
| non-admin | The auth user resource is hidden |
| `restrict.roles` | Role not listed -> the whole resource disappears |
| `pages` | Operations trimmed per action (`list`/`show`/`create`/`edit`/`delete`) |
| viewer | Resource paths keep only `list`/`show` operations, even if `pages` allows writes |
| command: admin | All |
| command: `allow verification` | Hidden from non-admin (depends on runtime inputs) |
| command: `allow roles` | Shown only when the role is listed |
| command: `allow permission` | Requires every expanded permission **value** |
| command: no `allow` | Hidden from non-admin (the default `admin, operator` list only helps admin) |

The document includes `info`, `servers`, `tags`, `components.securitySchemes` (`bearerSession` JWT Bearer and `apiKey` `X-API-Key`), per-resource CRUD plus `distribution`/`trend`/`aggregate`, each command as `POST /api/v1/commands/<name>`, `/auth/me`, `/auth/login` (when local login exists), the API-key and docs endpoints themselves, and `x-qiy-roles` / `x-qiy-permissions` / `x-qiy-verification` metadata. `x-qiy-permissions` records **expanded permission values** (`inventory:receive`), not declaration names; groups expand recursively and match command visibility and Web button visibility.

Important boundary: the Elysia plugin's own `/api/v1/openapi` endpoint is **public and unfiltered**. It does not contain Qiy permission filtering and must not be used as the production document source or as an attack-surface inventory. `restrict` row scopes, `mask` fields and `allow verification` commands are not represented structurally in the document at all.

## API keys

- Table `qiy_api_keys`: `id`, `userId`, `name`, `prefix`, `hash`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt` (indexes: user, unique hash).
- Format `qiy_<8 hex prefix>_<43-char base64url secret>`. Only an HMAC-SHA256 hash (peppered with `QIY_AUTH_SECRET`) plus the prefix is stored; the full key appears once in the creation response.
- Authentication: the normal authenticator runs first; on failure the server checks `Authorization: Bearer qiy_...` or `X-API-Key: qiy_...`. The resolved user row then goes through the same guard, scope, page and permission rules. `lastUsedAt` updates at most once per minute (best-effort).
- Revoked/expired keys return 401. Keys carry **no id_token claims**, so `permission from claim` does not apply; they inherit the role group, the database permission column and scope-derived claim keys.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/v1/auth/api-keys` | Masked list (`maskedKey` like `qiy_1a2b3c4d_********`) |
| `POST` | `/api/v1/auth/api-keys` | `{ name, expiresAt? }` -> **201** `{ key, record }`; name 1..80; `expiresAt` must be a future ISO time; over the limit -> **409** |
| `DELETE` | `/api/v1/auth/api-keys/:id` | Revoke your own key (idempotent); missing or someone else's -> 404 |

All key endpoints require a session and can only manage the caller's own keys. Limit: **10 active keys per user** (revoked/expired do not count); exceeding it returns 409 `At most 10 active API keys are allowed`. Revocation writes `revokedAt` and keeps the row for audit; issuing again creates a new key.

`apiKeys false` means no table, no routes and no key-header fallback. Enabling it on an existing project requires a migration:

```bash
cd apps/server
bun run db:generate
bun run db:migrate
```

## Environment variables

| Variable | Notes |
| --- | --- |
| `QIY_AUTH_SECRET` | **>= 32 chars**; HMAC pepper for API keys (shared with local login/OTP/onboarding). Missing/short -> hashing fails closed. Generated `.env` files only include it automatically for local/OTP auth; **a pure-OAuth project enabling `apiKeys` must add it manually** |
| `DATABASE_URL` | `qiy_api_keys` and the other generated tables migrate through the normal path |
| - | `features` has no dedicated variable; `overview`/`apiDocs`/`apiKeys` are baked in at generation time |

## Limits and security

1. **Flags gate generation, not access.** Generated pages are visible to any signed-in user; their content is filtered by role/permission. This is deliberate so every role can inspect what it may call.
2. **The API document is a permission-filtered view**, not a complete attack surface: `allow verification` and data scope are not represented; verification-gated commands are admin-only in the document.
3. **Try it is session-scoped**: requests run from the current browser with `qiy.access_token`; an optional API key stays in the form and is never stored. Responses are truncated to 20k characters. Server auth, permission filtering and validation remain authoritative. curl examples use a placeholder token that must be replaced with a real session token or API key.
4. **API keys are session-equivalent**: a leak grants the user's full permissions. Never echo the `key` field in CI logs; store it in a secret manager.
5. **Revocation is irreversible**: `revokedAt` is kept for audit; re-issuing yields a new key.
6. **Keys snapshot claims from the user row**, so role/scope column changes take effect on the next request without rotating keys; IdP claim changes (e.g. `roles`) never reach an API key.
7. The overview page shows the caller's own effective permissions; low-privilege users seeing their own set is intended observability, not leakage.

## CI recipes

Least-privilege key for automation: create a dedicated `viewer` (or narrowly permissioned) user, then create the key from that user's session rather than an admin's.

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $CI_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"nightly-export","expiresAt":"2027-01-01T00:00:00.000Z"}'

curl -H "X-API-Key: qiy_1a2b3c4d_..." http://localhost:3000/api/v1/inventory
```

Documentation-as-contract test: fetch `/api/v1/openapi.json` with tokens for each role and assert (a) viewer sees no write operations, (b) non-admin does not see the users resource, (c) no `allow verification` command appears for non-admin. Remember the `allow permission` document/filtering nuance and the public unfiltered `/api/v1/openapi`.

Gradual rollout: enabling `apiDocs true` only changes generation; access is always permission-filtered, so start with admin and grant permissions to operator/viewer later.

## Pitfalls

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `Unsupported features setting X; expected overview, apiDocs or apiKeys` | Typo/unknown key | Use one of the three |
| `Duplicate features setting X` | Key repeated | Keep one |
| `features apiKeys requires an auth block` | `apiKeys true` without `auth` | Add `auth` or disable keys |
| `features apiKeys requires the auth user entity X` | `auth.user` does not exist | Declare the user entity |
| Overview menu missing | `overview` true but `apiDocs` and `apiKeys` both false | Enable one docs feature |
| `/api/v1/openapi.json` 404 | `apiDocs` false | Enable `apiDocs` |
| `/api/v1/auth/api-keys` 404 | `apiKeys` false | Enable `apiKeys` and migrate |
| `QIY_AUTH_SECRET must be at least 32 characters to hash API keys` | Missing/short secret | Set a 32+ char secret in the server env |
| API key returns 401 | Revoked, expired, or no session/claims | Re-issue; check `expiresAt`/`revokedAt` |
| `At most 10 active API keys are allowed` (409) | Key limit reached | Revoke unused keys |
| Viewer sees write operations in docs | Fetched the public `/api/v1/openapi` instead of `/api/v1/openapi.json` | Use the Qiy-filtered endpoint with auth |
| Mermaid shows raw source | 10s timeout or render error | Check diagram syntax/size; fallback is intentional |

## Related references

- [Auth and permissions](auth-permissions.md) - API-key auth semantics, effective permissions, doc filtering rules
- [UI, charts and i18n](ui-charts-i18n.md) - `qiy.docs.*`, `qiy.apiDocs.*`, `qiy.apiKey.*` copy
- [Language reference](language-reference.md) - `features` position and settings
- [Testing and deployment](testing-deployment.md) - production verification and migrations
- [Troubleshooting](troubleshooting.md) - cross-area errors

## Canonical docs

- [features](https://ai-nodev.github.io/qiy/dsl/features)
- [API docs and keys guide](https://ai-nodev.github.io/qiy/guide/api-docs-and-keys)
- [API and data sources](https://ai-nodev.github.io/qiy/guide/api)
- [permissions: API docs relationship](https://ai-nodev.github.io/qiy/dsl/permissions)

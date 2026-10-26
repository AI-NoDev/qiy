# Generated Refine providers

Use this file when you need to understand or extend the generated Web layer after generation: DataProvider request mapping, AuthProvider login/identity, AccessControlProvider `can()`, LiveProvider, AuditLogProvider, notifications, i18n, routing and kbar. Everything here is generated from the model, so change the model first and keep hand-written code in unowned files.

Canonical reference: https://ai-nodev.github.io/qiy/guide/refine-providers

## Contents

- [Provider matrix](#provider-matrix)
- [DataProvider](#dataprovider)
- [AuthProvider](#authprovider)
- [AccessControlProvider](#accesscontrolprovider)
- [LiveProvider](#liveprovider)
- [AuditLogProvider](#auditlogprovider)
- [Notifications, i18n, router, kbar](#notifications-i18n-router-kbar)
- [Extending safely](#extending-safely)
- [Pitfalls](#pitfalls)

## Provider matrix

`apps/web/app/root.tsx` injects every provider; `apps/web/app/resources.ts` is the shared metadata source (`resources`, `resourceNames`, `getResource`, `menuGroups`, field `type`/`enumValues`/`relation`/`liveMode`/visibility/roles).

| Provider | File | Exports | DSL switch |
| --- | --- | --- | --- |
| `DataProvider` | `app/data-provider.ts` | `dataProvider`, `createDataProvider`, `createGraphQLDataProvider` | `api { client rest\|graphql; }` (overridable by `VITE_QIY_API_TRANSPORT`) |
| `AuthProvider` + `AccessControlProvider` | `app/auth.ts` | `qiyAuthProvider`, `qiyAuthToken`, `fetchCurrentIdentity`, `clearIdentityCache`, `qiyAccessControlProvider` | any `auth` block |
| `LiveProvider` | `app/providers/live-provider.ts` | `qiyLiveProvider`, `createQiyLiveProvider` | `realtime` (requires `auth`) |
| `AuditLogProvider` | `app/providers/audit-log-provider.ts` | `auditLogProvider`, `createAuditLogProvider` | any `auth` |
| `NotificationProvider` | `app/ui/index.tsx` | `useQiyNotificationProvider` | always |
| `i18nProvider` | `app/i18n.ts` | `createI18nProvider`, `resolveLocale`, `getAntdLocale` | `messages` (always present) |
| `routerProvider` | `app/root.tsx` + `app/routes.ts` | `@refinedev/react-router` default | resources/`features`/`actions` |
| kbar | `app/root.tsx` | `RefineKbarProvider`, `RefineKbar` | always |

Helpers: `app/api-error.ts` (`qiyApiError`), `app/messages.ts` (`projectMessages`, `projectMessage`, `defaultMessageLocale`), `app/auth/oidc-client.ts` (single-provider PKCE), `app/auth/oidc-multi.ts` (multi/hybrid callbacks, bind, onboarding), `app/auth/account.ts` (profile identities/unbind).

Generated provider files are listed in `.qiy-generated.json` and are rewritten by `--sync`. `app/extensions/**` and integration-mode `app/host/**` are not.

## DataProvider

REST base is `/api/v1`, GraphQL base is `/graphql`. Every request adds `Authorization: Bearer <qiy.access_token>` when present; there is no refresh, CSRF or automatic retry. An unknown `resource` fails before the request with `Unknown resource: <resource>`.

| Refine method | REST request | Returns |
| --- | --- | --- |
| `getList` | `GET /api/v1/<resource>?page&pageSize&sort&order&search&filters` | `{ data, total }` |
| `getOne` | `GET /api/v1/<resource>/:id` | `{ data }` |
| `getMany` | chunks of 100: `GET /api/v1/<resource>?page=1&pageSize=<n>&filters=[{"field":"id","operator":"in","value":"a,b"}]` | `{ data }` |
| `create` | `POST /api/v1/<resource>` | `{ data }` (201) |
| `update` | `PATCH /api/v1/<resource>/:id` | `{ data }` |
| `deleteOne` | `DELETE /api/v1/<resource>/:id` | `{ data }` |
| `deleteMany` | `DELETE /api/v1/<resource>?ids=a,b` | `{ data }` array |
| `custom` (command) | `POST /api/v1/commands/<flow>` or `/api/v1/orders/:uuid/(submit\|approve\|ship\|cancel)` | `{ data }` |
| `custom` (analytics) | `GET /api/v1/<resource>/(distribution\|trend\|aggregate)` | `{ data: { items } }` or `{ data: { value, operator } }` |

Pagination/sort/search/filter mapping:

| Refine input | Query parameter | Server constraint |
| --- | --- | --- |
| `pagination.currentPage` (default 1) | `page` | min 1 |
| `pagination.pageSize` (default 20) | `pageSize` | max **100** (larger -> 422); generated list pages use 10 |
| `sorters[0]` (first only) | `sort`, `order` (`asc`/`desc`) | sortable field, else 400 `Unsupported sort field` |
| filter field `q` or `__search` | `search` | max 200 chars; list search box uses `__search` |
| other filters | `filters` JSON string | max 50 clauses / 2000 chars; field+operator whitelist |

The generated provider sends the **array** filter shape:

```json
[{"field":"status","operator":"eq","value":"approved"},
 {"operator":"and","filters":[{"field":"price","operator":"gte","value":"10"},
                              {"field":"price","operator":"lte","value":"20"}]}]
```

Array values are joined with commas (`in`/`between`). Operators are `eq`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `between`, `in`; `id` supports all except text operators. Unknown field -> 400 `Unsupported filter field`; bad operator -> 400 `Unsupported filter operator`; invalid JSON -> 400 `Invalid filters`.

`getMany` protections: ids normalized/deduplicated/nulled and truncated to **200**; chunked at **100** per request; a 30-second merged cache keyed by resource + sorted ids with in-flight promise sharing; `create`/`update`/`deleteOne`/`deleteMany`/command POSTs clear it. Ids beyond 200 are silently dropped. GraphQL `getMany` chunks but has no cache.

Errors are always `Error` instances with `statusCode`, plus `errorKey` when the server sends one; `message` is resolved through `projectMessages` with the server `error` text as fallback. Typical statuses: 401 unauthenticated, 403 policy/page denial, 400 bad filter or empty PATCH, 404 not found, 422 body validation.

REST vs GraphQL:

| Aspect | REST | GraphQL |
| --- | --- | --- |
| List | query parameters | `QiyList(page, pageSize, search, sort, order, filters)` |
| Detail | `/:id` | `<apiName>ById(id:)` |
| Writes | POST/PATCH/DELETE | `create*`/`update*`/`delete*`/`delete*Many` |
| Commands | REST command route | **same REST command route** |
| `getMany` | chunk + 30s cache | chunk, no cache |
| Errors | `statusCode` + `errorKey` localization | `statusCode` only, no `errorKey` localization |
| Analytics | REST endpoints | `*Distribution`/`*Trend`/`*Aggregate` fields |

`custom` is allowlisted, not a general escape hatch: POST commands must be declared dataflows (or the fixed order workflow URLs) and GET analytics must be `<resource>/(distribution|trend|aggregate)` for a known resource. Others throw `Unknown workflow command` / `Unknown analytics resource` (GraphQL: `Unknown analytics field` / `Unknown aggregate field`). Analytics validation: `aggregate` op in `sum/avg/min/max` on numeric fields; `distribution` on enum fields; `trend` on `DateTime` with `days` 1..365.

`resources[].liveMode` comes from `realtime` `mode` (`auto`/`manual`, otherwise `off`). Only the generated show route passes it to `useOne`; list pages must pass `liveMode` to `useTable` themselves.

## AuthProvider

| Mode | Login page | Browser implementation |
| --- | --- | --- |
| Local password | `AuthPage` (no register/forgot/remember) | `POST /api/v1/auth/login` |
| OTP | two phases | `/auth/otp/request`, `/auth/otp/verify` |
| Single OIDC | one button + one silent renewal | browser PKCE direct to `VITE_QIY_TOKEN_URL` |
| Multi-provider | buttons from `GET /auth/providers` | `oidc-multi`, callback via `/auth/exchange` |
| Hybrid | password form + provider buttons | local login + `oidc-multi`, new identities go to onboarding |
| Integration | host login extension | delegates to `window.qiyHostAuth` |

Methods: `login` (username/email+password, OTP triplet, `providerName`, or OIDC redirect), `logout` (clears identity/token/flow state; single OIDC also hits IdP logout), `check` (local only, no request), `getIdentity` (`/auth/me`, 60s cache with in-flight merge), `getPermissions` (returns the **role string**, not an array), `onError` (clears identity; 401 logs out, 403 keeps the session). `register`/`forgotPassword`/`updatePassword` are not generated.

Identity cache: TTL 60s keyed by the access token; failed `/auth/me` caches `null` for 60s too; cleared by `logout`, any `onError`, or `clearIdentityCache()`.

Storage keys: `qiy.access_token` (all generated modes), `qiy.id_token` + `qiy.expires_at` (single OIDC/multi), PKCE state in sessionStorage (`qiy.oidc.verifier`, `.state`, `.return_to`, `.provider`, `.mode`, `.silent_attempt`), `qiy.oauth.onboarding` (hybrid). Multi-provider `logout` removes only the access token, not `id_token`/`expires_at`.

Redirects: unauthenticated protected route -> `/auth/login`; local/OTP success -> `/`; provider success -> stored `return_to` or `/`; onboarding -> `/auth/onboarding?token=...`; bind -> `/profile?linked=<provider>`; 401 -> logout -> login; 403 stays on the page.

`check()` verifies only that `qiy.access_token` exists (single OIDC also checks `qiy.expires_at` with a 60s margin). It does **not** verify signature, issuer, revocation, the user row, role changes or account status - the server decides on every request. An expired token counts as logged in until the first 401.

SSR: the Web is `ssr: false`; `check()` returns unauthenticated without `window`, `authHeaders()` is empty, and `createQiyLiveProvider()` returns `undefined`. Use `fetchCurrentIdentity()` where hooks are unavailable.

## AccessControlProvider

`can()` evaluates in order and returns on the first match:

| Order | Condition | Result |
| --- | --- | --- |
| 1 | No identity / `/auth/me` failed | `{ can: false, reason: "Authentication required" }` |
| 2 | `restrict.allow roles` excludes the role | deny |
| 3 | `pages` rule for that action | allow/deny by role |
| 4 | Command policy (`action`/`dataflow` allow) | see below |
| 5 | `action === "audit"` | admin only |
| 6 | role is `admin` | allow |
| 7 | resource is the auth user table | deny (`User administration is restricted`) |
| 8 | role is `operator`, or action is `list`/`show` | allow |
| 9 | otherwise | deny with role/action reason |

Command policy precedence: a verification policy is evaluated in the browser with the same expression semantics; a permission policy requires **all** expanded values when `/auth/me` returned `permissions` (roles are then ignored) and falls back to the role list when permission metadata is absent; a roles-only policy uses the role list. The server re-runs the same rules inside the command route.

Consumers: sidebar `list`, `ResourcePageGuard` (`list`/`create`/`show`/`edit`), create/show/edit/delete buttons, batch delete selection, detail audit panel (`audit`), business and batch actions (by action name, `params.id`/`ids`), manual action pages, kbar actions. `options.buttons.enableAccessControl` + `hideIfUnauthorized` hide rather than disable.

Front-end role changes take up to ~1 minute (60s identity cache + query `staleTime` 30s); the server applies changes on the next request. Field visibility (`@listVisible`/`@formVisible`/`@showVisible`, `pages field roles`) is UI only. Only `restrict mask`, row predicates and `scope` are security boundaries.

## LiveProvider

Generated only with `realtime` (which requires `auth`). Transport is the Ably JS SDK 2.x; the server issues a subscribe-only TokenRequest from `POST /api/v1/realtime/token`. Channels are `qiy:<table>` or `qiy:<table>:<claimValue>` for claim-segmented resources; the client resolves granted channels from the token capability instead of assuming names. Events map to the declared `created`/`updated`/`deleted`; `params.id`/`params.ids` trim callbacks by `payload.id`/`payload.data.id`; unsubscribing calls `channel.unsubscribe`.

`auto` lets Refine invalidate matching queries, `manual` sends events to `onLiveEvent` (not wired by default, so implement it in the page). Token failures: 401 unauthenticated, 403 no channel permission, 503 when `QIY_REALTIME_DISABLED=1`. Dataflow emits go to `qiy:event:<event>` and need a separate subscription. Delivery is at-least-once ([storage-realtime.md](storage-realtime.md)).

## AuditLogProvider

Generated with `auth`; every resource gets `meta: { audit: [] }`. `get` calls `GET /api/v1/audit-logs/?resource&resourceId&action&actorId&page&pageSize` with `cache: "no-store"`; `create`/`update` throw because audit rows are written by the server inside the business transaction and are immutable. Unknown resource -> `Unknown audit resource` before the request; Refine `create`/`update`/`delete` map to `<resource>.created/.updated/.deleted`.

Server contract: 401 unauthenticated; 403 for non-admin (`Audit history is restricted to administrators`); 400 unknown resource; 403 with `Tenant audit history requires persisted scope metadata` when the resource has `scope` (fail-closed); otherwise `{ data, total }`, `pageSize` <= 100. Rows are `{ id, resource, action, createdAt, author: { id, name, deleted } | null, meta: { id } }`; deleted actors keep their id and set `deleted: true`.

The detail-page `AuditHistory` panel uses `useLogList` and is wrapped in `CanAccess action="audit"` (admin only). The server rejects again.

## Notifications, i18n, router, kbar

- `NotificationProvider`: `useQiyNotificationProvider` is `@refinedev/antd`'s `useNotificationProvider`, mounted inside the antd `App`/`ConfigProvider`. Use `useNotification()` or Refine mutation notifications; do not use static antd `message` in generated pages.
- `i18nProvider`: `createI18nProvider(locale, setLocale)` uses one i18next instance with `keySeparator: false`, `nsSeparator: false`, escaping off; merges Refine messages + built-in chrome + project messages; `changeLocale` persists `qiy.locale`; `getAntdLocale` feeds `ConfigProvider`. Error keys live in the same `messages` block.
- `routerProvider`: `@refinedev/react-router`; routes are `auth/login`, `auth/callback`, `oauth/*`, `auth/onboarding`, `profile`, `/` (overview), `/system/{overview,api-docs,api-keys}` (per `features`), and `/:resource`, `/:resource/new`, `/:resource/:id`, `/:resource/:id/edit`, each wrapped in `ResourcePageGuard`.
- kbar: `RefineKbarProvider` wraps `<Refine>` and `<RefineKbar />` renders inside it (Ctrl/Cmd+K). Actions are generated from resources, filtered by `can()`, and labeled via i18n. Register custom actions in an unowned component with `useRegisterActions`.

## Extending safely

Prefer the model: `api.client`, `auth`, `pages`/`restrict`, `allow`, `scope`/`mask`, `realtime`, `messages`, `features`. Generated provider files are manifest-owned; `--sync` rewrites them.

For genuinely custom behavior, use unowned files: `app/extensions/**` (manual action pages), `app/plugins/**`, `app/hooks/**`, integration `app/host/**`. Factories such as `createDataProvider`, `createQiyLiveProvider`, `createAuditLogProvider` and `createI18nProvider` can be composed/wrapped without editing judgment logic. Host wrappers can add an outer `ConfigProvider`.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Login works but every page 403 | Role excluded by `restrict.allow roles` or `pages` | Check `can()` branch; adjust model rules |
| Menu only shows overview | `viewer` blocked or no `list` permission | Same |
| Direct `/{resource}/new` shows 403 | Page guard denies `create` | Expected; change `pages` or role |
| List 422 | `pageSize > 100` or non-integer `page` | Use server pagination defaults |
| 400 `Unsupported filter field` | Filtering a non-filterable field | Generate filters from `filterable`/`filterModes` |
| 400 `Invalid filters` | Hand-built filters in the wrong shape | Send `[{ field, operator, value }]` |
| FK cell shows `-` or an id | `getMany` failed: >200 ids, field without `in`, or stale 30s cache | Inspect the `filters=` request; remount if needed |
| Many `/auth/me` calls | Identity cache cleared repeatedly or token rewritten | Check `onError`/`logout` frequency and token writes |
| Logged out on 403 | Custom fetch wrapper treats 403 as 401 | Only 401 logs out |
| Multi-provider login succeeds but all pages 403 | No users row (multi mode never creates accounts) | Pre-create rows and identity columns, or use hybrid |
| `bind`/`unbind` 409 | Identity owned by another account / last login method | Bind from the original account; set a password or bind another provider first |
| Audit panel 403 | Not admin, or the resource has `scope` | Use admin; tenant audit needs persisted scope metadata |
| Audit panel 400 `Unknown audit resource` | Entity name instead of table name | Pass `resource.name` (table name) |
| List does not refresh live | `useTable` has no `liveMode` | Pass `liveMode: resource.liveMode` |
| Detail receives no events | Role not in `realtime.roles`, or segmented claim missing | Check token capability and claims |
| Command button throws `Unknown workflow command` | Undeclared command URL or non-POST | Declare a `dataflow`/`action` |
| GraphQL errors are not localized | GraphQL errors carry no `errorKey` | Use the REST client or map messages yourself |
| `qiy.id_token` remains after logout | Multi-provider logout only clears the access token | Clear it yourself or use hybrid |
| Custom provider overwritten by `--sync` | File is in `.qiy-generated.json` | Move it to an unowned path |

## Related references

- [Auth and permissions](auth-permissions.md) - login modes, roles, policies backing `can()`
- [Dataflows and actions](dataflows-actions.md) - commands, `allow`, idempotency keys
- [Storage and realtime](storage-realtime.md) - LiveProvider transport and outbox
- [UI, charts and i18n](ui-charts-i18n.md) - theme, i18n, charts used by pages
- [Testing and deployment](testing-deployment.md) - provider tests and acceptance

## Canonical docs

- [Refine providers](https://ai-nodev.github.io/qiy/guide/refine-providers)
- [API and data sources](https://ai-nodev.github.io/qiy/guide/api)
- [auth guide](https://ai-nodev.github.io/qiy/guide/auth)
- [realtime](https://ai-nodev.github.io/qiy/dsl/realtime)

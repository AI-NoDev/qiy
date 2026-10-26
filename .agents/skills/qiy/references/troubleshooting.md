# Troubleshooting

Use this file when something fails and you need the likely cause and exact fix. Find the symptom or error string, apply the fix, then re-run generation/typecheck/tests. Deeper explanations live in the area references linked per section.

Stable error codes: run `qiy explain --errors` (or `--errors --json`) and see https://ai-nodev.github.io/qiy/dsl/errors. `qiy explain <file> --json` attaches `code`/`fix` to parse failures when the error is in the catalog.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/overview

## Contents

- [Validation and generation errors](#validation-and-generation-errors)
- [Modeling errors](#modeling-errors)
- [Auth and permission errors](#auth-and-permission-errors)
- [Dataflow and command errors](#dataflow-and-command-errors)
- [Storage and realtime errors](#storage-and-realtime-errors)
- [CLI and workspace errors](#cli-and-workspace-errors)
- [Build, test and CI failures](#build-test-and-ci-failures)
- [Deployment failures](#deployment-failures)

## Validation and generation errors

| Error | Stage | Cause | Fix |
| --- | --- | --- | --- |
| `Unexpected Qiy syntax at offset N` | Lexer | Unquoted `:`/`[`/`/`/`*`/`$`/non-ASCII, or an unsupported symbol | Quote the value; use only supported structure symbols ([language-reference.md](language-reference.md)) |
| `Expected database near token N` | Parser | `database` is not the first declaration in `application` | Move it first |
| `Expected <block> near token N` | Parser | Declaration order violated (enum after entity, menu after dashboard, ...) | Reorder per the declaration-order table |
| `Expected <end> near token N` | Parser | Extra content after the application `}` or a missing brace | Check braces |
| `Expected ; near token N` | Parser | Missing `;` on a declaration, or a `;` after a block `}` | Add/remove it |
| `Expected value near token N` | Parser | Number/symbol where a string or identifier is required | Quote it or use an identifier |
| `Unsupported field type X` | Parser | Not one of the 11 types + declared enums | Use `Text`/`Integer`/`Decimal`/... ([modeling-and-generation.md](modeling-and-generation.md)) |
| `Unsupported field attribute @X` | Parser | Annotation not allowed on fields, or typo | Check the annotation inventory |
| `duplicate ... annotation` | Parser | Same annotation twice where duplicates are rejected | Keep one |
| `Missing default locale message for <purpose>: <key>` | Parser | `t("key")` missing from the default locale, or `messages` declared too late | Add the key; move `messages` before enums/entities |
| `Invalid message locale X: use a canonical BCP 47 language tag` | Parser | `fr_fr`, `FR-fr`, `en-us` | Use `fr-FR`, `en-US`, ... |
| `Missing default message locale X` | Parser | `default` has no matching `locale` block | Add the block |
| `Unsupported database dialect X` | Parser | Typo | `postgresql`/`mysql`/`sqlite` |
| `Unsupported UI library mui; only antd is implemented` | Parser | Non-AntD UI library | `library antd;` |
| `UI default theme X must be included in themes` | Parser | `theme` not in `themes` | Add it |
| `Unsupported include selector ...` | Include | Selector other than `@messages`/`@message` | Include the whole fragment or use `@messages` |
| `include path cannot contain ..` / `include path must be relative ...` | Include | Escaping the model directory | Keep fragments under the model root |
| `Qiy include cycle detected: a -> b -> a` | Include | Cyclic includes | Break the cycle |
| `Invalid Ant Design icon X` | Generation | Icon name is not `*Outlined` | Use an Ant Design icon name |
| `X: V0 CRUD requires exactly one UUID primary key named id` | Generation | Missing/renamed/retyped PK | `field id UUID @id` |
| `X: route path must be lowercase and URL-safe` | Generation | Uppercase/invalid `table` name | `^[a-z][a-z0-9_-]*$` |
| `required field cannot be hidden from the create form` | Generation | Non-null field hidden by `@visible(false)`/`@formVisible(false)` | Add `@nullable` or keep it visible |
| `V3 foreign keys require UUID fields` | IR | Non-UUID relation endpoint | Both endpoints `UUID` |
| `only one-to-one/many-to-one foreign keys are supported` | IR | Relation cardinality `many` | Use `one`; model M2M with a join entity |
| `target field must be primary or unique` | IR | Relation targets a non-unique field | Target the PK or add `@unique` |
| `setNull requires a nullable source field` | IR | `@onDelete(setNull)` on a non-null FK | Add `@nullable` |
| `Vector requires PostgreSQL and a declared pgvector extension` | IR | Wrong dialect or missing extension | PostgreSQL + `extension pgvector;` + `@extension(pgvector)` |
| `hnsw requires PostgreSQL and pgvector` | IR | Vector index on another dialect | PostgreSQL + pgvector |
| `Files cannot be a primary key` / `Files cannot be unique` | IR | `Files` used as PK/unique | Use `File` or a scalar key |
| `duplicate entity or table name` | IR | Repeated include or name collision | Include once; unique names |
| `X: duplicate @singular annotation` | Parser | Duplicate display annotation | Keep one |
| `... cannot interpolate foreign key field X` | Generation | Display template references an FK source | Reference the target's scalar field |
| `Output directory must be empty` | CLI | Non-empty target without `--sync` | New directory, or `--sync` on a Qiy-generated workspace |

## Modeling errors

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| Foreign key filled with a random UUID at create | No `relation` declared, so the UUID is treated as a system value | Declare `relation` |
| `@code requires a Text field without an enum` | `@code` on UUID/enum | Use a non-enum `Text` field |
| `@generated(uuid) requires a UUID field` | `@generated` on Text | Use `@code` or a UUID field |
| `@code and @generated cannot be combined` | Both on one field | Keep one |
| `the pattern needs {seq}, {count+1}, {random:…} or {uuid}` | Code template has no uniqueness token | Add `{seq:N}` or `{random:N}` |
| `unknown token {X}` | Typo in a code template | Use only documented tokens |
| `QIY_CODE_TIMEZONE is not a valid IANA timezone` | Bad env value | Use `Asia/Shanghai`, etc. |
| Create returns 409 `generated.conflict` | Five uniqueness retries exhausted | Raise template entropy/width |
| `Field type Text has no parameters` | Parentheses on a non-parameterized type | Remove them; enforce length in migrations/business code |
| `Unsupported field attribute @required` | Fields have no `@required` | Required is default; use `@nullable` |
| `dimension requires Vector` / `precision and scale require Decimal or Money` | Annotation/type mismatch | Match the annotation to the type |
| Chart/label/menu errors | See [ui-charts-i18n.md](ui-charts-i18n.md) | - |

## Auth and permission errors

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `Auth: roleField must be an enum with admin, operator and viewer values` | Role enum has extra/missing values | Declare exactly those three |
| `Auth: usernameField must be a required unique Text field` | Column contract violated | Make it non-null, unique, Text |
| `Auth: passwordField must be a nullable Text field ...` | Hash column not nullable | Make it `@nullable` Text |
| `Auth: subjectField must be a required unique Text field` | Missing/duplicate subject | Non-null unique Text |
| `Auth: provider X subjectField Y must be nullable` | Per-provider identity column not nullable | `@nullable` + `@unique` |
| `Auth: OAuth onboarding cannot populate required user fields: ...` | Required columns other than the auto-filled ones | Make them nullable |
| `Auth accepts either provider or providers, not both` | Both keys used | Keep one |
| `Auth providers cannot include otp` | `otp` inside `providers` | Use `provider otp;` |
| `Auth provider local requires usernameField and passwordField` | Local login incomplete | Add both |
| `Permission declarations require a generated auth block` | `permission` without `auth` | Add `auth` or remove permissions |
| `Permission declarations require at least one permission field` | Only groups/verifications | Declare a `permission field` |
| `provider is not a configured OAuth/OIDC provider` | Claim source provider missing | Add it to `providers` |
| `local and otp sessions do not carry claims` | Claim source uses local/otp | Use a database column instead |
| `Data scope claim org.id needs a matching field on users (expected orgId)` | Local/hybrid scope claim has no users column | Add `orgId` |
| `Missing required data scope claim: <claim>` (403) | Principal lacks the claim | Use OIDC, add the users column, or use an API key |
| `Restrict X: row conditions cannot target primary key id` | Row predicate on the PK | Use a non-PK column |
| `Restrict X: row condition on nullable field Y is not supported` | Claim predicate on nullable column | Use a non-null column or `mask` |
| `Restrict X: > on amount must compare two fields` | Literal used with `>`/`<` | Literals only with `==`/`!=`/`in`/`notIn` |
| `Restrict X: mask mode redact for Y requires a replacement string` | Missing replacement | Add `replacement "***"` |
| `Restrict X: dataflow Y cannot use a restricted resource ...` | Command touches any resource with a `restrict` block | Remove the resource from the command or drop `restrict` |
| `when scope requires a matching scope declaration` | `scope` atom without `scope` | Declare `scope` for that resource |
| `Page access denied` (403) | `pages` disallows the action | Adjust `pages`; export uses `list`, import writes use `create` |
| Login page has no provider buttons | Provider env block incomplete | Fill `QIY_OIDC_<ID>_ISSUER/AUDIENCE/JWKS_URL/AUTHORIZATION_URL/CLIENT_ID` |
| 401 immediately after login | Token `iss` differs from the configured issuer | Use the discovery issuer verbatim |
| `State mismatch in the provider callback` | Concurrent logins or cleared sessionStorage | Log in again |
| `The provider token exchange failed` | Redirect mismatch, missing secret, unreachable token endpoint | Align redirect/secret; set `HTTPS_PROXY` |
| Onboarding 409 | Username/email exists or identity belongs to another account | Change username or bind from the original account |
| Unbind 409 | Last login method | Set a password or bind another provider |
| OTP 502 `auth.otpDeliveryFailed` | Delivery adapter unreachable/non-2xx/non-HTTPS | Fix `QIY_OTP_DELIVERY_URL`, token, timeout |
| API key 401 | Revoked/expired | Re-issue |
| `At most 10 active API keys are allowed` (409) | Key limit | Revoke unused keys |
| `QIY_AUTH_SECRET must be at least 32 characters` | Missing/short secret | 32+ chars in a secret manager |

## Dataflow and command errors

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `Dataflow X requires input, context, and result blocks` | Missing block (even empty) | Write `input {}`, `context {}` |
| `result must return a declared context binding` | Returned an undeclared name | Return a context/create binding |
| 400 `A valid Idempotency-Key header is required` | Flow requires idempotency, no key sent | Send the header; generated actions do it |
| 409 idempotency body mismatch | Same key, different body | Use a new key for a new request |
| `cannot update scope field` | Command writes a scope column | Scope derives from the principal |
| `cannot update password field` | Command writes the auth password hash | Remove it |
| `create requires value for <entity>.<field>` | Non-null field not assigned | Assign it or make it `@nullable` |
| `create primary key ... is generated automatically` | Assigning `id` in `create` | Remove the assignment |
| `literal updates currently support Text and enum fields only` | Literal used for Integer/Decimal/Date | Use a matching `input.<f>` or `call` |
| `require comparisons support Text, enum and Integer fields only` | Compared Decimal/Boolean/Date | Validate in a `call` adapter or redesign |
| `require input must be @required` | Optional input used in `require` | Mark it `@required` |
| `context bindings must declare @required ...` | Missing `@required` on a context binding | Add it |
| 404 `Not found` + `resource` | Context record missing or out of scope | Check the id and data scope |
| 403 `command.forbidden` | `allow permission`/`allow verification` denied | Inspect `/auth/me` permissions/groups |
| `call` always 409 | Extension handler still fail-closed | Implement it in `extensions/dataflow-calls.ts` and return `{ ok: true }` |
| Batch 400 `Batch item identifiers must be unique` | Duplicate IDs | Deduplicate |
| Batch action rejected | Missing `batch true`, idempotency, list-only placement, or a `when` | Follow batch constraints |
| GraphQL mutation missing `idempotencyKey` | Flow requires idempotency | Pass the argument |
| Button not rendered | `when` mismatch, `CanAccess` denial, missing permission metadata | Check record, role, `/auth/me` |
| Manual page overwritten by `--sync` | Code outside `app/extensions/` | Move it into `app/extensions/` |

## Storage and realtime errors

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| Upload 415 | MIME not allowed, or `@upload` disallows the encoding | Adjust field/request |
| Upload 403 | Caller is `viewer` | Use admin/operator |
| Upload 409 `Storage key already exists` | Duplicate key | Generate a unique key |
| `Invalid storage key` (400) | Illegal segments or > 240 chars | Use `resource/<uuid>/<name>` |
| Download 404 | Not owner/admin, or metadata missing | Use the uploader account; `QIY_STORAGE_METADATA=database` |
| Files unreadable after restart | In-memory metadata | Set `QIY_STORAGE_METADATA=database` and migrate |
| `QIY_STORAGE_METADATA=database is required for production file metadata` | Production startup check | Fix `.env.production` |
| Upload succeeded but field empty | Key must be written to the entity | Let the form do it, or PATCH the key |
| Signed URL `null` | `local` provider has no presigning | Use the protected download endpoint |
| Orphan scan removes nothing | Dry-run default | Add `--apply` |
| `Realtime requires generated authentication` | No `auth` | Add `auth` |
| `Realtime X: restrict row predicates cannot be enforced on a shared channel` | Row predicate + realtime | Remove the predicate or realtime |
| `a claim-scoped channel already isolates rows; remove the restrict row predicates` | Both isolation styles | Keep the claim channel |
| `claim field X must be non-nullable` | `when` field nullable | Make it non-null |
| `/api/v1/realtime/token` 403 | Missing claim for a segmented channel | Add the claim or drop `when` |
| `/token` 503 `Realtime is disabled` | `QIY_REALTIME_DISABLED=1` | Unset it |
| Dead letters grow | Ably unreachable/wrong key/retry cap | Check health/dead, fix, replay |
| Page receives no events | Role not allowed or capability/channel mismatch | Check `roles`, claims, token capability |
| Events miss fields | A `mask` applies to a subscribable role | Adjust mask/roles |

## CLI and workspace errors

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `qiy is not recognized` | Not on `PATH` | Add it, reopen the terminal |
| `qiy init requires packageManager to declare Bun` | No Bun declaration in the host `package.json` | Add `"packageManager": "bun@<version>"` |
| `Refusing to overwrite existing host file` | Alias/script collision | Change `workspace.aliases`/`name` |
| `Unknown command: dev` | Qiy has no dev/build/deploy subcommand | Run `bun run dev` in the generated workspace |
| `application mode integration requires an integration block` | `mode integration` without settings | Add `integration { apiBase ... }` |
| `application mode integration must be mounted with qiy init ...` | Used `create`/`generate` | Run `qiy init` in the host |
| `application mode integration cannot configure generated server features` | Server blocks in an integration model | Remove `auth`/`storage`/`env`/`dataflow`/... |
| `integration apiBase must be an absolute http(s) URL or a path starting with /` | Relative `apiBase` | `/api/v2` or a full URL |
| `Integration auth options are only supported for cookie transport` | `csrfCookie` outside `auth cookie` | Move it |
| `integration tenant requires header and identity` | Half a tenant config | Provide both |
| `Qiy skill has local changes` | Official skill files edited | `qiy skill install --force` |
| `qiy skill install` writes to the wrong place | Legacy `.agent/skills/qiy` exists | Remove/rename it, or use `--dir` |

## Build, test and CI failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `tsc --noEmit` errors in generated code after a model edit | Generated files out of sync with the model | Re-run generation/`--sync`, then typecheck |
| Typecheck passes locally but CI installs a different dependency set | Generated `package.json` changed; lockfile stale | `bun install` in the generated workspace and commit the lockfile |
| `bun test` scenario tests refuse to run | PostgreSQL/MySQL without `QIY_TEST_DATABASE_URL` (or not `qiy_test_*`) | Create/migrate a dedicated test DB and set both variables |
| Scenario test wipes data | Tests clear model tables | Never point them at a business database |
| Scenario test fails on FK cleanup | Cyclic foreign keys | Remove the cycle; generation rejects it too |
| Realtime tests fail without Ably | They should force `QIY_REALTIME_DISABLED=1` | Do not set a real key in unit tests |
| Snapshot/SSR tests fail without `window` | Code assumes browser APIs | Use the generated `useQiyUiOptional()`/SSR-safe helpers |
| `preview` works, CI build fails | Preview uses an in-memory repository and dev env | Build with the production env requirements |
| Docs/skill assets stale in CI | `bun run docs:assets`/`skill:build` not run | Run them and commit generated assets |
| Release workflow skips | A Release already exists for that version | Do not recreate tags for an existing version |

## Deployment failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits at startup | No `auth` and `QIY_DEV_MODE` unset | Configure auth; never ship `QIY_DEV_MODE=1` |
| Migration runs twice/fails under replicas | SQLite has no cross-process lock, or DB lock privilege missing | Migrate from one process; grant lock privileges |
| `drift: <table>.<column>: ...` after deploy | Schema differs from `src/schema.ts` | Generate the missing migration; do not hand-edit applied SQL |
| Rollback refuses | Missing `drizzle/down/<tag>.sql` or `--confirm` | Create/review reverse SQL; pass `--confirm` |
| Restore refuses | Dialect/table-set mismatch or missing `--confirm` | Restore into a matching schema with both flags |
| Browser deep link 404 | No SPA fallback | `try_files $uri $uri/ /index.html` |
| Cross-origin 401 | CORS origin mismatch or auth headers not allowed | Exact origins including ports |
| Exports 400 `export.tooLarge` | Row cap (`QIY_EXPORT_MAX_ROWS`) | Narrow filters or raise the cap deliberately |
| Imports partially applied | Compensating delete on failure | Fix the reported line; no partial rows remain |
| Health 503 after deploy | DB/Ably unavailable or realtime thresholds exceeded | Check DB connectivity, realtime health/dead endpoints |
| S3 upload works locally, fails in cluster | Local storage on one replica | Use `s3` or a shared volume; `QIY_STORAGE_METADATA=database` |

## Related references

- [Language reference](language-reference.md) - syntax and declaration order
- [Modeling and generation](modeling-and-generation.md) - modeling errors
- [Auth and permissions](auth-permissions.md) - 401/403 and policy errors
- [Dataflows and actions](dataflows-actions.md) - command errors
- [Storage and realtime](storage-realtime.md) - upload and outbox errors
- [CLI workflows](cli-workflows.md) - CLI/workspace errors
- [Testing and deployment](testing-deployment.md) - CI and production failures

## Canonical docs

- [DSL overview and common errors](https://ai-nodev.github.io/qiy/dsl/overview)
- [application errors](https://ai-nodev.github.io/qiy/dsl/application)
- [permissions](https://ai-nodev.github.io/qiy/dsl/permissions)
- [deployment](https://ai-nodev.github.io/qiy/guide/deployment)

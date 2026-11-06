# Storage and realtime

Use this file when you add file uploads/downloads, choose a storage provider, plan attachment cleanup, or declare realtime subscriptions (SSE transport, roles, claim channels, masking).

Canonical reference: https://ai-nodev.github.io/qiy/dsl/realtime (`/guide/storage`)

## Contents

- [storage block](#storage-block)
- [File and Files fields](#file-and-files-fields)
- [Storage columns and API contract](#storage-columns-and-api-contract)
- [Upload endpoints and validation](#upload-endpoints-and-validation)
- [Attachment metadata and permissions](#attachment-metadata-and-permissions)
- [Resumable uploads](#resumable-uploads)
- [Storage environment variables](#storage-environment-variables)
- [Cleanup](#cleanup)
- [Realtime grammar](#realtime-grammar)
- [Modes, events and channels](#modes-events-and-channels)
- [Transports](#transports)
- [Outbox and environment](#outbox-and-environment)
- [Realtime limits](#realtime-limits)
- [Pitfalls](#pitfalls)

## storage block

```qiy
storage { provider local; }   // or storage { provider s3; }
```

| Item | Rule |
| --- | --- |
| Position | Inside `application`, after `elysia` and before `auth` |
| Keys | Only `provider` |
| Values | `local` or `s3` (`Unsupported storage provider X`) |
| Default | Omitted means `provider local` (`QIY_STORAGE_PROVIDER` defaults to `local`) |
| Effect | Sets the runtime `QIY_STORAGE_PROVIDER` default, whether S3 variables are generated, and the target of `attachments:*` tools |

Storage is a **protected endpoint**, not a public static directory: every download is authenticated and ownership-checked. Metadata (size, MIME, owner, resource) is managed next to the object.

## File and Files fields

```qiy
field datasheet File
  @nullable
  @label("Datasheet")
  @upload(both)
  @maxBytes(10485760)
  @mime("application/pdf")
  @maxFiles(1);

field attachments Files
  @nullable
  @upload(base64)
  @maxBytes(5242880)
  @mime("application/pdf", "image/*")
  @maxFiles(5);
```

```text
field <name> ( "File" | "Files" ) ( "@upload(" ( "binary" | "base64" | "both" ) ")"
  | "@maxBytes(" <int> ")" | "@mime(" <mime> ( "," <mime> )* ")" | "@maxFiles(" <int> ")" )* ";"
```

| Attribute | Applies to | Default | Validation |
| --- | --- | --- | --- |
| `@upload(binary\|base64\|both)` | File/Files | `binary` | `File upload mode must be binary, base64 or both`; non-file field -> `@upload is only valid for File and Files fields` |
| `@maxBytes(n)` | File/Files | `26214400` (25 MiB, per file) | 1..104857600 (100 MiB): `File maxBytes must be between 1 and 104857600` |
| `@mime("a/b", "image/*")` | File/Files | `*/*` | Lowercased, must match `type/subtype` or `type/*`; empty/duplicate rejected; at least one |
| `@maxFiles(n)` | `File` only `1`; `Files` 1..20 | `Files` defaults to `6` | `File fields support maxFiles(1); declare the field as Files for multiple files`; `Files maxFiles must be between 1 and 20` |
| Other field annotations | - | - | `@nullable`, `@label`, `@comment`, `@formVisible`, ... work as usual |

Hard constraints: `File`/`Files` cannot be a primary key; `Files` cannot be `@unique` and is not sortable/filterable by default; contradictory modifiers such as `File @maxFiles(2)` are rejected; display templates cannot interpolate `File`/`Files`.

## Storage columns and API contract

| Field | PostgreSQL | SQLite | MySQL |
| --- | --- | --- | --- |
| `File` | `text` | `text` | `text` (`varchar(255)` when unique/indexed) |
| `Files` | `jsonb` (`string[]`) | `text` with `mode:"json"` | `json` |

`File` stores one storage key; `Files` stores an array of keys, each with its own metadata and object. Downloads, signing, ownership and orphan scanning reuse the single-file logic.

| Location | `File` | `Files` |
| --- | --- | --- |
| REST body | `string` (1..240) | `string[]` (`minItems: 1`, `maxItems: @maxFiles ?? 6`) |
| GraphQL | `String` | `[String!]` |
| CSV import | Supported | **Not imported** (`Files` columns are excluded) |
| List/form | Single upload control + preview/download | Multi-file control (`maxCount = @maxFiles`) |

## Upload endpoints and validation

| Method | Path | Purpose | Role |
| --- | --- | --- | --- |
| `POST` | `/api/v1/files?key&resource&field[&fileName&contentType&resourceId]` | Binary upload (`request.blob()`) | `admin`/`operator` |
| `POST` | `/api/v1/files/base64` | JSON upload `{ key, data, contentType, resource, field, ... }` | `admin`/`operator` |
| `GET` | `/api/v1/files?key=` | Read object (authenticated stream) | Owner or `admin` |
| `GET` | `/api/v1/files/metadata?key=` | Attachment metadata | Owner or `admin` |
| `GET` | `/api/v1/files/signed?key=` | Signed URL (S3: 300s presigned; local: `null`) | Owner or `admin` |
| `DELETE` | `/api/v1/files?key=` | Delete object + metadata | `admin` only |
| `POST` | `/api/v1/files/upload-sessions` | Start a resumable session | `admin`/`operator` |
| `GET` | `/api/v1/files/upload-sessions/:id` | Received byte count | Session creator |
| `PUT` | `/api/v1/files/upload-sessions/:id?offset=n` | Append a chunk; offset must equal bytes received | Session creator |
| `POST` | `/api/v1/files/upload-sessions/:id/complete` | Merge + validate + persist | Session creator |
| `DELETE` | `/api/v1/files/upload-sessions/:id` | Abandon session | Session creator |

Server-side validation order (authoritative; frontend checks are only UX):

1. Storage key shape (each segment `[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*`, <= 240 chars) -> 400 `Invalid storage key`.
2. `resource + field` must match a declared file field -> 400 `Unknown file field` (fail-closed).
3. Encoding mode (`binary`/`base64`/`both`) -> 415 `File field does not accept <enc> uploads`.
4. Key already exists (metadata or object) -> 409 `Storage key already exists`.
5. Size <= `@maxBytes` -> 413 `File is too large`.
6. MIME matches `@mime` (`image/*` supported) -> 415 `File MIME type is not allowed`.
7. Write object, then metadata; if metadata fails the written object is deleted (minimize orphans).

## Attachment metadata and permissions

| Mode | Storage | Trigger |
| --- | --- | --- |
| In-process (default) | `Map` | `QIY_STORAGE_METADATA` is not `database` |
| Database | `attachments` table | `QIY_STORAGE_METADATA=database` + `DATABASE_URL` |

**Production servers require database metadata**: `server.ts` throws when `QIY_STORAGE_METADATA !== "database"` at startup, because in-memory metadata is unreliable across replicas/restarts. Generated `.env` files already set `database`.

| Operation | Rule |
| --- | --- |
| Read/download/metadata/signed | `principal.id === metadata.ownerId` or `principal.role === "admin"`; otherwise 404 (existence is not disclosed) |
| Upload | `admin`/`operator` (`viewer` gets 403 `Permission denied`) |
| Delete | `admin` only |
| Missing metadata | Always 404; access is never "restored" from a cache |

`resource`/`resourceId`/`fileName`/`contentType`/`size`/`ownerId` are recorded from the upload request for audit and cleanup. Deleting an entity row does **not** delete objects.

## Resumable uploads

- Session state is in **process memory**, TTL 1 hour; multi-replica deployments need sticky sessions or a shared session table.
- `PUT` offset must exactly equal bytes already received, else 409; exceeding `@maxBytes` returns 413.
- `complete` re-validates MIME and upload mode; an empty session is 400. S3 presigned PUT / native multipart **is not implemented** - uploads always pass through the server.
- `Files` is one request per file: the frontend uploads each selection and collects keys. There is no atomic multi-file upload, so a failure at file N leaves N-1 objects behind (clean them with the orphan scan).

## Storage environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `QIY_STORAGE_PROVIDER` | `local` (or the model value) | `local`/`s3`; other values throw at runtime |
| `QIY_STORAGE_ROOT` | `<server>/../../storage` (generated `.env` uses `./storage`) | Local provider root |
| `QIY_STORAGE_METADATA` | `database` (generated `.env`) | `database` uses the attachments table; required in production |
| `QIY_S3_BUCKET` | empty | **Required** (`S3 bucket is required`) |
| `QIY_S3_REGION` | empty | S3 region |
| `QIY_S3_ENDPOINT` | empty | S3-compatible endpoint (R2/MinIO) |
| `QIY_S3_ACCESS_KEY_ID` / `QIY_S3_SECRET_ACCESS_KEY` | empty | Credentials; server only |
| `QIY_S3_SESSION_TOKEN` | empty | Session token for temporary credentials |
| `QIY_ATTACHMENT_ORPHAN_LIMIT` | `1000` (code cap 10000) | Orphan scan batch size (`attachments:orphans` reads only this variable, no `--limit`) |
| `QIY_ATTACHMENT_CLEANUP_LIMIT` | `1000` (code cap 10000) | Missing-metadata cleanup batch size |

S3 uses Bun's native `Bun.S3Client` (no AWS SDK) with `save/open/exists/delete/presign/list`; `list()` pages at 20x1000 keys to avoid unbounded scans from a misconfigured bucket.

## Cleanup

```qiy
elysia {
  cron { job attachmentCleanup pattern "0 0 * * *" task cleanupMissingAttachments; }
}
```

| Direction | Command | Effect |
| --- | --- | --- |
| Metadata exists, object missing | `bun run attachments:cleanup` (dry-run by default; `--apply` executes) | Delete attachment rows whose file is gone; the `cleanupMissingAttachments` cron deletes them explicitly |
| Object exists, metadata missing | `bun run attachments:orphans` (dry-run by default; `--apply` executes) | List/delete objects without records; prints `{ objects, metadata, orphans, missingObjects, removed, dryRun, truncated }` |

Both require `QIY_STORAGE_METADATA=database` and `DATABASE_URL`; `removed` is non-zero only with `--apply`. Batch size comes from `QIY_ATTACHMENT_ORPHAN_LIMIT` / `QIY_ATTACHMENT_CLEANUP_LIMIT` (default 1000, cap 10000); an over-limit orphan scan sets `truncated: true`. Deletes are irreversible and may incur S3 delete costs - dry-run, review, then apply. Already-issued S3 URLs remain valid until they expire.

## Realtime grammar

`realtime` requires generated `auth` and sits with the other config blocks. It is rejected in `mode integration`.

```text
realtime "{" [ "mode" ( "auto" | "manual" ) ";" ]
  ( "resource" <entity> "{"
      "events" ( "created" | "updated" | "deleted" ) ( "," … )* ";"
      "roles" role ( "," role )* ";"
      [ "when" <field> "claim" <claim> ";" ]
    "}" )+
"}"
```

```qiy
realtime {
  mode auto;
  resource orders {
    events created, updated, deleted;
    roles admin, operator, viewer;
  }
  resource stock_movements {
    events created;
    roles admin, operator;
    when warehouseCode claim warehouse.code;
  }
}
```

| Element | Required | Default | Validation |
| --- | --- | --- | --- |
| `mode` | no | `auto` | Only `auto`/`manual` (`Unsupported realtime mode`) |
| `resource <r>` | yes (>=1) | - | Entity or table name, normalized to table name; unknown/duplicate rejected |
| `events` | yes | - | At least one, no duplicates; only `created`/`updated`/`deleted` |
| `roles` | yes | - | At least one, no duplicates; declared roles only (default admin/operator/viewer); defines who may subscribe to the resource channel |
| `when <field> claim <claim>` | no | none | Field must exist, be **non-nullable**, and be `Text` or `Integer`; claim may contain dots |
| Whole block | - | - | At least one resource; without `auth` -> `Realtime requires generated authentication`; `mode integration` rejected |

## Modes, events and channels

| Mode | Client behavior |
| --- | --- |
| `auto` | The generated LiveProvider makes Refine refresh matching `useTable`/`useOne`/`useMany` queries (detail pages match by `id`, batch pages by `ids`) |
| `manual` | Events go to Refine `onLiveEvent`; the page decides what to do |

**Important limitation**: the generator only passes `liveMode` to detail (show) pages. Generated list pages use `useTable` without `liveMode`, so they do **not** auto-refresh. Add `liveMode` (`auto`/`manual`) manually in a custom list page if you need it.

Record-level trimming: `subscribe({ params: { id } })` or `params: { ids: [...] }` only invokes the callback when `record.id` (or `data.id`) matches. Without those params the subscriber receives all events for the resource.

Channels: `qiy:<table>` for resource events and `qiy:<table>:<claimValue>` for claim-segmented resources; dataflow emits use `qiy:event:<event>`. The server computes the granted channels per connection (`realtimeCapabilities(principal)`) and only ever writes events from those channels to the stream; the browser has no way to publish.

Permission model (a channel is shared by all subscribers, so per-subscriber row filtering is impossible server-side):

| Constraint | Mechanism |
| --- | --- |
| Who may subscribe | `roles` -> `realtimeCapabilities(principal)`; anonymous 401, no granted channel 403 |
| Which channels | Computed at connect time; the first `event: ready` frame lists them |
| Field masking | Payload is trimmed **before enqueue** for every `mask` that applies to a subscribable role (global masks and `claim present/absent` masks); masks that only apply to non-subscribable roles are not applied |
| Row isolation | Impossible on a shared channel, so a resource with a `restrict` row predicate (`when`) is **forbidden** from realtime: `restrict row predicates cannot be enforced on a shared channel` |
| Tenant segmentation | `when <field> claim <claim>` splits the resource into `qiy:<table>:<value>`; a missing claim means **that channel is not granted** |

`restrict { when ... }` and `when <field> claim <claim>` cannot coexist on one resource (`a claim-scoped channel already isolates rows; remove the restrict row predicates`). Role/mask-only `restrict` blocks may coexist with realtime.

## Transports

Realtime is a **self-hosted Server-Sent Events** transport; there is no third-party provider or SDK.

| `api.client` | Transport | Generated artifacts |
| --- | --- | --- |
| `rest` | `GET /api/v1/realtime/stream`: one connection carrying every granted channel | `web/app/providers/live-provider.ts` (`createQiyLiveProvider`), `server/src/realtime.ts` |
| `graphql` | The same stream **plus** GraphQL Subscription over SSE (`GET /graphql/subscribe`) | Subscription root plus `web/app/subscriptions.ts` |

Stream frames:

```text
event: ready
data: {"channels":["qiy:orders","qiy:stock_movements:WH-1"]}

event: created
data: {"id":"...","channel":"qiy:orders","event":"created","record":{"id":"...","number":"SO-1"}}

: keep-alive
```

Auth is the normal `Authorization: Bearer <token>`; the browser reads the stream with `fetch` (not `EventSource`) so it can send the header. Keep-alive comments every 25s. Anonymous 401, no granted channel 403, `QIY_REALTIME_DISABLED=1` 503.

The browser LiveProvider shares **one** stream across all Refine subscriptions: the first subscription opens it, the last unsubscribe closes it, disconnects reconnect with exponential backoff, and 401/403 leave it idle.

GraphQL subscription shape:

```graphql
type OrdersEvent { event: String! record: Orders! }
type Subscription { ordersChanged: OrdersEvent! }
```

- `GET /graphql/subscribe?query=...`, one `data: {...}` frame per event. Anonymous 401; role not in `roles` 403; unknown field/non-subscription document/syntax error 400; client abort or reader cancel closes the iterator.
- Payloads come from the already-trimmed outbox: masked fields have no key; GraphQL can only return `null` for fields the client explicitly requested - it never leaks values.
- `subscribeGraphql()` reconnects with exponential backoff (1s..30s); pass `reconnect: false` to disable.

## Outbox and environment

CRUD repositories write `qiy_realtime_outbox` (`id`, `channel`, `type`, `payload`, `createdAt`) **in the same Drizzle transaction** as the business write and audit; after commit the service triggers one outbox read. Dataflow `emit` writes both `dataflow_outbox` and the realtime channel, committed/rolled back with the business write; `allow roles` on a flow decides who may subscribe to that event channel.

Each process runs **one shared poller** while it has subscribers: every `QIY_REALTIME_POLL_MS` it reads new outbox rows, dedupes by row id and fans them out to all local SSE/GraphQL subscribers. Every replica tails the same table, so an event written by any instance reaches every connected browser. A background task deletes rows older than `QIY_REALTIME_RETENTION_DAYS`; the outbox is a short-lived event log, not a delivery queue.

| Variable | Default | Notes |
| --- | --- | --- |
| `QIY_REALTIME_DISABLED` | `0` | `1` makes the stream 503 and stops polling (generated tests set it) |
| `QIY_REALTIME_POLL_MS` | `1000` | Outbox tail interval, min 100; bounds cross-replica latency |
| `QIY_REALTIME_RETENTION_DAYS` | `1` | 1..3650 |
| `QIY_REALTIME_CLEANUP_MS` | `3600000` | Cleanup interval, min 60000 |

Invalid values fail closed on first use (e.g. `QIY_REALTIME_POLL_MS must be an integer from 100 to ...`).

## Realtime limits

- **Best-effort live updates, not reliable messaging.** Events written while a browser is offline are not replayed; on reconnect Refine refetches. Use Dataflow `emit` plus your own consumer for anything that must be delivered.
- The poller looks back 5 seconds to cover late commits and small clock skew between replicas; new subscribers never receive events written before they subscribed.
- List pages are **not** auto-subscribed by default (only show pages get `liveMode`); custom list pages must pass `liveMode`.
- Field-level masking only; row isolation requires claim-segmented channels. `restrict` row predicates and claim-segmented channels are mutually exclusive.
- Polling cost is per **process**, not per subscriber: one query loop per replica regardless of connected browsers.
- Reverse proxies must not buffer SSE (`proxy_buffering off`; the response already sends `X-Accel-Buffering: no`) and need a read timeout above the 25s keep-alive.
- S3 presigned PUT and native multipart are not implemented; resumable sessions are in-memory and need sticky sessions.
- `Files` uploads are not atomic; partial uploads leave orphan objects for the orphan scan.

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| Upload 415 | MIME not in `@mime`, or `@upload` disallows the encoding | Adjust the field or the request header/encoding |
| Upload 403 | Caller is `viewer` | Use an `admin`/`operator` session |
| Download 404 | Not the owner/admin, or metadata missing | Use the uploader account; check `QIY_STORAGE_METADATA=database` |
| Files unreadable after restart | Still using in-memory metadata | Set `QIY_STORAGE_METADATA=database` and migrate |
| `QIY_STORAGE_METADATA=database is required for production file metadata` | Production startup check | Fix `.env.production` |
| Upload succeeded but the field is empty | Upload only returns a key; the entity must be PATCHed | Let generated forms do it, or write the key yourself |
| Signed URL is `null` | `local` provider has no presigning | Use the protected download endpoint |
| Orphan scan deletes nothing | Dry-run default | Add `--apply` and confirm `removed > 0` |
| `/api/v1/realtime/stream` 403 | Role not in any `roles`, or principal lacks the claim for a segmented channel | Check `roles`; add the claim to the users row/IdP, or drop `when ... claim ...` |
| Page receives no events | A reverse proxy buffers the SSE response or times out before keep-alive | Disable proxy buffering; read timeout > 25s |
| Events miss fields | A `mask` applies to a subscribable role | Adjust the mask or roles |
| Generation rejects realtime | Resource has a `restrict` row predicate / no `auth` / integration mode | Remove the predicate, add `auth`, or use a host LiveProvider |
| Stream 503 `Realtime is disabled` | `QIY_REALTIME_DISABLED=1` | Unset it |

## Related references

- [Dataflows and actions](dataflows-actions.md) - `emit` and realtime channel linkage
- [Auth and permissions](auth-permissions.md) - roles, mask, restrict mutual exclusions
- [Modeling and generation](modeling-and-generation.md) - `File`/`Files` field rules
- [Testing and deployment](testing-deployment.md) - storage/realtime acceptance and migration checks
- [Language reference](language-reference.md) - block placement

## Canonical docs

- [realtime](https://ai-nodev.github.io/qiy/dsl/realtime)
- [storage (DSL)](https://ai-nodev.github.io/qiy/dsl/storage)
- [storage guide](https://ai-nodev.github.io/qiy/guide/storage)
- [real services acceptance](https://ai-nodev.github.io/qiy/guide/real-services)

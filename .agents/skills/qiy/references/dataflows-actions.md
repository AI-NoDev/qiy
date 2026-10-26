# Dataflows, actions and workflows

Use this file when you add a transactional business command, bind it to a list/show button, add a manual extension page, run a batch operation, use the legacy `orderInventory` workflow, or write/run `app.test.qiy` scenario tests.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/dataflow (`/dsl/actions`, `/guide/workflow`)

## Contents

- [Choose the right mechanism](#choose-the-right-mechanism)
- [Dataflow grammar](#dataflow-grammar)
- [Annotations, authorization and audit](#annotations-authorization-and-audit)
- [Idempotency](#idempotency)
- [input: request contract](#input-request-contract)
- [context: load inside the transaction](#context-load-inside-the-transaction)
- [steps and statements](#steps-and-statements)
- [result and HTTP contract](#result-and-http-contract)
- [Batch execution](#batch-execution)
- [Actions: exposing commands and pages](#actions-exposing-commands-and-pages)
- [Manual extension pages](#manual-extension-pages)
- [workflow orderInventory](#workflow-orderinventory)
- [app.test.qiy scenarios](#apptestqiy-scenarios)
- [Pitfalls](#pitfalls)
- [Non-goals](#non-goals)

## Choose the right mechanism

| Need | Use | Notes |
| --- | --- | --- |
| Atomic multi-record business operation (approve, receive, ship, archive) | `dataflow` + `action` | Recommended general mechanism |
| Transactional event after commit | `dataflow` `emit` | Writes outbox rows; does not publish directly |
| Read-only custom screen | `action ... navigate` + `page manual @comment(...)` | Implement under `app/extensions/`, preserved by `--sync` |
| Fixed legacy ERP order/inventory slice | `workflow orderInventory;` | PostgreSQL only, fixed entities/actions, no row policy |
| Host API business logic | Host code | `mode integration` rejects `dataflow` |

A `dataflow` alone never adds UI. Declaring an `action` is what exposes it.

## Dataflow grammar

```qiy
dataflow revokeConnector @label("Revoke") @confirm("Revoke this connector?") @comment("Revoke an active connector") {
  allow roles admin, operator;          // or allow permission / allow verification
  idempotency required;                 // optional
  audit "connector.revoked";            // optional

  input {
    field connectorId UUID @required;
    field reason Text @required @comment("Reason supplied by the operator");
  }

  context {
    connector = entity connectors by id input.connectorId @required;
  }

  step validate @order(10) @comment("Check state") {
    require connector.status != "revoked" @error("errors.connector.alreadyRevoked");
  }

  step revoke @order(20) {
    update connector { status = "revoked"; }
    emit "connector.revoked" { connectorId = connector.id; reason = input.reason; }
  }

  result { return connector; }
}
```

```text
dataflow <Name> ( "@label" "(" doc ")" | "@confirm" "(" doc ")" | "@comment" "(" doc ")" )* {
  ( "allow" ( "roles" role ("," role)* | "permission" ref ("," ref)* | "verification" Name ) ";"
  | "idempotency" "required" ";"
  | "audit" <string> ";"
  | "input" "{" ( "field" <name> <type> ( "@required" | "@comment" "(" doc ")" )* ";" )* "}"
  | "context" "{" ( <binding> "=" "entity" <Entity> "by" <pk> "input." <field> ( "@required" | "@comment" "(" doc ")" )* ";" )* "}"
  | "step" <Name> ( "@order" "(" <int> ")" | "@comment" "(" doc ")" )* "{" <statement>* "}"
  | "result" "{" "return" <binding> ";" "}"
  )+
}
```

`input`, `context` and `result` blocks are mandatory (empty `{}` is allowed for the first two; `result` must return a declared binding) and at least one `step` is required. Serialization order is fixed: annotations -> `allow` -> `idempotency` -> `audit` -> `input` -> `context` -> `step...` -> `result`.

`doc` is a string literal or `t("key")`; the key must exist in the default `messages` locale.

## Annotations, authorization and audit

| Annotation | Effect | Default |
| --- | --- | --- |
| `@label(...)` | Command display name; an action that omits `label` inherits it | none (an action needs a label or an inheritable flow label) |
| `@confirm(...)` | Default confirmation text; an action may omit or override | none (no confirmation dialog) |
| `@comment(...)` | JSDoc, OpenAPI description, GraphQL mutation description | none |

`allow` accepts exactly one form per flow (a second declaration is `duplicate allow declaration`; no declaration defaults to `admin, operator`):

```qiy
allow roles admin, operator;                 // only admin/operator; viewer is rejected
allow permission InventoryReceivePermission; // needs every expanded permission value
allow verification CanShipOrders;            // evaluated with flow inputs
```

- `allow roles`: unauthenticated 401; role not listed 403 `Command execution is restricted`. admin does **not** bypass an explicit allowlist.
- `allow permission`: permission fields or groups, expanded to values at generation; any missing value -> 403 `{ errorKey: "command.forbidden", missing }`.
- `allow verification`: evaluated with flow inputs; each verification `input` needs a same-named `@required` Text or enum flow input; denial -> 403 `command.forbidden`; bad input shape 400.
- Checks run before idempotency lookup and the transaction: a denial writes no data, audit or receipt. Replay re-checks; a receipt does not grant access.

`audit "action.name";` writes `audit_events` in the same transaction with `actorId`, `action`, `resource` (the result binding's table), `resourceId` (its primary key) and `metadata { flow }`. An audit write failure rolls back the whole command.

Full permission semantics: [auth-permissions.md](auth-permissions.md).

## Idempotency

```qiy
idempotency required;
```

- The request must send an `Idempotency-Key` header of **1-128 printable ASCII** (`\x21-\x7E`); missing/invalid -> 400 `A valid Idempotency-Key header is required`.
- Receipts are unique per `(actorId, flow, sha256(key))`. A different request body hash -> 409 `Idempotency key was already used with a different request`; an identical one replays the first response without repeating writes, audit or events.
- Receipt table `dataflow_idempotency` (`requestKeyHash`, `requestHash`, `response` JSON text) is migrated automatically but **never auto-cleaned**.
- Batch commands use `<flow>:batch` as an independent flow name and write one receipt.
- Generated actions manage the key: retries with the same input keep it, changed input or success rotates it.
- Only `required` exists; there is no `optional` mode.

## input: request contract

| Item | Rule |
| --- | --- |
| Types | `UUID`, `Text`, `Integer`, `Decimal`, `Boolean`, or a declared enum name |
| `@required` | Required marker; default is optional. Any input referenced by a context key, `require`, `update`, `create`, `emit` or `call` **must** be `@required` |
| `@comment(...)` | TypeBox/OpenAPI description and Refine form field label; supports `t("key")` |
| Defaults | No default syntax; an omitted optional input is `undefined` |
| Request boundary | Only declared fields (`additionalProperties: false`); `Integer` range -2147483648..2147483647; type violations -> 422 |

```qiy
input {
  field decision reviewState @required;   // enum input: must be the same declared enum
  field quantity Integer @required;
  field note Text;
}
```

## context: load inside the transaction

```qiy
context {
  order = entity sales_orders by id input.orderId @required;
  item  = entity sales_order_lines by id input.lineId @required;
}
```

| Item | Rule |
| --- | --- |
| Loading | Primary key only: `by <pk> input.<field>`; no arbitrary `where` |
| `@required` | Mandatory today (`context bindings must declare @required until optional-flow semantics are implemented`) |
| Input | Must be `@required` and `UUID` (the primary key type) |
| Missing record | 404 `{ error: "Not found", resource: "<table>" }` |
| Names | Cannot be `input`; cannot collide with a `create` binding |
| Locking | PostgreSQL/MySQL use `SELECT ... FOR UPDATE`; SQLite runs synchronously in one transaction |

## steps and statements

Each step has a unique positive `@order`; omitted orders default to declaration order (1, 2, 3...). Duplicates/non-positive/non-integer -> `step order must be a unique positive integer`. Statements are order-sensitive: a `require` sees the state after earlier `update`/`create`/`delete` statements.

### require

```qiy
require connector.status != "revoked" @error("errors.connector.alreadyRevoked");
require input.quantity >= 100 @error(t("inventory.quantityTooLow"));
```

| Left operand type | Operators | Right operand |
| --- | --- | --- |
| `Text` / enum | `==`, `!=` | String literal (enum value must be declared) |
| non-null `Integer` | `==`, `!=`, `>`, `>=`, `<`, `<=` | Signed 32-bit integer literal (negatives allowed) |
| Anything else (Decimal/Money/Date/Time/DateTime/Boolean/UUID/Vector) | **unsupported** | - |

The left operand must be `input.<field>` (that input `@required`) or an undeleted context field. `@error(...)` is mandatory (literal or `t("key")`). Failure -> **409** with default-locale `error` and a stable `errorKey`. Field-to-field comparison, arithmetic, function calls and Decimal/Boolean conditions are not supported; nullable Integer comparison is rejected.

### update

```qiy
update connector { status = "revoked"; revokedReason = input.reason; }
```

| Value source | Allowed target types |
| --- | --- |
| Literal (`"text"` / enum name) | `Text`, enum |
| `input.<field>` | `Text`, `Integer`, `UUID`, or the same declared enum |

At least one field; a field may not be written twice (`duplicate update field`). Forbidden: primary key (`cannot update primary key`), `scope` field (`cannot update scope field`), local `passwordField` (`cannot update password field`), deleted context (`cannot update deleted context`). Decimal/Boolean input assignment is not supported for updates. Later `require` statements see the new value; a failed assertion rolls back.

### create

```qiy
create review = entity reviews {
  userId = input.userId;
  note = input.note;
  status = "pending";
}
```

| Item | Rule |
| --- | --- |
| Binding | Enters the context namespace; usable by later `require`/`update`/`delete`/`result`; cannot collide with another binding or `input` |
| Primary key | Generated; explicit assignment is rejected (`create primary key ... is generated automatically`) |
| Scope fields | Derived from the authenticated principal; client input cannot override |
| Required columns | Every non-null, non-PK, non-scope field must be assigned; nullable may be omitted (`create requires value for <entity>.<field>`) |
| Value source | Literals only `Text`/enum; `input.<field>` supports `UUID`/`Text`/`Integer`/`Decimal` and a same-named enum |
| Password field | Rejected |

### delete

```qiy
delete review;
```

Deletes a loaded or newly created binding; FK policy decides cascade/reject. The binding cannot be used afterwards (`cannot use deleted context` / `context ... is already deleted`), but it **may** be returned in `result` as its pre-delete snapshot. Same transaction as everything else.

### emit

```qiy
emit "order.approved";
emit "order.approved" {
  orderId = order.id;
  requestedBy = input.reason;
  source = "dashboard";
  priority = 2;
};
```

| Item | Rule |
| --- | --- |
| Event name | Non-empty fixed string; no variables/concatenation |
| Payload | At most **32** fields, unique keys |
| Sources | `@required` inputs, current undeleted context fields, string or safe-integer constants |
| Forbidden | Local password fields; deleted/unknown context; unknown input/field |
| Persistence | `dataflow_outbox` (event name, actor, payload JSON, created time) in the same transaction |
| Realtime | With `realtime` declared, also writes `qiy_realtime_outbox` with channel `qiy:event:<event>`, committed/rolled back together |

`emit` only persists; it does not publish to a broker. Consumers, idempotency and dead letters are your responsibility. An idempotent replay does not duplicate events.

### call

```qiy
call reviewPolicy {
  reviewId = review.id;
  status = review.status;
  reason = input.reason;
  source = "qiy-dashboard";
  priority = 1;
}
```

| Item | Rule |
| --- | --- |
| Adapter | Identifier; a flow may call several adapters |
| Payload | At most 32 unique fields with the same sources as `emit` |
| Forbidden | Password fields, deleted context, unknown fields |
| Contract | Generated in `apps/server/src/dataflows/calls.ts` |
| Implementation | `apps/server/src/extensions/dataflow-calls.ts` (not managed by `--sync`) |
| Default | Fail-closed: handlers must return `{ ok: true }` or `{ ok: false, error, errorKey? }` |
| Failure | `{ ok: false }` -> 409 with `error`/`errorKey`; a thrown error rolls back the transaction |
| Sync only | Handlers must not return a Promise and must not do network/irreversible work; use `emit` + a post-commit worker for that |

```ts
import type { DataflowCallHandlers } from "../dataflows/calls";

export const dataflowCallHandlers: DataflowCallHandlers = {
  reviewPolicy: (request) => {
    const reason = String(request.payload.reason ?? "").trim();
    if (!reason) return { ok: false, error: "A reason is required", errorKey: "review.reasonRequired" };
    return { ok: true };
  },
};
```

## result and HTTP contract

```qiy
result { return connector; }
```

`result` must return a declared context binding (including a `create` binding), else `result must return a declared context binding`. The REST success body is that record's JSON (200); GraphQL returns the entity type. A deleted record may be returned as its last snapshot.

| HTTP | Case | Body |
| --- | --- | --- |
| 200 | Success / idempotent replay | Result record |
| 400 | Missing/invalid `Idempotency-Key`; bad request shape | `error` |
| 401 | Unauthenticated | `error: "Authentication required"` |
| 403 | Role/permission/verification denial; missing scope claim | `error`, `errorKey` (`command.forbidden`, ...), optional `missing` |
| 404 | Context record not found | `error: "Not found"`, `resource` |
| 409 | `require` failure; `create` conflict; idempotency body mismatch | `error`, optional `errorKey`, `resource` |
| 422 | Type/range validation (Elysia) | Validation details |
| 500 | Unexpected error | `error` |

GraphQL commands keep the same machine contract in `extensions.status` and `extensions.errorKey`. `require ... @error(t("key"))` returns the default-locale text plus `errorKey`; the Refine data provider translates it for the current UI language and falls back to the API text.

Generated endpoints: `POST /api/v1/commands/<name>` (plus `/batch`), GraphQL `run<Name>(input: <Name>CommandInput!, idempotencyKey: String!)` and `run<Name>Batch(items: [...], idempotencyKey: String!)`, OpenAPI operations under `tags: ["Dataflow"]`. `/api/v1/commands` is exempt from the generic role guard; the command route runs authorization itself.

## Batch execution

```qiy
dataflow archiveReview @label("Archive selected") {
  allow roles admin, operator;
  idempotency required;
  input { field reviewId UUID @required; field reason Text @required; }
  context { review = entity reviews by id input.reviewId @required; }
  step archive { update review { status = "archived"; note = input.reason; } }
  result { return review; }
}

action archiveSelected {
  resource reviews;
  dataflow archiveReview;
  placement list;
  batch true;
}
```

- Endpoint `POST /api/v1/commands/<name>/batch`, body `{ "items": [ { ... }, ... ] }` with 1-100 unique IDs (duplicates -> 400 `Batch item identifiers must be unique`).
- All items run sequentially in **one transaction**; any failure rolls back everything and the response carries `item: { index, id }` plus `resource`/`errorKey`.
- One receipt is written under flow name `<name>:batch`; identical items and key replay, different order/content -> 409.
- Action constraints: `placement list` only, no record-level `when`, the flow must declare `idempotency required`, and the target resource must be loaded by exactly one required UUID input.

## Actions: exposing commands and pages

```text
action <Name> {
  "resource" <entity> ";"
  ( "dataflow" <Name> | "navigate" <string> ) ";"
  "placement" ( "list" | "show" ) ( "," ( "list" | "show" ) )* ";"
  [ "label" doc ";" ]
  [ "confirm" doc ";" ]            // dataflow action only
  [ "when" <field> ( "==" | "!=" ) <string> ";" ]
  [ "allow" ( "roles" role ("," role)* | "permission" ref ("," ref)* | "verification" <Name> ) ";" ]   // navigate only
  [ "batch" "true" ";" ]           // dataflow action only
  [ "page" "manual" "@comment" "(" doc ")" ";" ]   // navigate only
}
```

`resource`, `placement` and exactly one of `dataflow`/`navigate` are required.

| Property | Required | Default | Rules |
| --- | --- | --- | --- |
| `resource` | yes | - | Entity or table name; unknown -> `unknown resource` |
| `dataflow <Name>` | one of two | - | Must be declared, and its `context` must load this resource, else `dataflow <f> does not load resource <t>` |
| `navigate "<path>"` | one of two | - | Absolute route matching `^/[a-z0-9_-]+(/[a-z0-9_-]+|:[a-z][a-zA-Z0-9_]*)*$`, must contain `:id`, no `..`, `\`, `?`, `#` |
| `placement list` / `show` | yes (>=1) | - | Table actions column / detail action area; duplicates rejected |
| `label` | navigate yes; dataflow optional | inherits flow `@label` | Display name; `t("key")` supported; neither -> generation fails |
| `confirm` | no | inherits flow `@confirm` | Confirmation dialog; dataflow actions only |
| `when <field> == \| != "<value>"` | no | always visible | Record visibility. Field must be `Text` or enum on this resource; enum values must be declared; only `==`/`!=` |
| `allow roles/permission/verification` | no | inherits flow (dataflow action) | navigate actions accept admin/operator/viewer, permission fields/groups, and input-free verification; **forbidden** on dataflow actions |
| `batch true` | no | `false` | See batch constraints above |
| `page manual @comment(...)` | navigate yes | - | Placeholder page + unmanaged extension file; `@comment` required |

`when` is presentation logic only. A missing field or non-matching value hides the button, but direct command calls are still enforced by server `allow`/`require`. `when` is not allowed on batch actions.

Generated behavior:

- `placement list` adds a table row action; `placement show` adds a detail-page action. A `confirm` value shows an Ant Design `Modal.confirm`; cancel sends nothing.
- Visibility goes through Refine `CanAccess`: resource role policy and page rules first, then command policy (`roles` -> expanded `permissions` -> input-free `verification`).
- Success shows a notification and refreshes list/detail caches; failure keeps the dialog and inputs and translates `errorKey`; batch success clears the selection.
- The primary-key input (e.g. `input.reviewId`) is injected from the current record (`idInput`) and does not appear in the form. Other `@required` inputs render as: Text -> Input, Integer -> InputNumber, enum -> Select with enum labels, UUID -> Input. `@comment`/`t("key")` becomes the field label/help.
- Requests go only to `/api/v1/commands/<flow>`; the generated data provider rejects any undeclared command URL (fail-closed).
- i18n keys when no explicit text is declared: `qiy.actions.<action>.label`, `qiy.actions.<action>.confirm`, `qiy.actions.<action>.inputs.<input>.label`.

Integration mode: `qiyHostAuth.can` is the single visibility source; `action allow` cannot replace host policy ([workspace-integration.md](workspace-integration.md)).

## Manual extension pages

```qiy
action reviewConnector {
  allow roles operator, viewer;
  resource connectors;
  placement list, show;
  label "Review";
  navigate "/connectors/:id/review";
  page manual @comment(t("review.pageHelp"));
}
```

- Generates route `/connectors/:id/review` wrapped in `CanAccess` (`action: "reviewConnector"`); direct URLs are checked too.
- Generates a placeholder page under `apps/web/app/extensions/` (explanation + empty state). That directory is **not** in the generated manifest, so `qiy create --sync` / `qiy init --sync` will not overwrite your implementation.
- The page receives only `:id`. Read data with Refine hooks or your own API; implement server authorization separately (`restrict`/`scope`/host API). Do not put extension code outside `app/extensions/`.

## workflow orderInventory

```qiy
application qiy-erp-admin {
  database postgresql {}
  workflow orderInventory;
}
```

- Only `orderInventory` is accepted (`Unsupported workflow X`); duplicates fail. It sits after `messages`/`permission`, before `enum`/`entity`.
- Requires **PostgreSQL** and the entities `orders`, `orderItems`, `inventoryItems` with the fixed field contract (missing fields produce specific errors such as `orderInventory workflow requires orders.approvedBy`).
- Generates submit/approve/ship/cancel actions (REST endpoints + detail buttons), multi-warehouse reservation/release, transactional state checks, `order_reservations` and `order_idempotency` tables, and order/inventory relation queries.

State machine:

```text
draft --submit--> submitted --approve--> approved --ship--> shipped
  |                    |
  +----> cancelled <---+
```

Only `draft` and `submitted` can be cancelled; `approved` must ship (no approval rollback). Reservation on submit, release on cancel and deduction on ship happen in the server transaction. Replays return the first result; different content 409.

Authorization: the workflow reuses generated role guards and account roles; `scope` filtering applies (missing claim -> 403 `Missing required data scope claim`); `restrict` row policy is **not supported** (`Restrict <resource>: orderInventory does not apply row policy yet`); the workflow does not participate in `allow permission`/`allow verification`. Use a `dataflow` when you need permission-gated approvals.

Acceptance: `bun tools/verify-postgres-erp.ts qiy-erp-pg` creates and drops a temporary database and exercises idempotent submits, approval roles, tenant claim denials, insufficient-stock rollback, cancel/release and duplicate cancel. Identity is injected; it is not a real-login or browser acceptance test.

## app.test.qiy scenarios

When the entry model is `app.qiy`, the CLI looks for `app.test.qiy` in the same directory and compiles `given -> when dataflow -> expect` into Bun tests for the generated server.

```qiy
qiy test v0;
application dataflow-call;

scenario approve-review {
  given review = entity reviews {
    id = "00000000-0000-4000-8000-000000000001";
    status = "pending";
    note = "Requires policy approval";
  }
  when dataflow approveReview {
    reviewId = review.id;
    reason = "Approved by operator";
  }
  expect status == 200;
  expect review.status == "approved";
}
```

| Element | Rule |
| --- | --- |
| `application` | Must equal the main model's application name |
| `given` | At least one fixture; every non-null field must be provided; values must match types (`Date` `"YYYY-MM-DD"`, `Time` `"HH:mm:ss"`, `DateTime` millisecond timestamp, enum name) |
| `identity` | Optional. `identity anonymous;` or `identity { id = "..."; role = "operator"; claims { "tenant.id" = review.tenantId; } }`; id non-empty, role one of the three, claims may reference fixtures |
| `when dataflow` | Only declared flows; every required input present; inputs may reference fixture fields |
| `expect status` | **Required** (100-599) |
| `expect errorKey == "..."` | Optional stable error key assertion |
| `expect <alias>.<field> == value` | Optional, repeatable; duplicate assertions fail |
| `expect exists <alias> == false` | Asserts deletion; cannot coexist with field assertions for that alias |
| `expect outbox "<event>" count == <n>` | Asserts `dataflow_outbox` count; the event must be declared by a model `emit` |

- Scenarios reuse the generated auth roles, idempotency headers, transactional route and `call` contract; `call` adapters are stubbed to succeed rather than exercising your policy.
- SQLite uses an in-memory database. PostgreSQL/MySQL require migrated dedicated databases named `qiy_test_*`, with `DATABASE_URL` and `QIY_TEST_DATABASE_URL` both set to the same value; otherwise execution is refused before importing the database.
- Fixtures insert parents before children following explicit relations and clean up children first; cyclic foreign keys fail at generation. Tests clear model tables and Dataflow auxiliary tables before and after each scenario - never point them at a business database or share the database between parallel runners.
- These tests cover authorization and isolation **after** the authenticator returns a principal; they do not issue or verify real JWTs, cookies or IdP logins. Browser action scenarios are not implemented.

Run generated scenario tests:

```bash
# SQLite
cd apps/server && bun test tests/qiy-scenarios.test.ts

# PostgreSQL / MySQL
export DATABASE_URL='postgres://user:password@127.0.0.1:5432/qiy_test_admin'
export QIY_TEST_DATABASE_URL="$DATABASE_URL"
bun run --bun drizzle-kit generate
bun run --bun drizzle-kit migrate
bun test tests/qiy-scenarios.test.ts
```

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| 400 `A valid Idempotency-Key header is required` | Flow declares `idempotency required` but the caller sent no key | Send the header; generated actions do it for you |
| 409 with a business `errorKey` | A `require` assertion failed | Fix the caller's input/state; add frontend copy for the key |
| 404 `Not found` + `resource` | `context` cannot load the record (bad id or out of scope) | Check the id and data scope |
| 403 `command.forbidden` | `allow permission`/`allow verification` denied | Inspect `/auth/me` `permissions`/`groups` |
| `cannot update scope field` | Command writes a scope column | Scope columns derive from the principal |
| `create requires value for <e>.<f>` | Non-null field not assigned | Assign it or make it `@nullable` |
| `Dataflow <n> requires input, context, and result blocks` | Missing block, even when empty | Write `input {}`, `context {}` |
| `result must return a declared context binding` | Returned an undeclared name | Return a context/create binding |
| `literal updates currently support Text and enum fields only` | Literal used for Integer/Decimal/Date | Use a matching `input.<f>` or a `call` adapter |
| `call` always returns 409 | Extension still returns the fail-closed default | Implement the handler and return `{ ok: true }` |
| Button does not render | `when` mismatch, `CanAccess` denial, or missing permission metadata | Check record value, role and `/auth/me` |
| Button click returns 403 | Server `allow`/`require` denied | Hiding buttons is not authorization |
| Primary-key field missing from the form | Injected from the current record by design | Expected (`idInput`) |
| Batch button disabled/failing | Missing `batch true`, no `idempotency required`, or a `when` | Follow the batch constraints |
| Manual page overwritten by `--sync` | Implementation placed outside `app/extensions/` | Only edit `app/extensions/` |
| GraphQL mutation complains about a missing argument | Idempotency enabled | Pass `idempotencyKey` |

## Non-goals

Do not promise these:

- Arbitrary expressions, arithmetic, function calls, loops, dynamic SQL, reflection, embedded JS/TS.
- Arbitrary `where` loading, joins or aggregate reads inside a flow (use resource REST/GraphQL for queries).
- Async/external side effects: `call` must be synchronous and network-free; use `emit` plus a post-commit worker.
- Direct broker publishing, consumer idempotency or dead-letter handling.
- Optional context, field-to-field comparisons, Decimal/Boolean conditions, dynamic Decimal writes.
- Nested transactions, cross-command compensation or distributed transactions.
- Generated commands in `mode integration` (rejected).
- Custom roles in `allow roles` (only admin/operator); use `allow permission` for finer control.

## Related references

- [Auth and permissions](auth-permissions.md) - `allow`, verification, restrict/scope
- [Modeling and generation](modeling-and-generation.md) - entities, relations, generated values
- [Storage and realtime](storage-realtime.md) - emitted events and realtime delivery
- [Testing and deployment](testing-deployment.md) - generated test suites and release checks
- [Language reference](language-reference.md) - block order and declaration grammar
- [Troubleshooting](troubleshooting.md) - command error table

## Canonical docs

- [dataflow](https://ai-nodev.github.io/qiy/dsl/dataflow)
- [actions](https://ai-nodev.github.io/qiy/dsl/actions)
- [workflow guide](https://ai-nodev.github.io/qiy/guide/workflow)
- [permissions: command allow](https://ai-nodev.github.io/qiy/dsl/permissions)

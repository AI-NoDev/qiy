# Modeling and Includes

Use `.qiy` as the public model format. Every project starts with `qiy v0;` and one `application` block. The `database` declaration is required and comes first inside the application. Add optional UI, API, auth, storage, and workspace configuration before enums and entities; then declare relations, scopes, menus, and dashboard metrics.

## Smallest useful model

```qiy
qiy v0;

application inventory @comment("Inventory operations console") {
  database sqlite @comment("Local inventory records") {}
  ui { library antd; theme blue; themes blue, purple, green; colorMode system; allowThemeSwitch true; allowColorModeSwitch true; }
  api { client rest; }

  entity products @label("Products") @icon(ShoppingOutlined) {
    field id UUID @id;
    field sku Text @unique;
    field name Text;
    field active Integer @nullable;
  }
}
```

The generated admin exposes a resource for each entity. Fields form the database columns and Refine CRUD views. Give each entity one `UUID @id` field. `@label` controls display text; `@icon` uses an Ant Design icon name such as `ShoppingOutlined`. An application comment becomes the generated root, Server, and Web package descriptions; a database comment becomes file-level documentation in the generated Drizzle schema. Both comments may use `t("message.key")` and resolve after the `messages` block is parsed.

The optional `ui` block currently supports the complete `antd` adapter only. Theme keys are `blue`, `purple`, `green`, `orange`, and `red`; color mode is `light`, `dark`, or `system`. Generated CRUD pages prefer Refine Ant Design components, then Ant Design primitives, then Qiy custom components. Do not configure `mui`, `mantine`, or `chakra` until Qiy ships and validates their full adapters.

## Complete modular example

The [warehouse example](../examples/warehouse-admin/README.md) is a complete, runnable project with:

- a root `app.qiy` plus relative module includes;
- warehouse and product master data;
- stock movement enum with labels, colors, and icons;
- explicit foreign-key relations;
- grouped navigation and a dashboard metric;
- commands to generate, install, test, build, and preview the admin.

Use it as a working starting point, then rename fields/resources and regenerate. Do not start by copying a partial fragment without its included modules.

## Transactional creation and deletion

Dataflows may declare `@label(...)`, `@confirm(...)`, and `@comment(...)` after their name. Each accepts a literal or `t("message.key")`. A bound Action inherits the label and confirmation when it omits its own declarations; explicit Action values override the defaults. The comment is emitted into generated source documentation, REST OpenAPI endpoint metadata, and GraphQL command descriptions.

In standalone mode, a Dataflow step can bind a newly inserted record with `create review = entity reviews { status = "pending"; note = input.note; }`, then update or delete that binding with `delete review;`. Return the binding in `result { return review; }`; a deleted binding returns its last snapshot. Declare all required entity fields, except the generated UUID primary key and authenticated scope fields. Nullable fields may be omitted. Input assignments require matching, required UUID/Text/Integer/Decimal or enum types; literals support Text/enum only. Do not assign primary keys, scope fields or local password fields.

Input and context blocks may be empty for pure creation. Statements execute in step order and share one transaction; late business, call, audit, outbox and receipt failures roll back all changes. Use `idempotency required;` for safe retries, including deletion after the source row has disappeared. The server rechecks roles and scope before replay. `emit "order.approved" { orderId = order.id; actor = input.actor; };` writes a controlled transactional `dataflow_outbox` payload. When REST Realtime is configured, it also writes `qiy:event:order.approved` to `qiy_realtime_outbox`; the background worker delivers it after commit and inherits the Dataflow role allowlist for subscribe-only capabilities. `call reviewPolicy { orderId = order.id; reason = input.reason; }` invokes a generated, synchronous local validation contract; implement it in the unowned `apps/server/src/extensions/dataflow-calls.ts`. Call handlers return `{ ok: true }` or a typed rejection and must not perform async network or irreversible external side effects. REST and generated GraphQL `run<Dataflow>` mutations share the same command route, transaction and authorization implementation. Arbitrary payload expressions and integration-mode server business generation remain unsupported.

## Realtime resources

For a REST admin, declare resource-level subscriptions with `realtime`. A generated `auth` block is mandatory: Qiy refuses anonymous Realtime models because token issuance and Outbox operations must authenticate and authorize the principal. Qiy generates a Refine `LiveProvider` backed by Ably 2.x, a protected token endpoint, subscribe-only role capabilities, and CRUD publication after the database transaction resolves:

```qiy
api { client rest; }
realtime {
  mode auto;
  resource orders {
    events created, updated, deleted;
    roles admin, operator, viewer;
  }
}
auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
```

Set `QIY_ABLY_API_KEY` only in the generated Server environment or secret manager. Never expose it as a `VITE_` value. `QIY_REALTIME_POLL_MS` defaults to 5000ms, `QIY_REALTIME_LEASE_MS` to 30000ms, `QIY_REALTIME_MAX_ATTEMPTS` to 10, `QIY_REALTIME_RETENTION_DAYS` to 7 and `QIY_REALTIME_CLEANUP_MS` to 86400000ms. CRUD and Dataflow events are transactionally queued and retried with exponential backoff. PostgreSQL/MySQL workers claim rows with a transaction, lease and `FOR UPDATE SKIP LOCKED`; SQLite remains single-process. The worker cleans expired delivered history at startup and on the independent cleanup interval rather than on every delivery poll. Delivery is still at-least-once: a crash after provider success but before the delivered marker, or a publish exceeding the lease, can duplicate an event, so consumers must be idempotent. Protected endpoints list dead letters, expose JSON and low-cardinality Prometheus metrics, return threshold-based `200/503` health, replay one event or 1–100 unique IDs, and clean delivered history. They require an administrator except for the optional read-only Prometheus credential described below. The generated `bun run realtime:admin -- metrics|health|prometheus|dead|replay|cleanup` client calls those protected HTTP endpoints using `QIY_REALTIME_ADMIN_TOKEN`; it never bypasses server authorization or transactional audit. Manual replay and cleanup write the token principal to `audit_events` in the same database transaction; audit failure rolls back the operation. Existing databases require a generated migration for lease and dead-letter columns. GraphQL Subscription, native OTLP export, custom page/record/global scopes and tenant-specific capabilities remain unsupported and fail closed where applicable.

Standalone REST Realtime also generates Prometheus Operator ServiceMonitor/PrometheusRule manifests and a Grafana dashboard under `deploy`. Configure a separate `QIY_REALTIME_METRICS_TOKEN` in the application Secret; this read-only credential grants access only to Prometheus text metrics, with no administrator permissions. Empty configuration disables this credential. Install the Operator CRDs, configure its monitor/rule selectors and namespace selection, and configure Alertmanager notification routes yourself. Rotate the Secret and restart Server pods to reload the environment. Generated monitoring files are validated separately from actual cluster installation and Grafana import; cloud-specific monitoring adapters and native OTLP remain unsupported.

Place `app.test.qiy` next to `app.qiy` to generate declarative Bun server scenarios automatically. The supported grammar uses `given` entity fixtures, optional `identity`, one `when dataflow` invocation, required `expect status`, and optional `expect errorKey` or `expect alias.field` assertions. Fixture and input references are checked against the application model before generation. SQLite uses an in-memory database. PostgreSQL/MySQL require a migrated, dedicated `qiy_test_*` database and identical `DATABASE_URL`/`QIY_TEST_DATABASE_URL` values; missing explicit opt-in fails before the database import. Run `bun test tests/qiy-scenarios.test.ts` in the Server package. Tests clear model tables and Dataflow auxiliary tables before and after each scenario, so never use a business database or share the test database between parallel runners. Foreign-key dependency order is respected; cyclic relations fail closed. Synchronous call adapters are stubbed to succeed rather than exercising user policies.

Add an identity between `given` and `when` to test authorization:

```qiy
identity {
  id = "operator-a";
  role = "operator";
  claims { "tenant.id" = review.tenantId; }
}
```

The surrounding scenario must declare `review` as a fixture and its `tenantId` field. Roles are `admin`, `operator`, or `viewer`; the identity id must resolve to nonempty text. Claims may use literals or fixture references and declared scope claims must match their field types. Use `identity anonymous;` for a 401 test, a viewer identity for a denied command, omitted claims for missing-scope tests, and a different tenant claim for cross-tenant isolation. Assert both the HTTP status and unchanged fixture fields after denial. These tests inject the principal into the production Dataflow route; they do not test real login or token verification. Without `identity`, compatibility mode uses the flow's first allowed role or admin and a fixed test id.

## Record action conditions

Use a restricted `when` rule when a list/show action should appear only for a record state:

```qiy
action approveOrder {
  resource orders;
  dataflow approveOrder;
  placement list, show;
  label "Approve";
  when status == "submitted";
}
```

The field must belong to the action resource and use Text or a declared enum. Operators are limited to `==` and `!=`; the value must be quoted, and enum values are checked at generation time. Missing fields hide the action. This is presentation logic only: the Dataflow and API must still enforce authorization and valid state transitions.

Use `batch true;` on a list-only Dataflow Action when selected records must change atomically. The Dataflow must declare `idempotency required;` and load the target resource from one required UUID input. Qiy sends one `{ items: [...] }` request, processes at most 100 unique IDs in one database transaction, writes one persistent receipt for the whole collection, and reports the failing item index/id while rolling back every earlier item. Qiy also exposes a `run<Flow>Batch` GraphQL mutation through native, Yoga and Apollo GraphQL; every resolver delegates to the same REST batch route and persistent receipt. Shared required inputs are entered once and copied into each item. Batch Actions do not support `show`, record `when` conditions, partial success, client-side request loops, automatic background jobs, or collections larger than 100 items.

## Common declarations

```qiy
database postgresql { extension pgvector; }
database mysql {}
database sqlite {}

enum orderStatus @comment("Order lifecycle") {
  value draft label "Draft" color "default" icon ClockOutlined @comment("Editable order");
  value approved label "Approved" color "green" icon CheckOutlined @comment("Ready for fulfillment");
}

entity orders @label("Orders") @icon(ShoppingOutlined) {
  field id UUID @id;
  field number Text @unique;
  field customerId UUID;
  field status orderStatus;
  field internalNote Text @listVisible(false) @showVisible(false);
  index orders_number_idx btree (number);
}

entity customers {
  field id UUID @id;
  field name Text;
}

relation orderCustomer orders customerId customers id one @onDelete(restrict);

menu {
  group sales @label("Sales") @icon(ShoppingOutlined) @comment("Sales operations") {
    resource orders;
  }
}

dashboard {
  metric orderCount orders @label("Orders") @span(8) @comment("Current order records");
}
```

Supported scalar field types are `UUID`, `Text`, `Integer`, `Decimal(precision, scale)`, `Money(precision, scale)`, `DateTime`, `File`, and `Vector(dimension)`. Enum fields use the enum name as the field type. Annotate optional fields with `@nullable`; configure presentation with `@label`, `@icon`, `@listVisible`, `@showVisible`, and `@formVisible`; query behavior uses `@sortable` and `@filterable`.

Applications, databases, enums, enum values, menu groups, and dashboard metrics also accept `@comment("...")` or `@comment(t("message.key"))`. A translated comment requires the key in the default locale. Qiy preserves the fallback and key through serialization; generated package/schema documentation uses the default-locale application/database text, enum tags and dashboard cards show the current-language description, and menu/enum definitions retain it in generated metadata for custom layouts and extensions. Duplicate or unsupported comment annotations fail generation. Do not assume every configuration block accepts comments unless it is documented.

For vectors, declare PostgreSQL's `pgvector` extension and annotate the field/index as required by the database model. Database capability restrictions are validated during generation. A field or relation declaration does not infer a business workflow; supported workflows must be explicitly declared and may impose entity/dialect requirements.

## Includes

Use a root project with relative fragment files:

```qiy
qiy v0;
application warehouse {
  database sqlite {}
  include "modules/catalog.qiy";
  include "modules/inventory.qiy";
}
```

An included file contains application children only. It must not repeat `qiy v0;` or wrap content in another `application`. Includes can be nested and resolve relative to the including file. Keep all fragments under the model directory. Absolute paths, `..`, missing files, symlinks escaping the project root, and include cycles are rejected.

Use `include "modules/catalog.qiy" @messages;` when a mixed module contains entities or enums but the current application only needs its single top-level `messages` block. `@message` is an alias. Missing or duplicate top-level message blocks fail generation, and unsupported selectors such as `@menu.operations` are rejected explicitly. Selected includes still expand nested includes first and keep all path and cycle protections.

Place top-level configuration before enums and entities. After include expansion, the whole model must follow the same declaration order as a single-file model. If parsing reports `Expected ...`, check the order and punctuation first; declarations end in semicolons except block declarations.

## Environment variables

Declare custom variables in `.qiy`; Qiy generates mode-specific server and web environment files inside the target admin packages:

```qiy
env {
  variable PAYMENT_API_URL {
    development "http://localhost:8080";
    production required;
    example "https://api.example.com";
  }
  variable PAYMENT_API_TOKEN {
    secret;
    development generate;
    production required;
    example required;
  }
}
```

`development generate` creates a random value only when the admin is first generated. `--sync` preserves current development/production values and custom entries, then appends new model variables. Prefix public frontend values with `VITE_`; these are bundled into client code and must never contain secrets. Never put literal credentials in `.qiy`.

External identity providers use one public-client PKCE contract:

```qiy
auth { provider auth0; user users; subjectField externalSubject; roleField role; }
```

Supported provider names are `oidc`, `oauth2`, `sso`, `okta`, `auth0`, `azure-ad-b2c`, `keycloak`, `google`, and `kinde`. Generated web env files contain authorization/token/client ID/scope/redirect/logout fields; generated server env files contain issuer/audience/JWKS verification fields. Never add a client secret to a `VITE_` variable.

OTP is a separate server flow:

```qiy
auth { provider otp; user users; usernameField email; roleField role; }
```

It generates request/verify endpoints and requires `QIY_AUTH_SECRET` plus an HTTPS `QIY_OTP_DELIVERY_URL` in production. `QIY_OTP_DEV_CODE` is only for explicit local development.

## Important modeling limits

Declarative tests support persisted side effects on SQLite, PostgreSQL and MySQL:

```qiy
expect exists review == false;
expect outbox "review.deleted" count == 1;
```

`review` must be a `given` fixture; existence uses its primary key. A deleted fixture cannot also have field expectations. The event must be declared by a model Dataflow `emit`; counts are nonnegative integers and refer to persisted `dataflow_outbox` rows in the isolated scenario, not external delivery. Use `exists true`, unchanged field expectations and event count zero to verify denial or rollback. PostgreSQL/MySQL require migrated dedicated `qiy_test_*` databases with matching `DATABASE_URL` and `QIY_TEST_DATABASE_URL`.

- The frontend selects one DataProvider transport: `api { client rest; }` or `api { client graphql; }`.
- Use explicit `relation` declarations for foreign keys. Model many-to-many relations with an explicit join entity when supported; do not assume implicit relation generation.
- Dashboard metrics support `count`, enum `distribution`, and date `trend`; group-by fields must exist and match the metric type.
- `workflow orderInventory;` enables a specific PostgreSQL order/inventory workflow. It is not a general workflow language.
- External identity configuration maps identities to a user entity; it does not automatically integrate an unrelated application's refresh cookies, custom JWT claims, API envelope, or authorization rules. Real provider tenants and OTP delivery vendors require environment-specific acceptance tests.
- Keep secrets in environment variables and secret managers, never in model files or included fragments.

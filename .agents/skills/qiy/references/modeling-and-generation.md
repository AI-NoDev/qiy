# Modeling and generation

Use this file when you create or change the data model: entities, fields, types, relations, indexes, generated business codes, display templates, includes/modules, and every "parses but does not generate" rule. For the complete block/annotation inventory read [language-reference.md](language-reference.md); for auth, policy, commands, charts and features read the dedicated references listed at the end.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/entity

## Contents

- [What the model generates](#what-the-model-generates)
- [Smallest correct model](#smallest-correct-model)
- [Includes and modules](#includes-and-modules)
- [Entities, tables and primary keys](#entities-tables-and-primary-keys)
- [Field types](#field-types)
- [Field attributes](#field-attributes)
- [Generated values and business codes](#generated-values-and-business-codes)
- [Display templates](#display-templates)
- [Filters, visibility and defaults](#filters-visibility-and-defaults)
- [Relations](#relations)
- [Indexes](#indexes)
- [Validation pipeline and modeling limits](#validation-pipeline-and-modeling-limits)
- [Worked modeling walkthrough](#worked-modeling-walkthrough)
- [Pitfalls](#pitfalls)

## What the model generates

| Model construct | Generated artifact | Edit policy |
| --- | --- | --- |
| `entity` + `field` | Drizzle table in `apps/server/src/schema.ts`, TypeBox/GraphQL contracts, repository/service, REST + GraphQL resource, Refine list/create/edit/show routes | Owned by `.qiy-generated.json`; regenerate through the model, do not hand-edit |
| `relation` | FK constraint, `RelationSelect`, batch foreign-key loading, record drawer | Owned |
| `index` | Drizzle index / migration SQL | Owned |
| `@code` / `@generated` | `apps/server/src/generated-values.ts` and create paths | Owned |
| `enum` / `menu` / `dashboard` / `chart` | `resources.ts` metadata, navigation, home page | Owned |
| Custom behavior | `apps/web/app/extensions/`, `apps/server/src/extensions/` | Not registered in the manifest; `--sync` preserves it |

Treat generated TypeScript as editable for a one-off, but for anything long-lived prefer an unowned extension file: `--sync` rewrites or removes every file listed in `.qiy-generated.json`.

## Smallest correct model

```qiy
qiy v0;

application inventory @comment("Inventory operations console") {
  database sqlite @comment("Local inventory records") {}
  ui { library antd; theme blue; themes blue, purple, green; colorMode system; }
  api { client rest; }

  entity products @label("Products") @icon(ShoppingOutlined) {
    field id UUID @id;
    field sku Text @unique;
    field name Text;
    field active Integer @nullable;
  }
}
```

Rules that make this valid: `qiy v0;` first; exactly one `application`; `database` is the first declaration inside it; every entity has exactly one UUID primary key named `id`; declarations end in `;` but block braces do not; `api { client ... }` before any `cors` inside the block.

## Includes and modules

Split a large application into relative fragments. `include` is expanded textually before parsing, so the expanded model must satisfy one global declaration order.

```qiy
qiy v0;

application warehouse {
  database sqlite {}

  include "modules/messages.qiy";     # after config blocks, before enums/entities
  include "modules/catalog.qiy";
  include "modules/inventory.qiy";
  include "modules/relations.qiy";    # after all entities
}
```

```text
include "<relative-path>.qiy" [@messages | @message] ;
```

| Slot | Rule |
| --- | --- |
| Path | Quoted string ending in `.qiy`, relative to the current file's directory. Absolute paths, `..`, empty paths and non-`.qiy` suffixes are rejected. |
| Selector | `@messages` / `@message` imports only the single top-level `messages` block of the target file. Other selectors are rejected. |
| Semicolon | Required (`Expected ; after include path`). |
| Placement | Direct child of `application` (or top level of a fragment). Not inside `entity`, `menu`, `dataflow`, `chart`. |

Fragment rules:

- A fragment contains application children only. It must not repeat `qiy v0;` and must not wrap content in `application`.
- Nested includes resolve relative to the including fragment; expansion is recursive.
- All files share one namespace: entity, table, enum, relation name, index name (global), menu group, metric, dataflow and action names are checked after expansion.
- Including the same file twice is not deduplicated; it produces duplicate declarations.
- Cycles are detected by realpath; symlinks escaping the project root and `..` are rejected.
- Recommended layout: `app.qiy` holds header + `database` + config + includes + `scope`/`restrict`; `modules/messages.qiy`, `modules/permissions.qiy`, `modules/platform.qiy` (shared enums + users), domain `entities.qiy`, `relations.qiy`, `pages.qiy`, `menu.qiy`, `charts.qiy`, `dataflows.qiy`, `actions.qiy`.

Use `include "modules/catalog.qiy" @messages;` when a mixed module also contains entities/enums but the current app only needs its dictionary. The target must contain exactly one top-level `messages` block; dropped content does not enter the model.

Failure examples: `include statements must be direct children of the application or fragment`, `include path cannot contain ..`, `Qiy include cycle detected: a.qiy -> b.qiy -> a.qiy`, `include selector @messages did not find a top-level messages block`, `unsupported include selector @menu.operations`.

## Entities, tables and primary keys

```text
entity <Name> [table <tableName>] [@annotation(...)]... {
  field <name> <Type>[(<params>)] [@attribute[(<value>)]...] ;
  index <name> <method>(<field> [<opclass>], ...) [@unique] [@concurrently] [@comment(...)] ;
}
```

| Slot | Rule | Default |
| --- | --- | --- |
| `<Name>` | Identifier `[a-zA-Z_][a-zA-Z_0-9-]*`, not a JavaScript reserved word; used as API/GraphQL resource and permission resource name | Required |
| `table <tableName>` | Physical table and Web route (`/<tableName>`); must match `^[a-z][a-z0-9_-]*$` | Same as `<Name>` |
| Block content | Only `field` and `index` (`Expected field or index`); at least one field | Required |
| Primary key | Exactly one `field id UUID @id`; other names or types fail generation | Required |

Entity and table names are globally unique (`Entity X: duplicate entity or table name`). A bad route name fails with `X: route path must be lowercase and URL-safe`; a missing/renamed id fails with `X: V0 CRUD requires exactly one UUID primary key named id`.

Entity annotations (order does not matter): `@label`, `@icon` (must match `^[A-Z][a-zA-Z0-9]*Outlined$`), `@comment`, `@singular`, `@plural`, `@display`, `@tableDisplay`, `@relationDetail`. Duplicates of `@singular`/`@plural`/`@display`/`@tableDisplay`/`@relationDetail` are rejected. `@icon` heuristics: `user` -> `UserOutlined`, `order` -> `ShoppingOutlined`, `warehouse` -> `DatabaseOutlined`, otherwise `TableOutlined`.

## Field types

The type set is closed. Unknown names (including `String`, `Boolean`, `Email`, `Json`) fail with `Unsupported field type X`.

| Syntax | PostgreSQL column | Notes |
| --- | --- | --- |
| `UUID` | `uuid` | Primary key (must be `id`) and foreign keys |
| `Text` | `text` | Strings; enum storage type |
| `Integer` | `integer` | 32-bit |
| `Decimal(p[, s])` | `numeric(p, s)` | Precision required; scale defaults `0` |
| `Money(p[, s])` | `numeric(p, s)` | Same as Decimal, money semantics |
| `Date` | `date` (string mode) | Transports `YYYY-MM-DD` |
| `Time` | `time` | Transports `HH:mm[:ss]`, normalized to `HH:mm:ss` |
| `DateTime` | `timestamp with time zone` | Transports ISO date-time |
| `File` | `text` (storage key) | One protected file |
| `Files` | `jsonb` (string array) | Multiple storage keys |
| `Vector(n)` | `vector(n)` | Requires PostgreSQL + `extension pgvector` + `@extension(pgvector)` |
| `<enumName>` | `text` | Declared enum; rendered as Tag |

Type parameters and validation:

- `Vector(1536)` or `@dimension(1536)`: dimension must be a positive integer, column max 16000, vector index max 2000.
- `Decimal`/`Money` accept `(precision)` or `(precision, scale)`, or `@precision`/`@scale`. Precision > 0 (MySQL <= 65, PostgreSQL <= 1000); `0 <= scale <= precision` (MySQL scale <= 30).
- Parentheses on any other type fail: `Field type Text has no parameters`.
- Enum fields take no parameters and cannot carry `@code`.
- `Files` cannot be a primary key or `@unique`.
- Field names are globally unique; physical column names (`@column`) must be unique (`duplicate column name`).

Date/time behavior: invalid values such as `2026-02-31` or `25:61:00` return **400** naming the field. Forms use `DatePicker`, `TimePicker`, `DatePicker showTime`; lists and display templates localize with `Intl.DateTimeFormat`. Only `DateTime` can drive a dashboard `trend` group-by. Sorting is string comparison (ISO shapes sort correctly).

## Field attributes

Attributes follow the type, any order, and booleans accept `@x` or `@x(false)`.

| Attribute | Types | Default | Effect / error |
| --- | --- | --- | --- |
| `@id` | UUID | none | `.primaryKey()`; server-generated; hidden in forms. Exactly one per entity |
| `@nullable` | all | not null | Nullable column, request field optional. Required for `setNull` relations |
| `@unique` | all except `Files` | false | Unique constraint; usable as relation target. `Files cannot be unique` |
| `@label("...")` | all | field name | Column/form/filter label; derives `qiy.resources.<table>.fields.<field>.label` |
| `@comment("..." / t("key"))` | all | none | Schema JSDoc + metadata; missing default-locale key fails |
| `@icon(Icon)` | all | none | Field metadata; must be `*Outlined` |
| `@visible(bool)` | all | `!primaryKey && type !== Vector` | Default for the three visibility flags |
| `@listVisible(bool)` | all | `@visible` | Default list column |
| `@formVisible(bool)` | all | `@visible` | Form rendering; hiding a required field fails generation |
| `@showVisible(bool)` | all | `@visible` | Detail/drawer rendering |
| `@sortable(bool)` | all | `true` (`Files` false) | Server rejects other sort fields with 400 `Unsupported sort field` |
| `@filterable(bool)` | all | `true` (`Files` false) | Server rejects other filter fields with 400 `Unsupported filter field` |
| `@filter(mode, ...)` | all | by type | Restricts operators: `eq, contains, startsWith, endsWith, gt, gte, lt, lte, between, in` |
| `@upload(binary\|base64\|both)` | File/Files | `binary` | Upload channel |
| `@maxBytes(n)` | File/Files | `26214400` | 1..104857600 |
| `@maxFiles(n)` | File/Files | `1` for `File`, `6` for `Files` | `File` only 1; `Files` 1..20 |
| `@mime("a/b", ...)` | File/Files | `["*/*"]` | Mergeable whitelist |
| `@extension(name)` | Vector | none | DB extension already declared in `database` |
| `@code("template")` | Text, non-enum, non-PK | none | Server-rendered business code (see below) |
| `@generated(uuid)` | UUID, non-PK | none | Server UUIDv4 |
| `@column("name")` | all | field name | Physical column name |
| `@dimension/@precision/@scale` | Vector / Decimal / Money | type parameter | Alternative spelling |

There is no `@required`, no `@default`, no `@length`/`@min`/`@max`/`@format`, no `@searchable`/`@hidden`/`@readonly`, no `@computed`/`@transient`. Required is the default; use `@nullable` for optional. Defaults and business validation belong in migrations, seeds or server extensions.

## Generated values and business codes

```qiy
entity orgs @label("Organizations") {
  field id UUID @id;
  field code Text @unique @code("ORG-{YYYY}{MM}-{seq:4}");
  field name Text;
  field parentId UUID @nullable;
  field externalId UUID @nullable @generated(uuid);
}

relation orgParent orgs parentId orgs id one @onDelete(setNull);
```

| Annotation / shape | Type | When | Behavior |
| --- | --- | --- | --- |
| `@code("template")` | `Text`, non-enum, non-PK | Server create | Renders a business code |
| `@generated(uuid)` / `@generated` | `UUID`, non-PK | Server create | UUIDv4 |
| Non-PK `UUID` with **no** relation | `UUID` | Server create | Treated as a system reference: random UUID, hidden in forms |
| `field id UUID @id` | `UUID` | Server create | Always generated |
| FK source field with a relation | `UUID` | User choice | Never auto-generated |

**Declare a relation for every real foreign key.** Without one, a UUID field is filled with a random UUID and the form cannot select a target. Conversely, a FK source cannot be `@code` or `@generated`.

Template tokens (all validated at parse/generation time):

| Token | Meaning |
| --- | --- |
| `{uuid}` | Random UUIDv4 |
| `{YYYY}`, `{YY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}`, `{SSS}` | Date/time parts, rendered in `QIY_CODE_TIMEZONE` (default `UTC`) |
| `{YYYYMMDD}`, `{YYYY}{MM}` etc. | Any ordered concatenation; the parser splits by fixed widths |
| `{seq}` / `{seq:4}` | Sequence, width 1..12, zero-padded |
| `{count+1}` / `{count+1:4}` | Legacy alias of `{seq}` |
| `{$.seq}` / `{$.count+1}` | Legacy alias |
| `{random:10}` | Random string from `a-zA-Z0-9`, length 1..256 |
| `{random:8:A-F0-9}` | Random with an explicit ASCII alphanumeric charset |
| `{random a-z/A-Z/0-9 length 10}` | Natural spelling of the same |
| `{{` / `}}` | Literal braces |

- The pattern must be non-empty, <= 512 chars, contain at least one token, and contain a uniqueness token (`seq`, `count+1`, `random`, `uuid`).
- The bucket is the concatenation of rendered date/time tokens. Sequences are persisted per `(entity, field, bucket)` in `qiy_code_sequences`; `PO-{YYYYMMDD}-{seq:4}` resets daily.
- Two `{seq}` tokens in one template share the same allocated number, padded per width; multiple `@code` fields keep separate counters.
- Generated values are rendered only on the server. Client input is stripped (`qiyStripGeneratedValues`); PATCH/GraphQL update strips generated fields and returns the record unchanged when the patch becomes empty.
- Unique-conflict retries: 5 (`QIY_GENERATED_ATTEMPTS`), then HTTP **409** `{ errorKey: "generated.conflict" }` - not 500.
- PostgreSQL/SQLite allocate atomically (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`); MySQL uses `SELECT ... FOR UPDATE` inside the transaction.
- Seeds, migrations, raw SQL and Dataflow `create` bypass `@code`; a Dataflow `create` must supply non-null generated fields explicitly.
- Frontend: generated fields are not rendered in create forms (read-only `qiy.autoGenerated` hint), shown disabled when editing, visible in list/detail. `autoGenerated: true` in `resources.ts`; `@formVisible(true)` cannot override it.

## Display templates

`@display`, `@tableDisplay` and `@relationDetail` share one tiny template language:

```text
plain text                 escaped, output as-is
{$.fieldName}              interpolation: UUID, Text, enum, Integer, Decimal, Money, Date, Time, DateTime
<b>{$.name}</b></br>...    whitelisted tags: br b strong i em span small p div
```

Fallback chain: without `@display`, the first readable field named `name` -> `title` -> `displayName` -> `code` -> `number` -> `sku` -> `email` -> `label` -> `inventoryKey` becomes `{$.<field>}`. `File`, `Files` and `Vector` never participate. `@tableDisplay` defaults to `@display`; `@relationDetail` defaults to `@display`; the three are independent.

Rejected: empty template, malformed placeholder (must be exactly `{$.field}`), unknown field, interpolating `File`/`Files`/`Vector`, interpolating a foreign-key source field (`cannot interpolate foreign key field X`), non-whitelisted or uppercase tags, self-closing tags other than `br`, unpaired/stray tags, attributes/events. Text and values are HTML-escaped; enum values use the current language; dates use `Intl.DateTimeFormat`; `<br>`, `<br/>`, `</br>` all normalize to one newline.

## Filters, visibility and defaults

```qiy
entity products {
  field id UUID @id;
  field name Text @filter(contains, startsWith, endsWith, eq);
  field amount Integer @filter(eq, gte, lte, between, in);
  field createdAt DateTime @filter(gte, lte, between);
  field status productStatus;        // enum: only eq by default
  field attachment Files @nullable;  // not sortable/filterable by default
}
```

| Operator | Semantics | Input |
| --- | --- | --- |
| `eq`, `gt`, `gte`, `lt`, `lte` | equality/comparison | single value |
| `contains`, `startsWith`, `endsWith` | text matching | single value |
| `between` | inclusive range | two comma-separated values |
| `in` | set | comma-separated values |

Default operator sets: `@filter(...)` -> enum `["eq"]` -> Text `["contains","startsWith","endsWith","eq"]` -> other `["eq","gt","gte","lt","lte","between","in"]`.

- Server-side whitelists reject undeclared fields/operators with **400** `Unsupported filter field` / `Unsupported filter operator`.
- REST preserves nested `and`/`or` groups: max **8 levels**, **50 leaves**. GraphQL uses a flat `QiyFilterInput` (top-level AND).
- Visibility: primary keys and `Vector` are hidden in list/form/show by default; `File`/`Files` are visible. List columns are all `listVisible` fields in declaration order; the column picker persists to `localStorage`. Field order is declaration order everywhere (schema, forms, detail, list, CSV); there is no `@order`.

## Relations

```text
relation <name> <fromEntity> <fromField> <toEntity> <toField> <one|many>
         [@onDelete(<restrict|cascade|setNull>)]
         [@comment("...")] ;
```

```qiy
relation orderCustomer orders customerId customers id one @onDelete(restrict);
relation lineOrder orderItems orderId orders id one @onDelete(cascade);
relation orgParent orgs parentId orgs id one @onDelete(setNull);
```

| Slot | Rule |
| --- | --- |
| Name | Globally unique (`Relation X: invalid or duplicate name`) |
| Source | Declared entity + its `UUID` field; one relation per source field (`duplicate source field X.Y`) |
| Target | Declared entity + primary key or `@unique` field (`target field must be primary or unique`) |
| Cardinality | Only `one`. `many` parses but fails validation: `only one-to-one/many-to-one foreign keys are supported; model many-to-many with an explicit join entity` |
| `@onDelete` | `restrict`, `cascade`, `setNull` (default: database default). `setNull` requires `@nullable`; `@onDelete("")` emits no action |
| `@comment` | JSDoc on the FK column |

Hard rules: both endpoints must be `UUID` (`V3 foreign keys require UUID fields`); the source cannot be `@generated` or `@code`; only single-column FKs exist (no composite syntax); self relations are legal and generate a typed `.references((): AnyPgColumn => ...)` callback; `relation` declarations come after all `entity` blocks. Relations carry no authorization - use `restrict` for row/field policy ([auth-permissions.md](auth-permissions.md)).

Generated UI: FK cells render the target's display text (`@tableDisplay` -> `@display` -> natural field), not a bare UUID. The list batches FK lookups per resource (deduplicated, <= 200 ids, one `getMany` per target); detail pages and the drawer use `useOne`. The drawer mirrors the target's detail page, keeps a `@relationDetail` summary, supports nested FKs, and is `min(92vw, 760px)` wide. `pages ... field X roles ...` also gates drawer fields.

## Indexes

```text
index <name> <btree|hnsw|ivfflat> ( <field> [<opclass>] [, ...] )
      [@unique] [@concurrently] [@comment("...")] ;
```

```qiy
index products_sku_uq btree(sku) @unique;
index products_name_idx btree(name);
index products_embedding_hnsw hnsw(embedding vector_cosine_ops) @comment("Similarity search");
```

| Slot | Rule |
| --- | --- |
| Name | Globally unique (`duplicate index name`) |
| Method | `btree`, `hnsw`, `ivfflat` (`Unsupported index method X`) |
| Columns | Entity field names (not physical `@column` names); at least one |
| Opclass | Vector only: `vector_l2_ops`, `vector_ip_ops`, `vector_cosine_ops`; btree opclass is rejected |
| `@unique` | Not allowed on vector indexes |
| `@concurrently` | PostgreSQL only (`concurrently requires PostgreSQL`); migration cannot run in a transaction |

Vector indexes require PostgreSQL + `pgvector`, exactly one `Vector` column, a compatible opclass, and dimension <= 2000 (`hnsw vector dimension cannot exceed 2000`). PostgreSQL does not index foreign keys automatically - add `btree(<fk>)` when lists filter by them. For composite indexes put equality columns first and range/sort columns after (`btree(status, placedAt)`). MySQL narrows indexed `Text`/`File` columns to `varchar(255)`.

## Validation pipeline and modeling limits

```text
include expansion -> lexer/parser -> IR validation -> generation validation -> write files
```

- Parse errors abort immediately with the first error; IR/generation errors are collected and joined in one message; the CLI exits 1 and writes nothing on failure.
- Parse success is not generation success: missing `id`, bad icons, bad route names, hidden required fields, auth columns, scope/restrict references, features dependencies and permission sources are all checked later.

Modeling limits (do not promise these):

- No expressions, functions, template strings, default values, computed/transient fields or Text length constraints.
- One database dialect per model; no cross-database joins.
- No implicit many-to-many: model an explicit join entity with two `one` relations.
- No business workflow inference from fields/relations. Use `workflow orderInventory` (fixed, PostgreSQL, exact field contract) or an explicit `dataflow` ([dataflows-actions.md](dataflows-actions.md)).
- Format: `mode integration` models generate a Refine web package only; they reject `auth`, `scope`, `restrict`, `workflow`, `dataflow`, `storage`, `elysia`, `env` and `realtime` ([workspace-integration.md](workspace-integration.md)).
- `restrict` cannot be combined with `dataflow`/`orderInventory` on the same resource; the generator fails closed.
- No forward compatibility: unknown constructs/annotations are rejected, so regenerate after CLI upgrades.

## Worked modeling walkthrough

```qiy
qiy v0;

application catalog @comment("Catalog back office") {
  database postgresql {}
  api { client rest; }

  include "modules/shared.qiy";

  enum productStatus {
    value draft label "Draft" color default;
    value active label "Active" color green;
    value archived label "Archived" color red;
  }

  entity products table catalog_products
    @label("Products") @icon(AppstoreOutlined)
    @display("{$.sku} · {$.name}") @tableDisplay("{$.sku}") {
    field id UUID @id;
    field sku Text @unique @code("PRD-{YYYYMM}-{seq:4}");
    field name Text @filter(contains, startsWith, eq);
    field price Money(12, 2) @nullable @filter(eq, gte, lte);
    field status productStatus;
    field supplierId UUID;
    index catalog_products_sku_uq btree(sku) @unique;
    index catalog_products_supplier_idx btree(supplierId);
  }

  entity suppliers @display("{$.name}") {
    field id UUID @id;
    field name Text @unique;
  }

  relation productSupplier products supplierId suppliers id one @onDelete(restrict);
}
```

```qiy
# modules/shared.qiy - a fragment: no qiy header, no application wrapper
enum auditAction { value created; value updated; value deleted; }
```

Steps after editing: run `qiy generate <model> <dir> --sync` (or `qiy init --sync` for a mounted admin), review the generated Drizzle migration and the options table, run `bun run check`, `bun test`, and `bun run build` inside the generated workspace, then exercise list/create/edit/show for the changed resource. Never apply a migration you have not read, especially when it drops or renames a column.

## Pitfalls

| Error | Cause | Fix |
| --- | --- | --- |
| `Unsupported field type String` | Type is a closed set | Use `Text`, `Integer`, an enum, or `Text` + `@mime` |
| `Field type Text has no parameters` | Parentheses on a non-parameterized type | Remove them; enforce length in migrations/business code |
| `Unsupported field attribute @required` | Fields have no `@required` | Required is the default; use `@nullable` |
| `... V0 CRUD requires exactly one UUID primary key named id` | Missing/renamed/retyped PK | Keep `field id UUID @id` |
| `required field cannot be hidden from the create form` | Non-null field hidden via `@visible(false)`/`@formVisible(false)` | Add `@nullable` or keep it visible |
| `... cannot interpolate foreign key field customerId` | Display template references an FK source | Reference a scalar field of the target (`{$.customerName}`) |
| `invalid @code template "...": the pattern needs {seq}, ...` | Template has no uniqueness token | Add `{seq:N}` or `{random:N}` |
| `Entity X: duplicate entity or table name` | Include repeated or name collision | Include once; unique names |
| `Expected field or index` | Unsupported token inside an entity | Only `field` and `index` are allowed |
| `Expected relation near token N` | `relation` before entities | Move all relations after all entities |
| `Expected enum near token N` | Enum declared after an entity | Move enums before entities |
| FK filled with a random UUID at create | Relation missing | Declare the `relation` |
| `hnsw requires PostgreSQL and pgvector` | Wrong dialect or extension missing | PostgreSQL + `extension pgvector;` + `@extension(pgvector)` |
| `X: route path must be lowercase and URL-safe` | Uppercase/invalid `table` name | Use `^[a-z][a-z0-9_-]*$` |

## Related references

- [Language reference](language-reference.md) - complete DSL map, all blocks/settings/annotations
- [Auth and permissions](auth-permissions.md) - roles, scope, restrict, pages
- [Dataflows and actions](dataflows-actions.md) - transactional commands and UI actions
- [UI, charts and i18n](ui-charts-i18n.md) - menu, dashboard, charts, messages
- [Storage and realtime](storage-realtime.md) - file fields and subscriptions
- [CLI workflows](cli-workflows.md) - generate, `--sync`, install, run
- [Troubleshooting](troubleshooting.md) - cross-area error table

## Canonical docs

- [entity and field](https://ai-nodev.github.io/qiy/dsl/entity)
- [relation and index](https://ai-nodev.github.io/qiy/dsl/relation-index)
- [generated values](https://ai-nodev.github.io/qiy/dsl/generated-values)
- [modules/include](https://ai-nodev.github.io/qiy/dsl/modules)
- [annotations](https://ai-nodev.github.io/qiy/dsl/annotations)
- [validation overview](https://ai-nodev.github.io/qiy/dsl/overview)

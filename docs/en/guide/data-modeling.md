# Data modeling

A `.qiy` file holds one `application`. Inside it, `enum`, `entity`, `relation` and `view` declarations describe the data; every entity becomes a table, a Drizzle schema, REST and GraphQL resources, and list/create/edit/show pages.

## A complete model

```qiy
qiy v0;

application helpdesk {
  database sqlite {}

  enum ticketStatus {
    value open label "Open" color blue;
    value pending label "Pending" color orange;
    value closed label "Closed" color default;
  }

  entity customers @label("Customers") @icon(TeamOutlined) {
    field id UUID @id;
    field name Text @length(2, 80);
    field email Email @unique;
    field website URL @nullable;
  }

  entity labels {
    field id UUID @id;
    field name Text @unique;
  }

  entity tickets @label("Tickets") @icon(CustomerServiceOutlined) @display("{$.code} · {$.title}") {
    field id UUID @id;
    field code Text @unique @code("TCK-{YYYYMM}-{seq:4}");
    field title Text @length(3, 120) @filter(contains, startsWith, eq);
    field priority Integer @min(1) @max(5) @default(3);
    field hours Decimal(6, 2) @nullable;
    field rate Money(10, 2) @default(80);
    field cost Decimal(12, 2) @nullable @computed("{hours} * {rate}");
    field status ticketStatus @default(open);
    field customerId UUID;
    field attachments Files @nullable @mime("image/png", "application/pdf");
    field revision Integer @version;
    field openedAt DateTime @default(now) @filter(gte, lte, between);
    field deletedAt DateTime @nullable @softDelete;

    index tickets_status_opened_idx btree(status, openedAt);
  }

  relation ticketCustomer tickets customerId customers id one @onDelete(restrict);
  relation ticketLabels tickets labelIds labels id many;

  view open_tickets from tickets {
    columns id, code, title, priority, status;
  }

  menu {
    group support @label("Support") @icon(CustomerServiceOutlined) {
      resource tickets;
      resource customers;
      resource labels;
    }
  }

  chart const TicketCount { title = "Tickets"; data = count tickets; }
  chart pie TicketsByStatus { title = "By status"; data = count tickets group by status; labels = status; }
}
```

Generate it with `qiy generate helpdesk.qiy out/helpdesk`, or put it in a project and run `qiy dev`.

## Rules every model follows

- The file starts with `qiy v0;`, and `database <postgresql|mysql|sqlite>` is the first declaration inside `application`.
- Blocks appear in a fixed order: configuration blocks, then `permission`, `enum`, `entity`, `relation`, `view`, `scope`, `restrict`, `pages`, `menu`, `chart`, and finally `statemachine`, `dataflow`, `action`, `webhook` and `notification` in any order. See the [DSL reference](/en/guide/dsl-reference#block-order).
- Every entity has exactly one `field id UUID @id;`.
- `table <name>` sets the physical table and the web route; it must be lowercase and URL-safe. It defaults to the entity name.
- Text that is not a plain ASCII identifier goes in quotes: `@label("Open tickets")`, `@code("TCK-{seq:4}")`.

## Field types

| Type | Column (PostgreSQL) | Notes |
| --- | --- | --- |
| `UUID` | `uuid` | Primary keys and foreign keys |
| `Text`, `Email`, `URL` | `text` | `Email`/`URL` add format checks and matching inputs |
| `Integer` | `integer` | |
| `Decimal(p, s)`, `Money(p, s)` | `numeric(p, s)` | Returned as strings on PostgreSQL/MySQL to keep precision |
| `Boolean` | `boolean` | Rendered as a switch |
| `Date`, `Time`, `DateTime` | `date`, `time`, `timestamptz` | Transported as `YYYY-MM-DD`, `HH:mm:ss`, ISO date-time |
| `JSON`, `Text[]`, `Integer[]` | `jsonb` | |
| `File`, `Files` | `text`, `jsonb` | Storage keys for protected uploads; see `storage { provider local|s3; }` |
| `Vector(n)` | `vector(n)` | PostgreSQL with `extension pgvector;` only |
| `<enum name>` | `text` | Rendered as a colored tag |

Fields are required unless marked `@nullable`. There is no `String`, `Json` or `@required` on entity fields.

## Field attributes

| Attribute | Applies to | Effect |
| --- | --- | --- |
| `@nullable` | all | Optional column and input |
| `@unique` | all but `Files` | Unique constraint |
| `@default(v)` | scalars | Column default; the create input becomes optional and the form is pre-filled. `DateTime` accepts `now`, enum fields take a member name |
| `@min(n)` / `@max(n)` | `Integer`, `Decimal`, `Money` | Inclusive bounds |
| `@length(max)` / `@length(min, max)` | `Text`, `Email`, `URL` | Length in Unicode code points |
| `@pattern("regex", "example")` | `Text` | The example must satisfy the rule; it becomes the form placeholder and the test value |
| `@code("TCK-{YYYYMM}-{seq:4}")` | `Text` | Server-generated business code with a per-pattern sequence |
| `@generated(uuid)` | non-key `UUID` | Server-generated UUID |
| `@computed("…")` | `Text`, `Integer`, `Decimal`, `Money` | Database generated column; see below |
| `@version` | `Integer` | Optimistic locking; see below |
| `@softDelete` | nullable `DateTime` | Delete sets a timestamp; adds a trash page and a restore endpoint |
| `@tenant("tenant.id")` | `UUID`, `Text`, `Integer` | Tenant column filled and filtered from an auth claim |
| `@label`, `@comment`, `@icon` | all | Display text, documentation, icon (Ant Design `*Outlined`) |
| `@visible`, `@listVisible`, `@formVisible`, `@showVisible` | all | Where the field appears; a required field without a default cannot be hidden from the form |
| `@sortable`, `@filterable`, `@filter(eq, contains, …)` | all | Which sorts and filter operators the list UI and the server accept |
| `@mime`, `@maxBytes`, `@maxFiles`, `@upload` | `File`, `Files` | Upload policy |
| `@column("name")` | all | Physical column name |

Value rules are checked in each resource service, so REST, GraphQL and CSV import all answer with the same 400 `{ error, errorKey: "validation.<rule>", field }`, and the generated form applies the same rules before submitting.

### Computed fields

`@computed` compiles to a database generated column (STORED on PostgreSQL, VIRTUAL on MySQL and SQLite). A `Text` field takes a template such as `"Order {reference}"` over other `Text` fields; a numeric field takes arithmetic over numeric fields (`+ - * /`, numbers, parentheses). Numeric computed fields must be `@nullable`: a null reference or a division by zero yields null. Computed fields are read-only, sortable, filterable, indexable and can be selected by views.

### Optimistic locking

A `@version` field starts at 1 and increments on every REST, GraphQL or dataflow update. A PATCH that sends a stale value gets 409 `{ errorKey: "version.conflict" }`; the edit form sends the loaded value back and reloads the record on a conflict.

### Soft delete

With `@softDelete`, `DELETE /:id` stores the time instead of removing the row, lists exclude deleted rows, `GET /<table>?deleted=true` lists the trash and `POST /<table>/:id/restore` restores a row. Both use the resource's delete permission.

## Relations

```qiy
relation ticketCustomer tickets customerId customers id one @onDelete(restrict);
relation ticketLabels tickets labelIds labels id many;
```

`relation <name> <source> <field> <target> <targetField> one|many`:

- `one` is a foreign key. The source field is a `UUID`; `@onDelete(cascade|setNull|restrict)` sets the delete rule (`setNull` needs a nullable field). Forms render a searchable relation picker and lists show the target's `@display` text.
- `many` adds a virtual id-array field (here `labelIds`, not declared on the entity) backed by a generated join table. Create and update accept up to 500 ids, responses return the linked ids, and the form renders a multi-select.

`@display("{$.code} · {$.title}")` controls how a record appears in pickers and foreign-key cells. Without it Qiy uses the first of `name`, `title`, `displayName`, `code`, `number`, `sku`, `email`, `label`.

## Indexes

```qiy
index tickets_status_opened_idx btree(status, openedAt);
index customers_email_uq btree(email) @unique;
```

Indexes are declared inside the entity. The method is `btree`, or `hnsw`/`ivfflat` with an operator class for `Vector` fields on PostgreSQL with pgvector; PostgreSQL also accepts `@concurrently`.

## Views

```qiy
view open_tickets from tickets {
  columns id, code, title, priority, status;
}
```

A view becomes a database view plus read-only REST, GraphQL and list pages. Reads go through the source resource's access rules: soft-deleted rows, data scopes and record policies apply exactly as on the source.

## Enums, menus and charts

- `enum <name> { value <member> label "…" color <color> icon <Icon>; }` declares a closed set of values; the field stores the member name.
- `menu { group <name> @label("…") @icon(…) { resource <table>; } }` builds the sidebar; `@parent(<group>)` nests groups.
- `chart const|pie|bar|line|area|scatter|stacked|table <Name> { title = "…"; data = …; }` adds overview widgets: `count`, `sum`, `avg`, `min`, `max`, `count … group by <field>`, `trend <entity>.<DateTime field> days <n>` and `list <entity> columns …`. `chart panels` lays them out on a responsive grid.

## Changing a model

1. Edit the `.qiy` files and run `qiy check`.
2. Run `qiy diff` to preview what changes in the generated workspace, then `qiy generate`.
3. In `apps/server`, run `bun run db:generate` to create a migration, review it, and run `bun run db:migrate`. `bun run db:check` reports any drift between the database and the schema.

The complete attribute matrix, display templates and all error messages are in the Chinese [entity reference](/dsl/entity).

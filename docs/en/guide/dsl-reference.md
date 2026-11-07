# DSL reference

This page lists every Qiy construct with its syntax in one place. The exhaustive reference, with every setting, default and error message, is the Chinese [DSL overview](/dsl/overview) and the pages it links to.

## Lexical rules

- A file starts with `qiy v0;`. Comments run from `#` or `//` to the end of the line; there are no block comments.
- Identifiers match `[a-zA-Z_][a-zA-Z_0-9-]*`, so `azure-ad-b2c` is a valid bare value.
- Double-quoted strings are JSON strings. Single-quoted strings only escape `\\` and `\'`.
- Anything else, including non-ASCII text, spaces, `:`, `/`, `*`, `[` and `]`, must be inside quotes; otherwise the lexer reports `Unexpected Qiy syntax at offset N`.
- `field`, `index`, `relation`, `scope` and other one-line declarations end with `;`. A block's closing `}` takes no `;`.
- Display text can be a literal or a message key: `@label("Tickets")`, `@label(t("tickets.label"))`.

## Block order

The parser reads `application` in a fixed order. A block out of place fails with `Expected <keyword> near token N`. Optional blocks can be skipped, but the rest keep their relative order.

| # | Block | Count | Purpose |
| --- | --- | --- | --- |
| 1 | `database postgresql\|mysql\|sqlite { extension …; }` | exactly 1, first | Dialect and extensions (`pgvector` on PostgreSQL) |
| 2 | `mode standalone\|integration;` | 0..1 | Generate a full workspace, or only a web client for an existing API |
| 3 | `integration { … }` | 0..1 | Host API base URL, auth transport, response envelope, pagination |
| 4 | `workspace { … }` | 0..1 | Directory and package names for `qiy init` |
| 5 | `ui { … }` | 0..1 | Theme colors and light/dark mode |
| 6 | `api { client rest\|graphql; cors { origin "…"; } }` | 0..1 | Web transport and CORS origins |
| 7 | `features { overview true; apiDocs true; apiKeys true; }` | 0..1 | System pages |
| 8 | `realtime { … }` | 0..1 | Server-sent events for resources |
| 9 | `elysia { … }` | 0..1 | Server plugins and cron jobs |
| 10 | `storage { provider local\|s3; }` | 0..1 | File storage |
| 11 | `notifications { provider …; from "…"; }` | 0..1 | Email adapter and sender |
| 12 | `auth { … }` | 0..1 | Sign-in providers, user entity, roles, claims |
| 13 | `env { variable … { … } }` | 0..1 | Custom environment variables |
| 14 | `messages { default "…"; locale "…" { "key" "text"; } }` | 0..1 | Translations |
| 15 | `permission …` | 0..N, contiguous | Permission values, groups, sources, verifications |
| 16 | `enum` | 0..N | Closed value sets |
| 17 | `entity` | 0..N | Tables and resources |
| 18 | `relation` | 0..N | Foreign keys and many-to-many links |
| 19 | `view` | 0..N | Read-only database views |
| 20 | `scope` | 0..N | Data scopes |
| 21 | `restrict` | 0..N | Row and field policies |
| 22 | `pages` | 0..N | Page rules per role |
| 23 | `menu` | 0..1 | Sidebar |
| 24 | `chart`, `chart panels` | 0..N | Overview widgets and layouts |
| 25 | `statemachine`, `dataflow`, `action`, `webhook`, `notification` | 0..N, any order | Commands, buttons and event subscribers |

Large models can be split with `include "modules/catalog.qiy";`. Included files are fragments without `qiy v0;`, and the expanded result must still follow this order.

## Data

```text
enum <name> { value <member> [label "…"] [color <color>] [icon <Icon>]; … }

entity <Name> [table <table>] [@label(…)] [@icon(…)] [@display("{$.field} …")] {
  field <name> <Type>[(<params>)] [@attribute …];
  index <name> btree|hnsw|ivfflat(<field> [<opclass>], …) [@unique] [@concurrently];
}

relation <name> <source> <field> <target> <targetField> one|many [@onDelete(cascade|setNull|restrict)];

view <name> from <entity> { columns <field>, …; }
```

Types: `UUID`, `Text`, `Email`, `URL`, `Integer`, `Decimal(p, s)`, `Money(p, s)`, `Boolean`, `Date`, `Time`, `DateTime`, `JSON`, `Text[]`, `Integer[]`, `File`, `Files`, `Vector(n)` and enum names. Field attributes are listed in [Data modeling](/en/guide/data-modeling#field-attributes).

## Access

```text
auth {
  provider local | oidc;            // or: providers local, okta, corp;
  user <entity>; roleField <enumField>;
  [subjectField <field>;] [usernameField <field>;] [passwordField <field>;] [profileField <field>;]
  [roles { <role> full|write|read; … }]
  [claim <claim> <field>;]
  [provider <name> { preset <preset>; label "…"; subjectField <field>; claim <claim>; }]
}

permission field <Name> "<value>" [@label(…)];
permission group <Name> { <member>, … }
permission group <Name> = <A> & <B>;
permission from database field <entity>.<field>;
permission from claim <provider> "<claim>";
permission verification <Name> { [input { field <name> Text|Array<String>; }] return <expression>; }

scope <resource> <field> claim <claim> [tree <entity> <parentField>];

restrict <resource> {
  [allow roles <role>, …;]
  [when <condition>;] …
  [mask <field> roles <role>, … | claim absent <claim> mode omit|null|redact [replacement "…"];] …
}

pages <resource> {
  [list|show|create|edit|delete roles <role>, …;] …
  [field <field> roles <role>, …;] …
}
```

See [Authentication and permissions](/en/guide/auth-permissions).

## UI

```text
menu { group <name> [@label(…)] [@icon(…)] [@parent(<group>)] { resource <table>; … } }

chart const|pie|bar|line|area|scatter|stacked|table <Name> {
  [icon = "<Icon>";] title = "…";
  data = count <entity> | sum|avg|min|max <entity>.<field>
       | count <entity> group by <field>
       | trend <entity>.<DateTime field> days <n>
       | list <entity> columns <field>, …;
  [labels = <enum field>; | labels { <value> "…"; … }] [color = "#…";] [legend = false;]
}

chart panels <Name> { title = "…"; grid <columns> <rows>; <Chart> { larger|medium|small <x> <y> <w> <h>; } }
```

## Commands and events

```text
statemachine <Name> {
  resource <entity>; field <enumField>; initial <state>;
  transition <name> { from <state>, …; to <state>; [label …;] [confirm …;] [allow …;] }
}

dataflow <Name> [@label(…)] [@confirm(…)] [@comment(…)] {
  [allow roles … | allow permission … | allow verification <Name>;]
  [idempotency required;]
  [audit "<action>";]
  input { field <name> <Type> [@required]; … }
  context { <binding> = entity <entity> by id input.<field> [@required]; … }
  step <name> [@order(n)] {
    require <condition> @error("…");
    update <binding> { <field> = <value>; … }
    create <binding> = entity <entity> { <field> = <value>; … }
    delete <binding>;
    emit "<event>" { <key> = <value>; … }
    call <adapter> { <key> = <value>; … }
  }
  result { return <binding>; }
}

action <Name> {
  [allow …;] resource <entity>;
  dataflow <flow>; | navigate "/<table>/:id/…"; page manual;
  placement list, show; [label …;] [when <field> ==|!=|in …;] [confirm …;] [batch true;]
}

webhook <Name> { event "<event>", …; url env <ENV>; secret env <ENV>; }

notification <Name> { event "<event>"; to "<address>" | payload.<field>, …; subject …; body …; }
```

See [Business logic](/en/guide/business-logic).

## Validation stages

| Stage | Reports |
| --- | --- |
| Include expansion | Missing files, `..` escapes, cycles |
| Parsing | The first syntax error, block order, unknown attributes, references between blocks |
| IR validation | All naming, type, index and relation errors at once |
| Generation | All primary key, icon, route, auth, policy and command errors at once |

`qiy check` runs every stage without writing files. `qiy explain --json` returns the normalized model and stable error codes; `qiy explain --errors` lists the catalog.

# Qiy DSL language reference

Use this file as the complete map of the `.qiy` language: lexical rules, strict declaration order, every application block and setting, entity/field grammar, relations/indexes, enums, generated values, display templates, and the placement matrix for every annotation. Open the focused reference for deep behavior; this page is enough to write a syntactically valid model.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/overview

## Contents

- [Lexical rules](#lexical-rules)
- [Declaration order](#declaration-order)
- [Validation pipeline](#validation-pipeline)
- [Minimal valid model](#minimal-valid-model)
- [application settings](#application-settings)
- [database](#database)
- [mode and integration](#mode-and-integration)
- [workspace](#workspace)
- [ui](#ui)
- [api](#api)
- [features](#features)
- [realtime](#realtime)
- [elysia](#elysia)
- [storage](#storage)
- [auth](#auth)
- [env](#env)
- [messages](#messages)
- [permission](#permission)
- [workflow](#workflow)
- [enum](#enum)
- [entity and field](#entity-and-field)
- [relation and index](#relation-and-index)
- [scope, restrict, pages](#scope-restrict-pages)
- [menu](#menu)
- [dashboard](#dashboard)
- [chart and chart panels](#chart-and-chart-panels)
- [dataflow](#dataflow)
- [action](#action)
- [Annotation inventory](#annotation-inventory)
- [Generated values](#generated-values)
- [Display templates](#display-templates)
- [i18n keys](#i18n-keys)
- [Pitfalls](#pitfalls)

## Lexical rules

| Category | Rule | Example |
| --- | --- | --- |
| Identifier | `[a-zA-Z_][a-zA-Z_0-9-]*` (internal hyphens allowed) | `orders`, `azure-ad-b2c`, `order_items` |
| Integer | `-?\d+` (negatives only in dataflow integer comparisons) | `1536`, `8`, `-1` |
| Double-quoted string | JSON string: `\" \\ \/ \b \f \n \r \t \uXXXX` | `"用户总数"`, `"a\nb"` |
| Single-quoted string | Only `\\` and `\'` escape; other backslashes are literal | `'C:\path'` |
| Comment | `#` or `//` to end of line (not inside strings) | `# domain note` |
| Multi-char symbols | `&&`, `\|\|`, `==`, `!=`, `>=`, `<=` | permission/policy expressions |
| Single-char symbols | `{ } ( ) ; , @ . = < > ! & \|` | structure |
| Whitespace | any amount, separators only | - |

Anything else (`:`, `[`, `]`, `*`, `+`, `%`, `?`, `$`, backticks, non-ASCII) fails the lexer with `Unexpected Qiy syntax at offset N`. Put such content in quotes (`"CN-0001"`, `"https://..."`, `"{seq:4}"`). Bare values are allowed only for ASCII identifiers (`@icon(AppstoreOutlined)`, `theme blue`); double and single quotes are not equivalent (`"a\nb"` is a newline, `'a\nb'` is a backslash plus `n`).

Semicolons:

| Position | `;` | Notes |
| --- | --- | --- |
| `field`, `index`, `relation`, `scope`, `metric`, `permission field/from`, `workflow`, `variable` declarations | required | Missing -> `Expected ; near token N` |
| Block closing `}` (`database`, `ui`, `entity`, `enum`, `menu`, `chart`, ...) | **not allowed** | Extra `;` -> `Expected ... near token N` |
| `permission group { ... }`, `permission verification { ... }` | optional | List form may end with `;` |
| `chart` view properties | required between properties; optional before `}` | `expected ; after the property value` |
| `emit`/`call` payload blocks | block `;` optional; each assignment needs `;` | - |
| `require ... @error("...");` | required | - |

Numbers are integers only (type parameters, annotations, `chart panels` grid/coords, dataflow integer comparisons). There are no float literals; use `Decimal`/`Money` types.

## Declaration order

```text
qiy v0;                                   # first declaration (only v0 exists)
application <name> [@comment] { ... }     # exactly one per project
  database <dialect> [@comment] { extension ...; }    # first inside application
  mode standalone|integration;
  integration { ... }
  workspace { ... }
  ui { ... }
  api { ... }
  features { ... }
  realtime { ... }
  elysia { ... }
  storage { ... }
  auth { ... }
  env { ... }
  messages { ... }
  permission ...                          # contiguous, 0..N
  workflow orderInventory;
  enum ...                                # before entities
  entity ... { field ...; index ...; }
  relation ...;                           # after all entities
  scope ...;
  restrict ... { ... }
  pages ... { ... }
  menu { ... }                            # at most one
  dashboard { metric ...; } / chart ... / chart panels ...
  dataflow ... { ... }
  action ... { ... }
}
```

The parser is a single-pass recursive descent: it `expect`s each construct in this order and reports `Expected <keyword> near token N` on the first mismatch. Consequences:

- `database` must be the first declaration after `application {`.
- `permission` declarations must come immediately after `messages` (and before `workflow`/`enum`/`entity`); writing another top-level block between them fails.
- Enums before entities, entities before relations, `pages` before `menu`, `menu` before `dashboard`/`chart`, `dataflow` before `action`.
- Optional singleton blocks (`mode`, `integration`, `workspace`, `ui`, `api`, `features`, `realtime`, `elysia`, `storage`, `auth`, `env`, `messages`) may be omitted, but their slot cannot move.
- `dashboard` and `chart` share one slot and may interleave.
- After `include` expansion the whole model must satisfy the same order ([modeling-and-generation.md](modeling-and-generation.md)).

## Validation pipeline

```text
include expansion -> lexer/parser -> IR validation -> generation validation -> write files
```

| Stage | Checks | Typical error |
| --- | --- | --- |
| Include expansion | relative `.qiy` paths, `..`/absolute/symlink escapes, cycles, selectors | `Qiy include cycle detected: ...` |
| Parser | tokens, block order, annotation values, duplicates, templates, chart semantics, permission model, cross-block references | `Expected entity near token 42`, `Unsupported field attribute @required` |
| IR validation | names/types/indexes/relations/display templates with FK info | `V3 foreign keys require UUID fields` |
| Generation | primary-key shape, icons, route names, auth columns, scope/restrict, menu/metrics, CORS, cron/static, features deps, permission sources | `V0 CRUD requires exactly one UUID primary key named id` |
| Write | path safety, env merge, manifest, `--sync` cleanup | `Output directory must be empty` |

Parse errors abort on the first problem; IR/generation errors are collected and joined. The CLI exits 1 and writes nothing on failure. Parse success does not imply generation success.

## Minimal valid model

```qiy
qiy v0;

application inventory @comment("Inventory operations console") {
  database sqlite @comment("Local inventory records") {}

  entity products @label("Products") @icon(ShoppingOutlined) {
    field id UUID @id;
    field sku Text @unique;
    field name Text;
  }
}
```

## application settings

| Block | Syntax / keys | Values | Default |
| --- | --- | --- | --- |
| `database` | `postgresql` / `mysql` / `sqlite` | dialect identifier | required |
| `mode` | `standalone` / `integration` | identifier | `standalone` |
| `integration` | `apiBase`, `auth`, `response`, `pagination`, `tenant` | see below | only with `mode integration` |
| `workspace` | `name`, `aliases { server web deploy }`, `packages { server web }` | identifiers / quoted names | application name |
| `ui` | `library`, `theme`, `themes`, `colorMode`, `allowThemeSwitch`, `allowColorModeSwitch` | see below | antd/blue/all five/system/true/true |
| `api` | `client`, `cors { origin ...; }` | `rest`/`graphql`; exact origins | `rest` |
| `features` | `overview`, `apiDocs`, `apiKeys` | booleans | `true`, `false`, `false` |
| `realtime` | `mode`, `resource { events; roles; when }` | see below | `auto` |
| `elysia` | `bearer`, `serverTiming`, `html`, `drizzle`, `jwt`, `static`, `graphqlAdapter`, `cron` | switches/blocks | off, `native` |
| `storage` | `provider` | `local`/`s3` | `local` |
| `auth` | `provider`/`providers`, `user`, `subjectField`, `roleField`, `usernameField`, `passwordField`, `profileField`, provider mappings | see below | required fields |
| `env` | `variable NAME { secret; development; production; example; }` | literals/`required`/`generate` | empty |
| `messages` | `default`, `locale` | BCP 47 + dictionaries | `zh-CN`, empty |
| `permission` | `field`, `group`, `from`, `verification` | see below | none |
| `workflow` | `orderInventory;` | single fixed value | none |
| `scope` | `scope <resource> <field> claim <claim> [tree <entity> <parentField>];` | fields/claims | none |
| `restrict` | `allow roles`, `when`, `mask` | see below | none |
| `pages` | actions + field rules | roles | none |

## database

```text
database <postgresql|mysql|sqlite> [@comment(...)] {
  extension <name> ;
}
```

| Item | Values | Default |
| --- | --- | --- |
| Dialect | `postgresql`, `mysql`, `sqlite` | required (`Unsupported database dialect X`) |
| `@comment` | literal or `t("key")` | none; becomes `schema.ts` file JSDoc |
| `extension` | identifier; `pgvector` and `postgis` are recognized | none |

`pgvector`/`postgis` require PostgreSQL (`pgvector and postgis require PostgreSQL`). A `Vector` field needs PostgreSQL + declared `extension pgvector` + `@extension(pgvector)`. One dialect per model; multiple databases mean multiple projects.

## mode and integration

```text
mode standalone | integration ;

integration {
  apiBase "<absolute-http-url-or-/path>" ;
  auth none | bearer | cookie | portal ;
  auth cookie { csrfCookie "<name>" ; csrfHeader "<header>" ; } ;
  response { data "<path>" ; total "<path>" ; error "<path>" ; } ;
  pagination page | offset | none ;
  tenant { header "<header>" ; identity "<identity-key>" ; } ;
}
```

| Key | Values | Default |
| --- | --- | --- |
| `apiBase` | absolute http(s) URL or a path starting with `/` | required |
| `auth` | `none`, `bearer`, `cookie`, `portal` | `none` |
| CSRF | only inside `auth cookie` | none |
| `response.*` | dotted JSON key paths (`items`, `meta.count`) | `data`, no total, `error` |
| `pagination` | `page`, `offset`, `none` | `page` |
| `tenant` | header + identity key, both required | none |

Rules: `mode integration` needs an `integration` block and vice versa; duplicate keys fail (`Duplicate integration setting X`); `$.items` is rejected (`dotted JSON path`). Integration mode **rejects** `api { cors }`, `auth`, `scope`, `restrict`, `workflow`, `dataflow`, `permission`, `storage`, `elysia`, `env` and `realtime`, and cannot be generated by `create`/`generate` - mount it with `qiy init`. Full contract: [workspace-integration.md](workspace-integration.md).

## workspace

```text
workspace {
  name <identifier> ;
  aliases { server <identifier>; web <identifier>; deploy <identifier>; }
  packages { server "<package-name>"; web "<package-name>"; }
}
```

| Key | Default |
| --- | --- |
| `name` | application name |
| `aliases.server` / `.web` / `.deploy` | `<name>-server`, `<name>-web`, `<name>` |
| `packages.server` / `.web` | derived from the workspace name |

Only `name`/`aliases`/`packages` and their sub-keys are allowed; duplicates and invalid identifiers fail. Aliases affect `qiy init` only; `create`/`generate` still use `apps/server`/`apps/web`. `-n` overrides the name once.

## ui

```text
ui {
  library antd;
  theme <blue|purple|green|orange|red>;
  themes <key> [, <key>]*;
  colorMode <light|dark|system>;
  allowThemeSwitch <true|false>;
  allowColorModeSwitch <true|false>;
}
```

| Key | Values | Default |
| --- | --- | --- |
| `library` | `antd` only | `antd` |
| `theme` | five keys | first of `themes`, else `blue` |
| `themes` | comma list, >= 1 | all five |
| `colorMode` | `light`, `dark`, `system` | `system` |
| switches | boolean | `true` |

`mui`/`mantine`/`chakra` fail (`only antd is implemented`). `theme` must be in `themes`; duplicate/empty keys fail. Behavior: [ui-charts-i18n.md](ui-charts-i18n.md).

## api

```text
api {
  client <rest|graphql> ;
  cors { origin "<exact-origin>" ; ... }
}
```

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `client` | `rest`, `graphql` | `rest` | Web DataProvider transport; server always exposes both REST and `/graphql` |
| `cors.origin` | exact `http(s)://host[:port]`, repeated | none | `QIY_CORS_ORIGINS` + server CORS middleware |

`client` must be written before `cors`. REST prefix is fixed at `/api/v1`, GraphQL at `/graphql`; there is no `basePath`. Origins must be quoted (`CORS origins must be quoted strings`), without wildcards/paths/userinfo (`CORS origin must be an exact http(s) origin without a path or wildcard`), at least one (`CORS configuration requires at least one origin`).

## features

```text
features {
  overview <true|false> ;
  apiDocs <true|false> ;
  apiKeys <true|false> ;
}
```

| Key | Default | Generates |
| --- | --- | --- |
| `overview` | `true` | `/system/overview` + menu entry, only when `apiDocs`/`apiKeys` is on |
| `apiDocs` | `false` | `/system/api-docs` + `/api/v1/openapi.json` + `/api/v1/docs/model` |
| `apiKeys` | `false` | `/system/api-keys` + `qiy_api_keys` + `/api/v1/auth/api-keys` + key auth |

`apiKeys` requires `auth` (parse) and the auth user entity (generation). Details, filtering and key lifecycle: [system-features.md](system-features.md).

## realtime

```text
realtime {
  mode <auto|manual> ;
  resource <tableName> {
    events <created|updated|deleted> [, ...] ;
    roles <admin|operator|viewer> [, ...] ;
    when <field> claim <claim> ;
  }
}
```

| Key | Values | Default |
| --- | --- | --- |
| `mode` | `auto`, `manual` | `auto` |
| `resource` | entity/table name, unique | required (>=1) |
| `events` | >=1 of the three, unique | required |
| `roles` | >=1 of the three, unique | required |
| `when` | field (Text/Integer, non-null) + claim | none |

Realtime requires generated `auth`, is rejected in integration mode, and cannot combine a `restrict` row predicate with `when ... claim` on the same resource. Full semantics: [storage-realtime.md](storage-realtime.md).

## elysia

```text
elysia {
  bearer;
  serverTiming;
  html;
  drizzle;
  jwt { name <identifier>; secretEnv <identifier>; }
  static { assets <string>; prefix <string>; }
  graphqlAdapter adapter <native|yoga|apollo>;
  cron { job <name> pattern "<5-or-6-field cron>" task cleanupMissingAttachments; }
}
```

| Item | Values | Default |
| --- | --- | --- |
| `bearer`/`serverTiming`/`html`/`drizzle` | switch | off |
| `jwt` | bare or `{ name, secretEnv }` | `jwt`, `QIY_JWT_SECRET` |
| `static` | bare or `{ assets, prefix }` | `public`, `/public` |
| `graphqlAdapter` | `native`, `yoga`, `apollo` | `native` |
| `cron` | jobs, only `cleanupMissingAttachments` | none; `QIY_CRON_ENABLED=0` by default |

Static `prefix` must start with `/`, `assets` must be `public` or a subdirectory, and the prefix must be outside `/api`, `/graphql`, `/assets`. Cron patterns need 5 or 6 fields and unique job names. CORS belongs in `api { cors }`, not here.

## storage

```text
storage { provider local | s3 ; }
```

| Key | Values | Default |
| --- | --- | --- |
| `provider` | `local`, `s3` | `local` |

Aliases and endpoints: [storage-realtime.md](storage-realtime.md).

## auth

```text
auth {
  provider <provider-id> ;
  providers <provider-id> [, <provider-id>]* ;
  provider <provider-id> { subjectField <user-field>; claim <plain-claim-name>; }
  user <entity> ;
  subjectField <user-field> ;
  roleField <user-field> ;
  usernameField <user-field> ;
  passwordField <user-field> ;
  profileField <user-field> ;
}
```

| Key | Values | Required |
| --- | --- | --- |
| `provider` | `local`, `otp`, `oidc`, `oauth2`, `sso`, `okta`, `auth0`, `azure-ad-b2c`, `keycloak`, `google`, `kinde` | one of `provider`/`providers` |
| `providers` | comma list (may include `local`, never `otp`) | one of the two |
| `user` | declared entity | yes |
| `subjectField` | required unique Text | OAuth family |
| `roleField` | enum with exactly admin/operator/viewer | yes |
| `usernameField` | required unique Text | `local`/`otp` |
| `passwordField` | nullable Text | `local` |
| `profileField` | nullable Text | optional, OAuth only |
| mapping `subjectField` | nullable unique Text | hybrid/multi |
| mapping `claim` | plain identifier | optional, default `sub` |

`provider` and `providers` are mutually exclusive; provider mappings must name configured providers. Sessions, onboarding, bind/unbind, env vars and security notes: [auth-permissions.md](auth-permissions.md).

## env

```text
env {
  variable <UPPER_NAME> {
    secret;
    development <"literal" | required | generate> ;
    production  <"literal" | required> ;
    example     <"literal" | required> ;
  }
}
```

| Item | Rule |
| --- | --- |
| Name | `^[A-Z_][A-Z0-9_]*$` |
| `secret;` | No literal values allowed |
| `generate` | Only for a secret `development` value |
| Output | Server gets non-`VITE_` variables; web gets `VITE_` only |
| `VITE_` | Bundled into client code; cannot be secret |
| Credential-like names | `SECRET`/`TOKEN`/`PASSWORD`/`API_KEY`/`ACCESS_KEY` must be marked `secret` |

`--sync`/`init` merge new variables into existing files and preserve current values.

## messages

```text
messages {
  default "<locale>";
  locale "<locale>" {
    "<key>" "<value>";
  }
}
```

| Item | Rule |
| --- | --- |
| `default` | First in the block, canonical BCP 47, matching `locale` block must exist |
| `locale` | Unique canonical tags |
| key | `^[a-zA-Z_][a-zA-Z_0-9.-]*$`, no prototype-polluting segments |
| value | Any string with `{{name}}` interpolation / plural suffixes |

`@comment(t("key"))`, `@label(t("key"))`, `@confirm(t("key"))`, `@error(t("key"))` require the key in the default locale. Full rules: [ui-charts-i18n.md](ui-charts-i18n.md).

## permission

```text
permission field <Name> "<value>" [@label(...)] [@comment(...)] ;
permission group <Name> [@label(...)] [@comment(...)] { A, B } [;]
permission group <Name> [@label(...)] [@comment(...)] = A & B ;
permission from database field <entity>.<field> ;
permission from claim <provider> "<claim>" ;
permission verification <Name> [@label(...)] [@comment(...)] {
  input { field <name> Text|Array<String>; }
  return <expression> ;
}
```

Requires generated `auth` and at least one `permission field`. `&` means **union**. Verification grammar, sources, endpoints and command `allow`: [auth-permissions.md](auth-permissions.md).

## workflow

```text
workflow orderInventory ;
```

Only `orderInventory`, PostgreSQL only, requires fixed `orders`/`orderItems`/`inventoryItems` contracts, and fails with `restrict` row policy. See [dataflows-actions.md](dataflows-actions.md).

## enum

```text
enum <Name> [@comment("..." | t("key"))] {
  value <valueName> [label "..."] [color <color>] [icon <IconName>] [@comment(...)] ;
}
```

Value `label`/`color`/`icon` take **no `@`**; only `@comment` does. Values must be non-empty; names unique; enums before entities. `color` is passed to Ant Design `Tag`; `icon` must match `^[A-Z][a-zA-Z0-9]*Outlined$`. Only `@comment` is allowed on enums/values (`Enum X: unsupported annotation @Y`).

## entity and field

```text
entity <Name> [table <tableName>] [@annotation(...)]... {
  field <name> <Type>[(<params>)] [@attribute[(<value>)]...] ;
  index <name> <method>(<field> [<opclass>], ...) [@unique] [@concurrently] [@comment(...)] ;
}
```

| Item | Rule | Default |
| --- | --- | --- |
| Entity name | identifier, not a JS reserved word | required |
| `table` | `^[a-z][a-z0-9_-]*$`, becomes route `/<table>` | entity name |
| Block content | only `field`/`index`; at least one field | required |
| Primary key | exactly one `field id UUID @id` | required |
| Entity annotations | `@label`, `@icon`, `@comment`, `@singular`, `@plural`, `@display`, `@tableDisplay`, `@relationDetail` | all optional |

Field types (closed set):

| Type | PostgreSQL | Notes |
| --- | --- | --- |
| `UUID` | `uuid` | PK/FK |
| `Text` | `text` | strings, enum storage |
| `Email` / `URL` | `text` | email/uri validation; email/url form inputs |
| `JSON` | `jsonb` | arbitrary JSON; GraphQL JSON scalar |
| `Text[]` / `Integer[]` | `jsonb` | scalar arrays; tags input; GraphQL `[String!]`/`[Int!]` |
| `Integer` | `integer` | 32-bit |
| `Boolean` | `boolean` | SQLite uses integer boolean mode; form renders a Switch |
| `Decimal(p[,s])` / `Money(p[,s])` | `numeric(p,s)` | precision required |
| `Date` / `Time` / `DateTime` | `date` / `time` / `timestamptz` | `YYYY-MM-DD` / `HH:mm:ss` / ISO |
| `File` / `Files` | `text` / `jsonb` | storage key(s) |
| `Vector(n)` | `vector(n)` | PostgreSQL + pgvector |
| `<enumName>` | `text` | declared enum |

Unknown types (`String`, `Json`, ...) fail. Parameters only on `Vector`/`Decimal`/`Money` (`Field type Text has no parameters`). Field attributes: `@id`, `@nullable`, `@unique`, `@label`, `@comment`, `@icon`, `@visible`, `@listVisible`, `@formVisible`, `@showVisible`, `@sortable`, `@filterable`, `@filter(...)`, `@upload(...)`, `@maxBytes`, `@maxFiles`, `@mime`, `@extension`, `@code`, `@generated(uuid)`, `@column`, `@dimension`, `@precision`, `@scale`. There is no `@required`, `@default`, `@length`, `@computed`. Full matrices: [modeling-and-generation.md](modeling-and-generation.md).

## relation and index

```text
relation <name> <fromEntity> <fromField> <toEntity> <toField> <one|many>
         [@onDelete(<restrict|cascade|setNull>)]
         [@comment("...")] ;

index <name> <btree|hnsw|ivfflat> ( <field> [<opclass>] [, ...] )
      [@unique] [@concurrently] [@comment("...")] ;
```

Relation rules: only `one` (writing `many` parses but fails IR validation); both endpoints must be `UUID`; target must be primary or `@unique`; source cannot be `@code`/`@generated`; `setNull` requires `@nullable`; single-column only; self relations allowed; relations come after all entities. Index rules: name globally unique; `hnsw`/`ivfflat` require PostgreSQL + pgvector, one `Vector` column, an opclass from `vector_l2_ops`/`vector_ip_ops`/`vector_cosine_ops`, dimension <= 2000; `@concurrently` is PostgreSQL only. Details: [modeling-and-generation.md](modeling-and-generation.md).

## scope, restrict, pages

```text
scope <resource> <field> claim <claim> [ tree <treeEntity> <parentField> ] ;
```

`field` must be `UUID`/`Text`; claim matches `^[a-zA-Z_][a-zA-Z0-9_.-]*$`; one per resource; `tree` types must match; local/hybrid sessions need a matching users column.

```text
restrict <resource> {
  allow roles <role> [, <role>]* ;
  when <field> claim <claim> ;
  when <field> ==|!= "<value>" [, "<value>"] ;
  when <field> in|notIn "<value>" [, "<value>"] ;
  when ( <condition> or <condition> ) ;
  when <boolean-expression> ;
  mask <field> [roles <r>, ...] [claim <present|absent> <claim>] mode <omit|null|redact> [replacement "<text>"] ;
}
```

Only `one` per resource; `when` leaves are claim comparisons, literals (`==`/`!=` single value), sets (`in`/`notIn`, max 64), cross-field comparisons (`<`, `<=`, `>`, `>=`, `==`, `!=`; UUID only equality), the `scope` atom, and `not`/`and`/`or`/parentheses. Mask targets cannot be primary keys or `Vector`. A resource with any `restrict` block cannot be used by a dataflow.

```text
pages <resource> {
  list|show|create|edit|delete roles <role> [, <role>]* ;
  field <fieldName> roles <role> [, <role>]* ;
}
```

At least one action or field rule; actions at most once; roles non-empty. `field ... roles` is UI-only; use `restrict mask` to hide data. Full policy semantics: [auth-permissions.md](auth-permissions.md).

## menu

```text
menu {
  group <name>
    [@label("...")] [@icon(IconName)] [@parent(<group>)] [@comment("...")] {
    resource <tableName>;
  }
}
```

At most one `menu` block; groups unique; `resource` is the entity table name and may appear once across all groups; `@parent` must exist and be acyclic. Ungrouped resources append at root. Details: [ui-charts-i18n.md](ui-charts-i18n.md).

## dashboard

```text
dashboard {
  metric <name> <resource>
    [@label("...")] [@icon(IconName)] [@span(8|12|24)]
    [@type(<count|distribution|trend|aggregate>)]
    [@groupBy(<field>)] [@days(<1..365>)]
    [@field(<field>)] [@agg(<sum|avg|min|max>)]
    [@comment("..." | t("key"))]
    ;
}
```

| Type | Requirement |
| --- | --- |
| `count` | none |
| `distribution` | enum `@groupBy` |
| `trend` | `DateTime` `@groupBy`, optional `@days` 1..365 |
| `aggregate` | numeric `@field` + `@agg` |

`@span` is 8/12/24; `@field`/`@agg` only on aggregate; `@days` only on trend. `chart` takes precedence on the home page.

## chart and chart panels

```text
chart [const|pie|bar|line|area|scatter|stacked|table] <ChartName> {
  icon  = "<IconName>" ;
  title = "<text>" ;
  data  = <data expression> ;
  labels = <enumField> ;
  labels [=] { <value> "<text>" ; ... } ;
}

chart panels <PanelName> {
  title = "<text>" ;
  grid <cols> <rows> ;
  <ChartName> { <variant> <x> <y> <w> <h> ; ... }
}
```

Data expressions: `count <entity>` (const), `sum|avg|min|max <entity>.<field>` (const), `count <entity> group by <enumField>` (pie/bar), `trend <entity>.<DateTimeField> days <1..365>` (line/area), `list <entity> columns <x>, <y>` (scatter), `list <entity> columns <a>, <b>` (table). Same-name declarations with different kinds are multiple views of one card (first is default). `grid cols` 1..24, `rows` 1..200; variants `larger`/`medium`/`small` (aliases `large`/`lg`/`xl`, `md`, `sm`/`xs`) with `x+w<=cols`, `y+h<=rows`. Full grammar, labels and limits: [ui-charts-i18n.md](ui-charts-i18n.md).

## dataflow

```text
dataflow <Name> ( "@label" "(" doc ")" | "@confirm" "(" doc ")" | "@comment" "(" doc ")" )* {
  allow roles ... | allow permission ... | allow verification ... ;
  idempotency required ;
  audit "<action>" ;
  input { field <name> <type> ( "@required" | "@comment" "(" doc ")" )* ; }
  context { <binding> = entity <Entity> by <pk> input.<field> @required ; }
  step <Name> ( "@order" "(" <int> ")" | "@comment" "(" doc ")" )* { <statement>* }
  result { return <binding> ; }
}
```

`input`, `context`, `result` blocks are required (empty `{}` allowed for the first two) and at least one `step` is required. Statements: `require ... @error(...)`, `update <binding> { field = value; }`, `create <binding> = entity <E> { ... }`, `delete <binding>`, `emit "event" { ... }`, `call <adapter> { ... }`. Full contracts, batch and tests: [dataflows-actions.md](dataflows-actions.md).

## action

```text
action <Name> {
  resource <entity> ;
  ( dataflow <Name> | navigate "<path>" ) ;
  placement ( list | show ) [, ...] ;
  [ label doc ; ]
  [ confirm doc ; ]
  [ when <field> ( == | != ) "<value>" ; ]
  [ allow roles ... | permission ... | verification ... ; ]
  [ batch true ; ]
  [ page manual @comment(doc) ; ]
}
```

`resource`, `placement` and exactly one of `dataflow`/`navigate` are required. `navigate` needs an absolute route containing `:id` plus `page manual @comment(...)`. `when` accepts one Text/enum field and a quoted value. Batch requires list-only placement, no `when`, an idempotent flow and a single required UUID input. Full details: [dataflows-actions.md](dataflows-actions.md).

## Annotation inventory

42 annotation names exist; the same name means different things by placement. Unknown annotations fail (`Unsupported ... attribute @X`); unimplemented annotations are never silently ignored.

| Placement | Annotations |
| --- | --- |
| Documentation | `@comment(...)` (application, database, enum, enum value, entity, field, index, relation, menu group, metric, permission field/group/verification, dataflow and its input/context/step, action page manual), `@label(...)` (entity, field, menu group, metric, permission field/group/verification, dataflow), `@icon(...)` (entity, field, menu group, metric), `@confirm(...)` (dataflow), `@error(...)` (require) |
| Entity | `@label`, `@icon`, `@comment`, `@singular`, `@plural`, `@display`, `@tableDisplay`, `@relationDetail` |
| Field | `@id`, `@nullable`, `@unique`, `@label`, `@comment`, `@icon`, `@visible`, `@listVisible`, `@formVisible`, `@showVisible`, `@sortable`, `@filterable`, `@filter(...)`, `@upload(...)`, `@maxBytes`, `@maxFiles`, `@mime`, `@extension`, `@code`, `@generated`, `@column`, `@dimension`, `@precision`, `@scale` |
| Index | `@unique`, `@concurrently`, `@comment` |
| Relation | `@onDelete(...)`, `@comment` |
| Menu group | `@label`, `@icon`, `@parent`, `@comment` |
| Dashboard metric | `@label`, `@icon`, `@span`, `@type`, `@groupBy`, `@days`, `@field`, `@agg`, `@comment` |
| Permission / dataflow / action | `@label`, `@comment`, `@confirm`, `@required`, `@order`, `@error` |

Parameter forms: `documentation` accepts a literal or `t("key")`; `string` accepts a quoted string or bare identifier; `integer` is a non-negative decimal; boolean is `@x` (= true) or `@x(true|false)` - not all booleans allow omitting parentheses; identifiers are enumeration values. Duplicates usually overwrite silently; explicitly rejected duplicates: `@singular`, `@plural`, `@display`, `@tableDisplay`, `@relationDetail`, `@code`, `@generated`, `@filter` (same operator), `@mime` (same type), `@comment` on definition-site blocks, `@order` (via step uniqueness).

Common miswrites: field `@required` (use `@nullable` for optional), `@optional`, `@default(...)`, `@searchable`/`@hidden`/`@readonly`, field/entity `@order(...)`, `@length`/`@min`/`@max`/`@format`, `@enum`/`@relation`/`@index`, enum `@label`, field `@plural`, `@transient`/`@computed`, `@primaryKey`.

## Generated values

| Annotation / shape | Applies to | Behavior |
| --- | --- | --- |
| `@code("template")` | Text, non-enum, non-PK | Server-rendered business code |
| `@generated(uuid)` / `@generated` | UUID, non-PK | Server UUIDv4 |
| Non-PK `UUID` with no relation | UUID | Treated as a system reference: random UUID, hidden in forms |
| `field id UUID @id` | UUID | Always server-generated |
| FK source with a relation | UUID | User-selected, never generated |

Template tokens: `{uuid}`, date/time parts (`{YYYY}` `{YY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` `{SSS}` and concatenations), `{seq}`/`{seq:N}`, `{count+1}`, `{random:N}`, `{random:N:charset}`, `{{`/`}}`. A template must be non-empty, <= 512 chars, contain at least one token and a uniqueness token. Sequences persist per `(entity, field, date-time bucket)` in `qiy_code_sequences`; conflict retries use `QIY_GENERATED_ATTEMPTS` (5) then 409 `generated.conflict`. Details: [modeling-and-generation.md](modeling-and-generation.md).

## Display templates

```text
plain text              escaped, output as-is
{$.fieldName}           interpolation (UUID, Text, enum, Integer, Decimal, Money, Date, Time, DateTime)
<b>{$.name}</b></br>    whitelisted tags: br b strong i em span small p div
```

No fallback is generated when `@display` is absent unless one of `name` -> `title` -> `displayName` -> `code` -> `number` -> `sku` -> `email` -> `label` -> `inventoryKey` exists (first match becomes `{$.field}`). `@tableDisplay` defaults to `@display`; `@relationDetail` defaults to `@display`. Rejected: empty template, malformed placeholder, unknown field, `File`/`Files`/`Vector`, FK source fields, non-whitelisted/uppercase tags, self-closing tags other than `br`, unpaired tags, attributes.

## i18n keys

Keys derive from identifiers (never label text). `<resource>` is the **table** name.

| Key | Covers |
| --- | --- |
| `qiy.resources.<table>.label` / `.singular` / `.plural` | Resource name/titles |
| `qiy.resources.<table>.fields.<field>.label` | Column/detail/form/filter labels |
| `qiy.enums.<enum>.label` / `.values.<value>` | Enum descriptions and Tags |
| `qiy.menu.<group>.label` | Sidebar group |
| `qiy.dashboard.<metric>.label` | Legacy metric card |
| `qiy.charts.<chart>.label`, `.views.<kind>.label`, `.labels.<value>`, `qiy.charts.<panel>.label` | Charts |
| `qiy.actions.<action>.label` / `.confirm` / `.inputs.<input>.label` | Command buttons/forms |
| `qiy.dataflows.<dataflow>.label` | Overview dataflow name |

`<resource>` uses the entity's **table** name, so `entity Product table products` produces `qiy.resources.products.*`. See [ui-charts-i18n.md](ui-charts-i18n.md) for chrome keys, fallback order and locale rules.

## Pitfalls

| Error (stage) | Cause | Fix |
| --- | --- | --- |
| `Unexpected Qiy syntax at offset N` (lexer) | Unquoted non-ASCII, `:`, `[`, `/`, `*`, `$` | Quote the value; use only supported symbols |
| `Expected database near token N` | `database` not first in `application` | Move it first |
| `Expected <block> near token N` | Block order wrong | Reorder per [Declaration order](#declaration-order) |
| `Expected <end> near token N` | Content after `}` or missing `application` `}` | Check braces |
| `Expected ; near token N` | Missing semicolon, or a `;` after a block `}` | Add/remove the semicolon |
| `Unsupported field type X` | Not a closed-set type | Use `Text`/`Integer`/enum/... |
| `Unsupported field attribute @X` | Wrong placement or typo | Check the annotation inventory |
| `duplicate ... annotation` | Same annotation twice | Keep one |
| `Missing default locale message for <purpose>: key` | `messages` after the referencing declaration, or missing key | Move `messages` earlier; add the key |
| `Unsupported database dialect X` | Typo | `postgresql`/`mysql`/`sqlite` |
| `Invalid Ant Design icon X` | Not `*Outlined` | Use an Ant Design icon name |
| `V0 CRUD requires exactly one UUID primary key named id` | Missing/renamed PK | `field id UUID @id` |
| `route path must be lowercase and URL-safe` | Bad `table` name | `^[a-z][a-z0-9_-]*$` |
| `required field cannot be hidden from the create form` | Required field hidden | Add `@nullable` or show it |
| `Auth: ...` (generation) | User table columns violate the contract | See [auth-permissions.md](auth-permissions.md) |
| `Scope ...` / `Restrict ...` (generation) | Missing resource/field | See [auth-permissions.md](auth-permissions.md) |
| `Output directory must be empty` | Target non-empty without `--sync` | Clear it or use `--sync` |

## Related references

- [Modeling and generation](modeling-and-generation.md) - includes, fields, relations, indexes, generated codes, limits
- [Auth and permissions](auth-permissions.md) - auth modes, permission/verification/restrict/scope/pages
- [Dataflows and actions](dataflows-actions.md) - commands, actions, workflows, scenario tests
- [UI, charts and i18n](ui-charts-i18n.md) - ui, menu, dashboard, charts, messages
- [System features](system-features.md) - features, OpenAPI, API keys
- [Storage and realtime](storage-realtime.md) - storage and realtime
- [CLI workflows](cli-workflows.md) - commands, flags, layout, upgrade
- [Workspace integration](workspace-integration.md) - init, aliases, integration mode
- [Testing and deployment](testing-deployment.md) - scripts, migrations, acceptance
- [Troubleshooting](troubleshooting.md) - cross-area error table

## Canonical docs

- [DSL overview](https://ai-nodev.github.io/qiy/dsl/overview)
- [application](https://ai-nodev.github.io/qiy/dsl/application)
- [entity and field](https://ai-nodev.github.io/qiy/dsl/entity)
- [relations and indexes](https://ai-nodev.github.io/qiy/dsl/relation-index)
- [annotations](https://ai-nodev.github.io/qiy/dsl/annotations)
- [generated values](https://ai-nodev.github.io/qiy/dsl/generated-values)
- [modules/include](https://ai-nodev.github.io/qiy/dsl/modules)

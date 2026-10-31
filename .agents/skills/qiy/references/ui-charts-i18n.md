# UI, charts, menus and i18n

Use this file when you change look-and-feel, navigation, the overview page, charts, or any user-visible text. It covers `ui`, `menu`, legacy `dashboard`, `chart`/`chart panels`, `messages`/i18n keys, and the persistence keys the generated admin uses.

Canonical reference: https://ai-nodev.github.io/qiy/dsl/charts (`/guide/ui-theming`, `/guide/menu-dashboard`, `/dsl/i18n`)

## Contents

- [ui block](#ui-block)
- [Themes, color mode and persistence](#themes-color-mode-and-persistence)
- [Menu](#menu)
- [Legacy dashboard metrics](#legacy-dashboard-metrics)
- [chart grammar](#chart-grammar)
- [chart data mini-language](#chart-data-mini-language)
- [labels](#labels)
- [chart panels](#chart-panels)
- [Chart behavior, theme and limits](#chart-behavior-theme-and-limits)
- [messages and i18n](#messages-and-i18n)
- [Derived keys and fallback chain](#derived-keys-and-fallback-chain)
- [Generated system pages](#generated-system-pages)
- [Pitfalls](#pitfalls)

## ui block

`ui` sits after `workspace` and before `api` inside `application`.

```text
ui {
  library antd;
  theme <blue|purple|green|orange|red>;
  themes <key>, <key>, ...;
  colorMode <light|dark|system>;
  allowThemeSwitch <true|false>;
  allowColorModeSwitch <true|false>;
}
```

```qiy
ui {
  library antd;
  theme purple;
  themes purple, blue, green, orange;
  colorMode system;
  allowThemeSwitch true;
  allowColorModeSwitch true;
}
```

| Setting | Values | Default | Effect |
| --- | --- | --- | --- |
| `library` | `antd` only | `antd` | `mui`/`mantine`/`chakra` fail with `Unsupported UI library X; only antd is implemented` |
| `theme` | five keys | first of `themes`, else `blue` | Initial brand color; must be included in `themes` |
| `themes` | comma list, >= 1 | all five | Header theme candidates; only one key hides the selector |
| `colorMode` | `light`, `dark`, `system` | `system` | Initial mode; `system` follows `prefers-color-scheme` |
| `allowThemeSwitch` | boolean | `true` | Render the theme control |
| `allowColorModeSwitch` | boolean | `true` | Render the light/dark/system control |

Rules: each setting at most once (`Duplicate UI setting X`), unknown keys rejected, trailing comma in `themes` is invalid, `theme` not in `themes` fails with `UI default theme X must be included in themes`.

Theme registry (`colorPrimary` only; `borderRadius: 6` is fixed):

| key | Color | Copy override key |
| --- | --- | --- |
| `blue` | `#1677ff` | `qiy.themeBlue` |
| `purple` | `#722ed1` | `qiy.themePurple` |
| `green` | `#389e0d` | `qiy.themeGreen` |
| `orange` | `#d46b08` | `qiy.themeOrange` |
| `red` | `#cf1322` | `qiy.themeRed` |

There is no free-form `primaryColor` and no sixth theme key. For a custom brand color, pick the closest key or override `colorPrimary` in a host wrapper.

## Themes, color mode and persistence

Resolution: `resolvedColorMode = colorMode === "system" ? (prefersDark ? "dark" : "light") : colorMode`. It selects the Ant Design `darkAlgorithm` or `defaultAlgorithm` and sets `<html data-theme>`, `<html data-color-mode>` and inline `color-scheme`. `system` listens for `prefers-color-scheme` changes.

localStorage keys (all reads are wrapped in try/catch and degrade silently in private mode/quota errors):

| Storage | Key | Value |
| --- | --- | --- |
| localStorage | `qiy.ui.theme` | theme key (only if valid and in `themes`) |
| localStorage | `qiy.ui.color-mode` | `light`/`dark`/`system` |
| localStorage | `qiy.ui.sider-collapsed` | `collapsed`/`expanded` |
| localStorage | `qiy.locale` | BCP 47 tag |
| localStorage | `qiy.charts.panel` | selected panel name |
| localStorage | `qiy.columns.<resource>` | `{ fields, selected }` JSON |
| localStorage | `qiy.access_token` | session JWT |
| localStorage | `qiy.id_token`, `qiy.expires_at` | OIDC id token/expiry |
| sessionStorage | `qiy.oidc.verifier`, `qiy.oidc.state`, `qiy.oidc.return_to`, `qiy.oidc.silent_attempt` | PKCE intermediate state |

Theme and color mode are written on every mount, so changing the model default does not affect users who already have a stored value. Clearing browser storage resets theme, color mode, language, sider, panel and column preferences.

Do not hand-edit `app/ui/theme-config.ts`, `app/ui/index.tsx` or `app/styles.css` for a long-lived change: they are manifest-owned and `--sync` rewrites them. Use the `ui` block, host-level wrapping, or unowned extension components. Do not override `.ant-btn-primary` colors with CSS; the dark algorithm and `data-theme` derive many shades.

## Menu

```text
menu {
  group <name>
    [@label("...")] [@icon(IconName)] [@parent(<group>)] [@comment("..." | t("key"))] {
    resource <tableName>;
    ...
  }
}
```

```qiy
menu {
  group masterData @label("Master data") @icon(AppstoreOutlined) {
    resource suppliers;
    resource customers;
    resource products;
  }
  group sales @label("Sales") @icon(ShoppingOutlined) @parent(masterData) @comment("Sales entry points") {
    resource orders;
    resource order_lines;
  }
}
```

| Item | Values | Default | Effect |
| --- | --- | --- | --- |
| group name | unique identifier | required | Group key (`menu-<name>`) and `qiy.menu.<name>.label` |
| `@label` | string | group name | Sidebar title |
| `@icon` | `*Outlined` | `AppstoreOutlined` | Group icon (visible when collapsed) |
| `@parent(<group>)` | declared group | none | Nested submenu; unknown parent or cycle rejected |
| `@comment` | doc | none | Metadata |
| `resource <tableName>` | entity table name, repeatable | required (>=1) | Order within the group |

Rules: at most one `menu` in the application; only `group` inside; a resource appears in at most one group; unknown resources fail (`Menu group X: unknown resource Y`). Without a `menu`, every resource becomes a flat root menu. Resources not listed in any group are appended at root. A group whose children are all filtered out by permissions is not rendered. System pages (`features`) are linked under a default `System` group with the overview entry `qiy-overview` first.

Sidebar behavior: expanded width 248px, collapsed shows icons with tooltips, collapsed state persisted, the active route's group opens by default, and mobile uses a drawer.

## Legacy dashboard metrics

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

```qiy
dashboard {
  metric orderCount orders @label("Orders") @span(8) @comment(t("dashboard.orders"));
  metric orderStatus orders @label("Status") @span(8) @type(distribution) @groupBy(status);
  metric orderTrend orders @label("Last 30 days") @span(24) @type(trend) @groupBy(createdAt) @days(30);
  metric orderAmount orders @label("Amount") @span(8) @type(aggregate) @field(amount) @agg(sum);
}
```

| Type | Generated content | Validation |
| --- | --- | --- |
| `count` | Total count card, links to the list | - |
| `distribution` | Enum distribution bars using value labels/comments | `distribution requires an enum groupBy field` |
| `trend` | Daily trend for `@days` (1..365) | `trend requires a DateTime groupBy field`; `days must be between 1 and 365` |
| `aggregate` | Numeric statistic | `aggregate requires a numeric field`; `aggregate requires agg sum, avg, min or max` |

`@span` is only 8/12/24; `@field`/`@agg` are only valid on `aggregate`; `@days` only on `trend`; `@groupBy` is ignored on other types. Cards are wrapped in `CanAccess`, so resources the user cannot list are hidden. Prefer `chart` for new models.

Home page fallback:

| Model | Overview page |
| --- | --- |
| `dashboard` block | Declared metric cards |
| No `dashboard` and no `chart` | One `count` metric per entity (`span 8`, entity label/icon) |
| No `dashboard`, has `chart` | No metrics; chart panels render |
| Both | Charts render; dashboard metrics do not |

## chart grammar

`chart` and `chart panels` are written after `menu` and before `dataflow`, sharing a slot with legacy `dashboard`.

```text
chart [const|pie|bar|line|area|scatter|table] <ChartName> {
  icon  = "<IconName>" ;
  title = "<text>" ;
  data  = <data expression> ;
  labels = <enumField> ;
  labels [=] { <value> "<text>" ; ... } ;
}

chart panels <PanelName> {
  title = "<text>" ;
  grid <cols> <rows> ;
  <ChartName> {
    <variant> <x> <y> <w> <h> ;
    ...
  }
  ...
}
```

Chart view properties are `key = value;`; a trailing `;` may be omitted only before `}`. `labels` is the exception: `labels { ... }`, `labels = { ... }` and `labels = role;` are all accepted. Always quote `icon`/`title` strings.

| Property | Required | Values | Default | Notes |
| --- | --- | --- | --- | --- |
| kind | no | `const`, `pie`, `bar`, `line`, `area`, `scatter`, `table` | `const` | Omitting kind produces a statistic card |
| `icon` | no | Ant Design `*Outlined` | none | Card icon; see chart limits |
| `title` | no | string | chart name | Chart-level title |
| `data` | **yes** | data mini-language | - | Exactly once per declaration |
| `labels` | no | enum field or mapping block | none | Only meaningful for `pie`/`bar`; silently ignored elsewhere |

Multi-view semantics: declaring the same chart name with different kinds creates multiple views of one card, in declaration order; the first declaration is the default view. The same kind twice fails (`Chart <name>: duplicate <kind> view`), and two kind-less declarations both become `const` and collide. Chart-level `title`/`icon` come from the first view that declares them (not from the first view's whole attribute set). View title fallback: view `title` -> chart `title` -> chart name. The card header (icon/title) is chart-level and does not change when switching views; the view title appears inside the card.

## chart data mini-language

| `data` expression | Allowed kind | Generated request | Result |
| --- | --- | --- | --- |
| `count <entity>` | `const` | list `page=1&pageSize=1`, use `total` | Single count |
| `sum\|avg\|min\|max <entity>.<field>` | `const` | `GET /api/v1/<entity>/aggregate?field=&op=` | Numeric aggregate |
| `count <entity> group by <enumField>` | `pie`/`bar` | `GET /api/v1/<entity>/distribution?field=` | Enum distribution |
| `trend <entity>.<dateTimeField> days <1..365>` | `line` | `GET /api/v1/<entity>/trend?field=&days=` | Daily count trend |
| `list <entity> columns <a>, <b>, ...` | `table` | list `page=1&pageSize=5` | Read-only first 5 rows |

| Kind | Accepts | Rejects with |
| --- | --- | --- |
| `const` | ungrouped `count`; `sum`/`avg`/`min`/`max` | `count data cannot group by (use pie or bar)`, `const views require count or sum/avg/min/max data` |
| `pie`/`bar` | `count <entity> group by <enum field>` | `pie/bar views require "count <entity> group by <enum field>" data` |
| `line` | `trend` | `line views require "trend <entity>.<DateTime field> days <n>" data` |
| `table` | `list` | `table views require "list <entity> columns ..." data` |

Validation:

- `<entity>` may be an entity name or table name; it normalizes to the table name in metadata/requests (`unknown entity`).
- `<field>` is the entity field name, not a column name and without table prefix (`unknown field`).
- `group by` must be an enum field (`group by field X must be an enum field`).
- Aggregate fields must be `Integer`, `Decimal` or `Money` (`aggregate field X must be Integer, Decimal or Money`).
- `trend` fields must be `DateTime`; `days` is 1..365 (`trend field X must be a DateTime field`, `days must be between 1 and 365`).
- `list` needs at least one column; `Vector` columns cannot be rendered (`cannot render a Vector column (X)`).
- `sum ... group by ...` is parsed but unsupported by every kind. Use `count ... group by`, a `table` view or an extension page.
- Chart data goes through the same resource endpoints, so `scope`, `restrict`, `pages`, `mask` and role guards still apply. Charts never bypass data permissions.

## labels

`labels` affects only the numeric labels/legend of `pie`/`bar`, not counts.

1. Without `labels`, pie/bar metadata auto-expands every enum value (label = enum value label, key `qiy.charts.<chart>.labels.<value>`).
2. `labels = <enumField>` uses another enum field's value labels; it must be an enum field.
3. `labels { ... }` lists explicit values only; unlisted values render the raw string.
4. Runtime order: dictionary `qiy.charts.<chart>.labels.<value>` -> generated metadata label (explicit mapping or enum value label) -> raw value. The dictionary always wins.
5. Keys are per chart name, not per view: `pie` and `bar` share the same label keys.
6. `labels` on `const`/`line`/`table` is silently ignored.
7. Empty mapping fails (`labels mapping needs at least one entry`); duplicate values fail; each entry needs a quoted string and `;`.

## chart panels

| Element | Required | Values | Notes |
| --- | --- | --- | --- |
| `title` | no | string | Panel title; key `qiy.charts.<panel>.label`; duplicates silently overwrite |
| `grid cols` | yes | 1..24 | CSS grid columns |
| `grid rows` | yes | 1..200 | Grid row bound |
| chart reference | yes (>=1) | declared chart name | Each reference needs >= 1 placement; no duplicate chart in one panel |
| `<variant>` | yes (>=1) | see below | One placement per variant name |
| `x`,`y` | yes | integer >= 0 | 0-based origin |
| `w`,`h` | yes | integer >= 1 | Column/row span |

Responsive variants:

| Variants | Category | Viewport |
| --- | --- | --- |
| `larger`, `large`, `lg`, `xl` | larger | >= 1200px |
| `medium`, `md` | medium | >= 768px |
| `small`, `sm`, `xs` | small | < 768px |

Unknown variants fail and list the full set. Same-name variants fail (`duplicate <variant> placement`); different aliases of the same category are accepted but only the **first declared** is used (later aliases are dead code). Prefer `larger`/`medium`/`small`.

Bounds: `x + w <= cols`, `y + h <= rows`, `x,y >= 0`, `w,h >= 1` (`placement larger exceeds 24 grid columns`, `grid rows must be between 1 and 200`). There is **no overlap detection**: two charts may occupy the same cells and will stack visually. `grid` is required exactly once. A panel needs at least one chart; a chart reference needs at least one placement; unknown/duplicate chart names fail. Chart and panel names share a namespace (`panels` is reserved).

Panel selection: multiple panels render a selector in declaration order; the choice persists in `qiy.charts.panel`. A single panel hides the selector but still renders its title. A stored panel missing from the model falls back to `panels[0]`; unavailable localStorage falls back silently. The stored value is read on first mount, so SSR always renders `panels[0]` and hydration may visibly switch. Charts not referenced by any panel do not render. Without `chart panels`, all charts tile with `Row`/`Col` (`xs=24`, `lg=12`).

## Chart behavior, theme and limits

Rendering: `const` uses Ant Design `Statistic` (count is localized; aggregates append `agg · field`; Money/Decimal use 2 decimals). `pie` is inline SVG with a legend; `bar` uses `Progress` rows; `line` is inline SVG with first/last dates and max; `table` is a read-only Ant Design `Table` (max 5 rows) linking to the resource list. No charting library is used, so SSR works.

Data views are wrapped in `CanAccess resource=<entity> action="list"`; in panels mode the whole grid cell is wrapped too.

Theme: cards, tables, text and controls follow Ant Design tokens, but **chart graphics do not**: the pie palette (`#1677ff`, `#52c41a`, `#faad14`, `#eb2f96`, `#722ed1`, `#13c2c2`, `#fa541c`, `#8c8c8c`) and the line color are hardcoded light values. They stay visible in dark mode but do not adapt.

Chart icons: use an Ant Design `*Outlined` name. Chart-level and per-view icons are collected into `qiyIcons` together with entity/field/enum/menu/metric icons. Generation validates only the `*Outlined` name shape (`Invalid Ant Design icon`); a name Ant Design does not export passes generation and then fails the generated project's typecheck/build. Theme colors are not applied to chart graphics.

Known chart limits to state explicitly: `labels` silently ignored on non-pie/bar; alias variants beyond the first are dead code; overlapping placements are not detected; `table` view titles are not displayed; charts do not theme their graphics; only the five view kinds exist.

Generated files: `apps/web/app/charts.ts`, `apps/web/app/components/charts.tsx`, `apps/web/app/routes/home.tsx`, `apps/web/app/dashboard.ts`, `apps/web/tests/charts.test.ts`, `apps/web/tests/charts-render.test.tsx`.

## messages and i18n

`messages` sits after `env` and before `permission`/`workflow`/`enum`/`entity`.

```text
messages {
  default "<locale>";
  locale "<locale>" {
    "<key>" "<value>";
    ...
  }
  ...
}
```

```qiy
messages {
  default "zh-CN";
  locale "zh-CN" {
    "qiy.resources.reviews.label" "审核单";
    "review.note" "请说明审核决定";
  }
  locale "en-US" {
    "qiy.resources.reviews.label" "Reviews";
    "review.note" "Explain the decision";
  }
}
```

| Item | Rule |
| --- | --- |
| `default` | Required, first in the block, canonical BCP 47 tag; a matching `locale` block must exist (`Missing default message locale X`) |
| `locale` | At least the default; unique tags (`Duplicate message locale`); canonical form only (`Invalid message locale X: use a canonical BCP 47 language tag`) |
| key | `^[a-zA-Z_][a-zA-Z_0-9.-]*$`; no spaces/`:`/`/`; no `__proto__`/`prototype`/`constructor` segment (`Invalid message key`) |
| value | Any string; supports i18next `{{name}}` interpolation and CLDR plural suffixes |
| duplicates | Duplicate key within a locale fails (`Duplicate message key <locale>.<key>`) |

Canonical tags include `zh-CN`, `en-US`, `ja-JP`, `fr-FR`, `ar-EG`, `zh-Hans`, `es-419`; `fr_fr`, `FR-fr`, `en-us` are rejected. Keys use `.` as a literal character (`keySeparator: false`), not a nesting separator.

Without `messages`, the default is `zh-CN`, project messages are empty, and the UI still works using built-in chrome plus DSL text fallback. `include "modules/messages.qiy" @messages;` imports only one top-level `messages` block.

`t("key")` is only valid in documentation positions: `@comment`, `@label`, `@confirm`, `@error`. The key **must exist in the default locale** (`Missing default locale message for <purpose>: <key>`), because it is resolved at parse time for generated source/docs while the key is retained for runtime translation.

## Derived keys and fallback chain

Keys are derived from identifiers, never from label text. Renaming an identifier invalidates translations; editing label text does not.

| Key | Covers | Fallback |
| --- | --- | --- |
| `qiy.resources.<resource>.label` | Resource base name, related-record cards | entity `@label` -> entity name |
| `qiy.resources.<resource>.singular` | Create/edit/detail/drawer singular titles | `@singular` -> `.label` dictionary -> `@label` -> entity name |
| `qiy.resources.<resource>.plural` | Menu nodes, list titles, `viewResource` | `@plural` -> `.label` dictionary -> `@label` -> entity name |
| `qiy.resources.<resource>.fields.<field>.label` | Column headers, detail labels, form labels, filter placeholders | field `@label` -> field name |
| `qiy.enums.<enum>.label` | Enum description | enum name |
| `qiy.enums.<enum>.values.<value>` | Enum Tag, select options, distribution legend | enum value label -> value name |
| `qiy.menu.<group>.label` | Sidebar group | group `@label` -> group name |
| `qiy.dashboard.<metric>.label` | Legacy metric card title | `@label` -> metric name |
| `qiy.charts.<chart>.label` | Chart card title | chart `title` -> chart name |
| `qiy.charts.<chart>.views.<kind>.label` | View-internal title | view `title` -> chart `title` -> chart name |
| `qiy.charts.<chart>.labels.<value>` | Distribution labels (shared by views) | explicit mapping/enum label -> raw value |
| `qiy.charts.<panel>.label` | Panel title/selector | panel `title` -> panel name |
| `qiy.actions.<action>.label` / `.confirm` / `.inputs.<input>.label` | Command button, confirmation, form field | action text -> dataflow `@label`/`@confirm` -> input name |
| `qiy.dataflows.<dataflow>.label` | Dataflow name on the overview page | `@label` -> flow name |

`<resource>` is the **table** name (`entity Product table products` -> `qiy.resources.products.*`), which is also what menus, charts, commands and endpoints use. Permission `@label` does **not** derive a key: it is literal unless written as `@label(t("key"))`.

Translate fallback chain at runtime (later wins): Refine/AntD messages for the locale -> built-in chrome (`qiy.*`, zh-CN for `zh-CN`, English for everything else) -> default-locale project messages -> current-locale project messages -> the caller's fallback (the DSL literal). Any missing layer falls back instead of failing.

Consequence: adding a third language such as `ja-JP` and translating only business keys leaves English chrome. Override the `qiy.*` keys you care about in that locale.

Built-in chrome groups you can override: list/form (`qiy.new`, `qiy.edit`, `qiy.delete`, `qiy.batchDelete`, `qiy.search`, `qiy.filters`, `qiy.visibleColumns`, `qiy.noData`, `qiy.autoGenerated`, ...), import/export and saved views, pagination, filters operators (`qiy.filters.mode.*`), theme/color mode, login/OAuth/OTP/profile, 403/audit/tree, chart view (`qiy.chartView`, `qiy.chartViewKind.*`), system pages (`qiy.docs.*`, `qiy.apiDocs.*`, `qiy.apiKey.*`). `qiy.requiredWithLabel` is an exception: it uses Ant Design's `${label}` placeholder, not `{{label}}`.

Interpolation uses `{{name}}` with `escapeValue: false` - inserted values are plain text, never HTML. Plurals use CLDR suffixes (`_one`, `_other`, `_few`, `_many`) with `count`. Locale selection persists in `qiy.locale`; supported locales always include `zh-CN` and `en-US` plus every declared locale. Switching updates the Refine i18n provider, Ant Design locale, and `<html lang/dir>`; `ar`/`fa`/`he`/`ur` prefixes set RTL.

Ant Design component locales are imported only for exact tags: `ja-JP`, `ko-KR`, `fr-FR`, `de-DE`, `es-ES`, `pt-BR`, `ru-RU`, `ar-EG`, `hi-IN`, `it-IT`, `zh-TW`. Use these full tags for localized pagination/date pickers.

Adding a language: add the `locale` block, use a canonical tag, cover the `qiy.*` chrome keys you need, point `default` at the new block if it becomes default (and move every `t("key")` into it), choose an exact AntD tag for component localization, regenerate, then run the generated `apps/web` tests.

## Generated system pages

When `features` enables them, three authenticated pages appear under a `System` menu group: `/system/overview` (entities, relations, dataflows, permission model, OpenAPI browser), `/system/api-docs`, and `/system/api-keys`. Their copy lives in `qiy.docs.*`, `qiy.apiDocs.*`, `qiy.apiKey.*` and can be overridden. Page entries are visible to any signed-in user; content is filtered by the current principal's permissions. Details and gating: [system-features.md](system-features.md).

## Pitfalls

| Error / symptom | Cause | Fix |
| --- | --- | --- |
| `Unsupported UI library mui; only antd is implemented` | Non-AntD library | Use `antd` |
| `Unsupported UI theme teal` | Theme key outside the five | Use a built-in key |
| `UI default theme purple must be included in themes` | `theme` not in `themes` | Add it |
| Theme selector missing | `allowThemeSwitch false` or one theme | Enable it / add candidates |
| Theme resets after changing defaults | localStorage holds the old choice | Clear `qiy.ui.theme` / `qiy.ui.color-mode` |
| `Menu group X: unknown resource Y` | Entity not declared, or entity name used instead of table name | Use the `table` name |
| Menu group missing | All its resources are permission-filtered | Check `restrict`/`pages` |
| `distribution requires an enum groupBy field` | `@groupBy` not enum | Use an enum field |
| `trend requires a DateTime groupBy field` | Used `Date` | Use `DateTime` |
| `Chart X pie view: pie/bar views require "count <entity> group by <enum field>" data` | Wrong data expression | Use `count ... group by` |
| `Chart panel P: placement larger exceeds 24 grid columns` | `x + w > cols` | Shrink `x`/`w` or enlarge grid |
| Chart cards overlap | No overlap detection | Make `x` ranges disjoint |
| `Invalid message locale fr_fr` | Non-canonical tag | `fr-FR` |
| `Missing default message locale ja-JP` | `default` without a matching block | Add the block |
| `Missing default locale message for field comment: key` | `t("key")` absent from the default locale, or `messages` declared too late | Add the key; keep `messages` before enums/entities |
| Untranslated English buttons in a third language | Built-in chrome is English for non-`zh-CN` | Override the `qiy.*` keys |
| `Invalid message key x:y` | `:` in key | Use `.` and the allowed character set |

## Related references

- [Language reference](language-reference.md) - `ui`, `menu`, `dashboard`, `chart`, `messages` placement
- [Modeling and generation](modeling-and-generation.md) - enums and fields backing charts
- [System features](system-features.md) - `/system/*` pages and gating
- [Auth and permissions](auth-permissions.md) - menu/page filtering by role
- [Troubleshooting](troubleshooting.md) - error table

## Canonical docs

- [chart](https://ai-nodev.github.io/qiy/dsl/charts)
- [enum / menu / dashboard](https://ai-nodev.github.io/qiy/dsl/enum-menu-dashboard)
- [i18n / messages](https://ai-nodev.github.io/qiy/dsl/i18n)
- [UI and theming guide](https://ai-nodev.github.io/qiy/guide/ui-theming)
- [menu and dashboard guide](https://ai-nodev.github.io/qiy/guide/menu-dashboard)

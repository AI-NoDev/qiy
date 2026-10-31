# Changelog

All notable changes to Qiy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

Release notes on GitHub are generated from the matching section of this file.
Releases before `0.2.0` are listed on the
[GitHub releases page](https://github.com/AI-NoDev/qiy/releases).

## [0.16.0] - 2026-10-31

### Added

- Generated-app Playwright E2E: a real generated SQLite admin/API workspace is
  generated and installed in CI, then the browser creates a product and sees it
  in the list. Adds `playwright.generated.config.ts`, `e2e/generated.spec.ts`,
  the `e2e:generated` script and a `generated-e2e` CI job.

## [0.15.0] - 2026-10-31

### Added

- `stacked` chart kind: client-side group/series/value aggregation from
  `list <entity> columns <group>, <series>, <numericValue>`, segmented bars,
  series colors, optional `color` override and `legend = false`.

## [0.14.0] - 2026-10-31

### Added

- Chart view `color = "#rrggbb"` and `legend = true|false` options. Colors apply
  to bars, line/area strokes and scatter points; `legend = false` hides the
  pie/bar legend. Parser, serializer, generated metadata, docs and skill updated.

## [0.13.0] - 2026-10-31

### Added

- Grouped aggregate bar/pie charts: `sum|avg|min|max <entity>.<numericField>
  group by <enumField>` uses `/distribution?field=<group>&metric=<field>&op=<op>`
  and the optional repository `grouped()` method. `count ... group by` is
  unchanged.

## [0.12.0] - 2026-10-31

### Added

- `scatter` chart views from numeric `list ... columns x, y` data; clicking a
  point opens the record. Chart metadata/type generation includes `scatter`.
- Per-page Open Graph/Twitter images (`/og/<page>.png`) generated with sharp
  at docs-build time; `og:image` and `twitter:image` point at the page image.
- Playwright docs E2E + axe accessibility checks, CI browser install, and a
  documentation JS/CSS bundle budget (4MB default).
- Fixed light-theme link contrast (`#059669` → `#047857`).

## [0.11.0] - 2026-10-31

### Added

- Dedicated scalar array fields: `Text[]`, `Email[]`, `URL[]`, `Integer[]`.
  Stored as JSON (`jsonb`/text JSON/MySQL json), validated with REST
  `t.Array(...)`, typed as GraphQL `[String!]` / `[Int!]`, rendered as Ant
  Design tag inputs, and joined for list/detail display.

## [0.10.0] - 2026-10-30

### Added

- `area` chart view kind, reusing the existing `trend` data contract and
  rendering a filled SVG area. Same-name chart declarations can now mix
  line/area/bar/pie/table views.
- Task-oriented docs index at `/guide/tasks`, and segmented machine-readable
  docs: `/llms-dsl.txt` and `/llms-guides.txt` (plus the existing `llms.txt`
  and `llms-full.txt`).
- `coverage:check` CI gate (>=85% functions, >=90% lines), CycloneDX-style
  `qiy-sbom.json` generation/upload, and a CodeQL workflow.

## [0.9.0] - 2026-10-30

### Added

- `JSON` field type: PostgreSQL `jsonb`, SQLite text JSON mode and MySQL
  `json`; REST `t.Any()`, GraphQL `JSON` scalar, API-docs object schema,
  JSON textarea/object serialization in generated forms, and JSON list values.
  Use it for structured payloads and arrays.

## [0.8.0] - 2026-10-30

### Added

- `Email` and `URL` field types: text-backed storage on all dialects, REST
  `email`/`uri` validation, GraphQL strings, text-style filters, and email/url
  HTML inputs in generated forms. Docs and Agent Skill updated.

## [0.7.0] - 2026-10-30

### Added

- `Boolean` field type end-to-end: parser/IR/validation, PostgreSQL `boolean`,
  SQLite integer boolean mode, MySQL `boolean`, REST/GraphQL Boolean schemas,
  generated fixtures, API docs JSON Schema, and an Ant Design `Switch` in
  generated create/edit forms. Filters default to `eq`.

## [0.6.5] - 2026-10-30

### Added

- English documentation core pages: `/en/guide/getting-started` and
  `/en/guide/cli`, with matching SEO descriptions. The language switcher now
  only exposes Chinese and English; un-translated locale entries are hidden
  instead of linking to Chinese-only pages.

## [0.6.4] - 2026-10-30

### Added

- Versioned documentation: `docs:build` now also builds a stable `/v0.6/`
  archive with its own base/canonical URLs, and the site nav exposes
  Latest / v0.6 archive links. Archive builds are pinned per minor version so
  `latest` can keep changing.

## [0.6.3] - 2026-10-30

### Changed

- Security: upgraded `vue` / `@vue/server-renderer` (docs dev dependency) via
  overrides/resolutions to remove the high-severity XSS advisory.
- Generated workspaces now run turbo `build`/`test`/`typecheck` serially and use
  project-local temp directories for HTTP/storage tests, reducing Windows
  subprocess `EPERM` and resource-race flakiness.
- Added `AUDIT.md`: repository tests, coverage, docs build, generated-project
  acceptance, dependency audit and remaining ROADMAP status.

## [0.6.2] - 2026-10-26

### Added

- `qiy generate --incremental` writes only files whose content changed while
  still syncing/removing stale generated files, reducing churn for watch mode
  and CI. Unchanged files keep their mtimes.

## [0.6.1] - 2026-10-26

### Added

- `qiy diff [--check] [--json]` renders the generated workspace in memory and
  reports added/changed/removed files without writing. `.env.*` secrets are
  ignored, `--check` exits 1 on drift, and the generation pipeline is now split
  into `renderAppFiles` + write so other tools can preview output safely.

## [0.6.0] - 2026-10-26

### Added

- Official skill distribution now bundles all five skills (`qiy`, `refine-dev`,
  `bun`, `drizzle`, `elysia`) into the CLI. `qiy skill install [name]`,
  `install --all`, `list --all`, `update [name]` and `uninstall [name]` manage
  each skill offline; non-Qiy skills install under
  `.agents/skills/<name>` and keep local-edit protection. The docs site also
  publishes each skill and its tarball under `/skills/<name>/`.

## [0.5.3] - 2026-10-26

### Added

- v1 files pass entity/field annotations through (`@display`, `@label`,
  `@code`, ...) and support `as <relationName>` plus `@onDelete(cascade|
  restrict|setNull)` on inline one and one-to-many relations. Custom options on
  reciprocal many-to-many arrays are rejected with a join-entity hint.

## [0.5.2] - 2026-10-26

### Added

- Local password login now locks a lowercased username after repeated failures:
  5 failures / 15-minute window -> 15-minute lock, HTTP 429 with `Retry-After`.
  Tune with `QIY_AUTH_LOGIN_MAX_ATTEMPTS`, `QIY_AUTH_LOGIN_WINDOW_MS`,
  `QIY_AUTH_LOGIN_LOCK_MS`; counters are per-process memory.
- Session revocation: `qiy_session_revocations` watermark table,
  `POST /api/v1/auth/logout-all`, and a profile "Sign out all devices" action.
  Local tokens issued before the watermark are rejected on the next request.

## [0.5.1] - 2026-10-26

### Added

- API docs now expose `x-qiy-hidden` entries for verification-gated commands
  hidden from non-admin principals, and the web page shows an explanatory notice
  with the verification name instead of silently omitting the operation. Admin
  documents have an empty hidden list.

### Fixed

- The generated realtime audit test now creates its own `audit_events` table
  before querying it, so it no longer fails with `no such table` when test files
  run in parallel and another file drops shared tables.

## [0.5.0] - 2026-10-26

### Added

- API key permission scopes: create/rotate accept `scopes: string[]` (subset of
  the caller's effective permission values, max 50). `loadPermissions`
  intersects the user's permissions with the key scopes; null/empty inherits
  all. The key page adds a multi-select when the identity exposes permissions
  and a Scopes column.

## [0.4.9] - 2026-10-26

### Added

- API key rotation (`POST /api/v1/auth/api-keys/:id/rotate`): preserves name
  and expiry, revokes the old key immediately, stores `rotatedFromId` and shows
  the new secret once. The API-key page adds a Rotate action.
- API key audit trail (`qiy_api_key_events`, `GET /api/v1/auth/api-keys/events`):
  records created/rotated/revoked events per user (latest 100) and renders them
  below the key table. Audit writes are best-effort and never authorize requests.

## [0.4.8] - 2026-10-26

### Fixed

- `features { apiDocs true; }` without an `auth` block no longer generates web
  imports of a missing `app/auth` module. The docs helper falls back to the
  local `qiy.access_token` reader and the API-docs route skips the identity
  fetch when auth is disabled.

## [0.4.7] - 2026-10-26

### Added

- API docs page now has a session-scoped **Try it** panel per operation: path
  and query inputs, JSON body editor, optional in-form `X-API-Key`, automatic
  `qiy.access_token` bearer header, raw response with status (20k truncation),
  and clear auth/error states. Docs, skill reference and generated-page tests
  were updated.

## [0.4.6] - 2026-10-26

### Added

- `qiy add module` and `qiy add feature` now support v1 entries: module creates
  a v1 fragment under the entry's `modules/` directory and appends a relative
  `include`, feature adds/updates the `features` block. Both validate through
  the v1 preprocessor and roll back on failure.

## [0.4.5] - 2026-10-26

### Added

- v1 entry files can use top-level `include "modules/*.qiy";` v1 fragments.
  Includes are expanded before v1 translation (fragments must be relative,
  project-root-contained and must not declare `project`), so large v1 models can
  be split into modules while `explain/generate` keep working.

## [0.4.4] - 2026-10-26

### Added

- v1 preview passes through common v0 config blocks in canonical order:
  workspace/ui/api/features/realtime/elysia/storage/auth/env/messages/permission/
  workflow/enum before entities, and menu/dashboard/chart/dataflow/action after
  relations. Entity references inside these blocks use generated table names;
  this enables v1 apps with auth, developer pages, menus and charts.

## [0.4.3] - 2026-10-26

### Added

- v1 reciprocal many fields (`tags: Tag[]` on Product + `products: Product[]`
  on Tag) now generate an explicit `<parent>_<target>` join entity with two
  one relations, matching the v0 generator's requirement for an explicit join
  table. One-way arrays remain one-to-many.

## [0.4.2] - 2026-10-26

### Added

- `qiy add entity` and `qiy add field` now detect v1 entry files and write v1
  declarations (`entity Name { name: text }` / `phone: text nullable`), then
  validate through the v1→v0 preprocessor and roll back on failure. `qiy add
  module/feature` remain v0-only and say so explicitly.

## [0.4.1] - 2026-10-26

### Added

- v1 preview now supports one-to-many fields (`lines: OrderLine[]`): the
  preprocessor adds a nullable child FK and a one relation from the child table
  to the parent. Unknown/self/duplicate targets fail with actionable errors;
  many-to-many still requires an explicit join entity.

## [0.4.0] - 2026-10-26

### Added

- v1 friendly syntax preview: entry files starting with `project <name>` or
  `qiy v1;` are translated to canonical v0 (`project`, `module`, `entity`,
  `name: type`, `primary`/`nullable`/`unique`, automatic `id`, inline one
  relations). `qiy explain/generate/fmt` detect it automatically; unsupported
  include/many/non-entity constructs fail with actionable errors. Default
  templates and `qiy add` remain v0.
- New `/guide/syntax-v1` page, Agent Skill `references/syntax-v1.md`, and
  parser/CLI tests covering v1 translation, generation and error paths.

## [0.3.4] - 2026-10-26

### Added

- `qiy add module <name> --kind entities|ui|permissions|dataflows|messages`
  creates a model fragment and inserts its `include` at the kind-correct
  declaration position; `qiy add feature overview|apiDocs|apiKeys` enables a
  developer page and rolls back when validation fails (for example apiKeys
  without auth).

## [0.3.3] - 2026-10-26

### Added

- `qiy fmt [--check] [files...]`: syntax-preserving canonical whitespace
  formatting for project model files or explicit `.qiy` paths. It normalizes
  indentation, blank-line runs, trailing whitespace and the final newline
  without changing declarations, comments, includes or order. `--check` is
  CI-friendly and exits 1 when files need formatting.
- The design-philosophy page now contains the v1 friendly-syntax RFC
  (`project`/`module`, `name: type`, inline `customer: Customer` and
  `lines: OrderLine[]`, optional semicolons, v0 compatibility via `qiy fmt`).

## [0.3.2] - 2026-10-26

### Added

- `qiy add entity <name> --field name:Type ...` and `qiy add field <entity>
  <name:Type>` for structured incremental modeling. Both keep the module's
  declaration order/indentation, run a full project parse after the edit and
  roll the file back on validation errors, so agents can add models without
  hand-editing blocks.

## [0.3.1] - 2026-10-26

### Added

- `qiy dev --watch` watches `model/**/*.qiy`, debounces editor saves, regenerates
  `admin/`, prepares migrations, and lets the generated dev servers reload. A
  failed regeneration keeps the dev server running and prints the error plus the
  fix hint.

## [0.3.0] - 2026-10-26

### Added

- `qiy create project <name>` creates a standard modular Qiy project:
  `qiy.project.json`, `model/app.qiy`, `model/modules/*.qiy`, docs and
  commented examples for permissions, dataflows and messages. `--template
  minimal` keeps only the catalog module.
- Project-aware `qiy check`, `qiy generate`, `qiy dev`, `qiy test`, `qiy build`
  and `qiy preview`. `qiy dev` generates, installs on first run, prepares the
  development database and starts API + admin.
- New design-philosophy page and a CLI-first quickstart; documented Qiy as a
  project (`model/` + generated `admin/`) rather than a generator checkout.
- `qiy explain` now expands relative `include` modules, so modular models are
  validated and summarized correctly.

### Changed

- The canonical new-project path is `qiy create project <name>`; legacy
  `qiy create -f ...` / `qiy generate <file> <dir>` remain as advanced
  compatibility commands.

## [0.2.5] - 2026-10-26

### Added

- The generated API reference page can download the permission-filtered
  OpenAPI document currently shown to the account (`<title>.openapi.json`).
  The endpoint remains `/api/v1/openapi.json`; the download serializes the same
  filtered spec instead of issuing a new request.

## [0.2.4] - 2026-10-26

### Added

- Stable error-code catalog `QIY1001`–`QIY1016` for the most common parser,
  validation, permission, chart, scope, skill and `--sync` failures; list it
  with `qiy explain --errors [--json]`, browse it at `/dsl/errors`, and get
  `code`/`fix` attached to `qiy explain <file> --json` failures when recognized.

## [0.2.3] - 2026-10-26

### Added

- `qiy explain <file.qiy> [--json]` prints a normalized model summary (entities,
  fields, generated values, relations, enums, permissions, dataflows, actions,
  charts and counts) without generating a project. Invalid models can be
  inspected as `{"valid":false,"error":"…"}`.
- `qiy schema` prints the draft-2020-12 JSON Schema for `qiy explain --json`;
  the same schema is published at `/schema/qiy-explanation-1.json` and linked
  from `llms.txt`.
- `qiy skill list/update/uninstall` lifecycle commands (from 0.2.2) are
  documented in the CLI and Agent Skill references.

## [0.2.2] - 2026-10-26

### Added

- `qiy skill list [--json]` reports project, legacy, global and `--dir`
  installations with up-to-date/modified/missing/unrelated file details.
- `qiy skill update [--force]` refreshes an existing installation and refuses
  locally modified official files unless `--force` is passed.
- `qiy skill uninstall` removes only bundled official files and empty
  directories, preserving handwritten files under the skill directory.

## [0.2.1] - 2026-10-26

### Added

- Complete the official Agent Skill: a small `SKILL.md` router plus twelve
  self-contained references covering the whole DSL, modeling, auth and
  permissions, generated Refine providers, dataflows/actions, UI and charts,
  i18n, system features and API keys, storage and realtime, testing and
  deployment, the CLI, workspace integration and troubleshooting.
- The skill install test now validates every skill markdown link, each
  reference's keyword coverage and that the skill version matches the CLI
  package version.

### Fixed

- Generate a type-correct `qiyNextSequence` fallback for models without a
  `@code` field, and type the generated docs routes so Elysia plugin
  composition passes `tsc`.
- Omit relation-cell/record-details regression tests from generated projects
  that do not contain the demo `orgs` display-template fixture, and use the
  model's first resource in the data-provider coalescing test.
- Use `bun test --pass-with-no-tests` in integration-mode generated web
  packages, which intentionally ship no generated tests.
- Keep the `UploadOutlined` import required by the read-only saved-view
  publish button.
- Release acceptance now checks the standard `.agents/skills/qiy` install path.
- Add the missing `tenantId` field on the auth user fixture so dataflow scope
  generation passes, and pin Gradle 8.10.2 for the JetBrains plugin build.

### Changed

- The default skill install directory remains `.agents/skills/qiy`; legacy
  `.agent/skills/qiy` installations are still updated in place. Run
  `qiy skill install --force` after upgrading.
- `references/production-boundaries.md` was replaced by
  `references/testing-deployment.md`; force installs keep unrelated legacy
  files, so remove the old file manually if present.

## [0.2.0] - 2026-10-25

### Added

- Complete Chinese DSL reference for `application`, `entity`/`field`,
  `relation`/`index`, `generated-values`, `annotations`, `modules`,
  `permissions`, `auth`, `dataflow`, `actions`, `realtime`, `storage`,
  `features`, `charts`, `i18n`, `enum`/`menu`/`dashboard`, `workflow`,
  `scope`/`restrict`/`pages` and the application-block map.
- Goal-oriented DSL cookbook and a rewritten Refine providers guide.
- Documentation SEO: per-site sitemap, canonical URLs, OpenGraph/Twitter
  metadata, `robots.txt`, `llms.txt`, `llms-full.txt` and a static Agent Skill
  download (`/skills/qiy/SKILL.md`, `/skills/qiy-skill.tar.gz`).
- Developer pages for the system overview, permission-filtered API docs and
  API keys, gated by the `features` application block.
- Multi-view chart DSL with responsive `chart panels`, grouped nested menus,
  permission `verification`, command `allow` policies, row/field `restrict`,
  data `scope`, page rules and generated business codes.
- `qiy skill install` with project, `--global` and `--dir` destinations and a
  `--force` replace mode.

### Changed

- Skill installation moved to the standard `.agents/skills/qiy` directory;
  legacy `.agent/skills/qiy` is migrated in place. Run
  `qiy skill install --force` after upgrading.
- Documentation is scoped to Qiy users, developers and AI agents; unrelated
  Android distribution pages were removed.
- `/api/v1/auth/exchange` handles OIDC token responses defensively and reports
  the HTTP status; browser callback completion is StrictMode-safe.
- Identity requests are cached and batched FK lookups use `getMany`/`useMany`
  instead of one `useOne` per cell.

### Fixed

- Chart table labels, menu rendering warnings, Mermaid theme handling and the
  developer-page render loop.
- Generated server type checks for docs routes and models without generated
  code fields.
- Release acceptance failures exposed by the first 0.2.0 release candidate.

## [0.1.5] - 2026-10-12

See the [v0.1.5 release](https://github.com/AI-NoDev/qiy/releases/tag/v0.1.5).

[0.16.0]: https://github.com/AI-NoDev/qiy/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/AI-NoDev/qiy/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/AI-NoDev/qiy/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/AI-NoDev/qiy/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/AI-NoDev/qiy/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/AI-NoDev/qiy/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/AI-NoDev/qiy/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/AI-NoDev/qiy/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/AI-NoDev/qiy/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/AI-NoDev/qiy/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/AI-NoDev/qiy/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/AI-NoDev/qiy/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/AI-NoDev/qiy/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/AI-NoDev/qiy/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/AI-NoDev/qiy/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/AI-NoDev/qiy/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/AI-NoDev/qiy/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/AI-NoDev/qiy/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/AI-NoDev/qiy/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/AI-NoDev/qiy/compare/v0.4.9...v0.5.0
[0.4.9]: https://github.com/AI-NoDev/qiy/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/AI-NoDev/qiy/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/AI-NoDev/qiy/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/AI-NoDev/qiy/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/AI-NoDev/qiy/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/AI-NoDev/qiy/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/AI-NoDev/qiy/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/AI-NoDev/qiy/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/AI-NoDev/qiy/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/AI-NoDev/qiy/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/AI-NoDev/qiy/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/AI-NoDev/qiy/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/AI-NoDev/qiy/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/AI-NoDev/qiy/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/AI-NoDev/qiy/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/AI-NoDev/qiy/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/AI-NoDev/qiy/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/AI-NoDev/qiy/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AI-NoDev/qiy/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AI-NoDev/qiy/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AI-NoDev/qiy/compare/v0.1.5...v0.2.0

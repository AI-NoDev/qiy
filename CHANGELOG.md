# Changelog

All notable changes to Qiy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

Release notes on GitHub are generated from the matching section of this file.
Releases before `0.2.0` are listed on the
[GitHub releases page](https://github.com/AI-NoDev/qiy/releases).

## [0.5.1] - 2026-10-26

### Added

- API docs now expose `x-qiy-hidden` entries for verification-gated commands
  hidden from non-admin principals, and the web page shows an explanatory notice
  with the verification name instead of silently omitting the operation. Admin
  documents have an empty hidden list.

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

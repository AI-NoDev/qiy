# Changelog

All notable changes to Qiy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

Release notes on GitHub are generated from the matching section of this file.
Releases before `0.2.0` are listed on the
[GitHub releases page](https://github.com/AI-NoDev/qiy/releases).

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

[0.3.0]: https://github.com/AI-NoDev/qiy/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/AI-NoDev/qiy/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/AI-NoDev/qiy/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/AI-NoDev/qiy/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/AI-NoDev/qiy/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/AI-NoDev/qiy/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/AI-NoDev/qiy/compare/v0.1.5...v0.2.0

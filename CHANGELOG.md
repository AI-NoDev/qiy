# Changelog

All notable changes to Qiy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/).

Release notes on GitHub are generated from the matching section of this file.

## [Unreleased]

## [1.0.0] - 2026-11-07

First stable release. One `.qiy` model generates a complete Bun + Elysia +
Drizzle + Refine application: database, REST/GraphQL API, admin UI, auth and
permissions.

### Modeling

- Single `.qiy` text syntax with `include` modules, `qiy fmt`, `qiy explain [--json]`,
  `qiy schema`, an error-code catalog and incremental `qiy add entity/field/module/feature`.
- Field types Text, Integer, Decimal, Money, Boolean, Email, URL, JSON, UUID, Date, Time,
  DateTime, File, Files, Vector and arrays; server-generated values (`@code`, `@generated`),
  database-generated `@computed` columns, `@softDelete` with recycle bin, `@tenant`.
- Field rules `@min`/`@max`/`@length`/`@pattern` and `@default`, enforced on REST, GraphQL and
  CSV import with matching form rules; optimistic locking with `@version` (409 on conflict).
- One-to-many and many-to-many relations (join table, multi-select UI) with `@onDelete`;
  read-only database `view`s that inherit the source entity's row rules.

### Runtime

- PostgreSQL, SQLite and MySQL schemas and migrations with concurrency protection,
  `db:check` drift detection, logical backup and guarded restore.
- Elysia REST (nested and/or filter trees, pagination limits, CSV import/export jobs),
  GraphQL (Yoga or Apollo) and OpenAPI on one service layer with audited transactions.
- Refine + Ant Design admin: CRUD, relation selects and drawers, saved views, field layout
  permissions, nested menus, chart overview pages, themes and i18n.
- Local file and S3-compatible storage with multipart resumable uploads and MIME/size policies.
- Realtime over a database outbox and SSE (REST and GraphQL), with channel permissions and
  record-level subscriptions.

### Auth and permissions

- Local passwords (rate limiting, lockout, session revocation), OTP, any number of OpenID
  Connect providers with presets (generic, Okta, Auth0, Azure AD B2C, Keycloak, Google, Kinde),
  onboarding, account linking and scoped, rotatable API keys.
- Custom roles with `full`/`write`/`read` access, atomic permissions and groups, `scope` and
  tree scope, `restrict` row conditions, field masks and page route guards.

### Business logic

- Dataflows with typed input, guards, transactional writes, audit and events, plus declarative
  `app.test.qiy` scenarios; action buttons; `statemachine` transitions compiled to guarded,
  idempotent dataflows.
- `webhook` and `notification` subscriptions with transactional delivery records, HMAC signing
  and retries (SMTP, Resend, webhook, console); cron-scheduled dataflows with a lease so each
  tick runs once across replicas.

### Tooling

- `qiy create project`, `qiy dev --watch`, `standalone` and `integration` generation modes,
  `--sync` manifest protection for hand-written code, generator plugins and `qiy diff`.
- Official Agent Skill (`qiy skill install`), `qiy mcp`, the `qiy agent` HTTP API and
  `llms.txt` / `llms-dsl.txt` / `llms-guides.txt`.
- Chinese and English user documentation.

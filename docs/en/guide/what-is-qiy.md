# What is Qiy

Qiy is a modeling language and full-stack generator for **data-centric business applications**. You describe your data, access rules and business commands in one `.qiy` model; Qiy generates and keeps regenerating an ordinary TypeScript workspace you can read, test and extend:

- a **Refine** admin on **React Router** framework mode, with lists, forms, filters, saved views, charts and CSV import/export;
- a **Bun + Elysia** REST and GraphQL API with OpenAPI docs;
- a **Drizzle** data layer and migrations for **PostgreSQL**, **MySQL** or **SQLite**;
- authentication (local passwords, OAuth/OIDC), roles, permissions, row and field policies, data scopes and audit history;
- transactional commands (dataflows), state machines, webhooks, email notifications and scheduled jobs;
- generated server and web test suites, Docker, Kubernetes and Vercel deployment files.

## Why a model

In a typical admin project the same fact lives in many places:

```text
database column  → migration
API input        → route schema / OpenAPI
form field       → form component
list column      → table config
validation       → written twice, client and server
permission       → button, route and API checks
types            → server schema, client props, API client
```

When one copy drifts, a column exists but the API never returns it, or the form accepts what the server rejects. Qiy keeps one source of truth and derives the rest:

```text
.qiy model
   │
   ▼
Qiy IR  ──► Drizzle schema + migrations
        ──► Elysia REST / GraphQL API + OpenAPI
        ──► Refine admin pages, menus, charts
        ──► auth, permissions and record policies
        ──► server and web tests, deployment files
```

## Design principles

- **One way to do one thing.** Each capability has a single syntax, and anything outside it fails to parse.
- **Fail closed.** Unknown syntax, missing claims, unknown roles and unsafe combinations are errors at parse or generation time, not silent defaults at runtime.
- **Generated code is ordinary code.** The output is a Turborepo + Bun workspace. Qiy only rewrites the files it lists in `.qiy-generated.json`; your code under `apps/*/extensions/` is never touched.
- **Every generated feature ships with its tests.** Each generated workspace runs its own server and web suites, so a model change that breaks a rule shows up in `qiy test`.

## Compared with other tools

- **Django Admin** turns models into an admin. Qiy follows the same idea, but outside the Python ecosystem: it generates the web client, the API and the database layer, and leaves you with code instead of a runtime black box.
- **Prisma** models a database and generates a client. Qiy's schema layer is similar, but its target is a complete application: UI, API, permissions, commands and deployment.

## Next steps

- [Getting started](/en/guide/getting-started): generate your first admin in a few minutes.
- [Data modeling](/en/guide/data-modeling): entities, fields, relations, views.
- [DSL reference](/en/guide/dsl-reference): every construct on one page.

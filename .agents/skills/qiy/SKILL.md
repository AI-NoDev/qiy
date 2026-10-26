---
name: qiy
description: "Build and maintain applications with the Qiy CLI and .qiy models: scaffold a Bun + Elysia + Drizzle + Refine admin, add entities/fields/relations, permissions, dataflows, charts, modules, integrations and deployment checks. Use when the user mentions qiy, .qiy, Qiy DSL, qiy create/init/generate/skill/sync, or wants a Refine admin/CRUD app with API, database, auth, RBAC generated from one model."
license: MIT
metadata:
  short-description: "Build apps from .qiy models with the Qiy CLI"
  version: "0.4.1"
  homepage: "https://ai-nodev.github.io/qiy/"
  skill-docs: "https://ai-nodev.github.io/qiy/guide/agent-skill"
  llms-txt: "https://ai-nodev.github.io/qiy/llms.txt"
---

# Qiy

Qiy compiles a declarative `.qiy` model into editable TypeScript: a Refine + React Router admin, a Bun + Elysia REST/GraphQL API, a Drizzle database layer, tests, OpenWiki docs and deployment examples.

## Use this skill when

- The user wants to create, extend, review or maintain a Qiy application.
- The task involves `.qiy` blocks: entities, fields, relations, indexes, enums, generated codes, permissions, dataflows, actions, charts, menus, messages, auth, storage, realtime, scope/restrict, pages, features, modules.
- The user mentions `qiy create`, `qiy init`, `qiy generate --sync`, `qiy explain`, `qiy schema`, `qiy skill install`, or an existing generated workspace.
- The user wants an admin/CRUD app generated from a model instead of hand-written boilerplate.

## Do not use this skill when

- The task involves a different framework and no `.qiy` model or Qiy CLI.
- The user wants to modify the Qiy compiler/generator itself (maintainer work, not application work).

## Choose a workflow

| Situation | Command |
| --- | --- |
| New project (recommended) | `qiy create project <name>` then `cd <name> && qiy dev` |
| Change/validate the model | `qiy add entity/field/module/feature`, `qiy fmt`, then `qiy check` / `qiy generate` |
| Existing Bun repo, Qiy should own API + DB + admin | `qiy init -f <model.qiy>` from the repo root |
| Existing Bun repo with its own API/users | `qiy init` with `mode integration` in the model |
| Legacy explicit generation | `qiy generate <model.qiy> <dir> --sync` |

Inside a project, `qiy` reads `qiy.project.json` and finds the root from subdirectories. `qiy dev` generates, installs on first run, migrates the dev database and starts API + admin. `--sync` on the legacy command only works on a workspace Qiy generated (it follows `.qiy-generated.json`); never point it at an arbitrary repository.

## Install this skill

The CLI bundles this skill offline:

```bash
qiy skill install                  # <project>/.agents/skills/qiy
qiy skill install --global         # ~/.agents/skills/qiy
qiy skill install --dir .claude/skills/qiy
qiy skill install --dir ~/.codex/skills/qiy
qiy skill install --force          # after a CLI upgrade, replace modified official files
qiy skill list [--json]            # installed locations, freshness, modified/missing files
qiy skill update [--force]         # refresh an existing installation only
qiy skill uninstall                # remove official files; keep handwritten files
```

Repeats are idempotent; local edits to official files are refused unless `--force`; unrelated files are preserved; a legacy `.agent/skills/qiy` is updated in place. Static copies: `https://ai-nodev.github.io/qiy/skills/qiy/SKILL.md` and `.../skills/qiy-skill.tar.gz`. Installing this skill does not install the CLI.

## First run

1. `qiy --version` and `qiy doctor`; if missing, install the release binary for the OS/CPU from GitHub Releases.
2. `qiy create project <name>` and `cd <name>`; edit `model/app.qiy` and `model/modules/*.qiy`.
3. `qiy check`, then `qiy dev --watch` (generates, installs on first run, migrates the dev database, starts API + admin, and regenerates on model saves).
4. Before finishing: `qiy test` and `qiy build`; `qiy preview` is a loopback-only in-memory demo, never a deployment target.
5. For a real database, change `database postgresql|mysql {}` in the model, fill `admin/apps/<server-alias>/.env.development`, then `qiy dev` (it generates/applies migrations). Production values go in `.env.production`.

A server without `auth` refuses to start unless `QIY_DEV_MODE=1`.

## Progressive disclosure

Open only the reference that matches the task. Every reference is self-contained, offline, and ends with canonical doc URLs.

| Task | Read |
| --- | --- |
| Any DSL syntax: lexical rules, declaration order, every block/setting, annotations, field types | [language-reference.md](references/language-reference.md) |
| Model data: includes/modules, fields, relations, indexes, `@code`/`@generated`, display templates, limits | [modeling-and-generation.md](references/modeling-and-generation.md) |
| Simpler v1 preview syntax (`project`/`module`, `name: type`, inline one relation) and its limits | [syntax-v1.md](references/syntax-v1.md) |
| Login, OIDC/OTP/hybrid providers, roles, permissions, verification, restrict/scope/pages, 401/403 | [auth-permissions.md](references/auth-permissions.md) |
| Generated Refine providers: DataProvider mapping, AuthProvider, `can()`, live/audit/notification/i18n/router wiring | [refine-providers.md](references/refine-providers.md) |
| Business commands, dataflows, actions, batch, `workflow orderInventory`, `app.test.qiy` | [dataflows-actions.md](references/dataflows-actions.md) |
| Theme/layout, menu, dashboard, charts and panels, messages/i18n keys | [ui-charts-i18n.md](references/ui-charts-i18n.md) |
| `features`, system pages, OpenAPI filtering, API keys | [system-features.md](references/system-features.md) |
| File fields, uploads, S3, attachment cleanup, realtime/outbox | [storage-realtime.md](references/storage-realtime.md) |
| Typecheck/test/build, generated test suites, migrations, deployment, real-service acceptance | [testing-deployment.md](references/testing-deployment.md) |
| CLI commands/flags, output layout, env requirements, `--sync`, upgrade | [cli-workflows.md](references/cli-workflows.md) |
| Mount into an existing Bun project, aliases, integration mode, CSRF/envelope/tenant | [workspace-integration.md](references/workspace-integration.md) |
| A failure with an exact error string or symptom | [troubleshooting.md](references/troubleshooting.md) |
| A complete model to copy and generate | [warehouse-admin example](examples/warehouse-admin/README.md) |

## Safety rules

- **No secrets in `.qiy`.** Passwords, JWT/OIDC secrets, database URLs and S3 keys go in `.env` files, secret managers or deployment secrets.
- **Do not hand-edit owned generated files.** `.qiy-generated.json` lists them; `--sync` rewrites or removes them. Put lasting custom code in `apps/web/app/extensions/`, `apps/server/src/extensions/`, host adapters or plugins.
- **Hiding a button is not authorization.** `when`, `pages` and `CanAccess` are UI. Server `allow`/`require`/`restrict`/`scope` enforce.
- **`admin` does not bypass explicit allowlists.** `allow roles operator;` also rejects admin.
- **Permissions are additive.** There is no subtraction; change the role, database column or IdP claim to demote.
- **No rate limiting is generated.** Add it at the gateway/WAF or delivery adapter. OTP challenges are reusable within their window.
- **`mask` protects generated read paths, not the database.** Backups, DB access, logs and external systems still see plaintext.
- **Realtime is at-least-once.** Consumers must be idempotent. List pages are not auto-subscribed by default.
- **`mode integration` has no Qiy security.** The host API owns auth, permissions, CSRF and tenancy.
- **Do not promise unsupported behavior**: no arbitrary expressions, no custom roles in `allow roles`, no generated business workflow beyond `orderInventory`/dataflows, no integration-mode server generation.
- **Verify before saying done.** Regenerate, review migrations, then run typecheck, tests and build; a passing build does not prove database, IdP, S3 or deployment health.
- **Regenerate after CLI upgrades.** The DSL is not forward compatible; run `qiy generate ... --sync` or `qiy init --sync`, review migrations, then `qiy skill install --force`.

## Canonical web links

- Home: https://ai-nodev.github.io/qiy/
- Agent Skill docs: https://ai-nodev.github.io/qiy/guide/agent-skill
- DSL overview: https://ai-nodev.github.io/qiy/dsl/overview
- Goal-oriented recipes: https://ai-nodev.github.io/qiy/guide/dsl-cookbook
- Machine-readable index: https://ai-nodev.github.io/qiy/llms.txt
- Full text: https://ai-nodev.github.io/qiy/llms-full.txt
- CLI and release: https://ai-nodev.github.io/qiy/guide/cli
- Releases: https://github.com/AI-NoDev/qiy/releases

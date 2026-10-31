# CLI workflows

Use this file when you need the exact Qiy CLI commands, flags, output layout, environment requirements, upgrade/sync behavior, or the skill-install command. Every command here is implemented; anything else is not.

Canonical reference: https://ai-nodev.github.io/qiy/guide/cli

## Contents

- [Install and verify the CLI](#install-and-verify-the-cli)
- [Command reference](#command-reference)
- [create project: modular project](#create-project-modular-project)
- [Project commands: check/generate/dev/build/test/preview](#project-commands-checkgeneratedevbuildtestpreview)
- [Legacy explicit generation](#legacy-explicit-generation)
- [init: mount into an existing Bun project](#init-mount-into-an-existing-bun-project)
- [Install this skill from the CLI](#install-this-skill-from-the-cli)
- [doctor](#doctor)
- [First run](#first-run)
- [Output layout](#output-layout)
- [Environment requirements](#environment-requirements)
- [Upgrade and --sync](#upgrade-and-sync)
- [Common problems](#common-problems)

## Install and verify the CLI

The skill and the executable are separate: installing this skill does not install `qiy`.

Download the asset matching the OS/CPU from [Qiy GitHub Releases](https://github.com/AI-NoDev/qiy/releases/latest):

| Platform | Asset pattern |
| --- | --- |
| Windows x64 | `qiy-<version>-windows-x64.exe` |
| Linux x64 | `qiy-<version>-linux-x64` |
| Linux ARM64 | `qiy-<version>-linux-arm64` |
| macOS x64 | `qiy-<version>-darwin-x64` |
| macOS ARM64 | `qiy-<version>-darwin-arm64` |

Put the executable on `PATH` (or call it by path), `chmod +x` on Linux/macOS, then:

```bash
qiy --version
qiy --help
```

From a Qiy source checkout use `bun run qiy -- --help` instead. Do not assume `bunx qiy` exists; it only works if a published npm package is installed and resolves to the expected version.

The executable embeds the Admin template, so it can generate a complete application outside the repository. The public input format is `.qiy` only; MPS models and Database IR are maintainer tools, not CLI inputs.

## Command reference

```text
qiy create project <name> [--template minimal|standard] [--dir <path>]
qiy check
qiy diff [--check] [--json]
qiy add entity <name> [--module <name>] [--field name:Type ...] [--label ...] [--icon ...]
qiy add field <entity> <name:Type> [--nullable] [--unique] [--code <template>]
qiy add module <name> [--kind entities|ui|permissions|dataflows|messages]
qiy add feature <overview|apiDocs|apiKeys>
qiy fmt [--check] [files...]
qiy generate
qiy generate --incremental
qiy dev
qiy dev --watch
qiy build
qiy test
qiy preview
qiy generate <source.qiy> <output-dir> [--sync]     # legacy explicit
qiy create -f <source.qiy> -n <name> -o <output-dir> # legacy explicit
qiy init -f <source.qiy> [-n <name>] [-o <project-root>] [--sync]
qiy doctor [--json]
qiy explain <file.qiy> [--json]
qiy schema
qiy mcp
qiy explain --errors [--json]
qiy skill install [name] [--all] [--force] [--global] [--dir <path>]
qiy skill list [--all] [--json] [--global] [--dir <path>]
qiy skill update [name] [--force] [--global] [--dir <path>]
qiy skill uninstall [name] [--global] [--dir <path>]
qiy help            # same as --help
qiy --help | -h
qiy --version | -v
```

| Command | Required flags | Behavior |
| --- | --- | --- |
| `create project <name>` | name | Creates `qiy.project.json`, `model/app.qiy`, `model/modules/*`; no generation/install. `--template minimal` only includes the catalog module; `--dir` changes the target |
| `check` | - | Parses/validates the current project model and prints counts; writes nothing |
| `add entity` | name | Appends an entity (default `id UUID @id`) to a module with `--field name:Type`, optional `--label`/`--icon`/`--module`; validates and rolls back on failure |
| `add field` | `<entity> <name:Type>` | Inserts a field before the entity's closing brace with `--nullable`/`--unique`/`--code`; validates and rolls back on failure |
| `add module` | name | Creates `<nn>-<name>.qiy` and inserts its include at the kind-correct position (`entities`/`ui`/`permissions`/`dataflows`/`messages`) |
| `add feature` | feature | Enables `overview`/`apiDocs`/`apiKeys` in the `features` block; validates and rolls back (apiKeys needs auth) |
| `fmt` | `[files...]` | Syntax-preserving whitespace normalization for project model files or explicit `.qiy` paths; `--check` reports and exits 1 |
| `generate` (project) | - | Generates/syncs `admin/` from the current project manifest |
| `dev` | - | Generates, installs on first run, runs `db:generate` + `db:migrate`, starts the generated API + admin; `--watch` regenerates/migrates on debounced `model/**/*.qiy` saves |
| `build` / `test` / `preview` | - | Ensures generation/install, then runs that generated workspace script |
| `create` (legacy) | `-f`, `-n`, `-o` | Generates a standalone Turborepo + Bun workspace from an existing model file |
| `generate` (legacy) | `<source>`, `<output-dir>` | Same generation as legacy `create` with positional arguments |
| `init` | `-f` | Mounts server/web packages into the current Bun workspace. `-o` selects another project root; `-n` overrides the integration name once |
| `doctor` | - | Checks Bun runtime, the embedded Admin template and the current workspace's Bun declaration; `--json` prints machine-readable output |
| `explain` | `<file.qiy>` | Parses and summarizes the model (entities/fields/relations/permissions/dataflows/actions/charts) without generating; `--json` prints the machine-readable shape, invalid models print `{valid:false,error,code?,fix?}` and exit 1; `--errors [--json]` lists the stable QIY10xx catalog |
| `schema` | - | Prints the JSON Schema (draft 2020-12) for `explain --json`; also served at `/schema/qiy-explanation-1.json` |
| `skill install` | - | Installs the bundled official skill (see below) |
| `skill list` | - | Shows installed locations, freshness, and modified/missing/unrelated files; `--json` is machine-readable |
| `skill update` | - | Refreshes an existing installation; refuses local edits unless `--force` |
| `skill uninstall` | - | Removes only official files and prunes empty directories; handwritten files stay |
| `help` / `--help` / `-h` | - | Prints usage |
| `--version` / `-v` | - | Prints the CLI version |

Unknown commands exit 1 with `Unknown command: <name>` plus usage.

## create project: modular project

```bash
qiy create project shop
cd shop
# edit model/app.qiy and model/modules/*.qiy
qiy check
qiy dev
qiy dev --watch
```

- Writes only `qiy.project.json`, `model/` and project docs; it does not generate `admin/` or install dependencies.
- Target directory must be absent or empty.
- Names are lowercase kebab-case (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`).
- Default `standard` template includes working products/orders entities, a relation, menu and chart, plus commented permissions/dataflow/messages examples.
- `--template minimal` keeps only `10-catalog.qiy` and no relations/UI.
- All project commands find `qiy.project.json` by walking up from the current directory.

## Project commands: check/generate/dev/build/test/preview

```bash
qiy check      # validate only
qiy diff       # preview added/changed/removed generated files (--check exits 1)
qiy generate   # generate or sync admin/; --incremental writes only changed files
qiy dev        # generate + install first time + migrate + start API/admin
qiy test
qiy build
qiy preview
```

- `qiy generate` reads `model` and `output` from the manifest; when `admin/` already exists it syncs (never reinitializes over it).
- `qiy diff` renders the workspace in memory and reports added/changed/removed files without writing; `.env.*` secrets are ignored, `--check` exits 1 on drift, `--json` is machine-readable.
- `qiy dev` installs dependencies on first run, runs `db:generate` + `db:migrate`, then `bun run dev` in the generated workspace; add `--watch` to regenerate/migrate on debounced model saves.
- `qiy add entity <name> --field name:Text` and `qiy add field <entity> <name:Type>` edit the modular model in place, then re-parse and roll back on any validation error. Use them for AI-driven incremental modeling; use an editor for large restructuring.
- `qiy fmt` normalizes indentation, blank lines, trailing whitespace and the final newline without changing declarations/comments/includes/order; `qiy fmt --check` is CI-friendly.
- Generated scripts remain available inside `admin/` for CI or advanced use, but project commands are the supported entrypoint.

## Legacy explicit generation

```bash
qiy create -f ./models/warehouse/app.qiy -n warehouse-admin -o ./warehouse-admin
qiy generate ./models/app.qiy ./out/admin
qiy generate ./models/app.qiy ./out/admin --sync
```

- The source must be a `.qiy` file and may use relative `include` fragments; absolute includes, `..`, cycles and symlink escapes are rejected.
- The output directory must be empty or not exist (`Output directory must be empty`). Use `--sync` only on a directory previously generated by Qiy.
- `create` ignores most `workspace.aliases` and always produces `apps/server` and `apps/web`.
- `preview` binds loopback only and serves an in-memory repository; it is a local demo, not a production server. Stop it with Ctrl+C.
- On success the workspace contains `openwiki/{quickstart,architecture,development}.md`, `AGENTS.md` and the compatibility `AGENT.MD`.
- Prefer `qiy create project` + `qiy generate` for new work; these explicit commands remain for existing pipelines.

## init: mount into an existing Bun project

```bash
cd /path/to/existing-bun-project
qiy init -f ./models/admin.qiy
bun install
bun run qiy:admin:typecheck
bun run qiy:admin:test
```

Requirements and behavior:

- The target root's `package.json` must declare `"packageManager": "bun@<version>"`; `qiy init` refuses to write otherwise.
- Packages are mounted as `apps/<server-alias>` and `apps/<web-alias>`; deployment files are named from the deploy alias. Declare aliases in the model's `workspace` block ([workspace-integration.md](workspace-integration.md)).
- Qiy preserves existing workspace patterns, adds `apps/*` when missing, and adds direct `qiy:<name>:*` scripts (`typecheck`, `test`, `preview`, ...). It does not add Turborepo, a `turbo` dependency, or replace host root scripts.
- Conflicting host files or scripts make the command fail instead of overwriting. Resolve by choosing non-conflicting aliases.
- Each mounted admin gets its own env files under the aliased app directories. Qiy never writes the host root `.env*`.
- `--sync` updates only manifest-registered files and removes registered files the model no longer generates; unowned host files are never touched.
- `mode integration` models mount only the web package (no server, Drizzle, migrations, Docker/Compose) and generate host adapters under `apps/<web>/app/host/`.

## Install this skill from the CLI

The CLI bundles this skill offline; no network is required.

```bash
# Current project: <project>/.agents/skills/qiy
qiy skill install

# User level: ~/.agents/skills/qiy
qiy skill install --global

# Any agent-specific skills directory
qiy skill install --dir .claude/skills/qiy
qiy skill install --dir .cursor/skills/qiy
qiy skill install --dir ~/.codex/skills/qiy

# After a CLI upgrade: replace locally modified official files
qiy skill install --force

# Inspect, update or remove an installation
qiy skill list
qiy skill list --json
qiy skill update          # refuses local edits unless --force
qiy skill uninstall       # keeps handwritten files
```

| Flag | Effect |
| --- | --- |
| none | Writes `.agents/skills/qiy` under the current project |
| `--global` | Writes `~/.agents/skills/qiy` |
| `--dir <path>` | Writes the given directory; relative to the project, absolute, or `~/...` |
| `--force` | Replaces official files that were modified locally; unrelated files are always preserved |
| `list` | Reports installed locations, freshness, and modified/missing/unrelated files; add `--json` for scripts |
| `update` | Updates only an existing installation; same local-edit refusal as `install` |
| `uninstall` | Deletes only bundled official files and empty directories; handwritten files remain |

Behavior: repeating an install is idempotent; if an official file differs from the bundled version the command refuses with `Qiy skill has local changes...` and suggests `--force`; a legacy `.agent/skills/qiy` directory is updated in place when it is the only one present; only the skill's `SKILL.md`, `references/` and `examples/` are written. The installed bundle always matches the current CLI version - it never downloads a newer one.

No network? Extract the published archive instead:

```bash
tar -xzf qiy-skill.tar.gz -C .agents/skills
# produces .agents/skills/qiy/{SKILL.md,references/,examples/}
```

Static copies: `https://ai-nodev.github.io/qiy/skills/qiy/SKILL.md` and `.../skills/qiy-skill.tar.gz`. Prefer the CLI so versions stay aligned with the binary.

## doctor

```bash
qiy doctor
qiy doctor --json
```

Checks the Bun runtime, the embedded Admin template and the current directory's Bun package-manager declaration. Outside a Bun workspace it prints a warning; `qiy init` still refuses to write. `--json` emits the report for CI. The command exits 1 when the report is not OK, so it can gate a pipeline.

## First run

```bash
qiy --version
qiy doctor
qiy create project my-admin
cd my-admin
qiy check
qiy dev
qiy dev --watch
# edit model/app.qiy or model/modules/*.qiy, then:
qiy generate
qiy test
qiy build
qiy preview
```

`qiy dev` installs dependencies on the first run, prepares the default SQLite database and starts the API + admin. The generated workspace still exposes the underlying Bun scripts for CI.

For a real database: edit `apps/server/.env.development`, set `DATABASE_URL`, run `bun run db:generate` and `bun run db:migrate`, then `bun run dev:server` and `bun run dev:web`. Production configuration lives in `apps/server/.env.production`. A server without auth refuses to start unless `QIY_DEV_MODE=1`.

## Output layout

```text
my-admin/                       # qiy create project my-admin
├── qiy.project.json            # name, model, output, template
├── model/
│   ├── app.qiy                 # database + include statements
│   └── modules/*.qiy           # catalog, relations, ui, optional permissions/dataflows/messages
└── admin/                      # generated by qiy generate
    ├── apps/
    │   ├── server/             # Bun + Elysia API
    │   │   ├── src/            # db, contracts, repositories, services, routes, auth, storage, http.ts
    │   │   ├── drizzle/        # generated migrations + down/
    │   │   ├── tests/
    │   │   └── .env.{development,production,example}
    │   └── web/                # Refine + React Router SPA
    │       ├── app/            # routes, components, hooks, providers, ui, extensions, i18n.ts
    │       ├── tests/
    │       └── .env.{development,production,example}
    ├── deploy/                # nginx.conf, vercel.json, kubernetes/, observability/
    ├── Dockerfile, docker-compose.yml, turbo.json, package.json
    ├── openwiki/, AGENTS.md, AGENT.MD
    └── .qiy-generated.json    # manifest of Qiy-owned files
```

`init` uses aliases instead (`apps/<server-alias>`, `apps/<web-alias>`, `deploy/<deploy-alias>`, `<deploy-alias>.Dockerfile`, `docker-compose.<deploy-alias>.yml`, `.qiy-<name>.generated.json`) and puts agent entrypoints in the web package plus `openwiki/qiy-<name>/`.

## Environment requirements

| Requirement | Applies to | Notes |
| --- | --- | --- |
| Bun 1.3+ | CLI and generated projects | `bun --version` |
| `.qiy` source | All generation commands | `.qiy` is the only public input format |
| Empty output directory | `create`/`generate` without `--sync` | Otherwise `Output directory must be empty` |
| `packageManager: bun@...` | `init` | Hard requirement in the target root |
| `DATABASE_URL` | Real server runtime and migrations | Preview does not need it |
| `QIY_DEV_MODE=1` | Local server without auth | Never in production |
| `QIY_AUTH_SECRET` (>= 32 chars) | Local/hybrid/OTP/API-key auth | Production startup check |
| `QIY_STORAGE_METADATA=database` | Production storage | Startup check |
| `HTTPS_PROXY` / `HTTP_PROXY` | Restricted networks | Bun `fetch` for IdP token endpoints |
| Docker (optional) | Multi-platform executables, acceptance scripts | `bun run build:exe -- --all` |

`.env` files are generated per mode; `--sync` merges new variables while preserving existing values and user-added entries. Never commit real secrets; the `example` files are placeholders.

## Upgrade and sync

- The CLI version and the skill bundle are released together. After upgrading the binary, run `qiy skill install --force` to refresh official skill files.
- `.qiy-generated.json` records `schemaVersion: 1` and the generating `qiyVersion`. A manifest schema change makes an old `--sync` fail explicitly instead of guessing.
- The DSL has no forward compatibility: unknown constructs/annotations fail. After an upgrade, regenerate with `qiy generate ... --sync` or `qiy init --sync` and review every generated migration before applying it.
- `--sync` rewrites only manifest-registered files and deletes registered files the model no longer generates. Files outside the manifest (including `apps/web/app/extensions/` and `apps/server/src/extensions/`) are preserved.
- Do not hand-edit manifest-owned files and expect merges. Put long-lived custom behavior in unowned extensions, hooks, plugins or host adapters.
- Sync can fail on local edits to official skill files only for `qiy skill install`; project sync is unaffected by that check.

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `qiy is not recognized` / command not found | Executable not on `PATH` | Add its directory, reopen the terminal, run `qiy --version` |
| `Output directory must be empty` | Target has files and no `--sync` | Use a new directory, or `--sync` on a Qiy-generated workspace |
| `qiy init requires packageManager to declare Bun` | Host root has no Bun declaration | Add `"packageManager": "bun@<version>"`, run `bun install` |
| `Refusing to overwrite existing host file` | Alias collides with a host path/script | Change `workspace.aliases`; do not delete host files to force generation |
| `Unknown command: dev` | Generated projects use Bun scripts | `bun run dev` / `bun run preview` inside the workspace |
| Include error or cycle | Wrong relative path or a cycle | Fix the path relative to the including file; remove the cycle |
| Port already in use | Another local server | Stop it or set `PORT` |
| Build passes but API/auth is not connected | Build only compiles | Configure the real database/IdP and implement adapters |
| `Qiy skill has local changes` | Official skill files were edited | Re-run with `--force` (unrelated files are preserved) |
| Doctor exits 1 | Runtime/template/package-manager problem | Read the report (or `--json`), fix Bun or the workspace |

## Related references

- [Workspace integration](workspace-integration.md) - aliases, integration mode, host adapters
- [Modeling and generation](modeling-and-generation.md) - model syntax and includes
- [Testing and deployment](testing-deployment.md) - scripts, migrations, acceptance
- [Language reference](language-reference.md) - every block and setting
- [Troubleshooting](troubleshooting.md) - cross-area errors

## Canonical docs

- [CLI and release](https://ai-nodev.github.io/qiy/guide/cli)
- [Getting started](https://ai-nodev.github.io/qiy/guide/getting-started)
- [Existing Bun project](https://ai-nodev.github.io/qiy/guide/existing-bun-project)
- [Project structure](https://ai-nodev.github.io/qiy/guide/project-structure)

# CLI reference

Qiy exposes all functionality through one `qiy` CLI. Inside a project it finds the root by walking up to `qiy.project.json`.

## Project commands

```bash
qiy create project <name> [--template minimal|standard] [--dir <path>]
qiy check
qiy diff [--check] [--json]
qiy generate [--incremental]
qiy dev [--watch]
qiy test
qiy build
qiy preview
qiy add entity <name> [--field name:Type ...]
qiy add field <entity> <name:Type> [--nullable] [--unique] [--code <template>]
qiy add module <name> [--kind entities|ui|permissions|dataflows|messages]
qiy add feature <overview|apiDocs|apiKeys>
qiy fmt [--check] [files...]
```

| Command | Behavior |
| --- | --- |
| `qiy create project shop` | Create a modular project; does not generate `admin/` |
| `qiy check` | Parse/validate the model without writing |
| `qiy diff` | Render in memory and list added/changed/removed generated files; `--check` exits 1 on drift |
| `qiy generate` | Generate or sync `admin/`; `--incremental` writes only changed files |
| `qiy dev` | Generate, install on first run, migrate, start API + admin; `--watch` regenerates on model saves |
| `qiy test` / `qiy build` | Run generated workspace scripts |
| `qiy preview` | Loopback-only in-memory preview; not a deployment target |
| `qiy fmt` | Normalize `.qiy` whitespace without changing declarations, comments, includes or order |

## Inspect the model

```bash
qiy explain app.qiy            # human-readable normalized summary
qiy explain app.qiy --json     # machine-readable; includes stable error codes/fixes
qiy schema                     # JSON Schema for explain --json
qiy explain --errors           # stable error-code catalog (QIY1001–QIY1016)
```

## Legacy explicit generation

```bash
qiy generate model.qiy out/admin [--sync]
qiy create -f model.qiy -n my-app -o out/admin
qiy init -f model.qiy [--sync]
```

`--sync` only applies to a workspace Qiy generated (it follows `.qiy-generated.json`); never point it at an arbitrary repository.

## Agent skills

```bash
qiy skill install [name] [--all] [--force] [--global] [--dir <path>]
qiy skill list [--all] [--json]
qiy skill update [name] [--force]
qiy skill uninstall [name]
```

Bundled skills: `qiy`, `refine-dev`, `bun`, `drizzle`, `elysia`. `--all` installs all five.

## Release process

Releases are tag-driven: push an immutable annotated `vX.Y.Z` tag. CI runs a dry-run acceptance matrix (5 platforms), publishes binaries and runs release-smoke. See the Chinese CLI guide for the full release checklist.

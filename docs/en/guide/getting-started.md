# Getting started

Qiy turns one `.qiy` model into a Refine + React Router admin, a Bun + Elysia API, a Drizzle database layer, tests and deployment files.

## Requirements

- Bun **1.3+**
- Node.js only if your editor requires it; Qiy itself runs on Bun
- SQLite is the default database; PostgreSQL/MySQL are supported

## Install

```bash
# macOS / Linux
curl -fsSL https://github.com/AI-NoDev/qiy/releases/latest/download/install.sh | sh

# Windows (PowerShell)
irm https://github.com/AI-NoDev/qiy/releases/latest/download/install.ps1 | iex

# or run the package directly
bunx qiy --version
```

Verify the CLI and environment:

```bash
qiy --version
qiy doctor
```

## Create a project

```bash
qiy create project shop
cd shop
qiy dev
```

`qiy create project` writes a standard modular project:

```text
shop/
  qiy.project.json
  model/
    app.qiy
    modules/
      10-catalog.qiy
      20-relations.qiy
      30-ui.qiy
  admin/            # generated after qiy dev/generate
```

`qiy dev` generates `admin/`, installs dependencies on the first run, applies the SQLite schema and starts the API (`:3000`) and admin (`:5173`). Use `qiy dev --watch` to regenerate on model saves.

## Edit the model

```qiy
entity products {
  field id UUID @id;
  field name Text;
  field price Decimal(12, 2) @nullable;
}
```

Then check / regenerate / preview:

```bash
qiy check
qiy generate
qiy diff            # preview generated changes without writing
qiy fmt --check
```

`qiy add entity` / `qiy add field` can make small changes for you:

```bash
qiy add entity suppliers --field name:Text
qiy add field suppliers phone:Text --nullable
```

## Test and build

```bash
qiy test
qiy build
qiy preview      # loopback-only in-memory preview; not a deployment target
```

## Next steps

- [CLI reference](/en/guide/cli)
- [v1 friendly syntax](/guide/syntax-v1)
- [DSL overview](/dsl/overview)
- [Agent Skill](/guide/agent-skill)

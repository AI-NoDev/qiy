# Development

Run `bun install` at the workspace root. Available generated package commands:

### apps/server (qiy-generated-api)

- `dev`: `bun --env-file=.env.development --watch src/server.ts`
- `start`: `bun --env-file=.env.production src/server.ts`
- `preview`: `bun --env-file=.env.development src/preview.ts`
- `test`: `bun test --preload ./tests/setup.ts`
- `typecheck`: `tsc --noEmit`
- `db:generate`: `bun --env-file=.env.development run drizzle-kit generate`
- `db:migrate`: `bun --env-file=.env.development src/db-migrate.ts`
- `db:migrate:production`: `bun --env-file=.env.production src/db-migrate.ts`
- `attachments:cleanup`: `bun src/storage/cleanup.ts`
- `attachments:orphans`: `bun src/storage/orphans.ts`
- `db:rollback`: `bun --env-file=.env.production src/db-rollback.ts`
- `db:backup`: `bun --env-file=.env.production src/db-backup.ts`
- `db:restore`: `bun --env-file=.env.production src/db-restore.ts`
- `db:check`: `bun --env-file=.env.development src/db-check.ts`
- `realtime:admin`: `bun --env-file=.env.production src/realtime-admin.ts`

### apps/web (qiy-generated-web)

- `dev`: `react-router dev`
- `build`: `node build.mjs`
- `typecheck`: `react-router typegen && tsc --noEmit`
- `test`: `bun test`

## Regeneration

Run `qiy generate <model.qiy> <workspace-directory> --sync` from the directory containing the model.

The manifest records generated files. Regeneration can replace owned code and documentation. Handwritten Web extensions and host adapters are preserved; keep custom documentation in separate files. Existing AGENTS.md and AGENT.MD are preserved. Check generated environment placeholders without copying production secrets into source control. Review database migrations before applying them.

## AI skill

Run `qiy skill install` from the workspace root to install the official skill, references and complete example into `.agent/skills/qiy/`. Reinstallation refuses changed official files unless `--force` is supplied. Unrelated skills are preserved.

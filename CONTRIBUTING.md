# Contributing to Qiy

## Development checks

```bash
bun install --frozen-lockfile
bun run check
bun run lint
bun test
bun run docs:build
bun run e2e
bun run e2e:generated
```

- Generated-app E2E needs Playwright browsers (`bunx playwright install chromium`).
- Set `TEMP`/`TMP` to a workspace directory on Windows if esbuild or turbo hits sandbox `EPERM`.
- Use `bun run template:build` after editing `templates/admin/`; generated files come from `tools/admin-template.data.ts`.
- Use `bun run skill:build` after editing `.agents/skills/qiy/`; the CLI bundles `tools/qiy-skill.data.ts`.

## Internal verification

Maintainer-only scripts and real-service acceptance live in [MAINTAINER_VERIFICATION.md](MAINTAINER_VERIFICATION.md). They are intentionally outside the user documentation site.

## Release

Follow [RELEASING.md](RELEASING.md): dry-run the full matrix, tag immutably, publish, then wait for `Verify released Qiy CLI`.

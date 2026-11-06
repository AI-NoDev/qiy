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
bun run e2e:visual
```

- Generated-app E2E needs Playwright browsers (`bunx playwright install chromium`).
- `e2e:visual` needs Docker: pixel baselines are rendered by the pinned `mcr.microsoft.com/playwright` image so every host compares the same font stack. Update them with `bun run e2e:visual --update-snapshots`.
- Generated app tests keep scratch files next to the tests instead of the OS temp directory, so the generated root `bun run test` works in sandboxes that deny `%TEMP%`; `tests/generated-temp-dirs.test.ts` guards this. Repository-only `tools/verify-*.ts` scripts still use the OS temp directory.
- Use `bun run template:build` after editing `templates/admin/`; generated files come from `tools/admin-template.data.ts`.
- Use `bun run skill:build` after editing `.agents/skills/qiy/`; the CLI bundles `tools/qiy-skill.data.ts`.

## Internal verification

Maintainer-only scripts and real-service acceptance live in [MAINTAINER_VERIFICATION.md](MAINTAINER_VERIFICATION.md). They are intentionally outside the user documentation site.

## Release

Follow [RELEASING.md](RELEASING.md): dry-run the full matrix, tag immutably, publish, then wait for `Verify released Qiy CLI`.

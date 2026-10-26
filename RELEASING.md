# Releasing Qiy

Tags are immutable. Once a `v*` tag is pushed it is published as-is; if a blocker
is found afterwards, ship a patch release instead of moving the tag.

## 1. Prepare the version

1. Bump `version` in `package.json` (semver).
2. Add a `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md`. This section becomes
   the GitHub Release body via `tools/release-notes.ts`; keep it user-facing.
3. Bump `metadata.version` in `.agents/skills/qiy/SKILL.md` to the same version
   (`bun test` enforces the match).
4. If the embedded template changed, run `bun run template:build`; if the skill
   changed, run `bun run skill:build`. Commit the generated `tools/*.data.ts`.
5. Run locally:

   ```bash
   bun run check
   bun test
   bun run docs:build
   ```

## 2. Run the acceptance gate

From the commit that should be released, dispatch the release workflow with
`dry_run: true`. It executes the same matrix as a real release:

- `bun run check`, `bun test`, `bun run docs:build`
- template refresh and all five platform executables
- standalone and integration acceptance on linux-x64, linux-arm64,
  darwin-x64, darwin-arm64 and windows-x64
- no GitHub release or tag is created

```bash
gh workflow run "Release Qiy CLI" --ref main -f dry_run=true
gh run watch --workflow "Release Qiy CLI"
```

Only continue when it is green. The `dry_run` run is the pre-release gate; do
not create the tag before it passes.

## 3. Tag the accepted commit

```bash
git tag -a vX.Y.Z -m "Qiy X.Y.Z"
git push origin vX.Y.Z
```

The tag push triggers **Release Qiy CLI**, which rebuilds and verifies the five
executables, then creates the GitHub Release with the `CHANGELOG.md` section.
Do **not** push a version bump to `main` as the release trigger anymore; tagging
is the release action. (A `package.json` push can still start a release for
backward compatibility, but tag-driven is preferred.)

## 4. Verify the release

```bash
gh release view vX.Y.Z
gh run list --workflow "Verify released Qiy CLI" --limit 1
```

`Verify released Qiy CLI` downloads the published assets and runs them on every
platform. A green release smoke is required before announcing.

## Hotfixes

1. Fix on `main`, add a CHANGELOG section for the patch version, bump
   `package.json` and the skill metadata.
2. Run pre-release acceptance again.
3. Tag `vX.Y.(Z+1)` and push. Never delete or re-point an existing release tag.

## Related workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `CI` | every PR and `main` push | check, test, docs assets + docs build |
| `Release Qiy CLI` | `v*` tag, manual `dry_run=true` | build, verify, publish; dry run is the pre-release gate |
| `Verify released Qiy CLI` | release published | run published binaries |
| `Deploy documentation` | docs/package changes on main | GitHub Pages |
| `Verify generated database Dataflow` | generator/dataflow changes | PostgreSQL + MySQL smoke |
| `Publish editor plugins` | `v*` tag | VS Code + JetBrains packages |

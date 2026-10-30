import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "../tools/commands/generate-app";
import { diffProject, formatProjectDiff, generateProject } from "../tools/commands/project";
import { createQiyProject, requireQiyProject } from "../tools/project";

async function fixture(): Promise<{ root: string; output: string }> {
  const root = mkdtempSync(join(tmpdir(), "qiy-diff-"));
  const created = createQiyProject("diff-app", { cwd: root, template: "minimal" });
  const project = requireQiyProject(created.root);
  await generateApp(project.modelPath, project.outputPath, { sync: true });
  return { root: created.root, output: project.outputPath };
}

test("reports no differences for a freshly generated project", async () => {
  const { root } = await fixture();
  const diff = await diffProject(root);
  expect(diff.added).toEqual([]);
  expect(diff.changed).toEqual([]);
  expect(diff.removed).toEqual([]);
  expect(diff.unchanged).toBeGreaterThan(100);
  expect(formatProjectDiff(diff, diff.output)).toContain("No differences");
});

test("incremental generation leaves unchanged files untouched and repairs drift", async () => {
  const { root, output } = await fixture();
  const target = join(output, "apps/server/package.json");
  const old = new Date("2020-01-01T00:00:00Z");
  utimesSync(target, old, old);
  await generateProject(root, { incremental: true });
  expect(statSync(target).mtimeMs).toBe(old.getTime());

  writeFileSync(target, "// drift\n");
  await generateProject(root, { incremental: true });
  expect(readFileSync(target, "utf8")).not.toContain("// drift");
});

test("detects added, changed and removed generated files", async () => {
  const { root, output } = await fixture();
  const manifestPath = join(output, ".qiy-generated.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: string[] };
  const generatedTs = manifest.files.filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"));
  const changedPath = generatedTs[0]!;
  const removedPath = generatedTs[1]!;
  writeFileSync(join(output, changedPath), "// local drift\n");
  rmSync(join(output, removedPath), { force: true });
  writeFileSync(join(output, "apps/web/app/generated-but-stale.ts"), "stale\n");
  manifest.files.push("apps/web/app/generated-but-stale.ts");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const diff = await diffProject(root);
  expect(diff.changed).toContain(changedPath);
  expect(diff.removed).toContain("apps/web/app/generated-but-stale.ts");
  expect(diff.added).toContain(removedPath);
  const text = formatProjectDiff(diff, diff.output);
  expect(text).toContain(`~ ${changedPath}`);
  expect(text).toContain("- apps/web/app/generated-but-stale.ts");
  expect(text).toContain(`+ ${removedPath}`);
});

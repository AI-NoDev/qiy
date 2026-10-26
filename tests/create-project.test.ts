import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkProject, generateProject } from "../tools/commands/project";
import { explainQiyFile } from "../tools/commands/explain";
import { createQiyProject, findQiyProjectRoot, readQiyProject, requireQiyProject } from "../tools/project";

const root = resolve(import.meta.dir, "..");

test("scaffolds a modular project with manifest, entry model and modules", () => {
  const cwd = mkdtempSync(join(tmpdir(), "qiy-project-create-"));
  const created = createQiyProject("inventory-admin", { cwd });
  expect(created.root).toBe(join(cwd, "inventory-admin"));
  for (const file of [
    "qiy.project.json",
    "README.md",
    "model/app.qiy",
    "model/modules/10-catalog.qiy",
    "model/modules/20-relations.qiy",
    "model/modules/30-ui.qiy",
    "model/modules/40-permissions.qiy",
    "model/modules/50-dataflows.qiy",
    "model/modules/60-messages.qiy",
  ]) expect(existsSync(join(created.root, file)), file).toBe(true);
  const manifest = JSON.parse(readFileSync(join(created.root, "qiy.project.json"), "utf8")) as { name: string; model: string; output: string; template: string };
  expect(manifest).toMatchObject({ name: "inventory-admin", model: "model/app.qiy", output: "admin", template: "standard" });
  expect(readFileSync(join(created.root, "model/app.qiy"), "utf8")).toContain('include "modules/10-catalog.qiy"');
  expect(existsSync(join(created.root, "admin"))).toBe(false);

  expect(findQiyProjectRoot(join(created.root, "model"))).toBe(created.root);
  expect(readQiyProject(created.root).manifest.name).toBe("inventory-admin");
  expect(requireQiyProject(join(created.root, "model/modules")).root).toBe(created.root);
});

test("minimal template only includes the catalog module", () => {
  const cwd = mkdtempSync(join(tmpdir(), "qiy-project-minimal-"));
  const created = createQiyProject("tiny", { cwd, template: "minimal" });
  expect(existsSync(join(created.root, "model/modules/20-relations.qiy"))).toBe(false);
  expect(readFileSync(join(created.root, "model/app.qiy"), "utf8")).not.toContain("20-relations");
});

test("rejects invalid names and non-empty targets", () => {
  const cwd = mkdtempSync(join(tmpdir(), "qiy-project-invalid-"));
  expect(() => createQiyProject("Invalid Name", { cwd })).toThrow(/Invalid project name/);
  createQiyProject("taken", { cwd });
  expect(() => createQiyProject("taken", { cwd })).toThrow(/not empty/);
});

test("check and generate work inside a scaffolded project", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "qiy-project-workflow-"));
  createQiyProject("shop", { cwd });
  const projectRoot = join(cwd, "shop");
  await checkProject(projectRoot);
  await generateProject(projectRoot);
  expect(existsSync(join(projectRoot, "admin/.qiy-generated.json"))).toBe(true);
  const generated = readFileSync(join(projectRoot, "admin/apps/web/app/features.ts"), "utf8");
  expect(generated.length).toBeGreaterThan(0);
});

test("explain supports modular includes", async () => {
  const explanation = await explainQiyFile(join(root, "examples/self/app.qiy"));
  expect(explanation.counts.entities).toBeGreaterThan(5);
  expect(explanation.counts.relations).toBeGreaterThan(0);
  expect(explanation.counts.charts).toBeGreaterThan(0);
});

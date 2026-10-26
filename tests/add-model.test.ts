import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addEntity, addFeature, addField, addModule } from "../tools/commands/add";
import { explainQiyFile } from "../tools/commands/explain";
import { createQiyProject, readQiyProject } from "../tools/project";

function projectFixture(prefix: string): { cwd: string; root: string } {
  const parent = mkdtempSync(join(tmpdir(), prefix));
  createQiyProject("add-demo", { cwd: parent });
  const root = join(parent, "add-demo");
  return { cwd: root, root };
}

test("addEntity appends a valid entity with fields and annotations", async () => {
  const { cwd, root } = projectFixture("qiy-add-entity-");
  await addEntity("suppliers", {
    cwd,
    fields: ["name:Text", "email:Text", "rating:Integer"],
    label: "Suppliers",
    icon: "ShopOutlined",
  });
  const project = readQiyProject(root);
  const source = readFileSync(join(root, "model/modules/10-catalog.qiy"), "utf8");
  expect(source).toContain('entity suppliers @label("Suppliers") @icon(ShopOutlined) {');
  expect(source).toContain("field name Text;");
  expect(source).toContain("field email Text;");
  expect(source).toContain("field rating Integer;");
  const explanation = await explainQiyFile(project.modelPath);
  expect(explanation.entities.some((entity) => entity.name === "suppliers")).toBe(true);
});

test("duplicate entities and invalid field specs are rejected", async () => {
  const { cwd, root } = projectFixture("qiy-add-invalid-");
  await addEntity("suppliers", { cwd, fields: ["name:Text"] });
  await expect(addEntity("suppliers", { cwd })).rejects.toThrow(/already exists/);
  const before = readFileSync(join(root, "model/modules/10-catalog.qiy"), "utf8");
  await expect(addEntity("Bad Name", { cwd })).rejects.toThrow(/Invalid entity name/);
  await expect(addEntity("returns", { cwd, fields: ["name:Not A Type"] })).rejects.toThrow(/Invalid field type/);
  expect(readFileSync(join(root, "model/modules/10-catalog.qiy"), "utf8")).toBe(before);
});

test("addField inserts a field before the entity closing brace", async () => {
  const { cwd, root } = projectFixture("qiy-add-field-");
  await addEntity("suppliers", { cwd, fields: ["name:Text"] });
  await addField("suppliers", "phone:Text", { cwd, nullable: true });
  await addField("suppliers", "externalId:UUID", { cwd, unique: true });
  const source = readFileSync(join(root, "model/modules/10-catalog.qiy"), "utf8");
  expect(source).toContain("field phone Text @nullable;");
  expect(source).toContain("field externalId UUID @unique;");
  const explanation = await explainQiyFile(readQiyProject(root).modelPath);
  const suppliers = explanation.entities.find((entity) => entity.name === "suppliers");
  expect(suppliers?.fields.map((field) => field.name)).toEqual(["id", "name", "phone", "externalId"]);
});

test("addField rejects unknown entities", async () => {
  const { cwd } = projectFixture("qiy-add-missing-");
  await expect(addField("missing", "name:Text", { cwd })).rejects.toThrow(/not found/);
});

test("addModule creates a fragment and wires its include in order", async () => {
  const { cwd, root } = projectFixture("qiy-add-module-");
  await addModule("sales", { cwd });
  const project = readQiyProject(root);
  const app = readFileSync(project.modelPath, "utf8");
  expect(app).toContain('include "modules/70-sales.qiy";');
  expect(app.indexOf('include "modules/70-sales.qiy";')).toBeLessThan(app.indexOf('include "modules/20-relations.qiy";'));
  expect(readFileSync(join(root, "model/modules/70-sales.qiy"), "utf8")).toContain("sales module");
  await expect(explainQiyFile(project.modelPath)).resolves.toBeDefined();

  await addModule("messages", { cwd, kind: "messages" });
  expect(readFileSync(project.modelPath, "utf8").indexOf('include "modules/80-messages.qiy";')).toBeLessThan(
    readFileSync(project.modelPath, "utf8").indexOf('include "modules/70-sales.qiy";'),
  );
});

test("addFeature enables overview and rolls back apiKeys without auth", async () => {
  const { cwd, root } = projectFixture("qiy-add-feature-");
  await addFeature("overview", { cwd });
  const app = readFileSync(join(root, "model", "app".concat(".qiy")), "utf8");
  expect(app).toContain("features {");
  expect(app).toContain("overview true;");
  const before = app;
  await expect(addFeature("apiKeys", { cwd })).rejects.toThrow(/auth/i);
  expect(readFileSync(join(root, "model/app.qiy"), "utf8")).toBe(before);
});

test("CLI add entity and add field work inside a project", () => {
  const { cwd, root } = projectFixture("qiy-add-cli-");
  const cli = resolve(import.meta.dir, "../tools/cli.ts");
  const entity = Bun.spawnSync([process.execPath, "run", cli, "add", "entity", "warehouses", "--field", "name:Text", "--label", "Warehouses"], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(entity.exitCode, entity.stderr.toString()).toBe(0);
  expect(entity.stdout.toString()).toContain("Added entity warehouses");
  const field = Bun.spawnSync([process.execPath, "run", cli, "add", "field", "warehouses", "code:Text", "--unique"], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(field.exitCode, field.stderr.toString()).toBe(0);
  const source = readFileSync(join(root, "model/modules/10-catalog.qiy"), "utf8");
  expect(source).toContain("entity warehouses");
  expect(source).toContain("field code Text @unique;");
});

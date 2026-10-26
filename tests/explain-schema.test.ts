import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { explainQiySource } from "../tools/commands/explain";
import { QIY_EXPLANATION_FORMAT_VERSION, qiyExplanationSchema } from "../tools/qiy-schema";

const model = `qiy v0;
application demo {
  database sqlite {}
  entity products {
    field id UUID @id;
    field sku Text @unique @code("SKU-{seq:4}");
    field title Text;
  }
  entity orders {
    field id UUID @id;
    field productId UUID;
    field quantity Integer;
  }
  relation orderProduct orders productId products id one;
}`;

test("explains entities, generated fields and relations", () => {
  const explanation = explainQiySource(model, "model.qiy");
  expect(explanation.formatVersion).toBe(QIY_EXPLANATION_FORMAT_VERSION);
  expect(explanation.application).toMatchObject({ name: "demo", mode: "standalone", database: "sqlite" });
  expect(explanation.counts).toMatchObject({ entities: 2, fields: 6, relations: 1, permissionFields: 0, permissionGroups: 0, charts: 0 });
  expect(explanation.entities[0]!.fields.find((field) => field.name === "sku")).toMatchObject({
    generated: "code",
    codeTemplate: "SKU-{seq:4}",
    unique: true,
  });
  expect(explanation.relations[0]).toMatchObject({ name: "orderProduct", from: "orders", to: "products", cardinality: "one" });
});

test("schema is valid JSON Schema for the explanation shape", () => {
  const schema = qiyExplanationSchema as unknown as Record<string, unknown>;
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(schema.$id).toContain("qiy-explanation-1.json");
  expect(schema.type).toBe("object");
  const required = schema.required as string[];
  for (const key of ["formatVersion", "application", "entities", "permissions", "counts"]) expect(required).toContain(key);
  const defs = schema.$defs as Record<string, unknown>;
  expect(Object.keys(defs)).toEqual(expect.arrayContaining(["entity", "relation", "dataflow", "action", "chart"]));
  expect(JSON.parse(JSON.stringify(schema))).toMatchObject({ properties: { formatVersion: { const: 1 } } });
});

test("CLI explain --json and schema outputs are machine readable", () => {
  const cli = resolve(import.meta.dir, "../tools/cli.ts");
  const explain = Bun.spawnSync([process.execPath, "run", cli, "explain", "examples/catalog/app.qiy", "--json"], {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(explain.exitCode).toBe(0);
  const output = JSON.parse(explain.stdout.toString()) as { valid: boolean; formatVersion: number; entities: unknown[] };
  expect(output.valid).toBe(true);
  expect(output.formatVersion).toBe(QIY_EXPLANATION_FORMAT_VERSION);
  expect(output.entities.length).toBeGreaterThan(0);

  const schema = Bun.spawnSync([process.execPath, "run", cli, "schema"], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
  expect(schema.exitCode).toBe(0);
  expect(JSON.parse(schema.stdout.toString())).toMatchObject({ $id: "https://ai-nodev.github.io/qiy/schema/qiy-explanation-1.json" });
});

test("CLI explain --json reports parse errors without a stack trace", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-explain-"));
  const file = join(root, "broken.qiy");
  writeFileSync(file, "qiy v0;\napplication broken {\n  entity x { field id UUID @id; }\n}\n");
  const cli = resolve(import.meta.dir, "../tools/cli.ts");
  const result = Bun.spawnSync([process.execPath, "run", cli, "explain", file, "--json"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(1);
  const output = JSON.parse(result.stdout.toString()) as { valid: boolean; error: string; code?: string; fix?: string };
  expect(output.valid).toBe(false);
  expect(output.error.length).toBeGreaterThan(10);
  expect(output.code).toMatch(/^QIY10\d\d$/);
  expect(output.fix).toBeDefined();
});

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { formatQiyFiles, formatQiySource } from "../tools/format";
import { createQiyProject, readQiyProject } from "../tools/project";

const messy = `qiy v0;
application demo {
database sqlite {}
entity products {
field id UUID @id;
    field name Text @comment("# a brace { in a string");
   }
}
`;

test("formatQiySource normalizes indentation and is idempotent", () => {
  const formatted = formatQiySource(messy);
  expect(formatted).toContain('application demo {\n  database sqlite {}\n  entity products {\n    field id UUID @id;\n    field name Text @comment("# a brace { in a string");\n  }\n}\n');
  expect(formatQiySource(formatted)).toBe(formatted);
  expect(formatted.endsWith("\n")).toBe(true);
  expect(formatted).not.toMatch(/[ \t]+\n/);
});

test("formatQiyFiles formats project model files and check mode reports without writing", () => {
  const parent = mkdtempSync(join(tmpdir(), "qiy-fmt-"));
  createQiyProject("fmt-me", { cwd: parent });
  const root = join(parent, "fmt-me");
  const project = readQiyProject(root);
  const catalog = join(root, "model/modules/10-catalog.qiy");
  const original = readFileSync(catalog, "utf8");
  writeFileSync(catalog, original.replace(/^ {2}/gm, ""));

  const check = formatQiyFiles({ cwd: root, check: true });
  expect(check.changed).toContain("model/modules/10-catalog.qiy");
  expect(readFileSync(catalog, "utf8")).not.toBe(original);

  const format = formatQiyFiles({ cwd: root });
  expect(format.changed).toContain("model/modules/10-catalog.qiy");
  expect(readFileSync(catalog, "utf8")).toBe(original);
  expect(formatQiyFiles({ cwd: root }).changed).toEqual([]);
  expect(project.manifest.name).toBe("fmt-me");
});

test("formatQiyFiles accepts explicit files and rejects non-.qiy paths", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-fmt-files-"));
  const file = join(root, "fragment.qiy");
  writeFileSync(file, "entity x {\n   field id UUID @id;\n}\n");
  const result = formatQiyFiles({ cwd: root, files: ["fragment.qiy"] });
  expect(result.changed).toEqual(["fragment.qiy"]);
  expect(readFileSync(file, "utf8")).toBe("entity x {\n  field id UUID @id;\n}\n");
  writeFileSync(join(root, "not-qiy.txt"), "x");
  expect(() => formatQiyFiles({ cwd: root, files: ["not-qiy.txt"] })).toThrow(/only formats/);
});

test("CLI fmt --check exits 1 for unformatted files and 0 after formatting", () => {
  const parent = mkdtempSync(join(tmpdir(), "qiy-fmt-cli-"));
  createQiyProject("cli-fmt", { cwd: parent });
  const root = join(parent, "cli-fmt");
  const catalog = join(root, "model/modules/10-catalog.qiy");
  writeFileSync(catalog, readFileSync(catalog, "utf8").replace(/^ {2}/gm, ""));
  const cli = resolve(import.meta.dir, "../tools/cli.ts");
  const check = Bun.spawnSync([process.execPath, "run", cli, "fmt", "--check"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(check.exitCode).toBe(1);
  const write = Bun.spawnSync([process.execPath, "run", cli, "fmt"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(write.exitCode).toBe(0);
  const pass = Bun.spawnSync([process.execPath, "run", cli, "fmt", "--check"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(pass.exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findQiyError, formatQiyError, qiyErrorCatalog } from "../tools/error-catalog";

const root = resolve(import.meta.dir, "..");

test("catalog codes are unique, stable and documented", () => {
  expect(qiyErrorCatalog.length).toBeGreaterThanOrEqual(16);
  const codes = qiyErrorCatalog.map((entry) => entry.code);
  expect(new Set(codes).size).toBe(codes.length);
  for (const entry of qiyErrorCatalog) {
    expect(entry.code).toMatch(/^QIY10\d\d$/);
    expect(entry.title.length).toBeGreaterThan(3);
    expect(entry.fix.length).toBeGreaterThan(20);
    expect(entry.docs).toContain(`#${entry.code.toLowerCase()}`);
  }
  const docs = readFileSync(resolve(root, "docs/dsl/errors.md"), "utf8");
  for (const code of codes) expect(docs).toContain(code);
});

test("known messages map to the expected error code", () => {
  const cases: Array<[string, string]> = [
    ["Permission declarations require a generated auth block", "QIY1004"],
    ["Chart ProductTotals bar view: group by field status must be an enum field", "QIY1007"],
    ["Data scope claim tenant.id needs a matching field on users (expected tenantId)", "QIY1009"],
    ["Invalid Ant Design icon Foo", "QIY1013"],
    ["Qiy skill has local changes. Use qiy skill install --force", "QIY1014"],
    ["Expected } near token 12", "QIY1003"],
    ["test: duplicate @label annotation", "QIY1002"],
    ["features apiKeys requires an auth block", "QIY1012"],
  ];
  for (const [message, code] of cases) expect(findQiyError(message)?.code).toBe(code);
  expect(findQiyError("completely unrelated failure")).toBeUndefined();
});

test("formatQiyError adds code, fix and docs link", () => {
  const formatted = formatQiyError("Permission declarations require a generated auth block");
  expect(formatted).toContain("[QIY1004]");
  expect(formatted).toContain("Fix:");
  expect(formatted).toContain("#qiy1004");
  expect(formatQiyError("unrelated")).toBe("unrelated");
});

test("CLI exposes the catalog and attaches codes to explain failures", () => {
  const cli = resolve(root, "tools/cli.ts");
  const catalog = Bun.spawnSync([process.execPath, "run", cli, "explain", "--errors", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(catalog.exitCode).toBe(0);
  const rows = JSON.parse(catalog.stdout.toString()) as Array<{ code: string; fix: string }>;
  expect(rows.map((row) => row.code)).toEqual(qiyErrorCatalog.map((entry) => entry.code));

  const human = Bun.spawnSync([process.execPath, "run", cli, "explain", "--errors"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(human.exitCode).toBe(0);
  expect(human.stdout.toString()).toContain("QIY1004");
  expect(human.stdout.toString()).toContain("https://ai-nodev.github.io/qiy/dsl/errors");
});

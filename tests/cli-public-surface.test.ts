import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "../tools/commands/generate-app";

test("publishes only .qiy as an application generation input", async () => {
  const output = mkdtempSync(join(tmpdir(), "qiy-public-input-"));
  try {
    await expect(generateApp("model.mps", join(output, "mps"))).rejects.toThrow("only accepts .qiy source files");
    await expect(generateApp("model.json", join(output, "json"))).rejects.toThrow("only accepts .qiy source files");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("keeps MPS maintenance commands out of the public CLI", () => {
  const result = Bun.spawnSync([process.execPath, "run", "tools/cli.ts", "--help"], { cwd: process.cwd() });
  expect(result.exitCode).toBe(0);
  const help = result.stdout.toString();
  expect(help).toContain(".qiy project with optional relative include fragments");
  expect(help).not.toContain(".mps model");
  expect(help).not.toContain("Database IR .json");
  expect(help).not.toContain("export-qiy");
  expect(help).not.toContain("export-ir");
  expect(help).not.toContain("validate <model.mps>");
  expect(help).not.toContain("languages/qiy/models");
});

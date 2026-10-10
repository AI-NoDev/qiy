import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("MPS preflight validates generation contracts and reports all failed inputs", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-preflight-"));
  try {
    const source = await Bun.file("languages/qiy.sandbox/models/qiy.catalog.mps").text();
    const invalid = join(root, "invalid.mps");
    await Bun.write(invalid, source.replace('value="1536"', 'value="2001"'));
    const missing = join(root, "missing.mps");
    const result = Bun.spawnSync([process.execPath, "run", resolve("tools/check-mps.ts"), invalid, missing, "languages/qiy.sandbox/models/qiy.catalog.mps"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("vector dimension cannot exceed 2000");
    expect(result.stderr.toString()).toContain("missing.mps");
    expect(result.stdout.toString()).toContain("Validated MPS generation input: languages/qiy.sandbox/models/qiy.catalog.mps");
    const valid = Bun.spawnSync([process.execPath, "run", resolve("tools/check-mps.ts"), "languages/qiy.sandbox/models/qiy.catalog.mps", "languages/qiy.sandbox/models/qiy.relations.mps", "languages/qiy.sandbox/models/qiy.erpworkflow.mps"]);
    expect(valid.exitCode).toBe(0);
    expect(valid.stdout.toString().match(/Validated MPS generation input/g)).toHaveLength(3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

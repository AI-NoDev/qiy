import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generatedPath, manifestFiles } from "../tools/generated-paths";

test("generated paths reject traversal, aliases, and malformed manifests", () => {
  for (const path of ["../outside", "/outside", "C:/outside", "a/../outside", "a\\outside", "a//b", "a/./b", "a./b", "a /b", "a\0b", ""]) {
    expect(() => generatedPath("tmp/admin", path)).toThrow("Invalid generated file path");
  }
  for (const manifest of [null, {}, { files: "a" }, { files: [42] }]) {
    expect(() => manifestFiles(manifest)).toThrow("Invalid Qiy generated-file manifest");
  }
});

test("generated paths reject directory links and non-file targets", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-paths-"));
  try {
    mkdirSync(join(root, "outside"));
    mkdirSync(join(root, "admin"));
    symlinkSync(join(root, "outside"), join(root, "admin", "linked"), "junction");
    expect(() => generatedPath(join(root, "admin"), "linked/file.ts")).toThrow("symbolic link");
    expect(() => generatedPath(root, "outside")).toThrow("not a regular file");
    writeFileSync(join(root, "file"), "contents");
    expect(() => generatedPath(root, "file/child.ts")).toThrow("parent is not a directory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sync preflights the entire manifest before deleting or replacing files", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-sync-"));
  const output = join(root, "admin");
  const run = () => Bun.spawnSync([process.execPath, "run", resolve("tools/generate-app.ts"), resolve("examples/catalog/app.qiy"), output, "--sync"]);
  try {
    mkdirSync(output);
    writeFileSync(join(root, "outside.txt"), "outside");
    writeFileSync(join(output, "stale.ts"), "stale");
    writeFileSync(join(output, "custom.ts"), "custom");
    writeFileSync(join(output, ".qiy-generated.json"), JSON.stringify({ files: ["stale.ts", "../outside.txt"] }));
    const rejected = run();
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("Invalid generated file path");
    expect(await Bun.file(join(root, "outside.txt")).text()).toBe("outside");
    expect(await Bun.file(join(output, "stale.ts")).text()).toBe("stale");
    expect(existsSync(join(output, "package.json"))).toBe(false);
    writeFileSync(join(output, ".qiy-generated.json"), JSON.stringify({ files: ["stale.ts"] }));
    mkdirSync(join(root, "outside-apps"));
    symlinkSync(join(root, "outside-apps"), join(output, "apps"), "junction");
    expect(run().exitCode).toBe(1);
    expect(await Bun.file(join(output, "stale.ts")).text()).toBe("stale");
    expect(existsSync(join(root, "outside-apps", "server"))).toBe(false);
    unlinkSync(join(output, "apps"));
    const generated = run();
    expect(generated.exitCode).toBe(0);
    expect(existsSync(join(output, "stale.ts"))).toBe(false);
    expect(await Bun.file(join(output, "custom.ts")).text()).toBe("custom");
    expect(existsSync(join(output, "package.json"))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

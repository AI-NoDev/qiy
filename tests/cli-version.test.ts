import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("CLI source reports the package version", async () => {
  const root = resolve(import.meta.dir, "..");
  const expectedVersion = (await Bun.file(resolve(root, "package.json")).json()).version as string;
  const result = Bun.spawnSync([process.execPath, "run", "tools/cli.ts", "--version"], { cwd: root });

  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdout).toString().trim()).toBe(expectedVersion);
});

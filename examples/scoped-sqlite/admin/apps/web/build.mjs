import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("@react-router/dev/package.json")), "bin.js");
const result = spawnSync(process.execPath, [cli, "build"], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

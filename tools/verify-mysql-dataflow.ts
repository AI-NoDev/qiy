import { join } from "node:path";

const child = Bun.spawn([process.execPath, join(import.meta.dir, "verify-postgres-dataflow.ts"), process.argv[2] ?? "qiy-dataflow-mysql", "mysql"], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;

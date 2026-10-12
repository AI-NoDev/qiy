/** @deprecated Use `qiy export-ir` (tools/cli.ts) instead. */
import { exportMpsIr } from "./commands/export-ir";

const source = Bun.argv[2];
if (!source) {
  console.error("Usage: bun run tools/export-mps-ir.ts <qiy-model.mps>");
  process.exit(1);
}
try {
  process.stdout.write(await exportMpsIr(source));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

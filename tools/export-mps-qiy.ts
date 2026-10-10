/** @deprecated Use `qiy export-qiy` (tools/cli.ts) instead. */
import { exportQiy } from "./commands/export-qiy";

const [source, destination] = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!source || !destination) {
  console.error("Usage: qiy export-qiy <model.mps> <output.qiy> [--force]");
  process.exit(1);
}
try {
  await exportQiy(source, destination, Bun.argv.includes("--force"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

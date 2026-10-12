/** @deprecated Use `qiy validate` (tools/cli.ts) instead. */
import { validateMpsModels } from "./commands/validate-mps";

const sources = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!sources.length) {
  console.error("Usage: bun run tools/check-mps.ts <model.mps> [...models.mps]");
  process.exit(1);
}
try {
  await validateMpsModels(sources);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

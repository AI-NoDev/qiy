/** @deprecated Use `qiy drizzle` (tools/cli.ts) instead. */
import { generateDrizzle } from "./commands/generate-drizzle";

const source = Bun.argv[2];
if (!source) {
  console.error("Usage: bun run tools/generate-drizzle.ts <database-ir.json|qiy-model.mps>");
  process.exit(1);
}
try {
  process.stdout.write(await generateDrizzle(source));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

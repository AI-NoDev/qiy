/** @deprecated Use `qiy generate` (tools/cli.ts) instead. */
import { generateApp } from "./commands/generate-app";

const [source, destination] = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
if (!source || !destination) {
  console.error("Usage: qiy generate <project.qiy> <new-output-directory> [--sync]");
  process.exit(1);
}
try {
  await generateApp(source, destination, { sync: Bun.argv.includes("--sync") });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

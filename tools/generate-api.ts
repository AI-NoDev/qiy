import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DatabaseIR } from "./database-ir";
import { generateServer } from "./generate-server";
import { parseMpsDatabaseModel } from "./mps-database-ir";

const source = Bun.argv[2];
const destination = Bun.argv[3];
if (!source || !destination) {
  console.error("Usage: bun run tools/generate-api.ts <model.mps|ir.json> <new-output-directory>");
  process.exit(1);
}

try {
  const output = resolve(destination);
  if (existsSync(output) && readdirSync(output).length > 0) {
    throw new Error(`Output directory must be empty: ${output}`);
  }
  const database = source.endsWith(".mps")
    ? parseMpsDatabaseModel(
        await Bun.file(source).text(),
        await Bun.file(new URL("../languages/qiy/models/qiy.structure.mps", import.meta.url)).text(),
      )
    : await Bun.file(source).json() as DatabaseIR;
  const files = generateServer(database);
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(output, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, content);
  }
  console.log(`Generated ${Object.keys(files).length} API files in ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

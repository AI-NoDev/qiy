import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { exportMpsProjectAsQiy } from "../mps-qiy";
import { readStructureModel } from "../structure-model";

export async function exportQiy(source: string, destination: string, force = false): Promise<string> {
  const output = resolve(destination);
  if (existsSync(output) && !force) {
    throw new Error(`Output file already exists: ${output} (pass --force to replace it)`);
  }
  await Bun.write(output, exportMpsProjectAsQiy(await Bun.file(source).text(), await readStructureModel()));
  console.log(`Exported Qiy project source to ${output}`);
  return output;
}

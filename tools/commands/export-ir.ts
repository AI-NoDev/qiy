import { parseMpsDatabaseModel } from "../mps-database-ir";
import { validateDatabaseIR } from "../database-ir";
import { readStructureModel } from "../structure-model";

export async function exportMpsIr(source: string): Promise<string> {
  const database = parseMpsDatabaseModel(await Bun.file(source).text(), await readStructureModel());
  const errors = validateDatabaseIR(database);
  if (errors.length) throw new Error(errors.join("\n"));
  return `${JSON.stringify(database, null, 2)}\n`;
}

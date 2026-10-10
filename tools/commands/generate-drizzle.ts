import type { DatabaseIR } from "../database-ir";
import { generateDrizzlePostgres } from "../drizzle-pg";
import { parseMpsDatabaseModel } from "../mps-database-ir";
import { readStructureModel } from "../structure-model";

export async function generateDrizzle(source: string): Promise<string> {
  const database = source.endsWith(".mps")
    ? parseMpsDatabaseModel(await Bun.file(source).text(), await readStructureModel())
    : await Bun.file(source).json() as DatabaseIR;
  return generateDrizzlePostgres(database);
}

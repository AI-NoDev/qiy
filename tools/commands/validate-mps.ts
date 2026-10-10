import { parseMpsProjectModel } from "../mps-database-ir";
import { generateProject } from "../generate-project";
import { readStructureModel } from "../structure-model";

export async function validateMpsModels(sources: string[]): Promise<void> {
  const structure = await readStructureModel();
  const errors: string[] = [];
  for (const source of sources) {
    try {
      const project = parseMpsProjectModel(await Bun.file(source).text(), structure);
      const name = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      generateProject(project.database, name, project);
      console.log(`Validated MPS generation input: ${source}`);
    } catch (error) {
      errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

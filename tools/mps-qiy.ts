import { parseMpsProjectModel } from "./mps-database-ir";
import { serializeQiyProject } from "./qiy-project";

export function exportMpsProjectAsQiy(modelXml: string, structureXml: string): string {
  return serializeQiyProject(parseMpsProjectModel(modelXml, structureXml));
}

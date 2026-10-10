import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseIR } from "../database-ir";
import { generateProject } from "../generate-project";
import { parseMpsProjectModel } from "../mps-database-ir";
import { loadQiyProjectSource } from "../qiy-include";
import { parseQiyProject } from "../qiy-project";
import { generatedPath, manifestFiles } from "../generated-paths";
import { readStructureModel } from "../structure-model";

export interface GenerateAppOptions {
  sync?: boolean;
}

export async function generateApp(source: string, destination: string, options: GenerateAppOptions = {}): Promise<string> {
  const output = resolve(destination);
  if (existsSync(output) && readdirSync(output).length > 0 && !options.sync) {
    throw new Error(`Output directory must be empty: ${output}`);
  }
  const project = source.endsWith(".qiy") ? parseQiyProject(await loadQiyProjectSource(source)) : undefined;
  const mpsProject = source.endsWith(".mps")
    ? parseMpsProjectModel(await Bun.file(source).text(), await readStructureModel())
    : undefined;
  if (!project && !mpsProject && !source.endsWith(".json")) {
    throw new Error(`Unsupported input file: ${source}. Expected .qiy, .mps, or .json.`);
  }
  const database = project?.database ?? mpsProject?.database ?? await Bun.file(source).json() as DatabaseIR;
  const appName = project?.name
    ?? mpsProject?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    ?? "qiy-generated-app";
  const files = generateProject(database, appName, {
    apiClient: project?.apiClient ?? mpsProject?.apiClient,
    elysiaPlugins: project?.elysiaPlugins ?? mpsProject?.elysiaPlugins,
    corsOrigins: project?.corsOrigins,
    menuGroups: project?.menuGroups ?? mpsProject?.menuGroups,
    dashboardMetrics: project?.dashboardMetrics ?? mpsProject?.dashboardMetrics,
    storageProvider: project?.storageProvider ?? mpsProject?.storageProvider,
    auth: project?.auth ?? mpsProject?.auth,
    scopes: project?.scopes ?? mpsProject?.scopes,
    workflows: project?.workflows ?? mpsProject?.workflows,
  });
  const manifestPath = generatedPath(output, ".qiy-generated.json");
  for (const relativePath of Object.keys(files)) generatedPath(output, relativePath);
  if (options.sync && existsSync(output)) {
    const manifest = Bun.file(manifestPath);
    const staleFiles: string[] = [];
    if (await manifest.exists()) {
      for (const relativePath of manifestFiles(await manifest.json())) {
        if (Object.hasOwn(files, relativePath)) continue;
        staleFiles.push(generatedPath(output, relativePath));
      }
    }
    for (const stalePath of ["apps/server/src/repositories.ts", "apps/server/src/routes/index.ts"]) {
      if (!Object.hasOwn(files, stalePath)) staleFiles.push(generatedPath(output, stalePath));
    }
    for (const path of new Set(staleFiles)) if (existsSync(path)) unlinkSync(path);
  }
  files[".qiy-generated.json"] = JSON.stringify({ files: Object.keys(files) }, null, 2) + "\n";
  for (const [relativePath, content] of Object.entries(files)) {
    const path = generatedPath(output, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, String(content));
  }
  const count = Object.keys(files).length;
  console.log(`Generated ${count} application files in ${output}`);
  return output;
}

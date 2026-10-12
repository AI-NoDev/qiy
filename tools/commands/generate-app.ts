import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateProject } from "../generate-project";
import { loadQiyProjectSource } from "../qiy-include";
import { parseQiyProject } from "../qiy-project";
import { loadQiyTestSuite } from "../qiy-test";
import { createGeneratedManifest, generatedPath, readGeneratedManifest } from "../generated-paths";
import { prepareEnvironmentFile } from "../environment-files";
import { generatedWiki } from "../generated-wiki";

export interface GenerateAppOptions {
  sync?: boolean;
  name?: string;
}

export async function generateApp(source: string, destination: string, options: GenerateAppOptions = {}): Promise<string> {
  const output = resolve(destination);
  if (existsSync(output) && readdirSync(output).length > 0 && !options.sync) {
    throw new Error(`Output directory must be empty: ${output}`);
  }
  if (!source.endsWith(".qiy")) {
    throw new Error(`Unsupported input file: ${source}. Qiy application generation only accepts .qiy source files.`);
  }
  const project = parseQiyProject(await loadQiyProjectSource(source));
  const testSuite = loadQiyTestSuite(source, project);
  const database = project.database;
  const appName = options.name ?? project.name;
  if (project.mode === "integration") {
    throw new Error("application mode integration must be mounted with qiy init inside an existing Bun workspace; it does not create a standalone server workspace.");
  }
  const files = generateProject(database, appName, {
    comment: project.comment,
    commentKey: project.commentKey,
    mode: project.mode,
    integration: project.integration,
    ui: project.ui,
    dataflows: project.dataflows,
    messages: project.messages,
    actions: project.actions,
    apiClient: project.apiClient,
    elysiaPlugins: project.elysiaPlugins,
    corsOrigins: project.corsOrigins,
    menuGroups: project.menuGroups,
    dashboardMetrics: project.dashboardMetrics,
    realtime: project.realtime,
    storageProvider: project.storageProvider,
    auth: project.auth,
    environment: project.environment,
    scopes: project.scopes,
    workflows: project.workflows,
    testSuite,
  });
  Object.assign(files, generatedWiki(files, appName, source));
  const manifestPath = generatedPath(output, ".qiy-generated.json");
  const unowned = new Set(Object.keys(files).filter((path) => path.startsWith("apps/web/app/extensions/") || path.startsWith("apps/server/src/extensions/") || path === "AGENTS.md" || path === "AGENT.MD"));
  for (const relativePath of Object.keys(files)) generatedPath(output, relativePath);
  if (options.sync && existsSync(output)) {
    const manifest = Bun.file(manifestPath);
    const staleFiles: string[] = [];
    if (await manifest.exists()) {
      for (const relativePath of readGeneratedManifest(await manifest.json()).files) {
        if (Object.hasOwn(files, relativePath)) continue;
        staleFiles.push(generatedPath(output, relativePath));
      }
    }
    for (const stalePath of ["apps/server/src/repositories.ts", "apps/server/src/routes/index.ts"]) {
      if (!Object.hasOwn(files, stalePath)) staleFiles.push(generatedPath(output, stalePath));
    }
    for (const path of new Set(staleFiles)) if (existsSync(path)) unlinkSync(path);
  }
  files[".qiy-generated.json"] = JSON.stringify(createGeneratedManifest(appName, "standalone", Object.keys(files).filter((path) => !unowned.has(path))), null, 2) + "\n";
  for (const [relativePath, content] of Object.entries(files)) {
    const path = generatedPath(output, relativePath);
    if (unowned.has(relativePath) && existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    const environmentMode = /\.env\.(development|production)$/.exec(relativePath);
    const existingEnvironmentFile = environmentMode && options.sync && await Bun.file(path).exists()
      ? await Bun.file(path).text()
      : undefined;
    const outputContent = environmentMode ? prepareEnvironmentFile(String(content), existingEnvironmentFile) : String(content);
    await Bun.write(path, outputContent);
  }
  const count = Object.keys(files).length;
  console.log(`Generated ${count} application files in ${output}`);
  return output;
}

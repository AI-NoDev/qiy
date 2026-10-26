import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateApp } from "./generate-app";
import { explainQiyFile } from "./explain";
import { createQiyProject, requireQiyProject, type QiyProjectLocation } from "../project";

export interface CreateProjectOptions {
  cwd?: string;
  template?: "minimal" | "standard";
  directory?: string;
}

/** `qiy create project <name>`: scaffold a modular model project without generating. */
export function createProject(name: string, options: CreateProjectOptions = {}): void {
  const created = createQiyProject(name, options);
  const relative = created.root === process.cwd() ? "." : created.root;
  console.log(`Created Qiy project ${name} in ${relative}`);
  console.log(`  ${relative === "." ? "" : relative + "/"}${"qiy.project.json"}`);
  console.log(`  ${relative === "." ? "" : relative + "/"}model/app.qiy + model/modules/`);
  console.log("");
  console.log("Next:");
  if (relative !== ".") console.log(`  cd ${relative}`);
  console.log("  qiy dev     # generate, install, and start the API + admin");
  console.log("  qiy check   # validate only");
}

/** `qiy check`: parse and validate the project model without writing generated files. */
export async function checkProject(cwd = process.cwd()): Promise<void> {
  const project = requireQiyProject(cwd);
  const explanation = await explainQiyFile(project.modelPath);
  const counts = explanation.counts;
  console.log(`OK ${project.manifest.name}: ${counts.entities} entities, ${counts.fields} fields, ${counts.relations} relations, ${counts.dataflows} dataflows, ${counts.charts} charts`);
  console.log(`model: ${project.manifest.model}`);
  console.log(`output: ${project.manifest.output}`);
}

/** `qiy generate` inside a project: regenerate/sync the manifest output. */
export async function generateProject(cwd = process.cwd()): Promise<void> {
  const project = requireQiyProject(cwd);
  await generateApp(project.modelPath, project.outputPath, { sync: existsSync(project.outputPath) });
}

function run(command: string[], cwd: string): Promise<number> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  return child.exited;
}

async function ensureWorkspace(project: QiyProjectLocation): Promise<void> {
  const manifest = join(project.outputPath, ".qiy-generated.json");
  if (!existsSync(manifest)) {
    await generateApp(project.modelPath, project.outputPath, { sync: existsSync(project.outputPath) });
  }
  if (!existsSync(join(project.outputPath, "node_modules"))) {
    console.log(`Installing dependencies in ${project.manifest.output}/ (first run)...`);
    const code = await run([process.execPath, "install"], project.outputPath);
    if (code !== 0) throw new Error(`bun install failed in ${project.outputPath}`);
  }
}

/** `qiy dev`: regenerate, install on first run, then run the generated dev scripts. */
export async function devProject(cwd = process.cwd()): Promise<void> {
  const project = requireQiyProject(cwd);
  await generateProject(cwd);
  await ensureWorkspace(project);
  // Keep the development database schema in step with the model. Generating
  // migrations is a no-op when nothing changed; applying them is safe on SQLite.
  console.log("Preparing the development database...");
  const generate = await run([process.execPath, "run", "db:generate"], project.outputPath);
  if (generate !== 0) throw new Error("bun run db:generate failed. Check the generated server .env.development and drizzle config.");
  const migrate = await run([process.execPath, "run", "db:migrate"], project.outputPath);
  if (migrate !== 0) throw new Error("bun run db:migrate failed. Check apps/server/.env.development (DATABASE_URL) and the database connection.");
  const code = await run([process.execPath, "run", "dev"], project.outputPath);
  if (code !== 0) process.exitCode = code;
}

/** Runs a generated workspace script after ensuring generation/install. */
export async function runProjectScript(script: "build" | "test" | "preview", cwd = process.cwd()): Promise<void> {
  const project = requireQiyProject(cwd);
  await ensureWorkspace(project);
  const code = await run([process.execPath, "run", script], project.outputPath);
  if (code !== 0) process.exitCode = code;
}

import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import { generateApp, renderAppFiles } from "./generate-app";
import { explainQiyFile } from "./explain";
import { generatedPath, readGeneratedManifest } from "../generated-paths";
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
export async function generateProject(cwd = process.cwd(), options: { incremental?: boolean } = {}): Promise<void> {
  const project = requireQiyProject(cwd);
  await generateApp(project.modelPath, project.outputPath, { sync: existsSync(project.outputPath), ...(options.incremental && { incremental: true }), plugins: project.manifest.plugins, pluginRoot: project.root });
}

/** Differences between the current generated workspace and the model. */
export interface ProjectDiff {
  output: string;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
  ignoredEnvironmentFiles: number;
}

/** `qiy diff`: render in memory and report what generation would change. */
export async function diffProject(cwd = process.cwd()): Promise<ProjectDiff> {
  const project = requireQiyProject(cwd);
  const { files, unowned } = await renderAppFiles(project.modelPath, { plugins: project.manifest.plugins, pluginRoot: project.root });
  const expected = new Set<string>();
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  let ignoredEnvironmentFiles = 0;
  for (const [relativePath, content] of Object.entries(files)) {
    if (unowned.has(relativePath)) continue;
    if (/\.env\.(development|production)$/.test(relativePath)) {
      ignoredEnvironmentFiles += 1;
      continue;
    }
    expected.add(relativePath);
    const path = generatedPath(project.outputPath, relativePath);
    if (!existsSync(path)) added.push(relativePath);
    else if (readFileSync(path, "utf8") !== String(content)) changed.push(relativePath);
    else unchanged += 1;
  }
  const removed = new Set<string>();
  const manifestPath = generatedPath(project.outputPath, ".qiy-generated.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = readGeneratedManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
      for (const relativePath of manifest.files) {
        if (expected.has(relativePath) || unowned.has(relativePath)) continue;
        if (/\.env\.(development|production)$/.test(relativePath)) continue;
        if (existsSync(generatedPath(project.outputPath, relativePath))) removed.add(relativePath);
      }
    } catch {
      // An unreadable manifest is reported as a changed file; stale-file cleanup
      // cannot be inferred safely without it.
    }
  }
  return {
    output: project.manifest.output,
    added: added.sort(),
    changed: changed.sort(),
    removed: [...removed].sort(),
    unchanged,
    ignoredEnvironmentFiles,
  };
}

/** Human-readable `qiy diff` output. */
export function formatProjectDiff(diff: ProjectDiff, output: string): string {
  const lines = [`Qiy diff against ${output}`];
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
    lines.push(`No differences (${diff.unchanged} generated files match).`);
  } else {
    lines.push(`  added ${diff.added.length}, changed ${diff.changed.length}, removed ${diff.removed.length}, unchanged ${diff.unchanged}`);
    if (diff.added.length) lines.push("", "Added:", ...diff.added.map((path) => `  + ${path}`));
    if (diff.changed.length) lines.push("", "Changed:", ...diff.changed.map((path) => `  ~ ${path}`));
    if (diff.removed.length) lines.push("", "Removed:", ...diff.removed.map((path) => `  - ${path}`));
  }
  if (diff.ignoredEnvironmentFiles > 0) lines.push("", `Ignored ${diff.ignoredEnvironmentFiles} .env file(s) that hold local secrets.`);
  return lines.join("\n");
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

async function prepareDatabase(project: QiyProjectLocation): Promise<void> {
  console.log("Preparing the development database...");
  const generate = await run([process.execPath, "run", "db:generate"], project.outputPath);
  if (generate !== 0) throw new Error("bun run db:generate failed. Check the generated server .env.development and drizzle config.");
  const migrate = await run([process.execPath, "run", "db:migrate"], project.outputPath);
  if (migrate !== 0) throw new Error("bun run db:migrate failed. Check apps/server/.env.development (DATABASE_URL) and the database connection.");
}

export interface ProjectWatchOptions {
  /** Coalesce bursts of editor writes (default 250ms). */
  debounceMs?: number;
}

export interface ProjectWatcher {
  close: () => void;
}

/**
 * Watches the project's model directory and calls `onChange` after a debounced
 * `.qiy` edit. Changes during an in-flight regeneration are queued and run once
 * more, so a save never leaves `admin/` generated from a stale model.
 */
export function watchProjectModel(
  project: QiyProjectLocation,
  onChange: () => Promise<void> | void,
  options: ProjectWatchOptions = {},
): ProjectWatcher {
  const debounceMs = options.debounceMs ?? 250;
  const modelDirectory = dirname(project.modelPath);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  let closed = false;

  const runChange = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    do {
      pending = false;
      try {
        await onChange();
      } catch (error) {
        console.error(`Qiy watch regeneration failed: ${error instanceof Error ? error.message : String(error)}`);
        console.error("The dev server keeps running; fix the model and save again.");
      }
    } while (pending && !closed);
    running = false;
  };

  const schedule = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void runChange();
    }, debounceMs);
  };

  const watcher: FSWatcher = watch(modelDirectory, { recursive: true }, (_event, filename) => {
    const name = filename ? String(filename).replaceAll("\\", "/") : "";
    // Recursive watchers can report the containing directory instead of the
    // changed file; only ignore events that are clearly non-.qiy files.
    if (name && /\.[^/]+$/.test(name) && !name.endsWith(".qiy")) return;
    schedule();
  });

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher.close();
    },
  };
}

/** `qiy dev`: regenerate, install on first run, then run the generated dev scripts. */
export async function devProject(cwd = process.cwd(), options: { watch?: boolean } = {}): Promise<void> {
  const project = requireQiyProject(cwd);
  await generateProject(cwd);
  await ensureWorkspace(project);
  // Keep the development database schema in step with the model. Generating
  // migrations is a no-op when nothing changed; applying them is safe on SQLite.
  await prepareDatabase(project);
  const watcher = options.watch
    ? watchProjectModel(project, async () => {
        console.log("Model changed, regenerating admin/ ...");
        await generateProject(cwd);
        await prepareDatabase(project);
        console.log("Regenerated; the dev servers will reload changed files.");
      })
    : undefined;
  if (watcher) console.log("Watching model/ for .qiy changes (Ctrl+C to stop).");
  const child = Bun.spawn([process.execPath, "run", "dev"], { cwd: project.outputPath, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  const code = await child.exited;
  watcher?.close();
  if (code !== 0) process.exitCode = code;
}

/** Runs a generated workspace script after ensuring generation/install. */
export async function runProjectScript(script: "build" | "test" | "preview", cwd = process.cwd()): Promise<void> {
  const project = requireQiyProject(cwd);
  await ensureWorkspace(project);
  const code = await run([process.execPath, "run", script], project.outputPath);
  if (code !== 0) process.exitCode = code;
}

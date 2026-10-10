import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { generateProject } from "../generate-project";
import { generatedPath, manifestFiles } from "../generated-paths";
import { loadQiyProjectSource } from "../qiy-include";
import { parseQiyProject, type QiyWorkspaceConfig } from "../qiy-project";
import { prepareEnvironmentFile } from "../environment-files";

export interface InitAppOptions {
  source: string;
  root?: string;
  name?: string;
  sync?: boolean;
}

interface ResolvedInitConfig {
  name: string;
  server: string;
  web: string;
  deploy: string;
  serverPackage: string;
  webPackage: string;
}

function requireDirectoryName(value: string, label: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new Error(`${label} must use lowercase letters, numbers, and hyphens, and start with a letter.`);
  return value;
}

function requirePackageName(value: string, label: string): string {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)) throw new Error(`${label} must be a valid npm package name.`);
  return value;
}

function resolveConfig(projectName: string, input: QiyWorkspaceConfig | undefined, explicitName?: string): ResolvedInitConfig {
  const name = requireDirectoryName(explicitName ?? input?.name ?? projectName, "Admin name");
  const server = requireDirectoryName(input?.aliases?.server ?? `${name}-server`, "Server alias");
  const web = requireDirectoryName(input?.aliases?.web ?? `${name}-web`, "Web alias");
  const deploy = requireDirectoryName(input?.aliases?.deploy ?? name, "Deploy alias");
  if (server === web) throw new Error("Server and web aliases must be different.");
  return {
    name,
    server,
    web,
    deploy,
    serverPackage: requirePackageName(input?.packages?.server ?? `${name}-server`, "Server package name"),
    webPackage: requirePackageName(input?.packages?.web ?? `${name}-web`, "Web package name"),
  };
}

function mergedLines(previous: string, additions: string[]): string {
  const lines = previous.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  for (const addition of additions) if (!lines.includes(addition)) lines.push(addition);
  return `${lines.join("\n")}\n`;
}

function workspacePatterns(packageJson: Record<string, unknown>): string[] {
  const workspaces = packageJson.workspaces;
  if (Array.isArray(workspaces) && workspaces.every((entry) => typeof entry === "string")) return [...workspaces];
  if (workspaces && typeof workspaces === "object" && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    return [...((workspaces as { packages: string[] }).packages)];
  }
  return [];
}

function writePackageJson(root: string, packageJson: Record<string, unknown>, config: ResolvedInitConfig): void {
  const patterns = workspacePatterns(packageJson);
  if (!patterns.includes("apps/*")) patterns.push("apps/*");
  if (packageJson.workspaces && typeof packageJson.workspaces === "object" && !Array.isArray(packageJson.workspaces)) {
    (packageJson.workspaces as { packages: string[] }).packages = patterns;
  } else {
    packageJson.workspaces = patterns;
  }
  const scripts = (packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {}) as Record<string, string>;
  const prefix = `qiy:${config.name}`;
  const additions: Record<string, string> = {
    [`${prefix}:dev:server`]: `bun run --cwd apps/${config.server} dev`,
    [`${prefix}:dev:web`]: `bun run --cwd apps/${config.web} --bun dev`,
    [`${prefix}:preview`]: `bun run --cwd apps/${config.server} preview`,
    [`${prefix}:typecheck`]: `bun run --cwd apps/${config.server} typecheck && bun run --cwd apps/${config.web} typecheck`,
    [`${prefix}:test`]: `bun run --cwd apps/${config.server} test && bun run --cwd apps/${config.web} test`,
    [`${prefix}:db:generate`]: `bun run --cwd apps/${config.server} db:generate`,
    [`${prefix}:db:migrate`]: `bun run --cwd apps/${config.server} db:migrate`,
    [`${prefix}:db:migrate:production`]: `bun run --cwd apps/${config.server} db:migrate:production`,
  };
  for (const [name, value] of Object.entries(additions)) {
    if (scripts[name] && scripts[name] !== value) throw new Error(`Cannot add ${name}: the host package.json already defines a different script.`);
    scripts[name] = value;
  }
  packageJson.scripts = scripts;
  writeFileSync(resolve(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function rewriteFile(path: string, content: string, config: ResolvedInitConfig): [string, string] | undefined {
  if (["package.json", "turbo.json", "README.md", ".gitignore", ".dockerignore"].includes(path)) return undefined;
  let nextPath = path;
  let nextContent = content.replaceAll("apps/web", `apps/${config.web}`).replaceAll("apps/server", `apps/${config.server}`);
  if (path.startsWith("apps/server/")) {
    nextPath = `apps/${config.server}/${path.slice("apps/server/".length)}`;
    nextContent = nextContent.replaceAll("../../web/build/client", `../../${config.web}/build/client`);
    if (path === "apps/server/package.json") {
      const packageJson = JSON.parse(nextContent) as Record<string, unknown>;
      packageJson.name = config.serverPackage;
      nextContent = `${JSON.stringify(packageJson, null, 2)}\n`;
    }
  } else if (path.startsWith("apps/web/")) {
    nextPath = `apps/${config.web}/${path.slice("apps/web/".length)}`;
    if (path === "apps/web/package.json") {
      const packageJson = JSON.parse(nextContent) as Record<string, unknown>;
      packageJson.name = config.webPackage;
      nextContent = `${JSON.stringify(packageJson, null, 2)}\n`;
    }
  } else if (path.startsWith("deploy/")) {
    nextPath = `deploy/${config.deploy}/${path.slice("deploy/".length)}`;
    if (path === "deploy/nginx.conf") nextContent = nextContent.replaceAll("http://qiy:3000", `http://${config.deploy}:3000`);
  } else if (path === "Dockerfile") {
    nextPath = `${config.deploy}.Dockerfile`;
    nextContent = nextContent
      .replaceAll("apps/web", `apps/${config.web}`)
      .replaceAll("apps/server", `apps/${config.server}`)
      .replace("COPY package.json bun.lock turbo.json ./", "COPY package.json bun.lock ./");
  } else if (path === "docker-compose.yml") {
    nextPath = `docker-compose.${config.deploy}.yml`;
    nextContent = nextContent.replace(/^  qiy:/m, `  ${config.deploy}:`).replaceAll("qiy-storage", `${config.deploy}-storage`);
  }
  return [nextPath, nextContent];
}

function manifestName(config: ResolvedInitConfig): string {
  return `.qiy-${config.name}.generated.json`;
}

export async function initApp(options: InitAppOptions): Promise<string> {
  const root = resolve(options.root ?? process.cwd());
  const packagePath = resolve(root, "package.json");
  if (!existsSync(packagePath)) throw new Error(`qiy init must run in a Bun project root containing package.json: ${root}`);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
  if (typeof packageJson.packageManager !== "string" || !packageJson.packageManager.startsWith("bun@")) {
    throw new Error("qiy init requires package.json.packageManager to declare Bun, for example bun@1.3.13.");
  }
  if (!options.source.endsWith(".qiy")) throw new Error("qiy init accepts a .qiy model. Export MPS models to .qiy before mounting them into an existing project.");
  const project = parseQiyProject(await loadQiyProjectSource(resolve(root, options.source)));
  const config = resolveConfig(project.name, project.workspace, options.name);
  const generated = generateProject(project.database, config.name, {
    apiClient: project.apiClient,
    elysiaPlugins: project.elysiaPlugins,
    corsOrigins: project.corsOrigins,
    menuGroups: project.menuGroups,
    dashboardMetrics: project.dashboardMetrics,
    storageProvider: project.storageProvider,
    auth: project.auth,
    environment: project.environment,
    scopes: project.scopes,
    workflows: project.workflows,
  });
  const files = Object.fromEntries(Object.entries(generated).flatMap(([path, content]) => {
    const rewritten = rewriteFile(path, content, config);
    return rewritten ? [rewritten] : [];
  }));
  const manifestPath = generatedPath(root, manifestName(config));
  const previous = existsSync(manifestPath) ? manifestFiles(JSON.parse(readFileSync(manifestPath, "utf8"))) : [];
  const owned = new Set(previous);
  for (const relativePath of Object.keys(files)) {
    const target = generatedPath(root, relativePath);
    if (existsSync(target) && (!options.sync || !owned.has(relativePath))) throw new Error(`Refusing to overwrite existing host file: ${relative(root, target)}. Use a unique alias or move the file first.`);
  }
  if (options.sync) {
    for (const stale of previous.filter((path) => !Object.hasOwn(files, path))) {
      const target = generatedPath(root, stale);
      if (existsSync(target)) unlinkSync(target);
    }
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const target = generatedPath(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    const environmentMode = /\.env\.(development|production)$/.exec(relativePath);
    const existingEnvironmentFile = environmentMode && options.sync && existsSync(target) ? readFileSync(target, "utf8") : undefined;
    const outputContent = environmentMode ? prepareEnvironmentFile(content, existingEnvironmentFile) : content;
    await Bun.write(target, outputContent);
  }
  writePackageJson(root, packageJson, config);
  const gitignorePath = resolve(root, ".gitignore");
  const dockerignorePath = resolve(root, ".dockerignore");
  await Bun.write(gitignorePath, mergedLines(existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "", [
    `.qiy-${config.name}.generated.json`,
    `apps/${config.web}/build/`,
    `apps/${config.web}/.react-router/`,
    `apps/${config.server}/.env`,
    `apps/${config.server}/.env.development`,
    `apps/${config.server}/.env.production`,
    `apps/${config.server}/storage/`,
  ]));
  await Bun.write(dockerignorePath, mergedLines(existsSync(dockerignorePath) ? readFileSync(dockerignorePath, "utf8") : "", [
    `apps/${config.web}/build`,
    `apps/${config.web}/.react-router`,
    `apps/${config.server}/.env`,
    `apps/${config.server}/.env.development`,
    `apps/${config.server}/.env.production`,
    `apps/${config.server}/storage`,
  ]));
  await Bun.write(manifestPath, `${JSON.stringify({ files: Object.keys(files) }, null, 2)}\n`);
  console.log(`Mounted Qiy admin ${config.name} in ${root} (apps/${config.server}, apps/${config.web}).`);
  return root;
}

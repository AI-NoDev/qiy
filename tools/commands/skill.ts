import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { generatedPath } from "../generated-paths";
import { QIY_SKILL_FILES } from "../qiy-skill.data";

/** Default project-local location supported by agent skill loaders. */
export const SKILL_PROJECT_PATH = ".agents/skills/qiy";
/** Legacy path written by earlier Qiy releases; updated in place for compatibility. */
export const SKILL_LEGACY_PROJECT_PATH = ".agent/skills/qiy";
/** User-level location for agents that load skills globally. */
export const SKILL_GLOBAL_PATH = ".agents/skills/qiy";

export interface InstallSkillOptions {
  /** Install under the current user's home directory instead of the project. */
  global?: boolean;
  /** Explicit destination directory (relative to root, absolute, or with `~`). */
  dir?: string;
  /** Override the home directory (tests / custom environments). */
  home?: string;
}

export interface SkillStatus {
  destination: string;
  /** Whether the destination contains the skill entrypoint at all. */
  installed: boolean;
  /** True when every bundled official file exists with identical content. */
  upToDate: boolean;
  /** Official files with different content. */
  modified: string[];
  /** Official files that are missing. */
  missing: string[];
  /** Files under the destination that are not part of the official skill. */
  unrelated: string[];
}

/**
 * Resolves the skill destination for a project or user-level install.
 *
 * - `--dir` wins; `~` expands to the home directory
 * - `--global` installs to `~/.agents/skills/qiy`
 * - project installs use `.agents/skills/qiy`, but keep updating the legacy
 *   `.agent/skills/qiy` when that is the only directory already present
 */
export function resolveSkillDestination(root: string, options: InstallSkillOptions = {}): string {
  const home = options.home ?? homedir();
  if (options.dir) {
    if (options.dir === "~") return join(home, SKILL_PROJECT_PATH);
    if (options.dir.startsWith("~/") || options.dir.startsWith("~\\")) return join(home, options.dir.slice(2));
    return isAbsolute(options.dir) ? options.dir : resolve(root, options.dir);
  }
  if (options.global) return join(home, SKILL_GLOBAL_PATH);
  const legacy = resolve(root, SKILL_LEGACY_PROJECT_PATH);
  return existsSync(legacy) && !existsSync(resolve(root, SKILL_PROJECT_PATH)) ? legacy : resolve(root, SKILL_PROJECT_PATH);
}

export function installSkill(root = process.cwd(), force = false, options: InstallSkillOptions = {}): string {
  const destination = resolveSkillDestination(root, options);
  const targets = Object.entries(QIY_SKILL_FILES).map(([path, content]) => ({ path: generatedPath(destination, path), content }));
  for (const target of targets) {
    if (existsSync(target.path) && readFileSync(target.path, "utf8") !== target.content && !force) {
      throw new Error("Qiy skill has local changes. Use qiy skill install --force to replace official skill files; unrelated files are preserved.");
    }
  }
  for (const target of targets) {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, target.content);
  }
  console.log(`Installed official Qiy skill in ${destination}`);
  return destination;
}

/** Inspects one destination against the bundled official skill files. */
export function inspectSkill(destination: string): SkillStatus {
  const officialPaths = Object.keys(QIY_SKILL_FILES);
  const modified: string[] = [];
  const missing: string[] = [];
  for (const [path, content] of Object.entries(QIY_SKILL_FILES)) {
    const target = generatedPath(destination, path);
    if (!existsSync(target)) missing.push(path);
    else if (readFileSync(target, "utf8") !== content) modified.push(path);
  }
  const unrelated: string[] = [];
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const relative = path.slice(destination.length + 1).replaceAll("\\", "/");
        if (entry.isFile() && !officialPaths.includes(relative)) unrelated.push(relative);
      }
    }
  };
  visit(destination);
  return {
    destination,
    installed: existsSync(join(destination, "SKILL.md")),
    upToDate: existsSync(join(destination, "SKILL.md")) && modified.length === 0 && missing.length === 0,
    modified,
    missing,
    unrelated: unrelated.sort(),
  };
}

/** Lists the project, legacy and user-level installations that exist on disk. */
export function listSkillInstallations(root = process.cwd(), options: InstallSkillOptions = {}): SkillStatus[] {
  const destinations = new Set<string>();
  if (options.dir || options.global) {
    destinations.add(resolveSkillDestination(root, options));
  } else {
    destinations.add(resolve(root, SKILL_PROJECT_PATH));
    const legacy = resolve(root, SKILL_LEGACY_PROJECT_PATH);
    if (existsSync(legacy)) destinations.add(legacy);
    destinations.add(join(options.home ?? homedir(), SKILL_GLOBAL_PATH));
  }
  return [...destinations].map(inspectSkill).filter((status) => existsSync(status.destination) && (status.installed || status.unrelated.length > 0));
}

/** Replaces official files in an existing installation, refusing local edits unless forced. */
export function updateSkill(root = process.cwd(), force = false, options: InstallSkillOptions = {}): string {
  const destination = resolveSkillDestination(root, options);
  if (!existsSync(join(destination, "SKILL.md"))) {
    throw new Error(`No Qiy skill installation at ${destination}. Run qiy skill install first.`);
  }
  return installSkill(root, force, options);
}

export interface UninstallSkillResult {
  destination: string;
  removed: string[];
  preserved: string[];
}

/**
 * Removes only the bundled official files from an installation and prunes empty
 * directories. Handwritten files under the same directory are preserved.
 */
export function uninstallSkill(root = process.cwd(), options: InstallSkillOptions = {}): UninstallSkillResult {
  const destination = resolveSkillDestination(root, options);
  const status = inspectSkill(destination);
  if (!status.installed && status.missing.length === Object.keys(QIY_SKILL_FILES).length) {
    throw new Error(`No Qiy skill installation at ${destination}.`);
  }
  const removed: string[] = [];
  for (const path of Object.keys(QIY_SKILL_FILES)) {
    const target = generatedPath(destination, path);
    if (!existsSync(target)) continue;
    rmSync(target, { force: true });
    removed.push(path);
    // Prune now-empty parent directories up to (but excluding) the destination.
    let directory = dirname(target);
    while (directory.startsWith(destination) && directory !== destination) {
      if (existsSync(directory) && readdirSync(directory).length === 0) {
        rmdirSync(directory);
        directory = dirname(directory);
      } else break;
    }
  }
  const remaining = inspectSkill(destination);
  if (removed.length === 0) throw new Error(`No official Qiy skill files found at ${destination}.`);
  return { destination, removed, preserved: remaining.unrelated };
}

export function formatSkillStatuses(statuses: SkillStatus[]): string {
  if (statuses.length === 0) return "No Qiy skill installations found. Run qiy skill install.";
  return statuses
    .map((status) => {
      const state = !status.installed ? "incomplete" : status.upToDate ? "up-to-date" : "modified";
      const details = [
        status.missing.length ? `missing ${status.missing.length}` : "",
        status.modified.length ? `modified ${status.modified.length}` : "",
        status.unrelated.length ? `unrelated ${status.unrelated.length}` : "",
      ].filter(Boolean).join(", ");
      return `${status.destination} — ${state}${details ? ` (${details})` : ""}`;
    })
    .join("\n");
}

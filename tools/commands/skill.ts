import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

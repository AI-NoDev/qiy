import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generatedPath } from "../generated-paths";
import { QIY_SKILL_FILES } from "../qiy-skill.data";

export function installSkill(root = process.cwd(), force = false): string {
  const destination = resolve(root, ".agent/skills/qiy");
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

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../.agents/skills/qiy");
const files: Record<string, string> = {};
function visit(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name))) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill bundle cannot contain symbolic links: ${entry.name}`);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile()) files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
  }
}
visit(root);
if (!files["SKILL.md"]) throw new Error("Official Qiy skill is missing SKILL.md");
writeFileSync(join(import.meta.dir, "qiy-skill.data.ts"), `export const QIY_SKILL_FILES: Record<string, string> = ${JSON.stringify(files, null, 2)};\n`);
console.log(`Bundled ${Object.keys(files).length} official Qiy skill files.`);

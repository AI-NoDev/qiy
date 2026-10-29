import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../.agents/skills");
const names = ["bun", "drizzle", "elysia", "qiy", "refine-dev"] as const;
const skills: Record<string, Record<string, string>> = {};
for (const name of names) {
  const directory = join(root, name);
  const files: Record<string, string> = {};
  function visit(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name))) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill bundle cannot contain symbolic links: ${name}/${entry.name}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(directory, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  }
  visit(directory);
  if (!files["SKILL.md"]) throw new Error(`Official ${name} skill is missing SKILL.md`);
  skills[name] = files;
}
writeFileSync(join(import.meta.dir, "qiy-skill.data.ts"), `export const QIY_OFFICIAL_SKILLS: Record<string, Record<string, string>> = ${JSON.stringify(skills, null, 2)};\n\nexport const QIY_SKILL_FILES: Record<string, string> = QIY_OFFICIAL_SKILLS.qiy!;\n`);
console.log(`Bundled ${Object.values(skills).reduce((total, files) => total + Object.keys(files).length, 0)} official skill files across ${names.length} skills.`);

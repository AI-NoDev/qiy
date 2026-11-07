import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { generateProject, projectGenerationOptions } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const root = "docs/en";
const pages = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".md"))
  .map((path) => join(root, path).replace(/\\/g, "/"))
  .sort();

const completeModels = await Promise.all(pages.map(async (path) => {
  const content = (await Bun.file(path).text()).replace(/\r\n/g, "\n");
  const blocks = [...content.matchAll(/^```qiy[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]!);
  return { path, content, models: blocks.filter((block) => block.trimStart().startsWith("qiy v0;")) };
}));

test("the English guide has complete models to check", () => {
  expect(completeModels.flatMap((page) => page.models).length).toBeGreaterThanOrEqual(3);
});

for (const { path, models } of completeModels) {
  models.forEach((source, index) => {
    test(`${path} model ${index + 1} parses and generates`, () => {
      const project = parseQiyProject(source);
      expect(Object.keys(generateProject(project.database, project.name, projectGenerationOptions(project))).length).toBeGreaterThan(0);
    });
  });
}

test("English pages only link to pages that exist", () => {
  const missing = completeModels.flatMap(({ path, content }) =>
    [...content.matchAll(/\]\((\/[^)#\s]*)(?:#[^)]*)?\)/g)]
      .map((match) => match[1]!)
      .filter((link) => !/\.(txt|zip|json|svg|png)$/.test(link))
      .filter((link) => {
        const base = link === "/" ? "docs/index" : `docs${link.replace(/\/$/, "/index")}`;
        return !Bun.file(`${base}.md`).size;
      })
      .map((link) => `${path} -> ${link}`));
  expect(missing).toEqual([]);
});

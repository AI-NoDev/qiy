import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pageDescriptions } from "../docs/.vitepress/seo";
import { buildDocsAssets } from "../tools/build-docs-assets";

const root = resolve(import.meta.dir, "..");
const docs = join(root, "docs");

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "public" || entry.name === ".vitepress" ? [] : markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

const pages = markdownFiles(docs)
  .map((file) => relative(docs, file).replaceAll("\\", "/"))
  .sort();

// Build once for the whole file: repeated rebuilds race with editor watchers on
// Windows and are unnecessary for these assertions.
await buildDocsAssets();

test("every documentation page has a unique, page-specific description", () => {
  expect(pages.length).toBeGreaterThan(40);
  for (const page of pages) {
    const description = pageDescriptions[page];
    expect(description, `missing SEO description for ${page}`).toBeDefined();
    expect(description!.length, `description too short for ${page}`).toBeGreaterThanOrEqual(20);
    expect(description!.length, `description too long for ${page}`).toBeLessThanOrEqual(240);
  }
  const stale = Object.keys(pageDescriptions).filter((page) => !pages.includes(page));
  expect(stale, `stale SEO descriptions: ${stale.join(", ")}`).toEqual([]);
  const descriptions = Object.values(pageDescriptions);
  expect(new Set(descriptions).size).toBe(descriptions.length);
});

test("generated llms.txt indexes every DSL and guide page", () => {
  const llms = readFileSync(join(docs, "public", "llms.txt"), "utf8");
  expect(llms.startsWith("# Qiy\n")).toBe(true);
  for (const section of ["## Start here", "## DSL reference", "## Guides", "## Agent Skill", "## Machine-readable schema"]) {
    expect(llms).toContain(section);
  }
  const urls = [
    "/dsl/overview",
    ...pages.filter((page) => page.startsWith("dsl/")).map((page) => `/${page.replace(/\.md$/, "")}`),
    ...pages.filter((page) => page.startsWith("guide/")).map((page) => `/${page.replace(/\.md$/, "")}`),
  ];
  for (const url of new Set(urls)) expect(llms).toContain(`https://ai-nodev.github.io/qiy${url}`);
  expect(llms).toContain("https://ai-nodev.github.io/qiy/skills/qiy/SKILL.md");
  expect(llms).toContain("https://ai-nodev.github.io/qiy/skills/qiy-skill.tar.gz");
  expect(llms).not.toContain("localhost");
  expect(llms).not.toContain("/qiy/qiy/");
});

test("generated robots, full text and skill assets are consistent", () => {
  const robots = readFileSync(join(docs, "public", "robots.txt"), "utf8");
  expect(robots).toContain("Sitemap: https://ai-nodev.github.io/qiy/sitemap.xml");

  const full = readFileSync(join(docs, "public", "llms-full.txt"), "utf8");
  expect(full.startsWith("# Qiy full documentation\n")).toBe(true);
  expect(full).toContain("Source: https://ai-nodev.github.io/qiy/dsl/permissions");
  expect(full).toContain("Source: https://ai-nodev.github.io/qiy/guide/getting-started");
  expect(full.length).toBeGreaterThan(100_000);

  const skill = join(docs, "public", "skills", "qiy", "SKILL.md");
  expect(existsSync(skill)).toBe(true);
  const packageVersion = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
  expect(readFileSync(skill, "utf8")).toContain(`version: "${packageVersion}"`);
  expect(existsSync(join(docs, "public", "skills", "qiy-skill.tar.gz"))).toBe(true);
  const schemaFile = join(docs, "public", "schema", "qiy-explanation-1.json");
  expect(existsSync(schemaFile)).toBe(true);
  const schema = JSON.parse(readFileSync(schemaFile, "utf8")) as { $id: string; required: string[] };
  expect(schema.$id).toBe("https://ai-nodev.github.io/qiy/schema/qiy-explanation-1.json");
  expect(schema.required).toContain("formatVersion");
});

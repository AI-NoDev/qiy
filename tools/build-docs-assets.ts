import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pageDescriptions } from "../docs/.vitepress/seo";
import { qiyExplanationSchema } from "./qiy-schema";

/**
 * Generates the static, agent-facing assets served by the documentation site:
 *
 * - `docs/public/llms.txt` — curated index for LLM/agent retrieval (llms.txt format)
 * - `docs/public/llms-full.txt` — full DSL + guide text for offline retrieval
 * - `docs/public/skills/qiy/**` — the official Agent Skill (browsable/downloadable)
 * - `docs/public/skills/qiy-skill.tar.gz` — one-file download of the skill bundle
 * - `docs/public/robots.txt` — crawler hints pointing at the sitemap
 *
 * Run automatically by `bun run docs:dev` and `bun run docs:build`; safe to re-run.
 * Exported so `tests/docs-seo.test.ts` can validate the generated files.
 */

const root = resolve(import.meta.dir, "..");
const docs = join(root, "docs");
const publicDir = join(docs, "public");
const siteUrl = (process.env.QIY_DOCS_SITE_URL ?? "https://ai-nodev.github.io/qiy").replace(/\/$/, "");

interface DocPage {
  file: string;
  slug: string;
  title: string;
  description: string;
  body: string;
}

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    })
    .sort();
}

function plainText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstHeading(body: string): string | undefined {
  let fenced = false;
  for (const rawLine of body.split(/\n/)) {
    const line = rawLine.replace(/^\uFEFF/, "").trimEnd();
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = /^#\s+(.+)$/.exec(line);
    if (heading) return heading[1]!.trim();
  }
  return undefined;
}

function readPage(file: string): DocPage {
  // Files written by editors/agents may carry a UTF-8 BOM; strip it before any
  // markdown parsing so titles/links are not misdetected.
  const raw = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const withoutFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const relativePath = relative(docs, file).replace(/\\/g, "/");
  const isHome = relativePath === "index.md";
  const title = isHome ? "Qiy 文档" : (firstHeading(withoutFrontmatter) ?? relativePath.replace(/\.md$/, ""));
  const frontmatterDescription = /^---\n[\s\S]*?\ndescription:\s*"?([^"\n]+)"?\n[\s\S]*?\n---\n/.exec(raw)?.[1]?.trim();
  // The per-page SEO map is the single source of truth for llms.txt too, so the
  // index exposed to search engines and agents cannot drift apart.
  let description = isHome ? "Qiy 文档首页：快速开始、DSL 参考、指南与用法手册。" : (pageDescriptions[relativePath] ?? frontmatterDescription ?? "");
  if (!description) {
    let fenced = false;
    for (const rawLine of withoutFrontmatter.split(/\n+/)) {
      const line = rawLine.trim();
      if (line.startsWith("```")) { fenced = !fenced; continue; }
      if (!line || fenced || line.startsWith("#") || line.startsWith("|") || line.startsWith(":::") || line.startsWith("<") || line.startsWith("-") || line.startsWith("*") || line.startsWith("import ") || line.startsWith("export ")) continue;
      description = plainText(line);
      break;
    }
  }
  if (!description) description = title;
  const slug = "/" + relativePath.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");
  return { file, slug: slug === "/index" ? "/" : slug, title, description: description.slice(0, 200), body: withoutFrontmatter.trim() };
}

const dslOrder = ["overview", "modules", "application", "entity", "relation-index", "generated-values", "enum-menu-dashboard", "charts", "i18n", "auth", "permissions", "dataflow", "actions", "realtime", "storage", "features", "annotations", "errors"];
const guideOrder = ["what-is-qiy", "design-philosophy", "getting-started", "syntax-v1", "cli", "existing-bun-project", "modules", "best-practice-warehouse", "editor-support", "agent-skill", "project-structure", "data-modeling", "api", "auth", "refine-providers", "ui-theming", "menu-dashboard", "api-docs-and-keys", "workflow", "storage", "dsl-cookbook", "deployment", "real-services"];

function ordered(pages: DocPage[], order: string[]): DocPage[] {
  const byName = new Map(pages.map((page) => [page.slug.split("/").pop()!, page]));
  const result = order.flatMap((name) => (byName.has(name) ? [byName.get(name)!] : []));
  return [...result, ...pages.filter((page) => !order.includes(page.slug.split("/").pop()!))];
}

function section(title: string, pages: DocPage[]): string {
  const lines = pages.map((page) => `- [${page.title}](${siteUrl}${page.slug})${page.description ? `: ${page.description}` : ""}`);
  return [`## ${title}`, "", ...lines, ""].join("\n");
}

export function buildDocsAssets(): void {
  const dslPages = ordered(markdownFiles(join(docs, "dsl")).map(readPage), dslOrder);
  const guidePages = ordered(markdownFiles(join(docs, "guide")).map(readPage), guideOrder);

  const llmsTxt = [
    "# Qiy",
    "",
    "> Qiy is a model-driven full-stack application generator. A `.qiy` model produces a Refine + React Router admin, a Bun + Elysia REST/GraphQL API, a Drizzle database layer, tests, documentation and deployment examples.",
    "",
    "Docs are written for Qiy users, application developers and AI agents. Start with the quickstart or the DSL overview; each page contains grammar, defaults, validation, generated output, examples and common errors.",
    "",
    section("Start here", [
      readPage(join(docs, "index.md")),
      readPage(join(docs, "guide", "what-is-qiy.md")),
      readPage(join(docs, "guide", "getting-started.md")),
      readPage(join(docs, "guide", "cli.md")),
    ]),
    section("DSL reference", dslPages),
    section("Guides", guidePages),
    [
      "## Agent Skill",
      "",
      `- [Skill guide](${siteUrl}/guide/agent-skill): install and use the official Qiy skill.`,
      `- [SKILL.md](${siteUrl}/skills/qiy/SKILL.md): the skill entrypoint, routing to modular references.`,
      `- [Skill bundle download](${siteUrl}/skills/qiy-skill.tar.gz): complete skill with references and example.`,
      `- Official companion skills: [refine-dev](${siteUrl}/skills/refine-dev/SKILL.md), [bun](${siteUrl}/skills/bun/SKILL.md), [drizzle](${siteUrl}/skills/drizzle/SKILL.md), [elysia](${siteUrl}/skills/elysia/SKILL.md).`,
      "- CLI install: `qiy skill install [name]` / `qiy skill install --all` (project), `--global` (user), `--dir <path>` (custom agent directory).",
      "",
    ].join("\n"),
    [
      "## Machine-readable schema",
      "",
      `- [qiy explain JSON Schema](${siteUrl}/schema/qiy-explanation-1.json): validate \`qiy explain --json\` output.`,
      "- Generate it with `qiy schema`; inspect a model with `qiy explain <file.qiy> [--json]`.",
      "",
    ].join("\n"),
    [
      "## Optional",
      "",
      "- [Repository](https://github.com/AI-NoDev/qiy)",
      "- [Releases](https://github.com/AI-NoDev/qiy/releases/latest)",
      "",
    ].join("\n"),
  ].join("\n");

  const llmsFull = [
    "# Qiy full documentation",
    "",
    `> Complete text of the Qiy DSL reference and guides. Canonical index: ${siteUrl}/llms.txt`,
    "",
    ...dslPages.flatMap((page) => [`# ${page.title}`, "", `Source: ${siteUrl}${page.slug}`, "", page.body, ""]),
    ...guidePages.flatMap((page) => [`# ${page.title}`, "", `Source: ${siteUrl}${page.slug}`, "", page.body, ""]),
  ].join("\n");

  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, "llms.txt"), llmsTxt);
  writeFileSync(join(publicDir, "llms-full.txt"), llmsFull);
  writeFileSync(
    join(publicDir, "robots.txt"),
    ["User-agent: *", "Allow: /", `Sitemap: ${siteUrl}/sitemap.xml`, ""].join("\n"),
  );
  const schemaDir = join(publicDir, "schema");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "qiy-explanation-1.json"), `${JSON.stringify(qiyExplanationSchema, null, 2)}\n`);

  const officialSkills = ["qiy", "refine-dev", "bun", "drizzle", "elysia"];
  let skillFiles = 0;
  for (const name of officialSkills) {
    const source = join(root, ".agents", "skills", name);
    const destination = join(publicDir, "skills", name);
    rmSync(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    mkdirSync(destination, { recursive: true });
    cpSync(source, destination, { recursive: true });
    skillFiles += readdirSync(destination, { recursive: true }).length;
    const archive = join(publicDir, "skills", `${name}-skill.tar.gz`);
    rmSync(archive, { force: true });
    const tar = Bun.spawnSync(["tar", "-czf", archive, "-C", join(root, ".agents", "skills"), name], { stdout: "pipe", stderr: "pipe" });
    if (tar.exitCode !== 0) throw new Error(`Failed to create ${name} skill archive: ${tar.stderr.toString()}`);
  }
  const skillBytes = statSync(join(publicDir, "skills", "qiy-skill.tar.gz")).size;
  console.log(
    `Docs assets: llms.txt (${llmsTxt.length} bytes), llms-full.txt (${llmsFull.length} bytes), ${officialSkills.length} official skills (${skillFiles} files), qiy-skill.tar.gz (${skillBytes} bytes)`,
  );
}

if (import.meta.main) buildDocsAssets();

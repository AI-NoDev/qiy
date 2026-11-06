import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { generateApp } from "../tools/commands/generate-app";
import { initApp } from "../tools/commands/init";
import { installSkill, resolveSkillDestination } from "../tools/commands/skill";
import { QIY_SKILL_FILES } from "../tools/qiy-skill.data";

const model = `qiy v0; application inventory {
  database sqlite {}
  entity products { field id UUID @id; field title Text; }
}`;

function checkLinks(root: string, path: string): void {
  const text = readFileSync(join(root, path), "utf8");
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1]!;
    if (/^https?:\/\//.test(target) || target.startsWith("#")) continue;
    expect(existsSync(resolve(root, path, "..", target))).toBe(true);
  }
}

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

test("create documents actual generated files and preserves custom agent instructions on sync", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-ai-create-"));
  const source = join(root, "app.qiy");
  const output = join(root, "admin");
  writeFileSync(source, model);
  await generateApp(source, output);
  checkLinks(output, "AGENTS.md");
  checkLinks(output, "AGENT.MD");
  checkLinks(output, "openwiki/quickstart.md");
  checkLinks(output, "openwiki/architecture.md");
  expect(readFileSync(join(output, "openwiki/development.md"), "utf8")).toContain("apps/server");
  writeFileSync(join(output, "AGENTS.md"), "Custom development rules");
  writeFileSync(join(output, "openwiki/custom.md"), "Custom business rules");
  await generateApp(source, output, { sync: true });
  expect(readFileSync(join(output, "AGENTS.md"), "utf8")).toBe("Custom development rules");
  expect(readFileSync(join(output, "openwiki/custom.md"), "utf8")).toBe("Custom business rules");
});

test("init uses aliases and namespaced wiki without replacing host documentation", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-ai-init-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", packageManager: "bun@1.3.13" }));
  writeFileSync(join(root, "AGENTS.md"), "Host instructions");
  mkdirSync(join(root, "openwiki"));
  writeFileSync(join(root, "openwiki/quickstart.md"), "Host wiki");
  writeFileSync(join(root, "app.qiy"), model.replace("database sqlite {}", 'database sqlite {} mode integration; integration { apiBase "/api"; auth none; } workspace { aliases { web ops-console; } }'));
  await initApp({ root, source: "app.qiy" });
  checkLinks(root, "apps/ops-console/AGENTS.md");
  checkLinks(root, "openwiki/qiy-inventory/architecture.md");
  const wiki = readFileSync(join(root, "openwiki/qiy-inventory/development.md"), "utf8");
  expect(wiki).toContain("apps/ops-console");
  expect(wiki).not.toContain("apps/server");
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("Host instructions");
  expect(readFileSync(join(root, "openwiki/quickstart.md"), "utf8")).toBe("Host wiki");
  writeFileSync(join(root, "apps/ops-console/AGENT.MD"), "Local agent guide");
  await initApp({ root, source: "app.qiy", sync: true });
  expect(readFileSync(join(root, "apps/ops-console/AGENT.MD"), "utf8")).toBe("Local agent guide");
});

test("official skill installs complete resources offline and preflights local changes", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-skill-"));
  const installed = installSkill(root);
  for (const [path, content] of Object.entries(QIY_SKILL_FILES)) {
    expect(readFileSync(join(installed, path), "utf8")).toBe(content);
    expect(readFileSync(resolve(import.meta.dir, "../.agents/skills/qiy", path), "utf8")).toBe(content);
  }
  checkLinks(installed, "SKILL.md");
  const installedMarkdown = markdownFiles(installed).map((file) => relative(installed, file).replaceAll("\\", "/"));
  expect(installedMarkdown.length).toBe(Object.keys(QIY_SKILL_FILES).filter((path) => path.endsWith(".md")).length);
  for (const path of installedMarkdown) checkLinks(installed, path);
  installSkill(root);
  writeFileSync(join(installed, "SKILL.md"), "Local edits");
  writeFileSync(join(installed, "custom.md"), "Keep this");
  expect(() => installSkill(root)).toThrow("local changes");
  expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe("Local edits");
  installSkill(root, true);
  expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe(QIY_SKILL_FILES["SKILL.md"]!);
  expect(readFileSync(join(installed, "custom.md"), "utf8")).toBe("Keep this");
});

test("official skill installs into global and agent-specific directories", () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-skill-project-"));
  const home = mkdtempSync(join(tmpdir(), "qiy-skill-home-"));
  expect(resolveSkillDestination(root, { home })).toBe(join(root, ".agents/skills/qiy"));
  const global = resolveSkillDestination(root, { home, global: true });
  expect(global).toBe(join(home, ".agents/skills/qiy"));
  const custom = resolveSkillDestination(root, { home, dir: ".claude/skills/qiy" });
  expect(custom).toBe(join(root, ".claude/skills/qiy"));
  expect(resolveSkillDestination(root, { home, dir: "~/.codex/skills/qiy" })).toBe(join(home, ".codex/skills/qiy"));

  const installedGlobal = installSkill(root, false, { home, global: true });
  expect(readFileSync(join(installedGlobal, "SKILL.md"), "utf8")).toBe(QIY_SKILL_FILES["SKILL.md"]!);
  const installedCustom = installSkill(root, false, { dir: ".claude/skills/qiy" });
  expect(readFileSync(join(installedCustom, "references/cli-workflows.md"), "utf8")).toBe(QIY_SKILL_FILES["references/cli-workflows.md"]!);

  // Legacy projects keep updating their original directory.
  const legacyRoot = mkdtempSync(join(tmpdir(), "qiy-skill-legacy-"));
  mkdirSync(join(legacyRoot, ".agent/skills/qiy"), { recursive: true });
  const legacy = installSkill(legacyRoot);
  expect(legacy).toBe(join(legacyRoot, ".agent/skills/qiy"));
});

test("official skill is a compact router with complete, keyword-covered references", () => {
  const skillRoot = resolve(import.meta.dir, "../.agents/skills/qiy");
  const files = markdownFiles(skillRoot)
    .map((file) => relative(skillRoot, file).replaceAll("\\", "/"))
    .sort();
  expect(files).toContain("SKILL.md");
  expect(files).toContain("examples/warehouse-admin/README.md");
  for (const file of files) checkLinks(skillRoot, file);

  const skillText = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  expect(skillText.split("\n").length).toBeLessThanOrEqual(150);
  expect(skillText).toContain("## Progressive disclosure");
  for (const keyword of ["qiy create", "qiy init", "qiy generate", "--sync", "skill install --global", "--dir"]) {
    expect(skillText).toContain(keyword);
  }
  // Keep the skill metadata version aligned with the CLI package version so the
  // bundled skill always advertises the release it shipped in.
  const packageVersion = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")).version as string;
  expect(skillText).toContain(`version: "${packageVersion}"`);

  // Each reference must exist and mention the DSL areas it owns, so an agent can
  // retrieve a self-contained answer without falling back to the website.
  const coverage: Record<string, string[]> = {
    "references/language-reference.md": ["annotations", "@code", "restrict", "scope", "messages", "features", "chart panels"],
    "references/modeling-and-generation.md": ["@code", "relation", "index", "display template", "include"],
    "references/auth-permissions.md": ["permissions", "verify", "restrict", "scope", "API key", "onboarding"],
    "references/refine-providers.md": ["DataProvider", "AuthProvider", "can()", "LiveProvider", "AuditLogProvider"],
    "references/dataflows-actions.md": ["dataflow", "app.test.qiy", "idempotency", "orderInventory"],
    "references/ui-charts-i18n.md": ["charts", "chart panels", "messages", "menu", "colorMode"],
    "references/system-features.md": ["features", "apiKeys", "OpenAPI", "qiy_api_keys"],
    "references/storage-realtime.md": ["storage", "realtime", "attachments", "outbox"],
    "references/testing-deployment.md": ["typecheck", "deploy", "migration", "db:check"],
    "references/cli-workflows.md": ["create", "init", "--sync", "doctor", "skill install --dir"],
    "references/workspace-integration.md": ["mode integration", "aliases", "CSRF", "tenant"],
    "references/troubleshooting.md": ["401", "403", "drift"],
  };
  for (const [file, keywords] of Object.entries(coverage)) {
    expect(files).toContain(file);
    const text = readFileSync(join(skillRoot, file), "utf8").toLowerCase();
    for (const keyword of keywords) expect(text).toContain(keyword.toLowerCase());
  }
});

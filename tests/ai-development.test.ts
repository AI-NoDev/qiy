import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
    if (/^https?:\/\//.test(match[1]!)) continue;
    expect(existsSync(resolve(root, path, "..", match[1]!))).toBe(true);
  }
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

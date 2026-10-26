import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  formatSkillStatuses,
  inspectSkill,
  installSkill,
  listSkillInstallations,
  resolveSkillDestination,
  uninstallSkill,
  updateSkill,
} from "../tools/commands/skill";

function temporaryRoot(): string {
  return mkdtempSync(join(tmpdir(), "qiy-skill-lifecycle-"));
}

test("inspect and list report project, legacy and global installations", () => {
  const root = temporaryRoot();
  const home = join(root, "home");
  installSkill(root, false, { home });
  const project = join(root, ".agents/skills/qiy");
  expect(inspectSkill(project).upToDate).toBe(true);

  const statuses = listSkillInstallations(root, { home });
  expect(statuses.map((status) => status.destination)).toEqual([project]);
  expect(statuses[0]!.installed).toBe(true);
  expect(statuses[0]!.upToDate).toBe(true);

  installSkill(root, false, { home, global: true });
  const withGlobal = listSkillInstallations(root, { home });
  expect(withGlobal).toHaveLength(2);
  expect(withGlobal.some((status) => status.destination === join(home, ".agents/skills/qiy"))).toBe(true);
  expect(formatSkillStatuses(withGlobal)).toContain("up-to-date");
});

test("modified official files are detected, refused by update and replaceable with force", () => {
  const root = temporaryRoot();
  installSkill(root, false);
  const destination = join(root, ".agents/skills/qiy");
  const readme = join(destination, "references/cli-workflows.md");
  writeFileSync(readme, `${readFileSync(readme, "utf8")}\nlocal edit\n`);

  const inspected = inspectSkill(destination);
  expect(inspected.upToDate).toBe(false);
  expect(inspected.modified).toContain("references/cli-workflows.md");
  expect(() => updateSkill(root)).toThrow(/local changes/);
  updateSkill(root, true);
  expect(inspectSkill(destination).upToDate).toBe(true);
});

test("uninstall removes only official files and preserves unrelated files", () => {
  const root = temporaryRoot();
  installSkill(root, false);
  const destination = join(root, ".agents/skills/qiy");
  writeFileSync(join(destination, "references/team-notes.md"), "keep me\n");
  const result = uninstallSkill(root);
  expect(result.removed).toContain("SKILL.md");
  expect(result.removed).not.toContain("references/team-notes.md");
  expect(result.preserved).toContain("references/team-notes.md");
  expect(existsSync(join(destination, "SKILL.md"))).toBe(false);
  expect(readFileSync(join(destination, "references/team-notes.md"), "utf8")).toBe("keep me\n");
  expect(() => uninstallSkill(root)).toThrow(/No (official Qiy skill files|Qiy skill installation)/);
});

test("local project installs win over legacy and custom --dir is absolute or root-relative", () => {
  const root = temporaryRoot();
  expect(resolveSkillDestination(root, { home: join(root, "home") })).toBe(join(root, ".agents/skills/qiy"));
  expect(resolveSkillDestination(root, { home: join(root, "home"), dir: "custom/skills/qiy" })).toBe(join(root, "custom/skills/qiy"));
  expect(resolveSkillDestination(root, { home: join(root, "home"), dir: "~/skills/qiy" })).toBe(join(root, "home", "skills/qiy"));
});

test("the CLI exposes skill list/update/uninstall", () => {
  const root = temporaryRoot();
  installSkill(root, false);
  const cli = resolve(import.meta.dir, "../tools/cli.ts");
  const destination = join(root, ".agents/skills/qiy");
  const list = Bun.spawnSync([process.execPath, "run", cli, "skill", "list", "--json", "--dir", destination], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(list.exitCode).toBe(0);
  const statuses = JSON.parse(list.stdout.toString()) as Array<{ destination: string; upToDate: boolean }>;
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.upToDate).toBe(true);

  const help = Bun.spawnSync([process.execPath, "run", cli, "--help"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(help.exitCode).toBe(0);
  const text = help.stdout.toString();
  for (const command of ["skill list", "skill update", "skill uninstall"]) expect(text).toContain(command);
});

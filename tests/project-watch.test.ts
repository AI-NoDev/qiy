import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchProjectModel } from "../tools/commands/project";
import { createQiyProject, readQiyProject } from "../tools/project";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("watchProjectModel regenerates after debounced .qiy edits and stops on close", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "qiy-project-watch-"));
  createQiyProject("watch-me", { cwd });
  const project = readQiyProject(join(cwd, "watch-me"));
  const moduleFile = join(project.root, "model/modules/10-catalog.qiy");
  let calls = 0;
  let firstCall: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { firstCall = resolve; });
  const watcher = watchProjectModel(project, () => {
    calls += 1;
    firstCall?.();
  }, { debounceMs: 30 });
  await sleep(100);

  // Two rapid writes must coalesce into one regeneration.
  appendFileSync(moduleFile, "\n# first edit\n");
  appendFileSync(moduleFile, "\n# second edit\n");
  await Promise.race([first, sleep(5000).then(() => { throw new Error("watch callback did not fire"); })]);
  await sleep(120);
  expect(calls).toBe(1);

  watcher.close();
  appendFileSync(moduleFile, "\n# after close\n");
  await sleep(200);
  expect(calls).toBe(1);
}, { timeout: 10000 });

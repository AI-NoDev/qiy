import { expect, test } from "bun:test";
import { ADMIN_TEMPLATE_FILES } from "../tools/admin-template.data";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

// Sandboxed Windows shells deny the OS temp directory, which made the generated
// workspace's root `turbo run test` fail with EPERM; tests must stay workspace-local.
test("generated app tests never write scratch files under the OS temp directory", () => {
  const project = parseQiyProject(`qiy v0; application temp-demo {
    database sqlite {}
    entity notes { field id UUID @id; field title Text; field file File @nullable; }
  }`);
  const files = { ...ADMIN_TEMPLATE_FILES, ...generateProject(project.database, "temp-demo") } as Record<string, string>;
  const testFiles = Object.entries(files).filter(([path]) => /^apps\/(server|web)\/tests\//.test(path));
  expect(testFiles.length).toBeGreaterThan(0);
  for (const [path, contents] of testFiles) {
    expect({ path, usesOsTemp: /\btmpdir\(\)|os\.tmpdir|process\.env\.(TEMP|TMP)\b/.test(contents) }).toEqual({ path, usesOsTemp: false });
  }
});

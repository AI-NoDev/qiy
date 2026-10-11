import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const source = await Bun.file(new URL("../examples/dataflow/roles.qiy", import.meta.url)).text();

test("standalone audit integrates server authority and Refine read-only history", () => {
  const project = parseQiyProject(source);
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/app.ts"]).toContain('import("./audit/routes")');
  expect(files["apps/server/src/audit/repository.ts"]).toContain("leftJoin(users");
  expect(files["apps/server/src/audit/repository.ts"]).not.toContain("passwordHash");
  expect(files["apps/web/app/root.tsx"]).toContain("auditLogProvider={auditLogProvider}");
  expect(files["apps/web/app/root.tsx"]).toContain("audit: []");
  expect(files["apps/web/app/routes/show.tsx"]).toContain('action="audit"');
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain("useNotification");
  expect(files["apps/web/app/components/business-actions.tsx"]).not.toContain("message.success");
  expect(files["apps/web/app/auth.ts"]).toContain("onError: async (error)");
});

test("author permissions follow model table names rather than hardcoded users", () => {
  const project = parseQiyProject(source.replaceAll("users", "accounts"));
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/auth/guard.ts"]).toContain('resource.path === "accounts"');
  expect(files["apps/web/app/auth.ts"]).toContain('resource === "accounts"');
  expect(files["apps/server/src/audit/repository.ts"]).toContain("leftJoin(accounts");
});

test("audit endpoints and providers are absent without configured authentication", () => {
  const project = parseQiyProject('qiy v0; application demo { database sqlite {} entity items { field id UUID @id; field name Text; } }');
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/audit/routes.ts"]).toBeUndefined();
  expect(files["apps/web/app/providers/audit-log-provider.ts"]).toBeUndefined();
});

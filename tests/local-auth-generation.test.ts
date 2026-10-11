import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const source = `qiy v0;
application qiy-local-auth {
  database sqlite {}
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum role { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable @visible(false);
    field role role;
  }
}`;

test("generates local username/password auth without OIDC configuration", () => {
  const project = parseQiyProject(source);
  const files = generateProject(project.database, project.name, { auth: project.auth });

  expect(project.auth?.provider).toBe("local");
  expect(files["apps/server/src/auth/local.ts"]).toContain('post("/login"');
  expect(files["apps/server/src/auth/local.ts"]).not.toContain('post("/password"');
  expect(files["apps/server/src/auth/password.ts"]).toContain("Bun.password.verify");
  expect(files["apps/server/src/auth/set-password.ts"]).toContain("New password (minimum 8 characters)");
  expect(files["apps/server/src/auth/bootstrap-admin.ts"]).toContain("An admin account already exists");
  expect(files["apps/server/src/auth/bootstrap-admin.ts"]).not.toContain('const displayName =');
  expect(JSON.parse(files["apps/server/package.json"]!).scripts["auth:bootstrap-admin"]).toBe("bun --env-file=.env.production src/auth/bootstrap-admin.ts");
  expect(JSON.parse(files["apps/server/package.json"]!).scripts["auth:set-password"]).toBe("bun --env-file=.env.production src/auth/set-password.ts");
  expect(files["apps/server/src/auth/oidc.ts"]).toBeUndefined();
  expect(files["apps/server/tests/local-auth.test.ts"]).toContain("correct-horse-battery");
  expect(files["apps/server/src/modules/users/users.routes.ts"]).not.toContain('"passwordHash": t.Optional');
  expect(files["apps/server/src/modules/users/users.routes.ts"]).toContain('privateFields.some((field) => Object.hasOwn(values, field))');
  expect(files["apps/server/src/graphql.ts"]).not.toContain("passwordHash: String");
  expect(files["apps/server/tests/users.test.ts"]).toContain("never returns or persists private field passwordHash");
  expect(files["apps/web/app/auth.ts"]).toContain('fetch("/api/v1/auth/login"');
  expect(files["apps/web/app/routes/login.tsx"]).toContain('import { AuthPage } from "@refinedev/antd"');
  expect(files["apps/web/app/routes/login.tsx"]).toContain('type="login"');
  expect(files["apps/server/.env.example"]).toContain("QIY_AUTH_SECRET");
});

test("rejects a local auth model without a username or password hash field", () => {
  expect(() => parseQiyProject(`qiy v0; application invalid-local { database sqlite {} auth { provider local; user users; roleField role; usernameField email; } }`)).toThrow("requires usernameField and passwordField");
});

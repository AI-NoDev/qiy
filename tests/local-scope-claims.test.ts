import { expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { generateServer } from "../tools/generate-server";
import type { QiyProject } from "../tools/qiy-project";

function scopeDatabase(): DatabaseIR {
  return {
    dialect: "sqlite",
    extensions: [],
    enums: [{ name: "userRole", values: [{ name: "admin" }, { name: "operator" }, { name: "viewer" }] }],
    entities: [
      {
        name: "users",
        tableName: "users",
        fields: [
          { name: "id", type: "UUID", primaryKey: true },
          { name: "email", type: "Text", unique: true },
          { name: "passwordHash", type: "Text", nullable: true },
          { name: "role", type: "Text", enumName: "userRole" },
          { name: "orgId", type: "UUID", nullable: true },
        ],
      },
      {
        name: "warehouses",
        tableName: "warehouses",
        fields: [
          { name: "id", type: "UUID", primaryKey: true },
          { name: "name", type: "Text" },
          { name: "orgId", type: "UUID" },
        ],
      },
    ],
  };
}

const localAuth: NonNullable<QiyProject["auth"]> = {
  provider: "local",
  userEntity: "users",
  subjectField: "subject",
  roleField: "role",
  usernameField: "email",
  passwordField: "passwordHash",
};

test("local password sessions resolve data scope claims from user fields", () => {
  const files = generateServer(scopeDatabase(), {
    auth: localAuth,
    scopes: [{ resource: "warehouses", field: "orgId", claim: "org.id" }],
  });
  const local = files["api/src/auth/local.ts"]!;
  expect(local).toContain('claims["org.id"]');
  expect(local).toContain("row.orgId");
});

test("flat scope claims map to the same-named user field", () => {
  const files = generateServer(scopeDatabase(), {
    auth: localAuth,
    scopes: [{ resource: "warehouses", field: "orgId", claim: "orgId" }],
  });
  expect(files["api/src/auth/local.ts"]!).toContain('claims["orgId"]');
});

test("a scope claim without a matching user field fails generation", () => {
  expect(() =>
    generateServer(scopeDatabase(), {
      auth: localAuth,
      scopes: [{ resource: "warehouses", field: "orgId", claim: "tenant.region" }],
    }),
  ).toThrow("Data scope claim tenant.region needs a matching field on users (expected tenantRegion)");
});

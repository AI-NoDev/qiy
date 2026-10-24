import { describe, expect, test } from "bun:test";
import type { DatabaseIR, FieldIR } from "../tools/database-ir";
import { generatedFieldKind, generatedFieldsOf, validateDatabaseIR } from "../tools/database-ir";
import { generateDrizzleMysql } from "../tools/drizzle-mysql";
import { generateDrizzlePostgres } from "../tools/drizzle-pg";
import { generateDrizzleSqlite } from "../tools/drizzle-sqlite";
import { generateServer } from "../tools/generate-server";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

function fixture(dialect: DatabaseIR["dialect"], options: { selfRelation?: boolean; code?: boolean } = {}): DatabaseIR {
  const selfRelation = options.selfRelation ?? true;
  const code: FieldIR = options.code === false
    ? { name: "code", type: "Text", unique: true }
    : { name: "code", type: "Text", unique: true, codeTemplate: "ORG-{YYYY}{MM}-{seq:4}" };
  return {
    dialect,
    extensions: [],
    entities: [
      {
        name: "orgs",
        tableName: "orgs",
        fields: [
          { name: "id", type: "UUID", primaryKey: true },
          code,
          { name: "name", type: "Text" },
          ...(selfRelation ? [{ name: "parentId", type: "UUID" as const, nullable: true }] : []),
          { name: "externalId", type: "UUID", nullable: true, generatedValue: "uuid" },
          { name: "referenceId", type: "UUID", nullable: true },
        ],
      },
      {
        name: "customers",
        tableName: "customers",
        fields: [
          { name: "id", type: "UUID", primaryKey: true },
          { name: "name", type: "Text" },
        ],
      },
    ],
    relations: selfRelation
      ? [{ name: "orgParent", fromEntity: "orgs", fromField: "parentId", toEntity: "orgs", toField: "id", cardinality: "one", onDelete: "setNull" }]
      : [],
  };
}

describe("generated field detection", () => {
  test("treats @code, @generated and non-relation UUIDs as server-generated", () => {
    const database = fixture("sqlite");
    const generated = generatedFieldsOf(database.entities[0]!, database.relations ?? []);
    expect(generated.map((entry) => [entry.field.name, entry.kind, entry.template])).toEqual([
      ["code", "code", "ORG-{YYYY}{MM}-{seq:4}"],
      ["externalId", "uuid", undefined],
      ["referenceId", "uuid", undefined],
    ]);
    expect(generatedFieldKind({ name: "id", type: "UUID", primaryKey: true })).toBeUndefined();
    expect(generatedFieldKind({ name: "parentId", type: "UUID", nullable: true }, { hasRelation: true })).toBeUndefined();
    expect(generatedFieldKind({ name: "note", type: "Text" })).toBeUndefined();
  });

  test("rejects invalid generated annotations in the database IR", () => {
    const invalidTemplate = fixture("sqlite");
    invalidTemplate.entities[0]!.fields[1]!.codeTemplate = "ORG-{nope}";
    expect(validateDatabaseIR(invalidTemplate).join("\n")).toContain("unknown token {nope}");

    const wrongCodeType = fixture("sqlite");
    wrongCodeType.entities[0]!.fields.push({ name: "quantity", type: "Integer", codeTemplate: "QTY-{seq}" });
    expect(validateDatabaseIR(wrongCodeType).join("\n")).toContain("@code requires a Text field");

    const wrongGeneratedType = fixture("sqlite");
    wrongGeneratedType.entities[0]!.fields[2]!.generatedValue = "uuid";
    expect(validateDatabaseIR(wrongGeneratedType).join("\n")).toContain("@generated(uuid) requires a UUID field");

    const generatedPrimaryKey = fixture("sqlite");
    generatedPrimaryKey.entities[0]!.fields[0]!.generatedValue = "uuid";
    expect(validateDatabaseIR(generatedPrimaryKey).join("\n")).toContain("ids are always generated");

    const generatedForeignKey = fixture("sqlite");
    generatedForeignKey.entities[0]!.fields[3]!.generatedValue = "uuid";
    expect(validateDatabaseIR(generatedForeignKey).join("\n")).toContain("server-generated and cannot reference another record");
  });
});

describe("migration-free generated SQL", () => {
  test("renders a typed self reference and the sequence table for every dialect", () => {
    const postgres = generateDrizzlePostgres(fixture("postgresql"));
    expect(postgres).toContain('import type { AnyPgColumn } from "drizzle-orm/pg-core"');
    expect(postgres).toContain('"parentId": uuid("parentId").references((): AnyPgColumn => orgs["id"], { onDelete: "set null" })');
    expect(postgres).toContain('export const qiyCodeSequences = pgTable("qiy_code_sequences"');
    expect(postgres).toContain("primaryKey({ columns: [table.entity, table.field, table.bucket] })");

    const sqlite = generateDrizzleSqlite(fixture("sqlite"));
    expect(sqlite).toContain('import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"');
    expect(sqlite).toContain('"parentId": text("parentId").references((): AnySQLiteColumn => orgs["id"], { onDelete: "set null" })');
    expect(sqlite).toContain('export const qiyCodeSequences = sqliteTable("qiy_code_sequences"');

    const mysql = generateDrizzleMysql(fixture("mysql"));
    expect(mysql).toContain('import type { AnyMySqlColumn } from "drizzle-orm/mysql-core"');
    expect(mysql).toContain('"parentId": varchar("parentId", { length: 36 }).references((): AnyMySqlColumn => orgs["id"], { onDelete: "set null" })');
    expect(mysql).toContain('export const qiyCodeSequences = mysqlTable("qiy_code_sequences"');
  });

  test("keeps cross-entity references and omits unused self-reference imports", () => {
    const database = fixture("postgresql", { selfRelation: false });
    database.entities[1]!.fields.push({ name: "orgId", type: "UUID" });
    database.relations = [{ name: "customerOrg", fromEntity: "customers", fromField: "orgId", toEntity: "orgs", toField: "id", cardinality: "one", onDelete: "restrict" }];
    const postgres = generateDrizzlePostgres(database);
    expect(postgres).not.toContain("AnyPgColumn");
    expect(postgres).toContain('"orgId": uuid("orgId").references(() => orgs["id"], { onDelete: "restrict" }).notNull()');
  });

  test("omits the sequence table and imports when the model has no @code field", () => {
    for (const dialect of ["postgresql", "sqlite", "mysql"] as const) {
      const database = fixture(dialect, { code: false });
      const source = dialect === "postgresql" ? generateDrizzlePostgres(database) : dialect === "sqlite" ? generateDrizzleSqlite(database) : generateDrizzleMysql(database);
      expect(source).not.toContain("qiy_code_sequences");
    }
  });
});

describe("generated values in the generated server", () => {
  test("emits the runtime module, repository wiring, optional inputs and the 409 handler", () => {
    const database = fixture("sqlite");
    const files = generateServer(database);
    const runtime = files["api/src/generated-values.ts"]!;
    expect(runtime).toContain("export async function qiyGenerateValues");
    expect(runtime).toContain("qiyCreateWithGeneratedValues");
    expect(runtime).toContain("qiyStripGeneratedValues");
    expect(runtime).toContain("QiyGeneratedValueConflict");
    expect(runtime).toContain("QIY_CODE_TIMEZONE");
    expect(runtime).toContain("onConflictDoUpdate");
    expect(runtime).toContain("qiyCodeTemplateBucket");

    const repository = files["api/src/modules/orgs/orgs.repository.ts"]!;
    expect(repository).toContain('import { qiyCreateWithGeneratedValues, type QiyGeneratedField } from "../../generated-values"');
    expect(repository).toContain('return qiyCreateWithGeneratedValues("orgs", [{"field":"code","kind":"code","template":"ORG-{YYYY}{MM}-{seq:4}"},{"field":"externalId","kind":"uuid"},{"field":"referenceId","kind":"uuid"}], values,');
    expect(repository).toContain("...prepared,");

    const service = files["api/src/modules/orgs/orgs.service.ts"]!;
    expect(service).toContain("qiyStripGeneratedValues(values, qiyGeneratedFields)");
    expect(service).toContain("if (Object.keys(prepared).length === 0) return repository.one(id, scope)");

    const routes = files["api/src/modules/orgs/orgs.routes.ts"]!;
    expect(routes).toContain("QiyGeneratedValueConflict");
    expect(routes).toContain('errorKey: "generated.conflict"');
    expect(routes).toContain('"code": t.Optional(t.String({ minLength: 1 }))');
    expect(routes).toContain('"externalId": t.Optional(t.Union([t.String({ format: "uuid" }), t.Null()]');

    expect(files["api/src/graphql.ts"]).toContain("input OrgsCreateInput {\\n  code: String\\n  name: String!\\n");
    expect(files["api/tests/generated-values.test.ts"]).toContain("creates unique codes under concurrent creation");
  });

  test("uses dialect-specific sequence allocation", () => {
    const postgres = generateServer(fixture("postgresql"), {})["api/src/generated-values.ts"]!;
    expect(postgres).toContain("import { and, eq, sql } from \"drizzle-orm\"");
    expect(postgres).toContain(".returning({ value: qiyCodeSequences.value })");
    const mysql = generateServer(fixture("mysql"), {})["api/src/generated-values.ts"]!;
    expect(mysql).toContain("for(\"update\")");
    expect(mysql).toContain("db.transaction(async (tx)");
  });

  test("leaves models without generated values unchanged", () => {
    const database = fixture("sqlite", { code: false, selfRelation: false });
    database.entities[0]!.fields = database.entities[0]!.fields.filter((field) => !["externalId", "referenceId"].includes(field.name));
    const files = generateServer(database);
    expect(files["api/src/generated-values.ts"]).toBeUndefined();
    expect(files["api/tests/generated-values.test.ts"]).toBeUndefined();
    expect(files["api/src/modules/orgs/orgs.repository.ts"]).not.toContain("qiyCreateWithGeneratedValues");
  });
});

describe("generated values in the generated web app", () => {
  test("marks generated fields and hides them from the create form", () => {
    const files = generateWeb(fixture("sqlite"));
    const resources = files["web/app/resources.ts"]!;
    expect(resources).toContain("autoGenerated?: boolean");
    expect(resources).toContain("createFormFields");
    expect(resources).toContain("generatedFormFields");
    expect((resources.match(/"autoGenerated": true/g) ?? []).length).toBe(3);
    expect(files["web/app/components/resource-form.tsx"]).toContain("id ? editFormFields(resource) : createFormFields(resource)");
    expect(files["web/app/components/resource-form.tsx"]).toContain('<Input disabled />');
    expect(files["web/tests/generated-fields.test.ts"]).toContain("hides generated fields on create");
    expect(files["web/app/i18n.ts"]).toContain("autoGenerated:");
  });
});

describe("DSL round trip", () => {
  test("parses and serializes @code and @generated", () => {
    const source = `qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field code Text @unique @code("ORG-{YYYYMM}-{seq:4}");
    field name Text;
    field externalId UUID @nullable @generated(uuid);
    field referenceId UUID @nullable;
  }
}
`;
    const project = parseQiyProject(source);
    const orgs = project.database.entities[0]!;
    expect(orgs.fields.find((field) => field.name === "code")?.codeTemplate).toBe("ORG-{YYYYMM}-{seq:4}");
    expect(orgs.fields.find((field) => field.name === "externalId")?.generatedValue).toBe("uuid");
    expect(serializeQiyProject(project)).toContain('@code("ORG-{YYYYMM}-{seq:4}")');
    expect(serializeQiyProject(project)).toContain("@generated(uuid)");
    expect(parseQiyProject(serializeQiyProject(project)).database).toEqual(project.database);
  });

  test("accepts @generated without arguments and rejects invalid annotations", () => {
    expect(() => parseQiyProject(`qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field name Text;
    field externalId UUID @generated;
  }
}
`)).not.toThrow();
    expect(() => parseQiyProject(`qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field code Text @code("ORG-{nope}");
  }
}
`)).toThrow("unknown token {nope}");
    expect(() => parseQiyProject(`qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field count Integer @code("C-{seq}");
  }
}
`)).toThrow("@code requires a Text field");
    expect(() => parseQiyProject(`qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field name Text @generated(uuid);
  }
}
`)).toThrow("@generated(uuid) requires a UUID field");
    expect(() => parseQiyProject(`qiy v0;
application demo {
  database sqlite {}
  entity orgs {
    field id UUID @id;
    field name Text;
    field externalId UUID @generated(ts);
  }
}
`)).toThrow("only uuid is supported");
  });
});

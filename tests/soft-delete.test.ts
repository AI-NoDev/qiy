import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const source = (dialect = "sqlite") => `qiy v0; application soft-demo {
  database ${dialect} {}
  entity notes {
    field id UUID @id;
    field title Text;
    field deletedAt DateTime @nullable @softDelete;
  }
}`;

test("@softDelete stamps the marker in place of DELETE and audits it as deleted", () => {
  const project = parseQiyProject(source());
  expect(project.database.entities[0]!.fields.find((field) => field.softDelete)?.name).toBe("deletedAt");
  const files = generateProject(project.database, "soft-demo");
  const repository = files["apps/server/src/modules/notes/notes.repository.ts"]!;
  expect(repository).toContain("const notDeleted = isNull(notes.deletedAt)");
  expect(repository).toContain("tx.update(notes).set({ deletedAt: new Date() }");
  expect(repository).not.toContain("tx.delete(notes)");
  expect(repository).toContain('action: "notes.deleted"');
  expect(repository).not.toContain("qiySoftDeletedAt");
  expect(repository).toContain("where(and(notDeleted, eq(");
  expect(repository).toContain("options.deleted ? isNotNull(notes.deletedAt) : notDeleted");
});

test("@softDelete generates an audited restore across dialects", () => {
  for (const dialect of ["sqlite", "postgresql", "mysql"]) {
    const files = generateProject(parseQiyProject(source(dialect)).database, "soft-demo");
    const repository = files["apps/server/src/modules/notes/notes.repository.ts"]!;
    expect(repository).toContain("async restore(id, actorId, scope)");
    expect(repository).toContain("isNotNull(notes.deletedAt), eq(notes.id, id)");
    expect(repository).toContain('action: "notes.restored"');
    expect(files["apps/server/src/modules/notes/notes.service.ts"]).toContain("repository.restore?.(id, actorId, scope)");
    const routes = files["apps/server/src/modules/notes/notes.routes.ts"]!;
    expect(routes).toContain('.post("/:id/restore"');
    expect(routes).toContain('deleted: t.Optional(t.Union([t.Literal("true"), t.Literal("false")]))');
    if (dialect === "mysql") {
      expect(repository).toContain("const [record] = await tx.select().from(notes).where(eq(notes.id, id)).limit(1);");
      expect(repository).toContain("deletedRows = await tx.select().from(notes).where(inArray(notes.id, deletedRows.map((record) => record.id)));");
    }
  }
});

test("resources without @softDelete keep hard deletes and no restore route", () => {
  const files = generateProject(parseQiyProject(source().replace(" @softDelete", "")).database, "soft-demo");
  expect(files["apps/server/src/modules/notes/notes.repository.ts"]).toContain("tx.delete(notes)");
  expect(files["apps/server/src/modules/notes/notes.repository.ts"]).not.toContain("async restore(");
  expect(files["apps/server/src/modules/notes/notes.routes.ts"]).not.toContain("/restore");
});

test("@softDelete requires a nullable DateTime", () => {
  const wrongType = parseQiyProject(source().replace("field deletedAt DateTime @nullable @softDelete", "field deletedAt Text @nullable @softDelete"));
  expect(() => generateProject(wrongType.database, "soft-demo")).toThrow("@softDelete requires a DateTime");
  const wrongNullability = parseQiyProject(source().replace("field deletedAt DateTime @nullable @softDelete", "field deletedAt DateTime @softDelete"));
  expect(() => generateProject(wrongNullability.database, "soft-demo")).toThrow("@softDelete requires @nullable");
});

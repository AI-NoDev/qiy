import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

const source = `qiy v0; application soft-demo {
  database sqlite {}
  entity notes {
    field id UUID @id;
    field title Text;
    field deletedAt DateTime @nullable @softDelete;
  }
}`;

test("@softDelete generates filtered reads and a soft-delete wrapper", () => {
  const project = parseQiyProject(source);
  expect(project.database.entities[0]!.fields.find((field) => field.softDelete)?.name).toBe("deletedAt");
  const files = generateProject(project.database, "soft-demo");
  const repository = files["apps/server/src/modules/notes/notes.repository.ts"]!;
  expect(repository).toContain("const notDeleted = isNull(notes.deletedAt)");
  expect(repository).toContain("const qiySoftDeletedAt = \"deletedAt\"");
  expect(repository).toContain("[qiySoftDeletedAt]: new Date()");
  expect(repository).toContain("where(and(notDeleted, eq(");
  expect(repository).toContain("and(notDeleted, searchCondition");
});

test("@softDelete requires a nullable DateTime", () => {
  const wrongType = parseQiyProject(source.replace("field deletedAt DateTime @nullable @softDelete", "field deletedAt Text @nullable @softDelete"));
  expect(() => generateProject(wrongType.database, "soft-demo")).toThrow("@softDelete requires a DateTime");
  const wrongNullability = parseQiyProject(source.replace("field deletedAt DateTime @nullable @softDelete", "field deletedAt DateTime @softDelete"));
  expect(() => generateProject(wrongNullability.database, "soft-demo")).toThrow("@softDelete requires @nullable");
});

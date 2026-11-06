import { describe, expect, test } from "bun:test";
import type { DatabaseDialect, DatabaseIR } from "../tools/database-ir";
import { manyRelations, manyRelationTable, validateDatabaseIR } from "../tools/database-ir";
import { generateDrizzleMysql } from "../tools/drizzle-mysql";
import { generateDrizzlePostgres } from "../tools/drizzle-pg";
import { generateDrizzleSqlite } from "../tools/drizzle-sqlite";
import { generateServer } from "../tools/generate-server";
import { generateWeb } from "../tools/generate-web";
import { validateRelationLinkScopes } from "../tools/generate-relation-links";

const database = (dialect: DatabaseDialect = "sqlite"): DatabaseIR => ({
  dialect,
  extensions: [],
  entities: [
    { name: "tickets", tableName: "tickets", fields: [{ name: "id", type: "UUID", primaryKey: true }, { name: "title", type: "Text" }] },
    { name: "tags", tableName: "tags", fields: [{ name: "id", type: "UUID", primaryKey: true }, { name: "name", type: "Text", unique: true }, { name: "deletedAt", type: "DateTime", nullable: true, softDelete: true }] },
  ],
  relations: [{ name: "ticketTags", fromEntity: "tickets", fromField: "tagIds", toEntity: "tags", toField: "id", cardinality: "many" }],
});

describe("many-to-many relations", () => {
  test("resolve to a snake_case join table on the source entity", () => {
    const [link] = manyRelations(database());
    expect(link).toMatchObject({ field: "tagIds", table: "ticket_tags", targetField: "id" });
    expect(link!.source.name).toBe("tickets");
    expect(manyRelations(database(), "tags")).toEqual([]);
    expect(manyRelationTable({ name: "announcementLabels" })).toBe("announcement_labels");
    expect(validateDatabaseIR(database())).toEqual([]);
  });

  test("reject fields, keys and names the join table cannot back", () => {
    const errors = (mutate: (ir: DatabaseIR) => void) => { const ir = database(); mutate(ir); return validateDatabaseIR(ir).join("\n"); };
    expect(errors((ir) => ir.entities[0]!.fields.push({ name: "tagIds", type: "Array" }))).toContain("must not be declared as a column");
    expect(errors((ir) => { ir.relations![0]!.fromField = "tag-ids"; })).toContain("invalid many-to-many field name");
    expect(errors((ir) => { ir.entities[0]!.fields[0]!.type = "Integer"; })).toContain("needs a UUID primary key named id");
    expect(errors((ir) => { ir.relations![0]!.toField = "name"; })).toContain("must be a UUID primary or unique field");
    expect(errors((ir) => { ir.relations![0]!.onDelete = "cascade"; })).toContain("@onDelete is not supported");
    expect(errors((ir) => { ir.entities[1]!.tableName = "ticket_tags"; })).toContain("collides with an existing table");
    expect(errors((ir) => { ir.relations![0]!.name = "auditEvents"; })).toContain("collides with an existing table");
    expect(errors((ir) => { ir.relations![0]!.name = "tags"; })).toContain("collides with another schema export");
  });

  test("emit a cascading join table with a composite key in every dialect", () => {
    const sqlite = generateDrizzleSqlite(database("sqlite"));
    expect(sqlite).toContain('export const ticketTags = sqliteTable("ticket_tags"');
    expect(sqlite).toContain('references(() => tickets.id, { onDelete: "cascade" })');
    expect(sqlite).toContain('references(() => tags["id"], { onDelete: "cascade" })');
    expect(sqlite).toContain("primaryKey({ columns: [table.sourceId, table.targetId] })");
    expect(sqlite).toContain('index("ticket_tags_target_idx").on(table.targetId)');
    expect(generateDrizzlePostgres(database("postgresql"))).toContain('sourceId: uuid("sourceId").notNull()');
    expect(generateDrizzleMysql(database("mysql"))).toContain('sourceId: varchar("sourceId", { length: 36 }).notNull()');
  });

  test("only link scoped targets from sources carrying the same claim", () => {
    const scope = (resource: string, extra: Record<string, unknown> = {}) => ({ resource, field: "id", claim: "orgId", ...extra });
    expect(validateRelationLinkScopes(database(), [])).toEqual([]);
    expect(validateRelationLinkScopes(database(), [scope("tags")]).join("\n")).toContain("tickets");
    expect(validateRelationLinkScopes(database(), [scope("tags"), scope("tickets")])).toEqual([]);
  });

  test("wire link fields through the API, repository and admin resources", () => {
    const server = generateServer(database());
    expect(server["api/src/relation-links.ts"]).toContain("export class QiyRelationLinkError");
    const routes = server["api/src/modules/tickets/tickets.routes.ts"] ?? "";
    expect(routes).toContain('"tagIds": t.Optional(t.Union([t.Array(t.String({ format: "uuid" }), { maxItems: 500, uniqueItems: true }), t.Null()]))');
    expect(routes).toContain('"tagIds":["eq","in"]');
    expect(server["api/src/modules/tickets/tickets.repository.ts"]).toContain("qiyLinkedRepository");
    expect(server["api/src/modules/tags/tags.routes.ts"]).not.toContain("tagIds");
    const resources = generateWeb(database())["web/app/resources.ts"] ?? "";
    expect(resources).toContain('"name": "tagIds"');
    expect(resources).toContain('"many": true');
  });
});

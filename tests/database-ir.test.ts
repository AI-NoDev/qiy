import { describe, expect, test } from "bun:test";
import type { DatabaseIR } from "../tools/database-ir";
import { validateDatabaseIR } from "../tools/database-ir";
import { generateDrizzlePostgres } from "../tools/drizzle-pg";

const fixture = await Bun.file(new URL("../examples/catalog.ir.json", import.meta.url)).json() as DatabaseIR;
const copy = (): DatabaseIR => structuredClone(fixture);

describe("PostgreSQL Database IR", () => {
  test("rejects empty enums and incompatible enum storage before schema generation", () => {
    const database = copy();
    database.enums = [{ name: "status", values: [] }];
    expect(() => generateDrizzlePostgres(database)).toThrow("values must be a non-empty array");
    database.enums[0]!.values = [{ name: "active" }];
    const field = database.entities[0]!.fields[1]!;
    field.enumName = "status";
    expect(validateDatabaseIR(database)).toEqual([]);
    field.type = "Integer";
    expect(() => generateDrizzlePostgres(database)).toThrow("enum fields require Text storage");
    const malformed = JSON.parse(JSON.stringify(database)) as DatabaseIR;
    Object.assign(malformed.enums![0]!, { values: [null] });
    expect(validateDatabaseIR(malformed).join("\n")).toContain("invalid or duplicate value");
  });

  test("distinguishes pgvector storage capacity from approximate index capacity", () => {
    const database = copy();
    const vector = database.entities[0]!.fields.find((field) => field.type === "Vector")!;
    const vectorIndex = database.entities[0]!.indexes!.find((index) => index.method === "hnsw")!;
    for (const method of ["hnsw", "ivfflat"] as const) {
      vectorIndex.method = method;
      vector.dimension = 2000;
      expect(validateDatabaseIR(database)).toEqual([]);
      expect(generateDrizzlePostgres(database)).toContain("dimensions: 2000");
      vector.dimension = 2001;
      expect(() => generateDrizzlePostgres(database)).toThrow(`${method} vector dimension cannot exceed 2000`);
    }
    database.entities[0]!.indexes = [];
    vector.dimension = 16000;
    expect(validateDatabaseIR(database)).toEqual([]);
    expect(generateDrizzlePostgres(database)).toContain("dimensions: 16000");
    vector.dimension = 16001;
    expect(() => generateDrizzlePostgres(database)).toThrow("pgvector vector dimension cannot exceed 16000");
  });

  test("enforces decimal capabilities before generating database schemas", async () => {
    const { generateDrizzleMysql } = await import("../tools/drizzle-mysql");
    const database = copy();
    database.extensions = [];
    database.entities[0]!.fields = database.entities[0]!.fields.filter((field) => field.type !== "Vector");
    database.entities[0]!.indexes = [];
    const price = database.entities[0]!.fields.find((field) => field.name === "price")!;
    database.dialect = "mysql";
    price.precision = 65;
    price.scale = 30;
    expect(validateDatabaseIR(database)).toEqual([]);
    expect(generateDrizzleMysql(database)).toContain("precision: 65, scale: 30");
    price.precision = 66;
    expect(() => generateDrizzleMysql(database)).toThrow("mysql precision cannot exceed 65");
    price.precision = 65;
    price.scale = 31;
    expect(() => generateDrizzleMysql(database)).toThrow("mysql scale cannot exceed 30");
    database.dialect = "postgresql";
    price.precision = 1000;
    expect(validateDatabaseIR(database)).toEqual([]);
    price.precision = 1001;
    expect(() => generateDrizzlePostgres(database)).toThrow("postgresql precision cannot exceed 1000");
  });

  test("rejects ignored numeric parameters and unsafe numeric dimensions", () => {
    const database = copy();
    const title = database.entities[0]!.fields[1]!;
    title.precision = 10;
    title.scale = 0;
    title.dimension = 3;
    const errors = validateDatabaseIR(database).join("\n");
    expect(errors).toContain("precision and scale require Decimal or Money");
    expect(errors).toContain("dimension requires Vector");
    database.entities[0]!.fields[3]!.dimension = Number.MAX_SAFE_INTEGER + 1;
    expect(() => generateDrizzlePostgres(database)).toThrow("Vector dimension must be a positive integer");
  });

  test("validates the catalog and renders Drizzle schema", () => {
    expect(validateDatabaseIR(fixture)).toEqual([]);
    const source = generateDrizzlePostgres(fixture);
    expect(source).toContain('pgTable("products"');
    expect(source).toContain('numeric("price", { precision: 12, scale: 2 })');
    expect(source).toContain('vector("embedding", { dimensions: 1536 })');
    expect(source).toContain('index("products_embedding_hnsw").using("hnsw", table["embedding"].op("vector_cosine_ops"))');
    expect(source).toContain('index("products_title_idx").on(table["title"])');
    expect(new Bun.Transpiler({ loader: "ts" }).transformSync(source)).toBeTruthy();
  });

  test("renders DateTime columns for supported dialects", async () => {
    const database = copy();
    database.entities[0]!.fields = database.entities[0]!.fields.filter((field) => field.type !== "Vector");
    database.entities[0]!.indexes = database.entities[0]!.indexes?.filter((index) => index.method === "btree");
    database.extensions = [];
    database.entities[0]!.fields.push({ name: "createdAt", type: "DateTime", nullable: false });
    const { generateDrizzlePostgres } = await import("../tools/drizzle-pg");
    const { generateDrizzleSqlite } = await import("../tools/drizzle-sqlite");
    const { generateDrizzleMysql } = await import("../tools/drizzle-mysql");
    expect(generateDrizzlePostgres(database)).toContain('timestamp("createdAt", { withTimezone: true })');
    database.dialect = "sqlite";
    expect(generateDrizzleSqlite(database)).toContain('integer("createdAt", { mode: "timestamp_ms" })');
    database.dialect = "mysql";
    expect(generateDrizzleMysql(database)).toContain('datetime("createdAt", { mode: "date", fsp: 3 })');
    const mysql = generateDrizzleMysql(database);
    expect(mysql.match(/createdAt: bigint\("createdAt", \{ mode: "number" \}\)/g)).toHaveLength(2);
    expect(mysql).not.toContain('createdAt: int("createdAt")');
    expect(mysql).toContain('bigint("createdAt", { mode: "number" }).notNull().$defaultFn(() => Date.now())');
  });

  test("renders Date and Time text contracts for supported dialects", async () => {
    const database = copy();
    database.entities[0]!.fields = database.entities[0]!.fields.filter((field) => field.type !== "Vector");
    database.entities[0]!.indexes = database.entities[0]!.indexes?.filter((index) => index.method === "btree");
    database.extensions = [];
    database.entities[0]!.fields.push({ name: "dueDate", type: "Date", nullable: false }, { name: "shiftStart", type: "Time", nullable: false });
    expect(validateDatabaseIR(database)).toEqual([]);
    const { generateDrizzlePostgres } = await import("../tools/drizzle-pg");
    const { generateDrizzleSqlite } = await import("../tools/drizzle-sqlite");
    const { generateDrizzleMysql } = await import("../tools/drizzle-mysql");
    const postgres = generateDrizzlePostgres(database);
    expect(postgres).toContain('date("dueDate", { mode: "string" })');
    expect(postgres).toContain('time("shiftStart")');
    database.dialect = "sqlite";
    const sqlite = generateDrizzleSqlite(database);
    expect(sqlite).toContain('"dueDate": text("dueDate").notNull()');
    expect(sqlite).toContain('"shiftStart": text("shiftStart").notNull()');
    database.dialect = "mysql";
    const mysql = generateDrizzleMysql(database);
    expect(mysql).toContain('date("dueDate", { mode: "string" })');
    expect(mysql).toContain('time("shiftStart")');
    expect(mysql).toMatch(/import \{[^}]*\bdate\b[^}]*\} from "drizzle-orm\/mysql-core"/);
    expect(mysql).toMatch(/import \{[^}]*\btime\b[^}]*\} from "drizzle-orm\/mysql-core"/);
  });

  test("accepts Date and Time display template placeholders", async () => {
    const { DISPLAY_TEMPLATE_FIELD_TYPES, validateDisplayTemplate } = await import("../tools/database-ir");
    expect(DISPLAY_TEMPLATE_FIELD_TYPES.has("Date")).toBe(true);
    expect(DISPLAY_TEMPLATE_FIELD_TYPES.has("Time")).toBe(true);
    expect(DISPLAY_TEMPLATE_FIELD_TYPES.has("DateTime")).toBe(true);
    expect(DISPLAY_TEMPLATE_FIELD_TYPES.has("File")).toBe(false);
    const entity = { name: "orders", fields: [{ name: "id", type: "UUID" as const, primaryKey: true }, { name: "dueDate", type: "Date" as const }, { name: "shiftStart", type: "Time" as const }] };
    expect(validateDisplayTemplate("{$.dueDate} {$.shiftStart}", entity, "display")).toEqual([]);
  });

  test("rejects relations with missing entities and fields", () => {
    const database = copy();
    database.relations = [{ name: "productCategory", fromEntity: "products", fromField: "missing", toEntity: "categories", toField: "id", cardinality: "one" }];
    expect(validateDatabaseIR(database).join("\n")).toContain("referenced entity does not exist");
    database.relations[0]!.toEntity = "products";
    expect(validateDatabaseIR(database).join("\n")).toContain("unknown source field");
  });

  test("requires PostgreSQL and pgvector for vector indexes", () => {
    const database = copy();
    database.dialect = "mysql";
    expect(validateDatabaseIR(database).join("\n")).toContain("hnsw requires PostgreSQL and pgvector");
    expect(() => generateDrizzlePostgres(database)).toThrow("only supports PostgreSQL");
    database.dialect = "postgresql";
    database.extensions = [];
    expect(validateDatabaseIR(database).join("\n")).toContain("declared pgvector extension");
  });

  test("rejects invalid vector dimensions, operator classes and index columns", () => {
    const database = copy();
    database.entities[0]!.fields[3]!.dimension = -1;
    database.entities[0]!.indexes![0]!.columns[0]!.opclass = "btree_ops";
    database.entities[0]!.indexes![1]!.columns[0]!.fieldName = "missing";
    const errors = validateDatabaseIR(database).join("\n");
    expect(errors).toContain("positive integer");
    expect(errors).toContain("compatible opclass");
    expect(errors).toContain("unknown field missing");
  });

  test("rejects invalid precision and scale", () => {
    const database = copy();
    database.entities[0]!.fields[2]!.precision = 0;
    database.entities[0]!.fields[2]!.scale = -1;
    expect(validateDatabaseIR(database).join("\n")).toContain("precision must be a positive integer");
    expect(validateDatabaseIR(database).join("\n")).toContain("scale must be between zero and precision");
    database.entities[0]!.fields[2]!.precision = 4;
    database.entities[0]!.fields[2]!.scale = 5;
    expect(validateDatabaseIR(database).join("\n")).toContain("scale must be between zero and precision");
    database.entities[0]!.fields[1]!.scale = 1;
    expect(validateDatabaseIR(database).join("\n")).toContain("products.title: scale must be between zero and precision");
  });

  test("rejects postgis on MySQL and concurrently indexes outside PostgreSQL", () => {
    const database = copy();
    database.dialect = "mysql";
    database.extensions = ["postgis"];
    database.entities[0]!.indexes![1]!.concurrently = true;
    const errors = validateDatabaseIR(database).join("\n");
    expect(errors).toContain("postgis require PostgreSQL");
    expect(errors).toContain("concurrently requires PostgreSQL");
  });

  test("rejects unsupported btree opclasses and malformed entity names", () => {
    const database = copy();
    database.entities[0]!.name = "default";
    database.entities[0]!.indexes![1]!.columns[0]!.opclass = "vector_l2_ops";
    const errors = validateDatabaseIR(database).join("\n");
    expect(errors).toContain("invalid name");
    expect(errors).toContain("btree opclass is not supported");
  });

  test("rejects duplicate names, undeclared extensions, and unsupported input", () => {
    const database = copy();
    database.entities.push(structuredClone(database.entities[0]!));
    database.entities[0]!.fields[0]!.extension = "postgis";
    database.entities[0]!.fields[1]!.type = "Unknown" as never;
    const errors = validateDatabaseIR(database).join("\n");
    expect(errors).toContain("duplicate entity or table name");
    expect(errors).toContain("duplicate index name");
    expect(errors).toContain("undeclared extension postgis");
    expect(errors).toContain("unsupported field type");
  });

  test("rejects duplicate physical columns and malformed index input", () => {
    const database = copy();
    database.entities[0]!.fields[1]!.columnName = "id";
    database.entities[0]!.indexes![0]!.columns = undefined as never;
    expect(validateDatabaseIR(database).join("\n")).toContain("duplicate column name id");
    expect(validateDatabaseIR(database).join("\n")).toContain("index columns must be an array");
  });
});

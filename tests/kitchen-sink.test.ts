import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { DatabaseDialect, DatabaseIR, EntityIR, EnumIR, EnumValueIR, FieldIR, FieldType, FilterMode, IndexIR, RelationIR } from "../tools/database-ir";
import { renderAppFiles } from "../tools/commands/generate-app";
import { loadQiyProjectSource } from "../tools/qiy-include";
import { parseQiyProject, type DataflowIR, type QiyAction, type QiyChartDataOperation, type QiyChartView, type QiyChartViewKind, type QiyProject } from "../tools/qiy-project";

// Every key maps to `true` (exercised by tests/fixtures/kitchen-sink) or to the
// reason it lives elsewhere. Adding a property to the IR fails typecheck here
// until the fixture covers it or the exception is documented.
type Coverage<T> = Record<keyof T, true | string>;

const projectCoverage: Coverage<QiyProject> = {
  name: true, comment: true, commentKey: true, database: true, mode: true,
  integration: "mode integration has no generated server; covered by tests/integration-mode.test.ts and tools/verify-release-integration.ts",
  workspace: true, ui: true, apiClient: true, corsOrigins: true, elysiaPlugins: true, storageProvider: true, features: true,
  auth: true, environment: true, messages: true, menuGroups: true, charts: true, chartPanels: true, realtime: true,
  scopes: true, restrictions: true, pages: true,
  workflows: "legacy orderInventory slice, covered by examples/erpadmin until the declarative state machine replaces it",
  permissions: true, dataflows: true, actions: true,
};
const databaseCoverage: Coverage<DatabaseIR> = { comment: true, commentKey: true, dialect: true, extensions: true, entities: true, enums: true, relations: true, views: true };
const entityCoverage: Coverage<EntityIR> = {
  name: true, comment: true, commentKey: true, tableName: true, fields: true, indexes: true, label: true, icon: true,
  singular: true, plural: true, display: true, tableDisplay: true, relationDetail: true,
};
const fieldCoverage: Coverage<FieldIR> = {
  name: true, comment: true, commentKey: true, columnName: true, type: true, itemType: true, nullable: true, softDelete: true,
  tenantClaim: true, computed: true, primaryKey: true, unique: true, extension: true, dimension: true, precision: true, scale: true,
  enumName: true, label: true, icon: true, visible: true, listVisible: true, formVisible: true, showVisible: true, sortable: true,
  filterable: true, filterModes: true, uploadMode: true, maxBytes: true, mimeTypes: true, maxFiles: true, codeTemplate: true, generatedValue: true,
  min: true, max: true, minLength: true, maxLength: true, pattern: true, defaultValue: true, version: true,
};
const indexCoverage: Coverage<IndexIR> = { name: true, comment: true, commentKey: true, method: true, columns: true, unique: true, concurrently: true };
const relationCoverage: Coverage<RelationIR> = { name: true, comment: true, commentKey: true, fromEntity: true, fromField: true, toEntity: true, toField: true, cardinality: true, onDelete: true };
const enumCoverage: Coverage<EnumIR> = { name: true, comment: true, commentKey: true, values: true };
const enumValueCoverage: Coverage<EnumValueIR> = { name: true, label: true, color: true, icon: true, comment: true, commentKey: true };
const dataflowCoverage: Coverage<DataflowIR> = {
  name: true, label: true, labelKey: true, confirm: true, confirmKey: true, comment: true, commentKey: true, idempotency: true, audit: true,
  roles: true, permission: true, verification: true, input: true, context: true, steps: true, result: true,
};
const actionCoverage: Coverage<QiyAction> = {
  name: true, roles: true, permission: true, verification: true, resource: true, placements: true, batch: true, label: true, labelKey: true, condition: true, target: true,
};
const chartViewCoverage: Coverage<QiyChartView> = { kind: true, title: true, icon: true, data: true, labels: true, color: true, legend: true };

const fieldTypes: Record<FieldType, true> = { UUID: true, Text: true, Email: true, URL: true, JSON: true, Integer: true, Boolean: true, Decimal: true, Money: true, Date: true, Time: true, DateTime: true, Array: true, File: true, Files: true, Vector: true };
const filterModes: Record<FilterMode, true> = { eq: true, contains: true, startsWith: true, endsWith: true, gt: true, gte: true, lt: true, lte: true, between: true, in: true };
const indexMethods: Record<IndexIR["method"], true> = { btree: true, hnsw: true, ivfflat: true };
const onDeleteModes: Record<NonNullable<RelationIR["onDelete"]>, true> = { restrict: true, cascade: true, setNull: true };
const chartKinds: Record<QiyChartViewKind, true> = { const: true, pie: true, bar: true, line: true, area: true, scatter: true, stacked: true, table: true };
const chartOperations: Record<QiyChartDataOperation, true> = { count: true, sum: true, avg: true, min: true, max: true, trend: true, list: true };
const statementKinds: Record<DataflowIR["steps"][number]["actions"][number]["kind"], true> = { require: true, update: true, create: true, delete: true, emit: true, call: true };
const dialects: Record<DatabaseDialect, true> = { postgresql: true, mysql: true, sqlite: true };

const fixture = join(import.meta.dir, "fixtures/kitchen-sink");
const projects = new Map<DatabaseDialect, QiyProject>();
beforeAll(async () => {
  for (const dialect of Object.keys(dialects) as DatabaseDialect[]) projects.set(dialect, parseQiyProject(await loadQiyProjectSource(join(fixture, `${dialect}.qiy`))));
});

const isSet = (value: unknown) => value !== undefined && !(Array.isArray(value) && value.length === 0);
function uncovered<T extends object>(coverage: Coverage<T>, records: T[]): string[] {
  return (Object.keys(coverage) as Array<keyof T & string>).filter((key) => coverage[key] === true && !records.some((record) => isSet(record[key])));
}
const all = () => [...projects.values()];
const entities = () => all().flatMap((project) => project.database.entities);
const fields = () => entities().flatMap((entity) => entity.fields);

describe("kitchen-sink fixture", () => {
  test("parses for every dialect", () => {
    expect([...projects.keys()].sort()).toEqual((Object.keys(dialects) as DatabaseDialect[]).sort());
    for (const [dialect, project] of projects) expect(project.database.dialect).toBe(dialect);
  });

  test("sets every covered IR property", () => {
    expect({
      project: uncovered(projectCoverage, all()),
      database: uncovered(databaseCoverage, all().map((project) => project.database)),
      entity: uncovered(entityCoverage, entities()),
      field: uncovered(fieldCoverage, fields()),
      index: uncovered(indexCoverage, entities().flatMap((entity) => entity.indexes ?? [])),
      relation: uncovered(relationCoverage, all().flatMap((project) => project.database.relations ?? [])),
      enum: uncovered(enumCoverage, all().flatMap((project) => project.database.enums ?? [])),
      enumValue: uncovered(enumValueCoverage, all().flatMap((project) => project.database.enums ?? []).flatMap((item) => item.values)),
      dataflow: uncovered(dataflowCoverage, all().flatMap((project) => project.dataflows ?? [])),
      action: uncovered(actionCoverage, all().flatMap((project) => project.actions ?? [])),
      chartView: uncovered(chartViewCoverage, all().flatMap((project) => project.charts ?? []).flatMap((chart) => chart.views)),
    }).toEqual({ project: [], database: [], entity: [], field: [], index: [], relation: [], enum: [], enumValue: [], dataflow: [], action: [], chartView: [] });
  });

  test("uses every value of the closed vocabularies", () => {
    const missing = <T extends string>(all: Record<T, true>, used: Iterable<string | undefined>) => {
      const seen = new Set(used);
      return (Object.keys(all) as T[]).filter((value) => !seen.has(value));
    };
    expect({
      fieldTypes: missing(fieldTypes, fields().flatMap((field) => [field.type, field.itemType])),
      filterModes: missing(filterModes, fields().flatMap((field) => field.filterModes ?? [])),
      indexMethods: missing(indexMethods, entities().flatMap((entity) => entity.indexes ?? []).map((index) => index.method)),
      onDelete: missing(onDeleteModes, all().flatMap((project) => project.database.relations ?? []).map((relation) => relation.onDelete)),
      chartKinds: missing(chartKinds, all().flatMap((project) => project.charts ?? []).flatMap((chart) => chart.views.map((view) => view.kind))),
      chartOperations: missing(chartOperations, all().flatMap((project) => project.charts ?? []).flatMap((chart) => chart.views.map((view) => view.data.operation))),
      statements: missing(statementKinds, all().flatMap((project) => project.dataflows ?? []).flatMap((flow) => flow.steps.flatMap((step) => step.actions.map((action) => action.kind)))),
    }).toEqual({ fieldTypes: [], filterModes: [], indexMethods: [], onDelete: [], chartKinds: [], chartOperations: [], statements: [] });
  });

  test("renders a complete workspace for every dialect", async () => {
    for (const dialect of Object.keys(dialects) as DatabaseDialect[]) {
      const { files } = await renderAppFiles(join(fixture, `${dialect}.qiy`));
      const schema = files["apps/server/src/schema.ts"] ?? "";
      expect(schema, dialect).toContain(dialect === "postgresql" ? "pg-core" : dialect === "mysql" ? "mysql-core" : "sqlite-core");
      expect(files["apps/server/drizzle.config.ts"], dialect).toBeDefined();
      for (const entity of projects.get(dialect)!.database.entities) expect(schema, `${dialect} ${entity.tableName}`).toContain(`"${entity.tableName}"`);
      if (dialect === "postgresql") {
        for (const fragment of ["vector(", "knowledge_embedding_hnsw"]) expect(schema).toContain(fragment);
        expect(schema).not.toContain("knowledge_embedding_ivfflat");
        const migrate = files["apps/server/src/db-migrate.ts"] ?? "";
        expect(migrate).toContain('create extension if not exists \\"vector\\"');
        expect(migrate).toContain('CREATE INDEX CONCURRENTLY IF NOT EXISTS \\"knowledge_embedding_ivfflat\\"');
      }
    }
  }, 60_000);
});

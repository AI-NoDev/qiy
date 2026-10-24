import type { DatabaseIR, EntityIR, FieldIR, FilterMode } from "./database-ir";
import type { QiyProject, DataflowIR, QiyPolicyExpression, QiyResourceRestriction, QiyRowPredicate, QiyFieldMask } from "./qiy-project";
import { authHasLocal, authIsHybrid, authOAuthProviders, authProviderSubjectField, authUsesProviderChooser } from "./qiy-project";
import {
  declaredPermissionValues,
  evaluatePermissionVerification as evaluateDeclaredVerification,
  isPermissionModelEmpty,
  permissionExpansionTables,
  requiredPermissionValues,
  resolvePermissionSnapshot,
  type QiyPermissionModel,
} from "./permissions";
import { resolveQiyTestValue, type QiyTestSuite, type QiyTestScenario } from "./qiy-test";

/** A data scope, optionally widened to the whole subtree of a self-referencing entity. */
type QiyScope = NonNullable<QiyProject["scopes"]>[number];

/** Resolves the tree table, id column and parent column a `tree` scope needs. */
function resolveScopeTree(database: DatabaseIR, entity: EntityIR): { scope: QiyScope; table: EntityIR; idField: FieldIR; parentField: FieldIR } | undefined {
  const scope = (database as DatabaseIR & { scopes?: QiyScope[] }).scopes?.find((candidate) => (candidate.resource === entity.name || candidate.resource === entity.tableName) && candidate.tree);
  if (!scope?.tree) return undefined;
  const table = database.entities.find((candidate) => candidate.name === scope.tree!.entity || candidate.tableName === scope.tree!.entity);
  const idField = table?.fields.find((field) => field.primaryKey);
  const parentField = table?.fields.find((field) => field.name === scope.tree!.parentField);
  return table && idField && parentField ? { scope, table, idField, parentField } : undefined;
}

/** Emits the recursive CTE used to turn one claim value into the allowed subtree ids. */
function renderScopeTreeHelper(database: DatabaseIR, entity: EntityIR, name = "qiyScopeSubtree"): string {
  const tree = resolveScopeTree(database, entity);
  if (!tree) return "";
  const cast = JSON.stringify(database.dialect === "mysql" ? "CHAR" : "TEXT");
  const table = tree.table.name;
  // PostgreSQL folds unquoted camelCase identifiers, so alias-qualified CTE columns
  // are emitted through sql.raw (backticks for MySQL, double quotes elsewhere).
  const rawIdentifier = (identifier: string) => database.dialect === "mysql" ? "`" + identifier + "`" : '"' + identifier + '"';
  const childIdRaw = JSON.stringify("child." + rawIdentifier(tree.idField.name));
  const childParentRaw = JSON.stringify("child." + rawIdentifier(tree.parentField.name));
  const castName = `${name}Cast`;
  return `const ${castName} = ${cast};
/** Subtree ids are structural metadata: the recursive CTE does not re-apply the row policy. */
function ` + name + `(column: any, value: string) {
  return sql\`CAST(\${column} AS \${sql.raw(${castName})}) IN (WITH RECURSIVE qiy_scope(id, depth) AS (SELECT CAST(\${${table}.${tree.idField.name}} AS \${sql.raw(${castName})}), 0 FROM \${${table}} WHERE CAST(\${${table}.${tree.idField.name}} AS \${sql.raw(${castName})}) = \${value} UNION ALL SELECT CAST(\${sql.raw(${childIdRaw})} AS \${sql.raw(${castName})}), qiy_scope.depth + 1 FROM \${${table}} AS child JOIN qiy_scope ON CAST(\${sql.raw(${childParentRaw})} AS \${sql.raw(${castName})}) = qiy_scope.id WHERE qiy_scope.depth < 64) SELECT id FROM qiy_scope)\`;
}
`;
}
import { renderAppTemplate } from "./admin-template";
import { validateDatabaseIR } from "./database-ir";
import { generateDrizzlePostgres } from "./drizzle-pg";
import { generateDrizzleMysql } from "./drizzle-mysql";
import { generateDrizzleSqlite } from "./drizzle-sqlite";
import { generateAudit } from "./generate-audit";
import { generatedDocumentation } from "./generated-documentation";

function apiFieldSchema(field: FieldIR, database: DatabaseIR): string {
  if (field.enumName) {
    const values = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values ?? [];
    return `t.Union([${values.map((value) => `t.Literal(${JSON.stringify(value.name)})`).join(", ")}])`;
  }
  switch (field.type) {
    case "UUID": return "t.String({ format: \"uuid\" })";
    case "Text": return "t.String({ minLength: 1 })";
    case "File": return "t.String({ minLength: 1, maxLength: 240 })";
    case "Files": return `t.Array(t.String({ minLength: 1, maxLength: 240 }), { minItems: 1, maxItems: ${field.maxFiles ?? 6} })`;
    case "Integer": return "t.Integer()";
    // The temporal contract is validated by api/src/temporal.ts so malformed values
    // return a documented 400 instead of TypeBox's 422: TypeBox has no strict
    // calendar/`HH:mm:ss` format (its "date" format accepts 2026-2-3 and 2026-02-31).
    case "Date":
    case "Time": return "t.String({ minLength: 1, maxLength: 40 })";
    case "DateTime": return "t.String({ format: \"date-time\" })";
    case "Decimal":
    case "Money": return "t.String({ pattern: \"^-?[0-9]+(\\\\.[0-9]+)?$\" })";
    case "Vector": return `t.Array(t.Number(), { minItems: ${field.dimension}, maxItems: ${field.dimension} })`;
  }
}

/**
 * Date and Time are text contracts shared by REST, GraphQL and CSV:
 *   Date -> `YYYY-MM-DD`, Time -> `HH:mm:ss` (seconds default to `00`).
 * DateTime keeps the existing ISO date-time string / timestamp column behaviour.
 * TypeBox's registered `date` format is not strict and has no local-time format,
 * so the generated server validates these two types explicitly.
 */
function renderTemporalModule(): string {
  return `export type QiyTemporalFieldType = "Date" | "Time";

export class QiyTemporalValueError extends Error {
  readonly field: string;
  readonly type: QiyTemporalFieldType;

  constructor(field: string, type: QiyTemporalFieldType, value: unknown) {
    const expected = type === "Date" ? "YYYY-MM-DD" : "HH:mm:ss";
    super("Invalid " + type + " value for " + field + " (" + JSON.stringify(value ?? null) + "); expected " + expected);
    this.name = "QiyTemporalValueError";
    this.field = field;
    this.type = type;
  }
}

/** A calendar-valid date in the stored \`YYYY-MM-DD\` form. */
export function isValidDateValue(value: string): boolean {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Normalizes \`HH:mm\` or \`HH:mm:ss\` to the stored \`HH:mm:ss\` form; undefined when invalid. */
export function normalizeTimeValue(value: string): string | undefined {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value);
  return match ? match[1] + ":" + match[2] + ":" + (match[3] ?? "00") : undefined;
}

/**
 * Validates and normalizes the declared Date/Time fields of one write payload.
 * Absent, null and empty values are left untouched so nullable fields and PATCH
 * bodies keep working; an invalid value throws QiyTemporalValueError (400).
 */
export function normalizeTemporalValues<T extends Record<string, unknown>>(values: T, types: Record<string, QiyTemporalFieldType>): T {
  let next: Record<string, unknown> | undefined;
  for (const [field, type] of Object.entries(types)) {
    if (!Object.hasOwn(values, field)) continue;
    const value = values[field];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "string") throw new QiyTemporalValueError(field, type, value);
    if (type === "Date") {
      if (!isValidDateValue(value)) throw new QiyTemporalValueError(field, type, value);
      continue;
    }
    const normalized = normalizeTimeValue(value);
    if (!normalized) throw new QiyTemporalValueError(field, type, value);
    if (normalized !== value) {
      next ??= { ...values };
      next[field] = normalized;
    }
  }
  return (next ?? values) as T;
}
`;
}

/** The declared Date/Time fields of an entity, in declaration order. */
function temporalFieldsOf(entity: EntityIR): Array<[string, "Date" | "Time"]> {
  return entity.fields
    .filter((field): field is FieldIR & { type: "Date" | "Time" } => field.type === "Date" || field.type === "Time")
    .map((field) => [field.name, field.type]);
}

function apiField(field: FieldIR, database: DatabaseIR): string {
  const schema = apiFieldSchema(field, database);
  return field.comment !== undefined ? `t.Intersect([${schema}], { description: ${JSON.stringify(field.comment)} })` : schema;
}

function createFields(entity: EntityIR, database: DatabaseIR): string {
  return entity.fields.filter((field) => !field.primaryKey).map((field) => {
    const value = field.nullable ? `t.Optional(t.Union([${apiField(field, database)}, t.Null()], ${JSON.stringify(field.comment !== undefined ? { description: field.comment } : {})}))` : apiField(field, database);
    return `  ${JSON.stringify(field.name)}: ${value},`;
  }).join("\n");
}

function patchFields(entity: EntityIR, database: DatabaseIR): string {
  return entity.fields.filter((field) => !field.primaryKey).map((field) => {
    const value = field.nullable ? `t.Union([${apiField(field, database)}, t.Null()], ${JSON.stringify(field.comment !== undefined ? { description: field.comment } : {})})` : apiField(field, database);
    return `  ${JSON.stringify(field.name)}: t.Optional(${value}),`;
  }).join("\n");
}

function modelName(entity: EntityIR): string {
  return entity.name[0]!.toUpperCase() + entity.name.slice(1);
}

/**
 * Builds the principal display-name expression from the fields the user entity
 * actually declares. Hardcoding `displayName`/`email` produced server code that
 * did not compile for user entities without those fields.
 */
function principalNameExpression(entity: EntityIR | undefined, ...candidates: Array<string | undefined>): string {
  const declared = [...new Set(candidates.filter((field): field is string => typeof field === "string" && field.length > 0))]
    .filter((field) => entity?.fields.some((item) => item.name === field));
  return `String(${[...declared.map((field) => `row.${field}`), "row.id"].join(" ?? ")})`;
}

function filterModesForField(field: FieldIR): FilterMode[] {
  return field.filterModes ?? (field.enumName
    ? ["eq"]
    : field.type === "Text" || field.type === "File"
      ? ["contains", "startsWith", "endsWith", "eq"]
      : ["eq", "gt", "gte", "lt", "lte", "between", "in"]);
}

function graphqlName(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1);
}

function graphqlType(field: FieldIR, required = true): string {
  const base = field.enumName ? graphqlName(field.enumName)
    : field.type === "UUID" ? "ID"
      : field.type === "Integer" ? "Int"
        : field.type === "Vector" ? "[Float!]"
          : field.type === "Files" ? "[String!]"
            : "String";
  return required && !field.nullable ? `${base}!` : base;
}

function graphqlInputFields(entity: EntityIR, patch: boolean, hiddenFields: string[] = []): string {
  return entity.fields.filter((field) => !field.primaryKey && !hiddenFields.includes(field.name)).map((field) => {
    const required = !patch && !field.primaryKey && !field.nullable;
    return `${graphqlDescription(field.comment, "  ")}  ${field.name}: ${graphqlType(field, required)}`;
  }).join("\n");
}

function graphqlDescription(comment: string | undefined, indentation = ""): string {
  return comment === undefined ? "" : `${indentation}${JSON.stringify(comment)}\n`;
}

function dataflowGraphqlName(name: string): string {
  return name.split(/[-_]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function dataflowResultEntity(database: DatabaseIR, flow: DataflowIR): EntityIR {
  const contextEntity = flow.context.find((binding) => binding.name === flow.result)?.entity;
  const creation = flow.steps
    .flatMap((step) => step.actions)
    .find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "create" }> => action.kind === "create" && action.context === flow.result);
  const createdEntity = creation?.entity;
  const entity = database.entities.find((candidate) => candidate.name === (contextEntity ?? createdEntity));
  if (!entity) throw new Error(`Dataflow ${flow.name}: missing GraphQL result entity`);
  return entity;
}

function graphqlDataflowInputType(database: DatabaseIR, type: string): string {
  if (database.enums?.some((enumeration) => enumeration.name === type)) return graphqlName(type);
  if (type === "UUID") return "ID";
  if (type === "Integer") return "Int";
  if (type === "Boolean") return "Boolean";
  return "String";
}

function graphqlDataflowResultType(entity: EntityIR): string {
  const fieldType = (field: FieldIR) => {
    const base = field.type === "Integer" ? "number" : field.type === "Vector" ? "number[]" : "string";
    return field.nullable ? `${base} | null` : base;
  };
  return `{ ${entity.fields.map((field) => `${field.name}?: ${fieldType(field)}`).join("; ")} }`;
}

function graphqlSchema(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = [], realtimeEntities: EntityIR[] = []): string {
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const enums = (database.enums ?? []).map((enumeration) => `enum ${graphqlName(enumeration.name)} {\n${enumeration.values.map((value) => `  ${value.name}`).join("\n")}\n}`).join("\n\n");
  const types = database.entities.map((entity) => {
    const hidden = hiddenFields[entity.name] ?? [];
    const publicFields = entity.fields.filter((field) => !hidden.includes(field.name));
    return `${graphqlDescription(entity.comment)}type ${modelName(entity)} {\n${publicFields.map((field) => `${graphqlDescription(field.comment, "  ")}  ${field.name}: ${graphqlType(field)}`).join("\n")}\n}\n\ntype ${modelName(entity)}Page {\n  items: [${modelName(entity)}!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\n${graphqlDescription(entity.comment)}input ${modelName(entity)}CreateInput {\n${graphqlInputFields(entity, false, hidden)}\n}\n\n${graphqlDescription(entity.comment)}input ${modelName(entity)}UpdateInput {\n${graphqlInputFields(entity, true, hidden)}\n}`;
  }).join("\n\n");
  const queries = database.entities.flatMap((entity) => [
    `  ${entity.name}(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ${modelName(entity)}Page!`,
    `  ${entity.name}ById(id: ID!): ${modelName(entity)}`,
    `  ${entity.name}Aggregate(field: String!, op: String!): Float`,
    `  ${entity.name}Distribution(field: String!): [QiyDistribution!]!`,
    `  ${entity.name}Trend(field: String!, days: Int!): [QiyTrend!]!`,
  ]).join("\n");
  const dataflowInputs = dataflows.filter((flow) => flow.input.length > 0).map((flow) => `${graphqlDescription(flow.comment)}input ${dataflowGraphqlName(flow.name)}CommandInput {\n${flow.input.map((field) => `${graphqlDescription(field.comment, "  ")}  ${field.name}: ${graphqlDataflowInputType(database, field.type)}${field.required ? "!" : ""}`).join("\n")}\n}`).join("\n\n");
  const mutations = database.entities.flatMap((entity) => [
    `  create${modelName(entity)}(input: ${modelName(entity)}CreateInput!): ${modelName(entity)}!`,
    `  update${modelName(entity)}(id: ID!, input: ${modelName(entity)}UpdateInput!): ${modelName(entity)}`,
    `  delete${modelName(entity)}(id: ID!): ${modelName(entity)}`,
    `  delete${modelName(entity)}Many(ids: [ID!]!): [${modelName(entity)}!]!`,
  ]).join("\n");
  const dataflowMutations = dataflows.flatMap((flow) => {
    const name = dataflowGraphqlName(flow.name);
    const argumentsList = [flow.input.length > 0 ? `input: ${name}CommandInput!` : undefined, flow.idempotency?.required ? "idempotencyKey: String!" : undefined].filter((value): value is string => Boolean(value));
    const single = `${graphqlDescription(flow.comment, "  ")}  run${name}${argumentsList.length ? `(${argumentsList.join(", ")})` : ""}: ${modelName(dataflowResultEntity(database, flow))}!`;
    const batch = batchFlows.has(flow.name)
      ? `${graphqlDescription(`Atomically execute ${flow.comment ?? flow.label ?? flow.name} for a selected collection`, "  ")}  run${name}Batch(items: [${name}CommandInput!]!, idempotencyKey: String!): [${modelName(dataflowResultEntity(database, flow))}!]!`
      : undefined;
    return batch ? [single, batch] : [single];
  }).join("\n");
  return `${enums ? `${enums}\n\n` : ""}input QiyFilterInput {\n  field: String!\n  operator: String = "eq"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\n${types}${realtimeEntities.length ? `\n\n${realtimeEntities.map((entity) => `type ${modelName(entity)}Event {\n  event: String!\n  record: ${modelName(entity)}!\n}`).join("\n\n")}` : ""}${dataflowInputs ? `\n\n${dataflowInputs}` : ""}\n\ntype Query {\n${queries}\n}\n\ntype Mutation {\n${mutations}${dataflowMutations ? `\n${dataflowMutations}` : ""}\n}${realtimeEntities.length ? `\n\ntype Subscription {\n${realtimeEntities.map((entity) => `  ${entity.name}Changed: ${modelName(entity)}Event!`).join("\n")}\n}` : ""}`;
}

function graphqlResolver(entity: EntityIR, restricted = false): string {
  const name = modelName(entity);
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify(entity.fields.filter((field) => field.filterable !== false).map((field) => field.name));
  const filterModes = JSON.stringify(Object.fromEntries(entity.fields.filter((field) => field.filterable !== false).map((field) => [field.name, filterModesForField(field)])));
  // GraphQL must not become an authorization bypass: every resolver resolves the
  // same request policy as REST, forwards it to the service, and applies the
  // field masks before returning records.
  const readContextType = restricted
    ? `{ scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }`
    : `{ scopeFor: (resource: string) => { field: string; value: string } | undefined }`;
  const writeContextType = restricted
    ? `{ actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }`
    : `{ actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }`;
  const policyArg = restricted ? `, context.policyFor("${entity.name}")` : "";
  const listScope = restricted
    ? `scope: context.scopeFor("${entity.name}"), policy: context.policyFor("${entity.name}"),`
    : `scope: context.scopeFor("${entity.name}"),`;
  const listReturn = restricted
    ? `\n    const policy = context.policyFor("${entity.name}");\n    return { ...result, items: result.data.map((record) => policy.mask(record)), page: args.page ?? 1, pageSize: args.pageSize ?? 20 };`
    : `\n    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };`;
  const oneCall = `services.${entity.name}.one(id, context.scopeFor("${entity.name}")${policyArg})`;
  const oneReturn = restricted ? `${oneCall}.then((record) => record ? context.policyFor("${entity.name}").mask(record) : record)` : oneCall;
  const writeReturn = (expression: string) => restricted
    ? `${expression}.then((record) => record ? context.policyFor("${entity.name}").mask(record) : record)`
    : expression;
  const guardedWrite = (method: "create" | "update") => restricted
    ? `(async () => { const policy = context.policyFor("${entity.name}"); if (Object.keys(input).some((field) => policy.maskedFields.includes(field))) throw new QiyPolicyError("Masked fields cannot be written", 400, "policy.maskedField"); const record = await services.${entity.name}.${method}(${method === "update" ? "id, input" : "input"}, context.actorId, context.scopeFor("${entity.name}"), policy); return record ? policy.mask(record) : record; })()`
    : `services.${entity.name}.${method}(${method === "update" ? "id, input" : "input"}, context.actorId, context.scopeFor("${entity.name}"))`;
  const deleteManyExpression = `services.${entity.name}.deleteMany(ids, context.actorId, context.scopeFor("${entity.name}")${policyArg})`;
  const deleteManyReturn = restricted
    ? `${deleteManyExpression}.then((records) => records.map((record) => context.policyFor("${entity.name}").mask(record)))`
    : deleteManyExpression;
  return `  ${entity.name}Aggregate: ({ field, op }: { field: string; op: string }, context: ${readContextType}) => { ${restricted ? `if (context.policyFor("${entity.name}").maskedFields.includes(field)) return Promise.reject(new Error("Aggregating a masked field is not permitted")); ` : ""}if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.${entity.name}.aggregate(field, op, context.scopeFor("${entity.name}")${policyArg}).then((result) => result.value); },  ${entity.name}Distribution: ({ field }: { field: string }, context: ${readContextType}) => (${JSON.stringify(entity.fields.filter((item) => item.enumName).map((item) => item.name))} as string[]).includes(field) ? services.${entity.name}.distribution(field, context.scopeFor("${entity.name}")${policyArg}) : Promise.reject(new Error("Unsupported distribution field")),\n  ${entity.name}Trend: ({ field, days }: { field: string; days: number }, context: ${readContextType}) => (${JSON.stringify(entity.fields.filter((item) => item.type === "DateTime").map((item) => item.name))} as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.${entity.name}.trend(field, days, context.scopeFor("${entity.name}")${policyArg}) : Promise.reject(new Error("Invalid trend query")),\n` + `  ${entity.name}: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: ${readContextType}) => {
    const sortableFields = ${sortableFields} as string[];
    const filterableFields = ${filterableFields} as string[];
    const filterModes = ${filterModes} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.${entity.name}.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), ${listScope}
    });${listReturn}
  },
  ${entity.name}ById: ({ id }: { id: string }, context: ${readContextType}) => ${oneReturn},
  create${name}: ({ input }: { input: Record<string, unknown> }, context: ${writeContextType}) => ${guardedWrite("create")},
  update${name}: ({ id, input }: { id: string; input: Record<string, unknown> }, context: ${writeContextType}) => ${guardedWrite("update")},
  delete${name}: ({ id }: { id: string }, context: ${writeContextType}) => ${writeReturn(`services.${entity.name}.delete(id, context.actorId, context.scopeFor("${entity.name}")${policyArg})`)},
  delete${name}Many: ({ ids }: { ids: string[] }, context: ${writeContextType}) => ${deleteManyReturn},`;
}

function renderGraphQL(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = [], realtimeEntities: EntityIR[] = []): string {
  const restrictions = (database as DatabaseIR & { restrictions?: QiyResourceRestriction[] }).restrictions ?? [];
  const restrictedResources = new Set(restrictions.map((restriction) => restriction.resource));
  const schema = JSON.stringify(graphqlSchema(database, hiddenFields, dataflows, actions, realtimeEntities));
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const serviceImports = database.entities.map((entity) => `import { create${modelName(entity)}Service } from "./modules/${entity.name}/${entity.name}.service";`).join("\n") + '\nimport { withPaginationLimit } from "./pagination";\n\ntype FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";';
  const services = database.entities.map((entity) => `  ${entity.name}: withPaginationLimit(create${modelName(entity)}Service(repositories.${entity.name})),`).join("\n");
  const resolvers = database.entities.map((entity) => graphqlResolver(entity, restrictedResources.has(entity.name))).join("\n");
  // Subscription roots resolve through the in-process bus that the outbox dispatcher feeds.
  // Subscriptions stream over Server-Sent Events: one `data:` frame per GraphQL result.
  const policyImports = restrictions.length
    ? `import { QiyPolicyError, resolvePolicy, type QiyPolicy } from "./security/policy";\nimport { ${[...restrictedResources].join(", ")} } from "./schema";\n`
    : "";
  const policyColumnsLiteral = restrictions.length
    ? `\nconst policyColumns: Record<string, Record<string, unknown>> = {\n${restrictions.map((restriction) => {
      const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
      return `  ${JSON.stringify(restriction.resource)}: { ${entity.fields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ")} },`;
    }).join("\n")}\n};\n`
    : "";
  const policyContext = restrictions.length
    ? `, policyFor: (resource: string) => resolvePolicy(resource, principal, policyColumns[resource] ?? {})`
    : "";
  const commandResolvers = dataflows.flatMap((flow) => {
    const operation = `run${dataflowGraphqlName(flow.name)}`;
    const single = `  ${operation}: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<${graphqlDataflowResultType(dataflowResultEntity(database, flow))}>(commandRoutes, context.request, ${JSON.stringify(flow.name)}, args.input ?? {}, args.idempotencyKey),`;
    const batch = batchFlows.has(flow.name)
      ? `  ${operation}Batch: (args: { items: Array<Record<string, unknown>>; idempotencyKey: string }, context: { request: Request }) => executeDataflowCommand<Array<${graphqlDataflowResultType(dataflowResultEntity(database, flow))}>>(commandRoutes, context.request, ${JSON.stringify(`${flow.name}/batch`)}, { items: args.items }, args.idempotencyKey),`
      : undefined;
    return batch ? [single, batch] : [single];
  }).join("\n");
  const scopeDefinitions = JSON.stringify((database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? []);
  const commandImport = dataflows.length ? 'import { createDataflowRoutes } from "./dataflows";\n' : "";
  const commandSetup = dataflows.length ? "  const commandRoutes = createDataflowRoutes(authenticate);\n" : "";
  const commandArgument = dataflows.length ? ", commandRoutes" : "";
  const subscriptionRoute = realtimeEntities.length
    ? `
    .get("/subscribe", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      let document;
      try { document = parse(query.query); }
      catch { return status(400, { error: "Invalid GraphQL document" }); }
      const capabilities = realtimeCapabilities(principal);
      const contextValue = {
        request,
        actorId: principal.id,
        canSubscribe: (channel: string) => Boolean(capabilities[channel]?.includes("subscribe")),
        channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")),
        scopeFor: () => undefined,
      };
      let result: unknown;
      try { result = await subscribe({ schema, document, rootValue: resolvers(services${commandArgument}, { canSubscribe: (channel: string) => Boolean(capabilities[channel]?.includes("subscribe")), channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")) }), contextValue, variableValues: query.variables ? JSON.parse(query.variables) as Record<string, unknown> : undefined, operationName: query.operationName }); }
      catch (error) { return status(400, { error: error instanceof Error ? error.message : "Unsupported subscription" }); }
      if (!(Symbol.asyncIterator in (result as object))) {
        const failures = (result as { errors?: Array<{ message: string }> }).errors ?? [];
        const forbidden = failures.some((error) => error.message.includes("not permitted"));
        return status(forbidden ? 403 : 400, { error: failures[0]?.message ?? "Unsupported subscription" });
      }
      const iterator = result as AsyncIterableIterator<Record<string, unknown>>;
      const body = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          request.signal.addEventListener("abort", () => { void iterator.return?.(); try { controller.close(); } catch { /* already closed */ } });
          try {
            for await (const payload of iterator) controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\\n\\n"));
          } catch (error) {
            controller.enqueue(encoder.encode("event: error\\ndata: " + JSON.stringify({ message: error instanceof Error ? error.message : String(error) }) + "\\n\\n"));
          } finally {
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }, { query: t.Object({ query: t.String({ minLength: 1, maxLength: 20000 }), variables: t.Optional(t.String({ maxLength: 20000 })), operationName: t.Optional(t.String({ maxLength: 200 })) }) })`
    : "";

  // graphql-ws (WebSocket) transport: the same subscriptions as SSE, so browsers can
  // use the standard protocol without a separate server. Auth rides connection_init.
  const websocketRoute = realtimeEntities.length
    ? `
    .ws("/ws", {
      async message(socket, raw) {
        const ws = socket as any;
        let frame: { type?: string; id?: string; payload?: { token?: string; query?: string; variables?: Record<string, unknown>; operationName?: string } };
        try {
          // Elysia may hand the message over parsed, as text, or as a binary frame.
          frame = typeof raw === "object" && raw !== null && !(raw instanceof Uint8Array)
            ? raw as typeof frame
            : JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array));
        } catch { return ws.send(JSON.stringify({ type: "error", payload: [{ message: "Invalid message" }] })); }
        if (frame.type === "connection_init") {
          const token = frame.payload?.token ?? "";
          const headers: Record<string, string> = token ? { Authorization: /^Bearer\s/.test(token) ? token : "Bearer " + token } : {};
          const principal = await authenticate(new Request("http://realtime/ws", { headers }));
          if (!principal) { ws.close(4401, "Unauthorized"); return; }
          ws.data.principal = principal;
          ws.data.requestHeaders = headers;
          return ws.send(JSON.stringify({ type: "connection_ack" }));
        }
        if (frame.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
        if (frame.type === "connection_terminate") return ws.close(1000, "Terminated");
        const principal = ws.data.principal as Principal | undefined;
        if (!principal) { ws.close(4401, "Unauthorized"); return; }
        if (frame.type === "complete") { const iterator = ws.data.subscriptions?.get(frame.id); if (iterator) { void iterator.return?.(); ws.data.subscriptions.delete(frame.id); ws.send(JSON.stringify({ id: frame.id, type: "complete" })); } return; }
        if (frame.type !== "subscribe" || !frame.id) return ws.send(JSON.stringify({ type: "error", id: frame.id, payload: [{ message: "Unsupported message" }] }));
        let document;
        try { document = parse(frame.payload?.query ?? ""); } catch { return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: "Invalid GraphQL document" }] })); }
        const capabilities = realtimeCapabilities(principal);
        const contextValue = {
          request: new Request("http://realtime/ws", { headers: ws.data.requestHeaders ?? {} }),
          actorId: principal.id,
          channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")),
          scopeFor: () => undefined,
        };
        let result: any;
        try { result = await subscribe({ schema, document, rootValue: resolvers(services${commandArgument}, { channelFor: contextValue.channelFor }), contextValue, variableValues: frame.payload?.variables, operationName: frame.payload?.operationName }); }
        catch (error) { return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: error instanceof Error ? error.message : "Unsupported subscription" }] })); }
        if (!result || !(Symbol.asyncIterator in result)) {
          const failures = (result as { errors?: Array<{ message: string }> } | undefined)?.errors ?? [{ message: "Unsupported subscription" }];
          return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: failures }));
        }
        const iterator = result as AsyncIterableIterator<Record<string, unknown>>;
        ws.data.subscriptions = ws.data.subscriptions ?? new Map();
        ws.data.subscriptions.set(frame.id, iterator);
        void (async () => {
          try { for await (const payload of iterator) { if (ws.readyState !== 1) break; ws.send(JSON.stringify({ id: frame.id, type: "next", payload })); } }
          catch (error) { if (ws.readyState === 1) ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: error instanceof Error ? error.message : String(error) }] })); }
          finally { if (ws.readyState === 1) ws.send(JSON.stringify({ id: frame.id, type: "complete" })); ws.data.subscriptions?.delete(frame.id); }
        })();
      },
      close(socket) { const ws = socket as any; for (const iterator of ws.data.subscriptions?.values?.() ?? []) void iterator.return?.(); ws.data.subscriptions?.clear?.(); },
    })`
    : "";
  const commandParameter = dataflows.length ? ", commandRoutes: ReturnType<typeof createDataflowRoutes>" : "";
  // Subscription roots are lazy top-level getters: graphql-js reads rootValue[field]
  // when the operation is executed, so queries never evaluate them. The emitted value
  // must be shaped like the root field result, because graphql-js re-executes the
  // root selection against each event.
  const subscriptionResolvers = realtimeEntities.length
    ? realtimeEntities.map((entity) => {
      const field = `${entity.name}Changed`;
      // The granted channel may be claim-segmented (`qiy:orders:eu`), so resolve it
      // from the caller's capabilities instead of assuming the base name.
      return `  get ${field}() { const channel = context?.channelFor?.(${JSON.stringify(`qiy:${entity.tableName}`)}); if (!channel) throw new GraphQLError("Realtime subscription is not permitted", { extensions: { status: 403, errorKey: "realtime.forbidden" } }); const events = realtimeChannelIterator(channel); return (async function* () { try { for await (const event of events) yield { ${field}: { event: event.event, record: event.record } }; } finally { events.close(); } })(); },`;
    }).join("\n")
    : "";

  const commandHelpers = dataflows.length ? `async function executeDataflowCommand<T>(routes: ReturnType<typeof createDataflowRoutes>, request: Request, flow: string, input: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  const path = flow.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const response = await routes.handle(new Request("http://qiy.internal/api/v1/commands/" + path, { method: "POST", headers, body: JSON.stringify(input) }));
  const payload = await response.json() as { error?: string; errorKey?: string } & Record<string, unknown>;
  if (!response.ok) throw new GraphQLError(payload.error ?? "Dataflow command failed", { extensions: { status: response.status, ...(payload.errorKey ? { errorKey: payload.errorKey } : {}) } });
  return payload as T;
}

` : "";
  return `import { Elysia, t } from "elysia";
import { buildSchema, graphql, parse, subscribe, getOperationAST, Kind, GraphQLError } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator, Principal } from "./auth/guard";
${policyImports}${commandImport}${serviceImports}${realtimeEntities.length ? '\nimport { realtimeChannelIterator } from "./realtime";\nimport { realtimeCapabilities } from "./realtime";\n' : ""}

export const graphqlTypeDefs = ${schema};
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = ${scopeDefinitions} as Array<{ resource: string; field: string; claim: string; tree?: { entity: string; parentField: string } }>;${policyColumnsLiteral}

${commandHelpers}export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }${policyContext} };
}

function requestedFields(query: string, operationName?: string): Set<string> {
  const document = parse(query);
  const fragments = new Map(document.definitions.filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION).map((fragment) => [fragment.name.value, fragment]));
  const fields = new Set<string>();
  const visit = (selections: readonly import("graphql").SelectionNode[], seen = new Set<string>()) => {
    for (const selection of selections) {
      if (selection.kind === Kind.FIELD) fields.add(selection.name.value);
      else if (selection.kind === Kind.INLINE_FRAGMENT) visit(selection.selectionSet.selections, seen);
      else {
        if (seen.has(selection.name.value)) continue;
        const fragment = fragments.get(selection.name.value);
        if (fragment) visit(fragment.selectionSet.selections, new Set([...seen, selection.name.value]));
      }
    }
  };
  const operation = getOperationAST(document, operationName);
  if (operation) visit(operation.selectionSet.selections);
  return fields;
}

interface GraphQLRequest { query: string; variables?: Record<string, unknown>; operationName?: string; }

export function createGraphQLRoutes(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
${services}
  };
${commandSetup}  return new Elysia({ prefix: "/graphql" })
    .post("/", async ({ body, request, status }) => {
      const operation = body as GraphQLRequest;
      const principal = await authenticate(request);
      const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
      let fields: Set<string>;
      try { fields = requestedFields(operation.query, operation.operationName); } catch { fields = new Set(); }
      if (scopeDefinitions.some(({ resource }) => [resource, resource + "ById", resource + "Distribution", resource + "Trend", "create" + resource[0]!.toUpperCase() + resource.slice(1), "update" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1) + "Many"].some((name) => fields.has(name)) && !scopes[resource]?.value)) return status(403, { error: "Missing required data scope claim" });
      return graphql({ schema, rootValue: resolvers(services${commandArgument}), contextValue: { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }${policyContext} }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) })${subscriptionRoute}${websocketRoute};
}

function resolvers(services: {
${database.entities.map((entity) => `  ${entity.name}: ReturnType<typeof create${modelName(entity)}Service>;`).join("\n")}
}${commandParameter}, context?: { canSubscribe?: (channel: string) => boolean; channelFor?: (prefix: string) => string | undefined }) {
  return {
${subscriptionResolvers ? `${subscriptionResolvers}\n` : ""}${resolvers}${commandResolvers ? `\n${commandResolvers}` : ""}
  };}

export function createGraphQLResolvers(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
${services}
  };
${commandSetup}  return resolvers(services${commandArgument});
}
`;
}

function renderGraphQLAdapter(database: DatabaseIR, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = []): string {
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const commandMutations = dataflows.flatMap((flow) => {
    const operation = `run${dataflowGraphqlName(flow.name)}`;
    return batchFlows.has(flow.name) ? [operation, `${operation}Batch`] : [operation];
  });
  const adapterResolvers = `export function createGraphQLAdapterResolvers(repositories: Repositories, authenticate: Authenticator) {
  const root = createGraphQLResolvers(repositories, authenticate);
  return {
    Query: {
${database.entities.flatMap((entity) => [entity.name, `${entity.name}ById`, `${entity.name}Distribution`, `${entity.name}Trend`].map((field) => `      ${field}: async (_parent: unknown, args: any, context: { request: Request }) => root.${field}(args, await createGraphQLContext(authenticate, context.request)),`)).join("\n")}
    },
    Mutation: {
${[...database.entities.flatMap((entity) => [`create${modelName(entity)}`, `update${modelName(entity)}`, `delete${modelName(entity)}`, `delete${modelName(entity)}Many`]), ...commandMutations].map((field) => `      ${field}: async (_parent: unknown, args: any, context: { request: Request }) => root.${field}(args, await createGraphQLContext(authenticate, context.request)),`).join("\n")}
    },
  };
}`;
  return `import type { Repositories } from "./app";\nimport type { Authenticator } from "./auth/guard";\nimport { createGraphQLContext } from "./graphql";\nimport { createGraphQLResolvers } from "./graphql";\n\n${adapterResolvers}\n`;
}

function renderGraphQLTest(database: DatabaseIR, hiddenFields: string[] = []): string {
  const entity = database.entities[0]!;
  const visibleFields = entity.fields.filter((field) => !hiddenFields.includes(field.name));
  const scopes = (database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? [];
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, "00000000-0000-4000-8000-000000000002"])));
  const name = modelName(entity);
  // Hidden fields (for example the local-auth password column) are absent from the
  // generated schema, so neither the selection set nor the input may reference them.
  const values = visibleFields.filter((field) => !field.primaryKey && !field.nullable).map((field) => {
    const example = field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "Files" ? '["uploads/sample.pdf"]' : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
        : field.enumName ? JSON.stringify(database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? "") : '"Example"';
    return `${JSON.stringify(field.name)}: ${example}`;
  }).join(", ");
  const fields = visibleFields.slice(0, 3).map((field) => field.name).join(" ");
  return `import { describe, expect, test } from "bun:test";\nimport { Elysia } from "elysia";\nimport { createGraphQLRoutes } from "../src/graphql";\nimport type { Repositories } from "../src/app";\n\nconst records = new Map<string, Record<string, unknown>>();\nconst repository: Repositories["${entity.name}"] = {\n  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },\n  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },\n  async list(page, pageSize, options = {}) {\n    const rows = [...records.values()];\n    const filtered = options.search ? rows.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : rows;\n    return { data: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };\n  },\n  async one(id) { return records.get(id); },\n  async create(values) { const record = { id: crypto.randomUUID(), ...values }; records.set(record.id, record); return record; },\n  async update(id, values) { const old = records.get(id); if (!old) return undefined; const record = { ...old, ...values }; records.set(id, record); return record; },\n  async delete(id) { const record = records.get(id); records.delete(id); return record; },\n  async deleteMany(ids) { return ids.flatMap((id) => { const record = records.get(id); records.delete(id); return record ? [record] : []; }); },\n};\nconst app = new Elysia().use(createGraphQLRoutes({ ${entity.name}: repository } as Repositories, async () => ({ id: "test-user", role: "admin", name: "Test", claims: ${claims} })));\n\ndescribe("GraphQL API", () => {\n  test("supports create, list and delete mutations", async () => {\n    records.clear();\n    const create = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($input: ${name}CreateInput!) { create${name}(input: $input) { id } }", variables: { input: { ${values} } } }) }));\n    expect(create.status).toBe(200);\n    const created = await create.json() as { data: { create${name}: { id: string } } };\n    expect(created.data.create${name}.id).toBeTruthy();\n    const list = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { ${entity.name} { items { ${fields} } total } }" }) }));\n    expect((await list.json() as { data: { ${entity.name}: { total: number } } }).data.${entity.name}.total).toBe(1);\n    const deleted = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($id: ID!) { delete${name}(id: $id) { id } }", variables: { id: created.data.create${name}.id } }) }));\n    expect((await deleted.json() as { data: { delete${name}: { id: string } } }).data.delete${name}.id).toBeTruthy();\n  });\n});\n`;
}

function renderGraphQLListOptionsTest(database: DatabaseIR): string | undefined {
  const scopes = (database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? [];
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, "00000000-0000-4000-8000-000000000002"])));
  const cases = database.entities.flatMap((entity) => [
    ...entity.fields.filter((field) => field.sortable === false).map((field) => `  test("rejects disabled sort ${entity.name}.${field.name}", async () => {
    const response = await app.handle(request("query($sort: String) { ${entity.name}(sort: $sort) { total } }", { sort: ${JSON.stringify(field.name)} }));
    const payload = await response.json() as { errors?: Array<{ message: string }> };
    expect(payload.errors?.[0]?.message).toBe("Unsupported sort field");
  });`),
    ...entity.fields.filter((field) => field.filterable === false).map((field) => `  test("rejects disabled filter ${entity.name}.${field.name}", async () => {
    const response = await app.handle(request("query($filters: [QiyFilterInput!]) { ${entity.name}(filters: $filters) { total } }", { filters: [{ field: ${JSON.stringify(field.name)}, value: "x" }] }));
    const payload = await response.json() as { errors?: Array<{ message: string }> };
    expect(payload.errors?.[0]?.message).toBe("Unsupported filter field");
  });`),
  ]);
  if (cases.length === 0) return undefined;
  const resources = JSON.stringify(database.entities.map((entity) => entity.name));
  return `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createGraphQLRoutes } from "../src/graphql";
import type { Repositories } from "../src/app";

const repository = {
  async distribution() { return []; },
  async trend() { return []; },
  async list() { return { data: [], total: 0 }; },
  async one() { return undefined; },
  async create() { return {}; },
  async update() { return undefined; },
  async delete() { return undefined; },
  async deleteMany() { return []; },
};
const repositories = Object.fromEntries(${resources}.map((name) => [name, repository])) as unknown as Repositories;
const app = new Elysia().use(createGraphQLRoutes(repositories, async () => ({ id: "admin", role: "admin", name: "Admin", claims: ${claims} })));
const request = (query: string, variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });

${cases.join("\n\n")}
`;
}

function renderDataScopeTest(database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]>, orderWorkflowEnabled = false): string | undefined {
  const configured = scopes[0];
  if (!configured) return undefined;
  const entity = database.entities.find((item) => item.name === configured.resource || item.tableName === configured.resource)!;
  const unscoped = database.entities.find((item) => item.name !== entity.name && !scopes.some((scope) => scope.resource === item.name || scope.resource === item.tableName));
  const name = modelName(entity);
  const value = entity.fields.find((field) => field.name === configured.field)?.type === "UUID"
    ? "00000000-0000-4000-8000-000000000002" : "tenant-a";
  return `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

const scoped = { field: ${JSON.stringify(configured.field)}, value: ${JSON.stringify(value)} };
const seen: Array<unknown> = [];
const repository = {
  distribution: async (_field: string, scope?: unknown) => { seen.push(scope); return []; },
  list: async (_page: number, _size: number, options?: { scope?: unknown }) => { seen.push(options?.scope); return { data: [], total: 0 }; },
  one: async (_id: string, scope?: unknown) => { seen.push(scope); return undefined; },
  create: async (_values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return {}; },
  update: async (_id: string, _values: unknown, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  delete: async (_id: string, _actor?: string, scope?: unknown) => { seen.push(scope); return undefined; },
  deleteMany: async (_ids: string[], _actor?: string, scope?: unknown) => { seen.push(scope); return []; },
};
const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((item) => item.name))}.map((resource) => [resource, repository])) as unknown as Repositories;
const request = (query: string) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });

test("data scope rejects missing claims without blocking unrelated resources", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin" }), false, false);
  const graph = await app.handle(request("query { ${entity.name} { total } }"));
  if (graph.status === 200) expect((await graph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(graph.status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/${entity.tableName}/"))).status).toBe(403);
  ${unscoped ? `expect((await app.handle(request("query { ${unscoped.name} { total } }"))).status).toBe(200);` : ""}
  expect(seen).toEqual(${unscoped ? "[undefined]" : "[]"});
});

test("REST and GraphQL pass the authorized scope to repository operations", async () => {
  seen.length = 0;
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin", claims: { ${JSON.stringify(configured.claim)}: scoped.value } }), false, false);
  const list = await app.handle(request("query { ${entity.name} { total } }"));
  expect(list.status).toBe(200);
  expect((await list.json() as { data: { ${entity.name}: { total: number } } }).data.${entity.name}.total).toBe(0);
  expect((await app.handle(request('mutation { delete${name}(id: "00000000-0000-4000-8000-000000000001") { id } }'))).status).toBe(200);
  expect((await app.handle(new Request("http://localhost/api/v1/${entity.tableName}/"))).status).toBe(200);
  expect(seen).toEqual([scoped, scoped, scoped]);
});
${orderWorkflowEnabled && database.dialect === "postgresql" && entity.name === "orders" ? `
test("order workflows reject missing scope claims before database access", async () => {
  const app = await createApp(repositories, async () => ({ id: "user", name: "User", role: "admin" }), true, false);
  for (const command of ["submit", "approve", "ship", "cancel"]) {
    const response = await app.handle(new Request("http://localhost/api/v1/orders/00000000-0000-4000-8000-000000000001/" + command, { method: "POST" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Missing required data scope claim" });
  }
});
` : ""}
`;
}

function renderSqliteScopeTest(database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]>): string | undefined {
  if (database.dialect !== "sqlite" || !scopes.length) return undefined;
  const configured = scopes[0]!;
  const entity = database.entities.find((item) => item.name === configured.resource || item.tableName === configured.resource)!;
  const dateField = entity.fields.find((field) => field.type === "DateTime")?.name;
  const fields = entity.fields.filter((field) => !field.primaryKey && !field.nullable);
  const values = fields.map((field) => {
    const value = field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : field.type === "Integer" ? 1 : field.type === "Decimal" || field.type === "Money" ? "1.00" : field.type === "Date" ? "2026-11-30" : field.type === "Time" ? "08:30:00" : field.enumName ? database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name : "Example";
    return `${JSON.stringify(field.name)}: ${field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : JSON.stringify(value)}`;
  }).join(", ");
  const columns = entity.fields.map((field) => `"${field.columnName ?? field.name}" ${field.type === "Integer" || field.type === "DateTime" ? "integer" : "text"}${field.primaryKey ? " primary key" : ""}${!field.nullable && !field.primaryKey ? " not null" : ""}`).join(", ");
  return `import { expect, test } from "bun:test";

test("SQLite enforces tenant scope on reads and writes", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { ${modelName(entity)}Repository: repository } = await import("../src/modules/${entity.name}/${entity.name}.repository");
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS "audit_events"; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE "audit_events" ("id" text primary key, "actorId" text, "action" text not null, "resource" text not null, "resourceId" text, "metadata" text, "createdAt" integer not null);`)});
  const first = { field: ${JSON.stringify(configured.field)}, value: "tenant-a" };
  const second = { field: ${JSON.stringify(configured.field)}, value: "tenant-b" };
  const values = { ${values} };
  const owned = await repository.create({ ...values, ${JSON.stringify(configured.field)}: second.value }, "actor", first);
  const foreign = await repository.create(values, "actor", second);
  expect(owned[${JSON.stringify(configured.field)}]).toBe(first.value);
  expect((await repository.list(1, 20, { scope: first })).total).toBe(1);
  expect((await repository.list(1, 20, { scope: second })).total).toBe(1);
  expect(await repository.one(String(foreign.id), first)).toBeUndefined();
  expect(await repository.update(String(foreign.id), { ${JSON.stringify(configured.field)}: first.value }, "actor", first)).toBeUndefined();
  expect(await repository.delete(String(foreign.id), "actor", first)).toBeUndefined();
  expect(await repository.deleteMany([String(owned.id), String(foreign.id)], "actor", first)).toHaveLength(1);
  expect(await repository.one(String(foreign.id), second)).toBeDefined();
  const updated = await repository.update(String(foreign.id), { ${JSON.stringify(configured.field)}: first.value }, "actor", second);
  expect(updated?.[${JSON.stringify(configured.field)}]).toBe(second.value);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(4);
${dateField ? `  const { create${modelName(entity)}Service } = await import("../src/modules/${entity.name}/${entity.name}.service");
  const service = create${modelName(entity)}Service(repository);
  const dated = await service.create({ ...values, ${dateField}: "2026-01-01T00:00:00.000Z" }, "actor", first);
  expect(dated.${dateField}).toBeInstanceOf(Date);
  expect((dated.${dateField} as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  const changed = await service.update(String(dated.id), { ${dateField}: "2026-01-02T00:00:00.000Z" }, "actor", first);
  expect((changed?.${dateField} as Date).toISOString()).toBe("2026-01-02T00:00:00.000Z");
  expect((await repository.one(String(dated.id), first))?.${dateField}).toBeInstanceOf(Date);
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const onDay = (offset: number) => new Date(midnight + offset * 86400000 + 12 * 3600000);
  for (const [offset, tenant] of [[-1, first], [0, first], [0, first], [0, second], [-2, first], [1, first]] as const) {
    await repository.create({ ...values, ${dateField}: onDay(offset) }, "actor", tenant);
  }
  expect(await repository.trend("${dateField}", 2, first)).toEqual([
    { day: onDay(-1).toISOString().slice(0, 10), count: 1 },
    { day: onDay(0).toISOString().slice(0, 10), count: 2 },
  ]);
  expect(await repository.trend("${dateField}", 2, second)).toEqual([{ day: onDay(0).toISOString().slice(0, 10), count: 1 }]);
  await expect(repository.trend("${dateField}", 366, first)).rejects.toThrow("Invalid trend query");
` : ""}
});
`;
}

function previewRecord(entity: EntityIR, database: DatabaseIR, scope?: { field: string; value: string }): string {
  const values = entity.fields.map((field) => {
    if (field.type === "DateTime") return `${JSON.stringify(field.name)}: new Date().toISOString()`;
    if (field.type === "Date") return `${JSON.stringify(field.name)}: ${JSON.stringify("2026-11-30")}`;
    if (field.type === "Time") return `${JSON.stringify(field.name)}: ${JSON.stringify("08:30:00")}`;
    let value: unknown = null;
    if (field.name === scope?.field) value = scope.value;
    else if (field.primaryKey) value = "00000000-0000-4000-8000-000000000001";
    else if (field.enumName) value = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? null;
    else if (field.type === "Text") value = `Demo ${entity.name}`;
    else if (field.type === "Integer") value = 1;
    else if (field.type === "Decimal" || field.type === "Money") value = "49.90";
    return `${JSON.stringify(field.name)}: ${JSON.stringify(value)}`;
  });
  return `{ ${values.join(", ")} }`;
}

function previewRepository(entity: EntityIR, database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = []): string {
  const configured = scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  const field = entity.fields.find((item) => item.name === configured?.field);
  const scope = configured && field ? { field: field.name, value: field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : `Demo ${entity.name}` } : undefined;
  const scopeWriteSpread = "...(scope ? { [scope.field]: scope.value } : {})";
  return `${entity.name}: (() => {
    const records: Array<Record<string, unknown>> = [${previewRecord(entity, database, scope)}];
    const visible = (record: Record<string, unknown>, scope?: { field: string; value: string }) => !scope || record[scope.field] === scope.value;
    return {
      async distribution(field: string, scope?: { field: string; value: string }) { const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
      async trend(field: string, days: number, scope?: { field: string; value: string }) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
      async list(page: number, pageSize: number, options?: { scope?: { field: string; value: string } }) { const rows = records.filter((record) => visible(record, options?.scope)); return { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }; },
      async one(id: string, scope?: { field: string; value: string }) { return records.find((record) => record.id === id && visible(record, scope)); },
      async create(values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = { id: crypto.randomUUID(), ...values, ${scopeWriteSpread} };
        records.push(record);
        return record;
      },
      async update(id: string, values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = records.find((item) => item.id === id && visible(item, scope));
        if (record) Object.assign(record, values, scope ? { [scope.field]: scope.value } : {});
        return record;
      },
      async delete(id: string, _actor?: string, scope?: { field: string; value: string }) {
        const index = records.findIndex((record) => record.id === id && visible(record, scope));
        return index === -1 ? undefined : records.splice(index, 1)[0];
      },
      async deleteMany(ids: string[], _actor?: string, scope?: { field: string; value: string }) {
        const deleted = records.filter((record) => ids.includes(String(record.id)) && visible(record, scope));
        for (const record of deleted) records.splice(records.indexOf(record), 1);
        return deleted;
      },
    };
  })(),`;
}

/**
 * Row-level and field-level authorization shared by REST, GraphQL and the
 * repository layer. Row predicates are compiled into Drizzle conditions so the
 * database enforces visibility, and field masks are applied to every response
 * projection. Both are derived from the authenticated principal, never from the
 * request body, so a client cannot widen its own scope.
 */
function renderPolicyModule(restrictions: QiyResourceRestriction[], database: DatabaseIR, scopes: QiyScope[] = []): string {
  const configuredScopes = scopes.length ? scopes : ((database as DatabaseIR & { scopes?: QiyScope[] }).scopes ?? []);
  /** True when a restrict expression mentions the caller's data scope. */
  const mentionsScope = (node: QiyPolicyExpression): boolean =>
    node.kind === "scope" ? true
      : node.kind === "not" ? mentionsScope(node.expression)
        : node.kind === "and" || node.kind === "or" ? node.children.some(mentionsScope)
          : false;
  // resolveScopeTree reads scopes off the database IR, so mirror them onto a copy.
  const scopedDatabase = scopes.length ? ({ ...database, scopes } as DatabaseIR & { scopes: QiyScope[] }) : database;
  const scopeResources: Record<string, { field: string; helper?: string }> = {};
  const treeHelpers: string[] = [];
  for (const restriction of restrictions) {
    if (!(restriction.expressions ?? []).some(mentionsScope)) continue;
    const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
    const scope = configuredScopes.find((candidate) => candidate.resource === entity.name || candidate.resource === entity.tableName);
    if (!scope) continue;
    let helper: string | undefined;
    if (resolveScopeTree(scopedDatabase, entity) && !treeHelpers.some((item) => item === entity.name)) {
      const name = `qiyPolicyScopeSubtree_${treeHelpers.length}`;
      const rendered = renderScopeTreeHelper(scopedDatabase, entity, name);
      if (rendered) {
        treeHelpers.push(rendered);
        helper = name;
      }
    }
    scopeResources[entity.name] = { field: scope.field, ...(helper ? { helper } : {}) };
  }
  const scopeLiteral = JSON.stringify(scopeResources);
  const helperNames = treeHelpers.map((code) => /function (qiyPolicyScopeSubtree_\d+)/.exec(code)?.[1]).filter((name): name is string => Boolean(name));
  const helperMapLiteral = `{ ${helperNames.map((name) => `${JSON.stringify(name)}: ${name}`).join(", ")} }`;
  const scopeHelperCode = treeHelpers.length ? `\n${treeHelpers.join("\n")}` : "";
  const treeImport = treeHelpers.length ? `\nimport { ${[...new Set(scopes.map((scope) => database.entities.find((candidate) => candidate.name === scope.tree?.entity || candidate.tableName === scope.tree?.entity)?.name).filter((name): name is string => Boolean(name)))].join(", ")} } from "../schema";` : "";
  const rowsLiteral = JSON.stringify(Object.fromEntries(restrictions.map((restriction) => {
    const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
    const numericFields = [...(restriction.rows ?? []), ...(restriction.groups ?? []).flat()]
      .filter((row) => entity.fields.find((field) => field.name === row.field)?.type === "Integer")
      .map((row) => row.field);
    return [restriction.resource, { rows: restriction.rows ?? [], groups: restriction.groups ?? [], expressions: restriction.expressions ?? [], masks: restriction.masks ?? [], roles: restriction.roles ?? [], numericFields }];
  })));
  const roleLiteral = JSON.stringify(Object.fromEntries(restrictions.filter((restriction) => restriction.roles?.length).map((restriction) => [restriction.resource, restriction.roles!])));
  return `import { and, eq, gt, gte, inArray, lt, lte, ne, not, notInArray, or${treeHelpers.length ? ", sql" : ""} } from "drizzle-orm";
import type { Principal } from "../auth/guard";

export type QiyRole = "admin" | "operator" | "viewer";

export interface QiyRowPredicate {
  field: string;
  source: "claim" | "values";
  operator: "==" | "!=" | "in" | "notIn";
  claim?: string;
  values?: string[];
  missing: "deny" | "hide";
}

export type QiyCrossOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type QiyPolicyExpression =
  | { kind: "predicate"; predicate: QiyRowPredicate }
  | { kind: "cross"; field: string; operator: QiyCrossOperator; otherField: string }
  | { kind: "scope" }
  | { kind: "not"; expression: QiyPolicyExpression }
  | { kind: "and"; children: QiyPolicyExpression[] }
  | { kind: "or"; children: QiyPolicyExpression[] };

export interface QiyFieldMask {
  field: string;
  roles?: QiyRole[];
  claim?: string;
  claimState?: "present" | "absent";
  mode: "omit" | "null" | "redact";
  replacement?: string;
}

export interface QiyResourcePolicy {
  rows: QiyRowPredicate[];
  /** Each group is OR-ed internally and AND-ed with rows. */
  groups: QiyRowPredicate[][];
  /** General boolean expressions AND-ed with rows and groups. */
  expressions: QiyPolicyExpression[];
  masks: QiyFieldMask[];
  roles: QiyRole[];
  /** Fields whose declared literal values must be coerced to numbers. */
  numericFields: string[];
}

/** Resolved authorization state for one request and one resource. */
export interface QiyPolicy {
  /** Drizzle row conditions that must all hold for a row to be visible. */
  conditions: unknown[];
  /** True when an expression mentions the scope atom, so the repository must not also apply its implicit scope filter. */
  usesScope: boolean;
  /** Fields the current principal must not read or write. */
  maskedFields: string[];
  /** Applies role and claim based field masking to a response record. */
  mask(record: Record<string, unknown>): Record<string, unknown>;
}

const policies = ${rowsLiteral} as Record<string, QiyResourcePolicy>;
const scopeResources = ${scopeLiteral} as Record<string, { field: string; helper?: string }>;
const scopeHelpers: Record<string, (column: unknown, value: string) => unknown> = ${helperMapLiteral};${treeImport}${scopeHelperCode}
const resourceRoles = ${roleLiteral} as Record<string, QiyRole[]>;

export class QiyPolicyError extends Error {
  readonly status: number;
  readonly errorKey: string;
  constructor(message: string, status = 403, errorKey = "policy.denied") {
    super(message);
    this.status = status;
    this.errorKey = errorKey;
  }
}

/** True when the principal carries any role permitted for the resource. */
export function mayUseResource(resource: string, principal: Principal | null): boolean {
  const roles = resourceRoles[resource];
  if (!roles || roles.length === 0) return true;
  if (!principal) return false;
  return roles.includes(principal.role as QiyRole);
}

function claimValue(principal: Principal | null, claim: string): string | undefined {
  const value = principal?.claims?.[claim];
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/**
 * Builds the row conditions and mask function for a resource. When the resource
 * has no recorded policy the result is inert, so generated behaviour for models
 * without \`restrict\` blocks is unchanged.
 */
export function resolvePolicy(resource: string, principal: Principal | null, columns: Record<string, unknown>, scope?: { field: string; value: string }): QiyPolicy {
  const policy = policies[resource];
  if (!policy) return { conditions: [], maskedFields: [], mask: (record) => record, usesScope: false };
  if (!mayUseResource(resource, principal)) throw new QiyPolicyError("Permission denied for resource " + resource, 403, "policy.resourceDenied");
  const conditions: unknown[] = [];
  /** Returns the condition for one predicate, or undefined when it must be hidden. */
  const buildCondition = (row: QiyRowPredicate, missingIsHide: boolean): unknown | undefined => {
    const column = columns[row.field];
    if (!column) throw new QiyPolicyError("Unknown policy column " + row.field, 500, "policy.misconfigured");
    if (row.source === "claim") {
      const value = claimValue(principal, row.claim!);
      if (value === undefined) {
        if (row.missing === "deny" && !missingIsHide) throw new QiyPolicyError("Missing required authorization claim: " + row.claim, 403, "policy.missingClaim");
        return undefined;
      }
      return eq(column as never, value as never);
    }
    const values = (row.values ?? []).map((value) => (policy.numericFields.includes(row.field) ? Number(value) : value));
    if (row.operator === "==") return eq(column as never, values[0] as never);
    if (row.operator === "!=") return ne(column as never, values[0] as never);
    if (row.operator === "in") return inArray(column as never, values as never[]);
    return notInArray(column as never, values as never[]);
  };
  for (const row of policy.rows) {
    conditions.push(buildCondition(row, false) ?? eq(columns[row.field] as never, "__qiy_policy_never_matches__" as never));
  }
  for (const group of policy.groups ?? []) {
    // A missing claim drops only its own branch; if every branch drops the request
    // stays fail-closed instead of silently returning every row.
    const branches = group.map((row) => buildCondition(row, true)).filter((condition) => condition !== undefined);
    if (!branches.length) throw new QiyPolicyError("Missing required authorization claim for a policy group", 403, "policy.missingClaim");
    conditions.push(branches.length === 1 ? branches[0] : or(...(branches as never[])));
  }
  /** Builds one boolean expression; undefined means "cannot be satisfied for this principal". */
  const buildExpression = (node: QiyPolicyExpression): unknown | undefined => {
    if (node.kind === "predicate") return buildCondition(node.predicate, true);
    if (node.kind === "scope") {
      const config = scopeResources[resource];
      if (!scope || !scope.value || !config) return undefined;
      const column = columns[scope.field] ?? columns[config.field];
      if (!column) throw new QiyPolicyError("Unknown scope column " + scope.field, 500, "policy.misconfigured");
      const helper = config.helper ? scopeHelpers[config.helper] : undefined;
      if (helper) return helper(column, scope.value);
      return eq(column as never, scope.value as never);
    }
    if (node.kind === "cross") {
      const left = columns[node.field];
      const right = columns[node.otherField];
      if (!left || !right) throw new QiyPolicyError("Unknown cross-field policy column", 500, "policy.misconfigured");
      if (node.operator === "==") return eq(left as never, right as never);
      if (node.operator === "!=") return ne(left as never, right as never);
      if (node.operator === "<") return lt(left as never, right as never);
      if (node.operator === "<=") return lte(left as never, right as never);
      if (node.operator === ">") return gt(left as never, right as never);
      return gte(left as never, right as never);
    }
    if (node.kind === "not") {
      // NOT of an unsatisfiable claim branch is never treated as "allow everything".
      const inner = buildExpression(node.expression);
      return inner === undefined ? undefined : not(inner as never);
    }
    const children = node.children.map(buildExpression).filter((condition) => condition !== undefined);
    if (!children.length) return undefined;
    if (children.length === 1) return children[0];
    return node.kind === "and" ? and(...(children as never[])) : or(...(children as never[]));
  };
  for (const expression of policy.expressions ?? []) {
    const built = buildExpression(expression);
    if (built === undefined) throw new QiyPolicyError("Missing required authorization claim for a policy expression", 403, "policy.missingClaim");
    conditions.push(built);
  }
  const activeMasks = policy.masks.filter((mask) => {
    if (mask.roles && !(principal && mask.roles.includes(principal.role as QiyRole))) return false;
    if (mask.claim) {
      const present = claimValue(principal, mask.claim) !== undefined;
      if (mask.claimState === "absent" ? present : !present) return false;
    }
    return true;
  });
  const mask = (record: Record<string, unknown>) => {
    if (!activeMasks.length) return record;
    const safe = { ...record };
    for (const item of activeMasks) {
      if (!Object.hasOwn(safe, item.field)) continue;
      if (item.mode === "omit") delete safe[item.field];
      else if (item.mode === "null") safe[item.field] = null;
      else safe[item.field] = item.replacement;
    }
    return safe;
  };
  const usesScope = (policy.expressions ?? []).some((expression) => {
    const visit = (node: QiyPolicyExpression): boolean =>
      node.kind === "scope" ? true
        : node.kind === "not" ? visit(node.expression)
          : node.kind === "and" || node.kind === "or" ? node.children.some(visit)
            : false;
    return visit(expression);
  });
  return { conditions, maskedFields: activeMasks.map((item) => item.field), mask, usesScope };
}
`;
}

function renderRoutes(entity: EntityIR, database: DatabaseIR, scopes: Array<{ resource: string; field: string; claim: string }> = [], hiddenFields: string[] = [], restricted = false, temporalErrorClass = ""): string {
  const temporal = temporalFieldsOf(entity);
  const name = modelName(entity);
  const route = JSON.stringify(`/${entity.tableName}`);
  const scope = scopes.find((item) => item.resource === entity.name || item.resource === entity.tableName);
  const scopeLiteral = scope ? JSON.stringify({ field: scope.field, claim: scope.claim }) : "null";
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify(entity.fields.filter((field) => field.filterable !== false).map((field) => field.name));
  const filterModes = JSON.stringify(Object.fromEntries(entity.fields.filter((field) => field.filterable !== false).map((field) => [field.name, filterModesForField(field)])));
  const allowed = entity.fields.filter((field) => !field.primaryKey).map((field) => JSON.stringify(field.name)).join(", ");
  const sanitize = hiddenFields.length ? `const privateFields = ${JSON.stringify(hiddenFields)} as string[];
const redact = (record: Record<string, unknown>) => { const safe = { ...record }; for (const field of privateFields) delete safe[field]; return safe; };` : "const redact = (record: Record<string, unknown>) => record;";
  const privateInputGuard = hiddenFields.length ? `.onRequest(async ({ request, status }) => {
      if (request.method !== "POST" && request.method !== "PATCH") return;
      try {
        const values: unknown = await request.clone().json();
        if (values && typeof values === "object" && !Array.isArray(values) && privateFields.some((field) => Object.hasOwn(values, field))) return status(400, { error: "Private fields cannot be written" });
      } catch { return; }
    })` : "";
  const maskWriteGuard = restricted ? `.onRequest(async ({ request, status }) => {
      // Elysia hooks run for every request, so this guard must only inspect its own resource.
      if (!new URL(request.url).pathname.startsWith("/api/v1" + ${route})) return;
      if (request.method !== "POST" && request.method !== "PATCH") return;
      let values: unknown;
      try { values = await request.clone().json(); } catch { return; }
      if (!values || typeof values !== "object" || Array.isArray(values)) return;
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      if (policy.maskedFields.some((field) => Object.hasOwn(values, field))) return status(400, { error: "Masked fields cannot be written", errorKey: "policy.maskedField" });
    })` : "";
  const policyColumnEntries = entity.fields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const policyPlumbing = restricted ? `
  const policyColumns: Record<string, any> = { ${policyColumnEntries} };
  const resolveResourcePolicy = async (principal: Principal | null, request?: Request | null, scope?: { field: string; value: string }) => resolvePolicy(${JSON.stringify(entity.name)}, principal, policyColumns, scope ?? (request ? await resolveScope(request) : undefined));` : "";
  const policyErrorHandler = restricted
    ? ".onError(({ error, status }) => error instanceof QiyPolicyError ? status(error.status as 403, { error: error.message, errorKey: error.errorKey }) : undefined)"
    : "";
  // Malformed Date/Time payloads are rejected with a documented 400 instead of a
  // generic 500 or TypeBox 422; the class comes from api/src/temporal.ts.
  const temporalErrorHandler = temporalErrorClass
    ? `.onError(({ error, status }) => error instanceof ${temporalErrorClass} ? status(400, { error: error.message }) : undefined)`
    : "";
  const redactRecordHelper = restricted
    ? `const redactRecord = (record: Record<string, unknown>, policy?: QiyPolicy) => redact(policy ? policy.mask(record) : record);`
    : `const redactRecord = (record: Record<string, unknown>) => redact(record);`;
  /**
   * Handler bodies are emitted verbatim for unrestricted resources so existing
   * generated output is unchanged; restricted resources additionally resolve the
   * request policy and thread it into every repository call.
   */
  const oneHandler = restricted
    ? `.get("/:id", async ({ params, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.one(params.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`
    : `.get("/:id", async ({ params, status, request }) => {
      const record = await repository.one(params.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })`;
  const createHandler = restricted
    ? `.post("/", async ({ body, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      return status(201, redactRecord(await repository.create(body, principal?.id, await resolveScope(request), policy), policy));
    }, { body: create${name} })`
    : `.post("/", async ({ body, status, request }) => status(201, redactRecord(await repository.create(body, (await authenticate(request))?.id, await resolveScope(request)))), { body: create${name} })`;
  const patchHandler = restricted
    ? `.patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.update(params.id, body, principal?.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patch${name} })`
    : `.patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const record = await repository.update(params.id, body, principal?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patch${name} })`;
  const deleteManyHandler = restricted
    ? `.delete("/", async ({ query, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const records = await repository.deleteMany(query.ids.split(","), principal?.id, await resolveScope(request), policy);
      return records.map((record) => redactRecord(record, policy));
    }, {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })`
    : `.delete("/", async ({ query, request }) => (await repository.deleteMany(query.ids.split(","), (await authenticate(request))?.id, await resolveScope(request))).map((record) => redactRecord(record)), {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })`;
  const deleteHandler = restricted
    ? `.delete("/:id", async ({ params, status, request }) => {
      const principal = await authenticate(request);
      const policy = await resolveResourcePolicy(principal, request);
      const record = await repository.delete(params.id, principal?.id, await resolveScope(request), policy);
      return record ? redactRecord(record, policy) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });`
    : `.delete("/:id", async ({ params, status, request }) => {
      const record = await repository.delete(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redactRecord(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });`;
  return `
const create${name} = t.Object({
${createFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

const patch${name} = t.Object({
${patchFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

export interface ${name}Repository {
  distribution(field: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  create(values: typeof create${name}.static, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown>>;
  update(id: string, values: typeof patch${name}.static, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }${restricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<Record<string, unknown>>>;
  /** Optional so test doubles and hand-written repositories keep working. */
  recordExportAudit?(input: { rows: number; filters: number; principalId?: string }): Promise<void>;
  recordImportAudit?(input: { rows: number; principalId?: string }): Promise<void>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }
export interface FilterGroup { operator: "and" | "or"; filters: FilterExpression[]; }
export type FilterExpression = FilterClause | FilterGroup;

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterExpression[];
  scope?: { field: string; value: string };
${restricted ? "  policy?: QiyPolicy;" : ""}
}

export function ${name}Routes(repository: ${name}Repository, authenticate: Authenticator = async () => null) {
  ${sanitize}
  ${redactRecordHelper}
  const sortableFields = ${sortableFields} as string[];
  const filterableFields = ${filterableFields} as string[];
  const filterModes = ${filterModes} as Record<string, FilterOperator[]>;
  const resolveScope = async (request: Request) => {
    const principal = await authenticate(request);
    const scopeConfig = ${scopeLiteral} as { field: string; claim: string } | null;
    const scopeField = scopeConfig?.field;
    const scopeClaim = scopeConfig?.claim;
    if (!scopeField || !scopeClaim) return undefined;
    const claimValue = principal?.claims?.[scopeClaim];
    if (!principal || claimValue === undefined || claimValue === null || claimValue === "") throw new Error("Missing required data scope claim: " + scopeClaim);
    return { field: scopeField, value: String(claimValue) };
  };${policyPlumbing}
  const exportColumns = ${JSON.stringify(entity.fields.filter((field) => field.type !== "Vector").map((field) => field.name))} as string[];
  const exportMaxRows = () => { const value = Number(Bun.env.QIY_EXPORT_MAX_ROWS ?? 1000); return Number.isSafeInteger(value) && value >= 1 && value <= 100000 ? value : 1000; };
  // Exports stream in bounded pages so memory does not grow with the result set.
  const EXPORT_PAGE_SIZE = Math.min(250, exportMaxRows());
  // Import accepts plain scalar columns only; vectors and key lists need the API.
  const importTypes = ${JSON.stringify(Object.fromEntries(entity.fields.filter((field) => !field.primaryKey && field.type !== "Vector" && field.type !== "Files").map((field) => [field.name, field.type])))} as Record<string, string>;
  const importColumns = Object.keys(importTypes);
  const importMaxRows = () => { const value = Number(Bun.env.QIY_IMPORT_MAX_ROWS ?? 1000); return Number.isSafeInteger(value) && value >= 1 && value <= 100000 ? value : 1000; };
  /** RFC 4180 reader: quoted fields, doubled quotes and CRLF line endings. */
  const parseCsv = (input: string): string[][] => {
    const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
    for (let index = 0; index < input.length; index++) {
      const char = input[index]!;
      if (quoted) {
        if (char === '"') { if (input[index + 1] === '"') { field += '"'; index++; } else quoted = false; }
        else field += char;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ",") { row.push(field); field = ""; continue; }
      if (char === "\\r") continue;
      if (char === "\\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((cells) => cells.some((cell) => cell.length > 0));
  };
  const importValue = (field: string, value: string) => {
    if (value === "") return null;
    if (importTypes[field] === "Integer") { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error("Column " + field + " must be an integer"); return parsed; }
    if (importTypes[field] === "DateTime") { const parsed = new Date(value); if (Number.isNaN(parsed.getTime())) throw new Error("Column " + field + " must be an ISO date-time"); return parsed; }${temporal.length ? `
    if (importTypes[field] === "Date") { const parsed = new Date(value + "T00:00:00Z"); if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Column " + field + " must be a YYYY-MM-DD date"); return value; }
    if (importTypes[field] === "Time") { const match = /^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(value); if (!match) throw new Error("Column " + field + " must be a HH:mm:ss time"); return match[1] + ":" + match[2] + ":" + (match[3] ?? "00"); }` : ""}
    return value;
  };
  const importWorkerId = crypto.randomUUID();
  const exportWorkerId = crypto.randomUUID();
  /**
   * Claims one export job (by id inline, otherwise the oldest queued one) and
   * rebuilds its CSV from the stored request spec, so any replica can finish it.
   */
  const claimAndProcessExportJob = async (jobId?: string): Promise<string | undefined> => {
    const claimed = await claimExportJob(${JSON.stringify(entity.tableName)}, exportWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ExportSpec = { search?: string; sort?: string; order?: "asc" | "desc"; filters?: string; ids?: string; columns?: string; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let spec: ExportSpec;
    try { spec = JSON.parse(claimed.payload) as ExportSpec; }
    catch { await updateExportJob(claimed.id, { status: "failed", errors: ["Export job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const principal = { id: spec.principal.id, name: spec.principal.name ?? "", role: (spec.principal.role ?? "viewer") as "admin" | "operator" | "viewer", claims: spec.principal.claims ?? {} };
    const requestedIds = spec.ids ? spec.ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
    const requestedColumns = spec.columns ? [...new Set(spec.columns.split(",").map((column) => column.trim()).filter(Boolean))] : [];
    const pageSize = Math.min(EXPORT_PAGE_SIZE, exportMaxRows());
    const csvCell = (value: unknown) => {
      if (value === null || value === undefined) return "";
      const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\\r\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
    };
    try {
      const firstPage = await runListQuery({ search: spec.search, sort: spec.sort, order: spec.order, filters: spec.filters, page: 1, pageSize: requestedIds.length ? exportMaxRows() : pageSize }, new Request("http://worker/export"), { principal, scope: spec.scope });
      if ("error" in firstPage) throw new Error(firstPage.error);
      ${restricted ? "const policy = firstPage.policy;" : ""}
      const project = (record: Record<string, unknown>) => redactRecord(record${restricted ? ", policy" : ""}) as Record<string, unknown>;
      let rows = firstPage.result.data.map(project);
      if (requestedIds.length) rows = rows.filter((row) => requestedIds.includes(String(row.id)));
      const visibleColumns = exportColumns.filter((column) => rows.some((row) => Object.hasOwn(row, column)));
      const columns = requestedColumns.length ? visibleColumns.filter((column) => requestedColumns.includes(column)) : visibleColumns;
      if (requestedColumns.length && !columns.length) throw new Error("None of the requested columns can be exported");
      const lines = [columns.join(",") + "\\r\\n"];
      let written = 0;
      const push = (row: Record<string, unknown>) => { lines.push(columns.map((column) => csvCell(row[column])).join(",") + "\\r\\n"); written++; };
      for (const row of rows) push(row);
      rows = [];
      const totalPages = requestedIds.length ? 1 : Math.ceil(firstPage.result.total / pageSize);
      for (let page = 2; page <= totalPages; page++) {
        const next = await runListQuery({ search: spec.search, sort: spec.sort, order: spec.order, filters: spec.filters, page, pageSize }, new Request("http://worker/export"), { principal, scope: spec.scope });
        if ("error" in next) throw new Error(next.error);
        for (const record of next.result.data.map(project)) push(record);
        if (written % 500 === 0) await updateExportJob(claimed.id, { processed: written });
      }
      await repository.recordExportAudit?.({ rows: written, filters: firstPage.clauses, principalId: principal.id });
      await updateExportJob(claimed.id, { status: "completed", processed: written, result: lines.join(""), releaseLease: true });
    } catch (error) {
      await updateExportJob(claimed.id, { status: "failed", errors: [error instanceof Error ? error.message : String(error)], releaseLease: true }).catch(() => undefined);
    }
    return claimed.id;
  };
  /**
   * Claims one import job (by id when running inline, otherwise the oldest queued one)
   * and writes its stored payload. Any replica can run this; the lease decides who wins.
   */
  const claimAndProcessImportJob = async (jobId?: string): Promise<string | undefined> => {
    const claimed = await claimImportJob(${JSON.stringify(entity.tableName)}, importWorkerId, new Date(Date.now() + 120000), jobId);
    if (!claimed) return undefined;
    type ImportPayload = { header: string[]; rows: string[][]; principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } };
    let payload: ImportPayload;
    try { payload = JSON.parse(claimed.payload) as ImportPayload; }
    catch { await updateImportJob(claimed.id, { status: "failed", errors: ["Import job payload is invalid"], releaseLease: true }).catch(() => undefined); return claimed.id; }
    const payloadPrincipal = { id: payload.principal.id, name: payload.principal.name ?? "", role: (payload.principal.role ?? "viewer") as "admin" | "operator" | "viewer", claims: payload.principal.claims ?? {} };
    const payloadScope = payload.scope;
    ${restricted ? "const payloadPolicy = await resolveResourcePolicy(payloadPrincipal as never, null, payloadScope);" : ""}
    const createdKeys: string[] = [];
    const jobErrors: string[] = [];
    let processed = 0;
    try {
      for (const [offset, cells] of payload.rows.entries()) {
        const rowNumber = offset + 2;
        try {
          if (cells.length !== payload.header.length) throw new Error("Row " + rowNumber + " has " + cells.length + " columns, expected " + payload.header.length);
          const values = Object.fromEntries(payload.header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await repository.create(values, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""});
          createdKeys.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          jobErrors.push("Row " + rowNumber + ": " + (error instanceof Error ? error.message : String(error)));
          break;
        }
        processed++;
        if (processed % 25 === 0) await updateImportJob(claimed.id, { processed });
        if (processed % 10 === 0 && await isImportJobCancelled(claimed.id)) {
          if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""}).catch(() => undefined);
          await updateImportJob(claimed.id, { status: "cancelled", processed, errors: ["Cancelled"], releaseLease: true });
          return claimed.id;
        }
        const delayMs = Number(Bun.env.QIY_IMPORT_JOB_DELAY_MS ?? 0);
        if (Number.isSafeInteger(delayMs) && delayMs > 0) await Bun.sleep(Math.min(delayMs, 1000));
      }
      if (jobErrors.length) {
        if (createdKeys.length) await repository.deleteMany(createdKeys, payloadPrincipal.id, payloadScope${restricted ? ", payloadPolicy" : ""}).catch(() => undefined);
        await updateImportJob(claimed.id, { status: "failed", processed, failed: jobErrors.length, errors: jobErrors, releaseLease: true });
      } else {
        await repository.recordImportAudit?.({ rows: processed, principalId: payloadPrincipal.id });
        await updateImportJob(claimed.id, { status: "completed", processed, errors: [], releaseLease: true });
      }
    } catch (error) {
      await updateImportJob(claimed.id, { status: "failed", errors: [...jobErrors, error instanceof Error ? error.message : String(error)], releaseLease: true }).catch(() => undefined);
    }
    return claimed.id;
  };
  // The list and export routes share one query path so export cannot diverge from
  // the list's filter validation, scope handling or row policy.
  const runListQuery = async (query: { page?: number; pageSize?: number; search?: string; sort?: string; order?: "asc" | "desc"; filters?: string }, request: Request, workerContext?: { principal: { id: string; name?: string; role?: string; claims?: Record<string, string | number | boolean | null> }; scope?: { field: string; value: string } }): Promise<{ status: number; error: string } | { result: { data: Array<Record<string, unknown>>; total: number }; clauses: number; policy: ${restricted ? "QiyPolicy" : "undefined"} }> => {
    let filters: Record<string, string> | FilterExpression[] | undefined;
    if (query.filters) {
      try {
        const parsed: unknown = JSON.parse(query.filters);
        const oldShape = parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "string");
        const validExpression = (value: unknown, depth = 0): value is FilterExpression => {
          if (depth > 8 || !value || typeof value !== "object" || Array.isArray(value)) return false;
          const filter = value as Record<string, unknown>;
          if (typeof filter.field === "string" && typeof filter.operator === "string" && typeof filter.value === "string") return true;
          return (filter.operator === "and" || filter.operator === "or") && Array.isArray(filter.filters) && filter.filters.length > 0 && filter.filters.every((child) => validExpression(child, depth + 1));
        };
        const newShape = Array.isArray(parsed) && parsed.length > 0 && parsed.every((filter) => validExpression(filter));
        if (!oldShape && !newShape) return { status: 400, error: "Invalid filters" };
        filters = parsed as Record<string, string> | FilterExpression[];
      } catch { return { status: 400, error: "Invalid filters" }; }
    }
    if (query.sort && !sortableFields.includes(query.sort)) return { status: 400, error: "Unsupported sort field" };
    const flatten = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : flatten(filter.filters));
    const clauses = Array.isArray(filters) ? flatten(filters) : Object.entries(filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    if (clauses.length > 50) return { status: 400, error: "Too many filters" };
    if (clauses.some((filter) => !filterableFields.includes(filter.field))) return { status: 400, error: "Unsupported filter field" };
    if (clauses.some((filter) => !filterModes[filter.field]?.includes(filter.operator))) return { status: 400, error: "Unsupported filter operator" };
    const scope = workerContext ? workerContext.scope : await resolveScope(request);
    const principal = workerContext ? (workerContext.principal as Principal | null) : await authenticate(request);
    const policy = ${restricted ? "await resolveResourcePolicy(principal, request, workerContext ? workerContext.scope : undefined)" : "undefined"};
    const result = await repository.list(query.page ?? 1, query.pageSize ?? 20, { ...query, filters, scope${restricted ? ", policy" : ""} });
    return { result, clauses: clauses.length, policy };
  };
  return new Elysia({ prefix: ${route} })${privateInputGuard}${maskWriteGuard}\n    .onError(({ error, status }) => error instanceof Error && error.message.startsWith("Missing required data scope claim:") ? status(403, { error: error.message }) : undefined)${policyErrorHandler}${temporalErrorHandler}\n    .get("/aggregate", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      if (policy.maskedFields.includes(query.field)) return status(403, { error: \"Aggregating a masked field is not permitted\", errorKey: \"policy.maskedField\" });\n      " : ""}if (!["sum", "avg", "min", "max"].includes(query.op)) return status(400, { error: "Unsupported aggregate operator" });
      if (!(${JSON.stringify(entity.fields.filter((field) => ["Integer", "Decimal", "Money"].includes(field.type)).map((field) => field.name))} as string[]).includes(query.field)) return status(400, { error: "Unsupported aggregate field" });
      return repository.aggregate ? repository.aggregate(query.field, query.op as "sum" | "avg" | "min" | "max", await resolveScope(request)${restricted ? ", policy" : ""}) : { value: null, operator: query.op };
    }, { query: t.Object({ field: t.String({ minLength: 1 }), op: t.String({ minLength: 3 }) }) })
    .get("/distribution", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      " : ""}return (${JSON.stringify(entity.fields.filter((field) => field.enumName).map((field) => field.name))} as string[]).includes(query.field) ? repository.distribution(query.field, await resolveScope(request)${restricted ? ", policy" : ""}) : status(400, { error: "Unsupported distribution field" });
    }, { query: t.Object({ field: t.String() }) })
    .get("/trend", async ({ query, status, request }) => {
      ${restricted ? "const principal = await authenticate(request);\n      const policy = await resolveResourcePolicy(principal, request);\n      " : ""}return (${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[]).includes(query.field) ? repository.trend(query.field, query.days, await resolveScope(request)${restricted ? ", policy" : ""}) : status(400, { error: "Unsupported trend field" });
    }, { query: t.Object({ field: t.String(), days: t.Numeric({ minimum: 1, maximum: 365 }) }) })
    .get("/", async ({ query, status, request }) => {
      const outcome = await runListQuery(query, request);
      if ("error" in outcome) return status(outcome.status, { error: outcome.error });
      return { ...outcome.result, data: outcome.result.data.map((record) => redactRecord(record${restricted ? ", outcome.policy" : ""})) };
    }, {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        pageSize: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        search: t.Optional(t.String({ maxLength: 200 })),
        sort: t.Optional(t.String({ maxLength: 64 })),
        order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
        filters: t.Optional(t.String({ maxLength: 2000 })),
      }),
    })
    .get("/export", async ({ query, status, request }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const limit = exportMaxRows();
      // Selected-row export is bounded on its own; a large table must not block it.
      const selectedIds = query.ids ? query.ids.split(",").map((id) => id.trim()).filter(Boolean) : [];
      if (selectedIds.length > 500) return status(400, { error: "Select at most 500 rows to export", errorKey: "export.tooManyIds" });
      if (selectedIds.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return status(400, { error: "Invalid row id for export", errorKey: "export.invalidId" });
      // Column selection is limited to declared exportable columns.
      const requestedColumns = query.columns ? [...new Set(query.columns.split(",").map((column) => column.trim()).filter(Boolean))] : [];
      if (requestedColumns.length > 100) return status(400, { error: "Select at most 100 columns to export", errorKey: "export.tooManyColumns" });
      if (requestedColumns.some((column) => !exportColumns.includes(column))) return status(400, { error: "Unknown export column", errorKey: "export.invalidColumn" });
      const pageSize = Math.min(EXPORT_PAGE_SIZE, limit);
      const firstPage = await runListQuery({ ...query, page: 1, pageSize: selectedIds.length ? limit : pageSize }, request);
      if ("error" in firstPage) return status(firstPage.status, { error: firstPage.error });
      // Refuse rather than silently exporting a partial data range.
      if (!selectedIds.length && firstPage.result.total > limit) return status(400, { error: "Export is limited to " + limit + " rows; narrow the filters", errorKey: "export.tooLarge" });
      const project = (record: Record<string, unknown>) => redactRecord(record${restricted ? ", firstPage.policy" : ""}) as Record<string, unknown>;
      const firstRecords = selectedIds.length ? firstPage.result.data : firstPage.result.data;
      let firstRows = firstRecords.map(project);
      if (selectedIds.length) firstRows = firstRows.filter((record) => selectedIds.includes(String(record.id)));
      // Masked omit fields disappear from the projection, so the column set is taken once.
      const visibleColumns = exportColumns.filter((column) => firstRows.some((row) => Object.hasOwn(row, column)));
      const columns = requestedColumns.length ? visibleColumns.filter((column) => requestedColumns.includes(column)) : visibleColumns;
      if (requestedColumns.length && !columns.length) return status(400, { error: "None of the requested columns can be exported", errorKey: "export.noColumns" });
      const csvCell = (value: unknown) => {
        if (value === null || value === undefined) return "";
        const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
        return /[",\\r\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
      };
      const encoder = new TextEncoder();
      const line = (row: Record<string, unknown>) => columns.map((column) => csvCell(row[column])).join(",") + "\\r\\n";
      const totalPages = selectedIds.length ? 1 : Math.ceil(firstPage.result.total / pageSize);
      let exported = firstRows.length;
      // Background export: store the request spec and let the worker build the CSV.
      if (query.async === "1") {
        const jobId = await createExportJob({
          resource: ${JSON.stringify(entity.tableName)},
          total: firstPage.result.total,
          actorId: principal.id,
          payload: JSON.stringify({ search: query.search, sort: query.sort, order: query.order, filters: query.filters, ids: query.ids, columns: query.columns, principal: { id: principal.id, name: principal.name, role: principal.role, claims: principal.claims ?? {} }, scope: await resolveScope(request) }),
        });
        if (Bun.env.QIY_EXPORT_INLINE !== "off") void claimAndProcessExportJob(jobId);
        return status(202, { jobId, total: firstPage.result.total });
      }
      // Rows stream page by page, so a large export never materializes the whole table.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(columns.join(",") + "\\r\\n"));
            for (const row of firstRows) controller.enqueue(encoder.encode(line(row)));
            firstRows = [];
            for (let page = 2; page <= totalPages; page++) {
              const next = await runListQuery({ ...query, page, pageSize }, request);
              if ("error" in next) throw new Error(next.error);
              for (const record of next.result.data.map(project)) {
                controller.enqueue(encoder.encode(line(record)));
                exported++;
              }
            }
            await repository.recordExportAudit?.({ rows: exported, filters: firstPage.clauses, principalId: principal.id });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + ${JSON.stringify(entity.tableName)} + '.csv"' } });
    }, {
      query: t.Object({
        search: t.Optional(t.String({ maxLength: 200 })),
        sort: t.Optional(t.String({ maxLength: 64 })),
        order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
        filters: t.Optional(t.String({ maxLength: 2000 })),
        ids: t.Optional(t.String({ maxLength: 32000 })),
        columns: t.Optional(t.String({ maxLength: 4000 })),
        async: t.Optional(t.String({ maxLength: 1 })),
      }),
    })
    .post("/import", async ({ request, status, query }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      ${restricted ? "const policy = await resolveResourcePolicy(principal, request);" : ""}
      const rows = parseCsv(await request.text());
      if (rows.length < 2) return status(400, { error: "CSV must include a header and at least one data row", errorKey: "import.empty" });
      const header = rows[0]!.map((name) => name.trim());
      const duplicate = header.filter((name, index) => header.indexOf(name) !== index);
      if (duplicate.length) return status(400, { error: "Duplicate import columns: " + duplicate.join(", "), errorKey: "import.duplicateColumn" });
      const unsupported = header.filter((name) => !importColumns.includes(name));
      if (unsupported.length) return status(400, { error: "Unsupported import columns: " + unsupported.join(", "), errorKey: "import.unknownField" });
      ${restricted ? "const maskedColumns = policy.maskedFields.filter((field) => header.includes(field));\n      if (maskedColumns.length) return status(400, { error: \"Masked fields cannot be imported: \" + maskedColumns.join(\", \"), errorKey: \"import.maskedField\" });" : ""}
      const limit = importMaxRows();
      if (rows.length - 1 > limit) return status(400, { error: "Import is limited to " + limit + " rows", errorKey: "import.tooLarge" });
      const scope = await resolveScope(request);
      // Background import: the row payload is stored on the job so any replica can run it.
      if (query?.async === "1") {
        const jobId = await createImportJob({
          resource: ${JSON.stringify(entity.tableName)},
          total: rows.length - 1,
          actorId: principal.id,
          payload: JSON.stringify({ header, rows: rows.slice(1), principal: { id: principal.id, name: principal.name, role: principal.role, claims: principal.claims ?? {} }, scope }),
        });
        if (Bun.env.QIY_IMPORT_INLINE !== "off") void claimAndProcessImportJob(jobId);
        return status(202, { jobId, total: rows.length - 1 });
      }
      const created: string[] = [];
      // Rows are written one by one, so a failure compensates by deleting what this
      // request already created instead of leaving a partial import behind.
      for (let index = 1; index < rows.length; index++) {
        const cells = rows[index]!;
        if (cells.length !== header.length) { if (created.length) await repository.deleteMany(created, principal.id, scope${restricted ? ", policy" : ""}).catch(() => undefined); return status(400, { error: "Row " + (index + 1) + " has " + cells.length + " columns, expected " + header.length, errorKey: "import.rowLength" }); }
        try {
          const values = Object.fromEntries(header.map((name, column) => [name, importValue(name, cells[column] ?? "")]));
          const record = await repository.create(values, principal.id, scope${restricted ? ", policy" : ""});
          created.push(String((record as Record<string, unknown>).id));
        } catch (error) {
          if (created.length) await repository.deleteMany(created, principal.id, scope${restricted ? ", policy" : ""}).catch(() => undefined);
          ${restricted ? 'if (error instanceof QiyPolicyError) return status(403, { error: "Row " + (index + 1) + ": " + error.message, errorKey: error.errorKey });' : ""}
          return status(400, { error: "Row " + (index + 1) + ": " + (error instanceof Error ? error.message : String(error)), errorKey: "import.invalidRow" });
        }
      }
      await repository.recordImportAudit?.({ rows: created.length, principalId: principal.id });
      return status(201, { imported: created.length });
    })
    // Background export progress: status, then a one-shot CSV download.
    .get("/export/jobs/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Export job not found" });
      return { id: job.id, resource: job.resource, status: job.status, total: job.total, processed: job.processed, errors: job.errors, createdAt: job.createdAt, updatedAt: job.updatedAt };
    })
    .get("/export/jobs/:id/download", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)} || !job.result) return status(404, { error: "Export job not found" });
      if (job.status !== "completed") return status(409, { error: "Export job is not finished", errorKey: "export.notReady" });
      return new Response(job.result, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + job.resource + '.csv"' } });
    })
    // Cross-replica worker: an admin can list work and drive one job from any replica.
    .get("/import/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "import.forbidden" });
      return { items: await listImportJobs(${JSON.stringify(entity.tableName)}) };
    })
    .post("/import/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "import.forbidden" });
      const job = await readImportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      if (job.status !== "queued") return status(409, { error: "Import job is not queued", errorKey: "import.notQueued" });
      const ran = await claimAndProcessImportJob(params.id);
      if (!ran) return status(409, { error: "Import job was claimed by another worker", errorKey: "import.claimed" });
      return status(202, { jobId: ran });
    })
    // Cross-replica export worker: list work and run one job from any replica.
    .get("/export/jobs", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "export.forbidden" });
      return { items: await listExportJobs(${JSON.stringify(entity.tableName)}) };
    })
    .post("/export/jobs/:id/run", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Worker dispatch requires the admin role", errorKey: "export.forbidden" });
      const job = await readExportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Export job not found" });
      if (job.status !== "queued") return status(409, { error: "Export job is not queued", errorKey: "export.notQueued" });
      const ran = await claimAndProcessExportJob(params.id);
      if (!ran) return status(409, { error: "Export job was claimed by another worker", errorKey: "export.claimed" });
      return status(202, { jobId: ran });
    })
    // Background import progress: the caller polls this job id.
    .get("/import/jobs/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      await releaseStaleImportJobs();
      const job = await readImportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      return job;
    })
    // Cancelling stops the background loop and compensates what it already wrote.
    .post("/import/jobs/:id/cancel", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      await releaseStaleImportJobs();
      const job = await readImportJob(params.id);
      if (!job || job.resource !== ${JSON.stringify(entity.tableName)}) return status(404, { error: "Import job not found" });
      const outcome = await requestImportJobCancel(params.id);
      if (outcome === "notRunning") return status(409, { error: "Import job is not running", errorKey: "import.notRunning" });
      return status(202, { status: "cancelled" });
    })
    ${oneHandler}
    ${createHandler}
    ${patchHandler}
    ${deleteManyHandler}
    ${deleteHandler}
}

export const ${entity.name}WritableFields = [${allowed}] as const;
`;
}

/**
 * A realtime channel is shared by every subscriber of a resource, so a field that
 * is masked for any role allowed to subscribe must be stripped from the event
 * payload at publish time. A mask without roles (or with a claim predicate only)
 * applies to everyone, so it always counts.
 */
function maskedRealtimeFields(restriction: QiyResourceRestriction | undefined, subscriberRoles: readonly string[]): string[] {
  if (!restriction?.masks?.length) return [];
  const fields = restriction.masks
    .filter((mask) => !mask.roles?.length || mask.roles.some((role) => subscriberRoles.includes(role)))
    .map((mask) => mask.field);
  return [...new Set(fields)];
}

function renderRepositoryMethods(entity: EntityIR, database: DatabaseIR, realtimeEvents: ReadonlySet<string> = new Set(), restricted = false, realtimeMasked: string[] = [], realtimeClaim?: { field: string; claim: string }): string {  const searchOperator = database.dialect === "postgresql" ? "ilike" : "like";
  const searchableFields = entity.fields.filter((field) => field.type === "Text").map((field) => `${entity.name}.${field.name}`).join(", ");
  const sortFields = entity.fields.filter((field) => field.sortable !== false).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterableEntityFields = entity.fields.filter((field) => field.filterable !== false);
  const filterFields = filterableEntityFields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterTypes = JSON.stringify(Object.fromEntries(filterableEntityFields.map((field) => [field.name, field.type])));
  const configuredScopes = (database as DatabaseIR & { scopes?: QiyScope[] }).scopes ?? [];
  const scopeFields = entity.fields.filter((field) => configuredScopes.some((scope) => (scope.resource === entity.name || scope.resource === entity.tableName) && scope.field === field.name));
  const scopeColumnFields = [...new Set([...filterableEntityFields, ...scopeFields])].map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const groupFields = entity.fields.filter((field) => field.enumName).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const numericFields = entity.fields.filter((field) => ["Integer", "Decimal", "Money"].includes(field.type)).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const dateFields = entity.fields.filter((field) => field.type === "DateTime").map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const scopeColumns = scopeColumnFields || "";
  // A `tree` scope widens the claim to the whole subtree, so the row predicate
  // becomes a recursive CTE over the tree entity instead of an equality check.
  const scopeColumnCondition = resolveScopeTree(database, entity) ? `qiyScopeSubtree(scopeColumns[scope.field], scope.value)` : `eq(scopeColumns[scope.field], scope.value)`;
  // The list method names its argument differently, so mirror the same predicate for it.
  const scopeColumnConditionFor = (name: string) => resolveScopeTree(database, entity) ? `qiyScopeSubtree(scopeColumns[${name}.field], ${name}.value)` : `eq(scopeColumns[${name}.field], ${name}.value)`;
  // Writes always land on the caller's own node: the subtree predicate governs reads.
  const scopeWriteSpread = "...(scope ? { [scope.field]: scope.value } : {})";
  const policyCondition = restricted
    ? `const policyCondition = policy && policy.conditions.length ? and(...(policy.conditions as any[])) : undefined;`
    : "";
  /** `policyCondition` is only emitted for restricted resources, so every condition list must reference it conditionally. */
  const policyArg = restricted ? ", policyCondition" : "";
  // Audit columns differ per dialect: SQLite stores JSON text and a Date, MySQL a
  // numeric millisecond timestamp without a column default, PostgreSQL defaults now().
  const exportAuditValues = database.dialect === "sqlite"
    ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: JSON.stringify({ rows: input.rows, filters: input.filters }), createdAt: new Date() }`
    : database.dialect === "mysql"
      ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows, filters: input.filters }, createdAt: Date.now() }`
      : `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.exported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows, filters: input.filters } }`;
  const importAuditValues = database.dialect === "sqlite"
    ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: JSON.stringify({ rows: input.rows }), createdAt: new Date() }`
    : database.dialect === "mysql"
      ? `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows }, createdAt: Date.now() }`
      : `{ id: crypto.randomUUID(), actorId: input.principalId ?? null, action: "${entity.tableName}.imported", resource: "${entity.tableName}", resourceId: null, metadata: { rows: input.rows } }`;
  /**
   * A shared channel cannot carry per-recipient permissions, so masked fields are
   * stripped once at publish time for every role that may subscribe to it.
   */
  const realtimePayload = (record: string) => realtimeMasked.length ? `qiyRealtimePayload(${record})` : record;
  // Claim-scoped resources publish per segment so subscribers only ever see their own rows.
  const realtimeChannelExpression = (record: string) => realtimeClaim
    ? `"qiy:${entity.tableName}:" + String((${record} as Record<string, unknown>)[${JSON.stringify(realtimeClaim.field)}])`
    : JSON.stringify(`qiy:${entity.tableName}`);
  const realtimeWrite = (type: "created" | "updated" | "deleted", payload: string) => realtimeEvents.has(type)
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: ${realtimeChannelExpression(payload)}, type: ${JSON.stringify(type)}, payload: JSON.stringify(${realtimePayload(payload)}), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() })${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const realtimeDeleteManyWrite = realtimeEvents.has("deleted")
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), channel: ${realtimeChannelExpression("record")}, type: "deleted", payload: JSON.stringify(${realtimePayload("record")}), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() })))${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const auditedMutationMethods = database.dialect === "sqlite" ? `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      ${policyCondition}
      const record = tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      ${restricted ? "const visible = tx.select().from(" + entity.name + ").where(and(eq(" + entity.name + ".id, record.id)" + policyArg + ")).get(); if (!visible) throw new QiyPolicyError(\"Write is outside the record policy\", 403, \"policy.outsideScope\");" : ""}
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const record = tx.update(${entity.name}).set({ ...values, ${scopeWriteSpread} }).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const record = tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedRows = tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition${policyArg})).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
` : database.dialect === "mysql" ? `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${policyCondition}
      const id = crypto.randomUUID();
      await tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id } as typeof ${entity.name}.$inferInsert);
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id)${policyArg})).limit(1);
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [existing] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1).for("update");
      if (!existing) return undefined;
      await tx.update(${entity.name}).set({ ...values, ${scopeWriteSpread} }).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg}));
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1);
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).limit(1).for("update");
      if (!record) return undefined;
      await tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg}));
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {}, createdAt: Date.now() });
       ${realtimeWrite("deleted", "record")}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedRows = await tx.select().from(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition${policyArg})).for("update");
      if (deletedRows.length) {
        await tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, deletedRows.map((record) => record.id)), scopeCondition${policyArg}));
        await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {}, createdAt: Date.now() })));
         ${realtimeDeleteManyWrite}
      }
      return deletedRows;
    });
  },
` : `  async create(values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      ${policyCondition}
      const [record] = await tx.insert(${entity.name}).values({ ...values, ${scopeWriteSpread}, id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      ${restricted ? "const [visible] = await tx.select().from(" + entity.name + ").where(and(eq(" + entity.name + ".id, record.id)" + policyArg + ")).limit(1); if (!visible) throw new QiyPolicyError(\"Write is outside the record policy\", 403, \"policy.outsideScope\");" : ""}
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: { fields: Object.keys(values) } });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [record] = await tx.update(${entity.name}).set({ ...values, ${scopeWriteSpread} }).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) } });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const [record] = await tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition${policyArg})).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {} });
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope${restricted ? ", policy" : ""}) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
      ${policyCondition}
      const deletedRows = await tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition${policyArg})).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {} })));
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
`;
  return `  async aggregate(field, operator, scope${restricted ? ", policy" : ""}) {
    if (!["sum", "avg", "min", "max"].includes(operator)) throw new Error("Unsupported aggregate operator");
    const columns: Record<string, any> = { ${numericFields} };
    const column = columns[field];
    if (!column) throw new Error("Unsupported aggregate field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const expression = operator === "sum" ? sum(column) : operator === "avg" ? avg(column) : operator === "min" ? min(column) : max(column);
    const [row] = await db.select({ value: expression }).from(${entity.name}).where(and(scopeCondition${policyArg}));
    const value = row?.value === null || row?.value === undefined ? null : Number(row.value);
    return { value: value === null || Number.isFinite(value) ? value : null, operator };
  },
  async distribution(field, scope${restricted ? ", policy" : ""}) {
    const columns: Record<string, any> = { ${groupFields} };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    return db.select({ value: column, count: count() }).from(${entity.name}).where(and(scopeCondition${policyArg})).groupBy(column);
  },
  async trend(field, days, scope${restricted ? ", policy" : ""}) {
    const columns: Record<string, any> = { ${dateFields} };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = ${database.dialect === "postgresql" ? "sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`" : database.dialect === "sqlite" ? "sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`" : "sql<string>`date_format(${column}, '%Y-%m-%d')`"};
    return db.select({ day, count: count() }).from(${entity.name}).where(and(gte(column, start), lt(column, end), scopeCondition${policyArg})).groupBy(day).orderBy(day);
  },
  async list(page, pageSize, options = {}) {
    const searchableColumns: any[] = [${searchableFields}];
    const searchCondition = options.search && searchableColumns.length > 0
      ? or(...searchableColumns.map((column) => ${searchOperator}(column, "%" + options.search + "%")))
      : undefined;
    const sortColumns: Record<string, any> = { ${sortFields} };
    const sortColumn = options.sort ? sortColumns[options.sort] : ${entity.name}.id;
    if (options.sort && !sortColumn) throw new Error("Unsupported sort field");
    const orderBy = options.order === "desc" ? desc(sortColumn) : asc(sortColumn);
    const filterColumns: Record<string, any> = { ${filterFields} };
    const filterTypes = ${filterTypes} as Record<string, string>;
    const filters = Array.isArray(options.filters) ? options.filters : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filterClauses = (expressions: FilterExpression[]): FilterClause[] => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters));
    if (filterClauses(filters as FilterExpression[]).some(({ field }) => !filterColumns[field])) throw new Error("Unsupported filter field");
    const coerce = (field: string, value: string) => filterTypes[field] === "Integer" ? Number(value) : filterTypes[field] === "DateTime" ? new Date(value) : value;
    const filterCondition = ({ field, operator, value }: FilterClause) => {
      const column = filterColumns[field];
      if (operator === "contains") return ${searchOperator}(column, "%" + value + "%");
      if (operator === "startsWith") return ${searchOperator}(column, value + "%");
      if (operator === "endsWith") return ${searchOperator}(column, "%" + value);
      if (operator === "gt") return gt(column, coerce(field, value));
      if (operator === "gte") return gte(column, coerce(field, value));
      if (operator === "lt") return lt(column, coerce(field, value));
      if (operator === "lte") return lte(column, coerce(field, value));
      if (operator === "between") {
        const [lower, upper, extra] = value.split(",").map((item) => item.trim());
        if (!lower || !upper || extra !== undefined) throw new Error("Between filter requires two values");
        return and(gte(column, coerce(field, lower)), lte(column, coerce(field, upper)));
      }
      if (operator === "in") {
        const values = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => coerce(field, item));
        if (values.length === 0) throw new Error("In filter requires at least one value");
        return inArray(column, values);
      }
      return eq(column, coerce(field, value));
    };
    const filterExpression = (filter: FilterExpression): any => "field" in filter
      ? filterCondition(filter)
      : filter.operator === "and" ? and(...filter.filters.map(filterExpression)) : or(...filter.filters.map(filterExpression));
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = options.scope && ${restricted ? "!(options.policy && options.policy.usesScope) && " : ""}scopeColumns[options.scope.field] ? ${scopeColumnConditionFor("options.scope")} : undefined;
    ${policyCondition.replace("policy && policy.conditions.length", "options.policy && options.policy.conditions.length").replace("(policy.conditions as any[])", "(options.policy.conditions as any[])")}
    const whereCondition = and(searchCondition, scopeCondition${policyArg}, ...(filters as FilterExpression[]).map(filterExpression));
    const [data, totalRows] = await Promise.all([
      db.select().from(
${entity.name}
).where(whereCondition).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(
${entity.name}
).where(whereCondition),
    ]);
    return { data, total: totalRows[0]?.total ?? 0 };
  },
  async one(id, scope${restricted ? ", policy" : ""}) {
    const scopeColumns: Record<string, any> = { ${filterFields} };
    const scopeCondition = scope && ${restricted ? "!(policy && policy.usesScope) && " : ""}scopeColumns[scope.field] ? ${scopeColumnCondition} : undefined;
    ${policyCondition}
    const [record] = await db.select().from(
${entity.name}
).where(and(eq(
${entity.name}
.id, id), scopeCondition${policyArg})).limit(1);
    return record;
  },
${auditedMutationMethods}
  async recordExportAudit(input) {
    await db.insert(auditEvents).values(${exportAuditValues});
  },
  async recordImportAudit(input) {
    await db.insert(auditEvents).values(${importAuditValues});
  },
`;
}

function renderRouteTest(entity: EntityIR, database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = [], hiddenFields: string[] = []): string {
  const name = modelName(entity);
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"])));
  const values = entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => {
    const example = field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "Files" ? '["uploads/sample.pdf"]' : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
        : field.enumName ? JSON.stringify(database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? "") : '"Example"';
    return `${JSON.stringify(field.name)}: ${example}`;
  }).join(", ");
  const unsupportedQueryTests = [
    ...entity.fields.filter((field) => field.sortable === false).map((field) => `  test("rejects sorting on disabled field ${field.name}", async () => {
    const response = await app.handle(new Request(endpoint + "/?sort=${encodeURIComponent(field.name)}"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported sort field" });
  });`),
    ...entity.fields.filter((field) => field.filterable === false).map((field) => `  test("rejects filtering on disabled field ${field.name}", async () => {
    const filters = encodeURIComponent(JSON.stringify({ ${JSON.stringify(field.name)}: "x" }));
    const response = await app.handle(new Request(endpoint + "/?filters=" + filters));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported filter field" });
  });`),
  ].join("\n\n");
  const hiddenFieldTests = hiddenFields.map((field) => `
  test("never returns or persists private field ${field}", async () => {
    records.clear();
    const id = "00000000-0000-4000-8000-000000000077";
    records.set(id, { id, ${JSON.stringify(field)}: "argon2id-private-hash" });
    const found = await app.handle(new Request(endpoint + "/" + id));
    expect(found.status).toBe(200);
    expect(await found.json()).not.toHaveProperty(${JSON.stringify(field)});
    const listed = await app.handle(new Request(endpoint + "/"));
    expect(await listed.json()).not.toMatchObject({ data: [ { ${JSON.stringify(field)}: "argon2id-private-hash" } ] });
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values}${values ? ", " : ""}${JSON.stringify(field)}: "attacker-controlled-hash" }) }));
    expect(created.status).toBe(400);
    expect(await created.json()).toEqual({ error: "Private fields cannot be written" });
    expect([...records.values()].some((record) => record[${JSON.stringify(field)}] === "attacker-controlled-hash")).toBe(false);
  });`).join("\n");
  // Date and Time are text contracts validated in api/src/temporal.ts: a malformed
  // value must be a documented 400 on create and update, and a bare `HH:mm` Time
  // is normalized to the stored `HH:mm:ss` form.
  const temporalFixtureFields = temporalFieldsOf(entity);
  const invalidTemporalValue = (type: "Date" | "Time") => type === "Date" ? "not-a-date" : "25:61:00";
  const temporalTests = temporalFixtureFields.map(([field, type]) => `
  test("rejects an invalid ${type} value for ${field}", async () => {
    records.clear();
    const invalid = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...({ ${values} } as Record<string, unknown>), ${JSON.stringify(field)}: ${JSON.stringify(invalidTemporalValue(type))} }) }));
    expect(invalid.status).toBe(400);
    expect(String((await invalid.json() as { error?: string }).error)).toContain(${JSON.stringify(field)});
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }) }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    const patched = await app.handle(new Request(endpoint + "/" + record.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${JSON.stringify(field)}: ${JSON.stringify(invalidTemporalValue(type))} }) }));
    expect(patched.status).toBe(400);
  });`).join("\n");
  const firstTimeField = temporalFixtureFields.find(([, type]) => type === "Time")?.[0];
  const temporalNormalizationTest = firstTimeField
    ? `
  test("normalizes a HH:mm Time value to HH:mm:ss", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...({ ${values} } as Record<string, unknown>), ${JSON.stringify(firstTimeField)}: "08:30" }) }));
    expect(created.status).toBe(201);
    expect((await created.json() as Record<string, unknown>)[${JSON.stringify(firstTimeField)}]).toBe("08:30:00");
  });`
    : "";
  // Non-temporal resources keep the previous generated output byte-for-byte.
  const temporalSection = temporalTests || temporalNormalizationTest ? `\n${temporalTests}${temporalNormalizationTest}` : "";
  return `import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { ${name}Routes, type ${name}Repository } from "../src/routes/${entity.name}";

const records = new Map<string, Record<string, unknown>>();
const repository: ${name}Repository = {
  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
  async list(page, pageSize, options = {}) {
    const data = [...records.values()];
    const filtered = options.search ? data.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : data;
    const filterClauses = (expressions: Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>): Array<{ field: string; operator: string; value: string }> => expressions.flatMap((filter) => "field" in filter ? [filter] : filterClauses(filter.filters as Array<{ field: string; operator: string; value: string } | { operator: "and" | "or"; filters: unknown[] }>));
    const clauses = Array.isArray(options.filters) ? filterClauses(options.filters) : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
    const filteredByFields = clauses.reduce((rows, { field, operator, value }) => rows.filter((record) => {
      const actual = record[field]; const text = String(actual ?? "");
      if (operator === "contains") return text.toLowerCase().includes(value.toLowerCase());
      if (operator === "startsWith") return text.toLowerCase().startsWith(value.toLowerCase());
      if (operator === "endsWith") return text.toLowerCase().endsWith(value.toLowerCase());
      if (operator === "in") return value.split(",").map((item) => item.trim()).includes(text);
      if (operator === "between") { const [lower, upper] = value.split(",").map(Number); return Number(actual) >= lower! && Number(actual) <= upper!; }
      if (operator === "gt") return Number(actual) > Number(value);
      if (operator === "gte") return Number(actual) >= Number(value);
      if (operator === "lt") return Number(actual) < Number(value);
      if (operator === "lte") return Number(actual) <= Number(value);
      return text === value;
    }), filtered);
    const sorted = options.sort ? [...filteredByFields].sort((left, right) => String(left[options.sort!] ?? "").localeCompare(String(right[options.sort!] ?? ""))) : filteredByFields;
    if (options.order === "desc") sorted.reverse();
    return { data: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length };
  },
  async one(id) { return records.get(id); },
  async create(values) {
    const record = { id: crypto.randomUUID(), ...values };
    records.set(record.id, record);
    return record;
  },
  async update(id, values) {
    const old = records.get(id);
    if (!old) return undefined;
    const record = { ...old, ...values };
    records.set(id, record);
    return record;
  },
  async delete(id) {
    const record = records.get(id);
    records.delete(id);
    return record;
  },
  async deleteMany(ids) {
    const deleted = ids.flatMap((id) => {
      const record = records.get(id);
      records.delete(id);
      return record ? [record] : [];
    });
    return deleted;
  },
};
  const app = new Elysia({ prefix: "/api/v1" }).use(${name}Routes(repository, async () => ({ id: "00000000-0000-4000-8000-000000000001", name: "Scoped User", role: "admin", claims: ${claims} })));
const endpoint = "http://localhost/api/v1/${entity.tableName}";

describe("${entity.tableName} CRUD", () => {
  test("creates, lists, reads, updates and deletes", async () => {
    records.clear();
    const created = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    expect(created.status).toBe(201);
    const record = await created.json() as { id: string };
    expect(record.id).toBeTruthy();
    const listed = await app.handle(new Request(endpoint + "/?page=1&pageSize=10"));
    expect(listed.status).toBe(200);
    expect((await listed.json() as { total: number }).total).toBe(1);
    const queried = await app.handle(new Request(endpoint + "/?sort=id&order=desc&filters=" + encodeURIComponent(JSON.stringify({ id: record.id }))));
    expect(queried.status).toBe(200);
    expect((await queried.json() as { total: number }).total).toBe(1);
    const found = await app.handle(new Request(endpoint + "/" + record.id));
    expect(found.status).toBe(200);
    const patched = await app.handle(new Request(endpoint + "/" + record.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    }));
    expect(patched.status).toBe(400);
    const deleted = await app.handle(new Request(endpoint + "/" + record.id, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
    expect((await app.handle(new Request(endpoint + "/" + record.id))).status).toBe(404);
    const firstBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    const secondBatchRecord = await app.handle(new Request(endpoint + "/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ${values} }),
    }));
    const firstBatchId = (await firstBatchRecord.json() as { id: string }).id;
    const secondBatchId = (await secondBatchRecord.json() as { id: string }).id;
    const batchDeleted = await app.handle(new Request(endpoint + "?ids=" + firstBatchId + "," + secondBatchId, { method: "DELETE" }));
    expect(batchDeleted.status).toBe(200);
  });

  test("rejects invalid pagination and resource ids", async () => {
    expect((await app.handle(new Request(endpoint + "/?pageSize=101"))).status).toBe(422);
    expect((await app.handle(new Request(endpoint + "/invalid-id"))).status).toBe(422);
  });

${unsupportedQueryTests}
${hiddenFieldTests}${temporalSection}
});
`;
}

function renderOrderWorkflow(database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = [], enabled = false): string | undefined {
  if (!enabled) return undefined;
  if (database.dialect !== "postgresql") throw new Error("orderInventory workflow currently requires PostgreSQL transaction and row-lock semantics");
  const names = new Set(database.entities.map((entity) => entity.name));
  if (!["orders", "orderItems", "inventoryItems"].every((name) => names.has(name))) throw new Error("orderInventory workflow requires orders, orderItems, and inventoryItems entities");
  for (const [entityName, fields] of Object.entries({
    orders: { id: "UUID", status: "enum", approvedBy: "UUID?" },
    orderItems: { id: "UUID", orderId: "UUID", productId: "UUID", quantity: "Integer" },
    inventoryItems: { id: "UUID", productId: "UUID", quantity: "Integer", reservedQuantity: "Integer" },
  })) {
    const entity = database.entities.find((item) => item.name === entityName)!;
    for (const [fieldName, expected] of Object.entries(fields)) {
      const field = entity.fields.find((item) => item.name === fieldName);
      if (!field) throw new Error(`orderInventory workflow requires ${entityName}.${fieldName}`);
      if ((expected === "enum" && !field.enumName) || (expected !== "enum" && field.type !== expected.replace("?", "")) || (expected.endsWith("?") && !field.nullable)) {
        throw new Error(`orderInventory workflow requires ${entityName}.${fieldName} to be ${expected}`);
      }
    }
  }
  const status = database.entities.find((entity) => entity.name === "orders")!.fields.find((field) => field.name === "status")!;
  const states = new Set(database.enums?.find((enumeration) => enumeration.name === status.enumName)?.values.map((value) => value.name));
  for (const state of ["draft", "submitted", "approved", "shipped", "cancelled"]) if (!states.has(state)) throw new Error(`orderInventory workflow requires orders.status enum value ${state}`);
  const orderScope = scopes.find((scope) => scope.resource === "orders" || scope.resource === database.entities.find((entity) => entity.name === "orders")?.tableName);
  return `import { and, eq, gte, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db";
import { auditEvents, inventoryItems, orderIdempotency, orderItems, orderReservations, orders } from "../schema";
import type { Authenticator } from "../auth/guard";
import { planInventoryAllocation } from "./allocation";

class WorkflowConflict extends Error {}
function result(status: (code: number, body: unknown) => unknown, code: number, message: string) { return status(code, { error: message }); }
const requiredScopeClaim = ${JSON.stringify(orderScope?.claim ?? null)};
function orderScopeCondition(principal: Awaited<ReturnType<Authenticator>>) {
  if (!requiredScopeClaim) return undefined;
  const value = principal?.claims?.[requiredScopeClaim];
  if (value === undefined || value === null || value === "") return null;
  return eq(orders.${orderScope?.field ?? "id"}, String(value));
}

export function createOrderWorkflowRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/orders" })
    .post("/:id/submit", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      const key = request.headers.get("idempotency-key");
      if (key && key.length > 128) return result(status, 400, "Idempotency key is too long");
      try {
        const order = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current) throw new WorkflowConflict("Order not found");
          if (key) {
            const [receipt] = await tx.select().from(orderIdempotency).where(and(eq(orderIdempotency.orderId, params.id), eq(orderIdempotency.actorId, principal.id), eq(orderIdempotency.requestKey, key))).limit(1);
            if (receipt) return receipt.response as typeof current;
          }
          if (current.status !== "draft") throw new WorkflowConflict("Only draft orders can be submitted");
          const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, params.id)).orderBy(orderItems.productId, orderItems.id);
          if (items.length === 0) throw new WorkflowConflict("Order requires at least one item");
          for (const item of items) {
            const stocks = await tx.select().from(inventoryItems).where(eq(inventoryItems.productId, item.productId)).orderBy(inventoryItems.id).for("update");
            for (const allocation of planInventoryAllocation(stocks, item.quantity)) {
              const [updatedStock] = await tx.update(inventoryItems).set({ reservedQuantity: sql\`\${inventoryItems.reservedQuantity} + \${allocation.quantity}\` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), sql\`\${inventoryItems.quantity} - \${inventoryItems.reservedQuantity} >= \${allocation.quantity}\`)).returning();
              if (!updatedStock) throw new WorkflowConflict("Inventory changed concurrently");
              await tx.insert(orderReservations).values({ id: crypto.randomUUID(), orderId: params.id, orderItemId: item.id, inventoryItemId: allocation.inventoryItemId, quantity: allocation.quantity });
            }
          }
          const [updated] = await tx.update(orders).set({ status: "submitted" }).where(and(eq(orders.id, params.id), eq(orders.status, "draft"), scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.submitted", resource: "orders", resourceId: params.id, metadata: { itemCount: items.length } });
          if (key) await tx.insert(orderIdempotency).values({ id: crypto.randomUUID(), orderId: params.id, actorId: principal.id, requestKey: key, response: updated });
          return updated;
        });
        return order;
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to submit order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/approve", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || principal.role !== "admin") return result(status, 403, "Only admins can approve orders");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        return await db.transaction(async (tx) => {
          const [updated] = await tx.update(orders).set({ status: "approved", approvedBy: principal.id }).where(and(eq(orders.id, params.id), eq(orders.status, "submitted"), scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Only submitted orders can be approved");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.approved", resource: "orders", resourceId: params.id, metadata: {} });
          return updated;
        });
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to approve order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/ship", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        return await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current || current.status !== "approved") throw new WorkflowConflict("Only approved orders can be shipped");
          const allocations = await tx.select().from(orderReservations).where(eq(orderReservations.orderId, params.id)).orderBy(orderReservations.inventoryItemId).for("update");
          if (!allocations.length) throw new WorkflowConflict("Missing inventory reservations");
          for (const allocation of allocations) {
            const [stock] = await tx.update(inventoryItems).set({ quantity: sql\`\${inventoryItems.quantity} - \${allocation.quantity}\`, reservedQuantity: sql\`\${inventoryItems.reservedQuantity} - \${allocation.quantity}\` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), gte(inventoryItems.quantity, allocation.quantity), gte(inventoryItems.reservedQuantity, allocation.quantity))).returning();
            if (!stock) throw new WorkflowConflict("Inventory reservation changed concurrently");
          }
          await tx.delete(orderReservations).where(eq(orderReservations.orderId, params.id));
          const [shipped] = await tx.update(orders).set({ status: "shipped" }).where(and(eq(orders.id, params.id), eq(orders.status, "approved"), scopeCondition)).returning();
          if (!shipped) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.shipped", resource: "orders", resourceId: params.id, metadata: { allocationCount: allocations.length } });
          return shipped;
        });
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to ship order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/:id/cancel", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal || (principal.role !== "admin" && principal.role !== "operator")) return result(status, 403, "Permission denied");
      const scopeCondition = orderScopeCondition(principal);
      if (scopeCondition === null) return result(status, 403, "Missing required data scope claim");
      try {
        const cancelled = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(orders).where(and(eq(orders.id, params.id), scopeCondition)).limit(1).for("update");
          if (!current) throw new WorkflowConflict("Order not found");
          if (current.status !== "draft" && current.status !== "submitted") throw new WorkflowConflict("Only draft or submitted orders can be cancelled");
          if (current.status === "submitted") {
            const allocations = await tx.select().from(orderReservations).where(eq(orderReservations.orderId, params.id)).orderBy(orderReservations.inventoryItemId).for("update");
            if (!allocations.length) throw new WorkflowConflict("Missing inventory reservations");
            for (const allocation of allocations) {
              const [stock] = await tx.update(inventoryItems).set({ reservedQuantity: sql\`\${inventoryItems.reservedQuantity} - \${allocation.quantity}\` }).where(and(eq(inventoryItems.id, allocation.inventoryItemId), gte(inventoryItems.reservedQuantity, allocation.quantity))).returning();
              if (!stock) throw new WorkflowConflict("Inventory reservation changed concurrently");
            }
            await tx.delete(orderReservations).where(eq(orderReservations.orderId, params.id));
          }
          const [updated] = await tx.update(orders).set({ status: "cancelled" }).where(and(eq(orders.id, params.id), sql\`\${orders.status} IN ('draft', 'submitted')\`, scopeCondition)).returning();
          if (!updated) throw new WorkflowConflict("Order changed concurrently");
          await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal.id, action: "order.cancelled", resource: "orders", resourceId: params.id, metadata: { previousStatus: current.status } });
          return updated;
        });
        return cancelled;
      } catch (error) { return result(status, 409, error instanceof Error ? error.message : "Unable to cancel order"); }
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
}
`;
}

function dataflowInputField(type: string): string {
  switch (type) {
    case "UUID": return 't.String({ format: "uuid" })';
    case "Text": return "t.String({ minLength: 1 })";
    case "Integer": return "t.Integer({ minimum: -2147483648, maximum: 2147483647 })";
    case "Decimal": return 't.String({ pattern: "^-?[0-9]+(\\\\.[0-9]+)?$" })';
    case "Boolean": return "t.Boolean()";
    default: throw new Error(`Unsupported dataflow input type ${type}`);
  }
}

function renderDataflowIdempotencySchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const actor = dialect === "mysql" ? 'varchar("actorId", { length: 128 })' : 'text("actorId")';
  const flow = dialect === "mysql" ? 'varchar("flow", { length: 80 })' : 'text("flow")';
  const key = dialect === "mysql" ? 'varchar("requestKeyHash", { length: 64 })' : 'text("requestKeyHash")';
  return `\n\nexport const dataflowIdempotency = ${table}("dataflow_idempotency", {\n  id: ${dialect === "mysql" ? 'varchar("id", { length: 36 })' : 'text("id")'}.primaryKey(),\n  actorId: ${actor}.notNull(),\n  flow: ${flow}.notNull(),\n  requestKeyHash: ${key}.notNull(),\n  requestHash: text("requestHash").notNull(),\n  response: text("response").notNull(),\n}, (table) => [uniqueIndex("dataflow_idempotency_actor_flow_key_idx").on(table.actorId, table.flow, table.requestKeyHash)]);\n`;
}

function renderDataflowOutboxSchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  return `\n\nexport const dataflowOutbox = ${table}("dataflow_outbox", {\n  id: ${dialect === "mysql" ? 'varchar("id", { length: 36 })' : 'text("id")'}.primaryKey(),\n  actorId: ${dialect === "mysql" ? 'varchar("actorId", { length: 128 })' : 'text("actorId")'},\n  event: ${dialect === "mysql" ? 'varchar("event", { length: 190 })' : 'text("event")'}.notNull(),\n  payload: text("payload").notNull(),\n  createdAt: ${dialect === "postgresql" ? 'timestamp("createdAt", { withTimezone: true })' : dialect === "sqlite" ? 'integer("createdAt", { mode: "timestamp" })' : 'datetime("createdAt", { mode: "date", fsp: 3 })'}.notNull(),\n});\n`;
}

function renderRealtimeOutboxSchema(dialect: DatabaseIR["dialect"]): string {  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const string = dialect === "mysql" ? (name: string, length: number) => `varchar(${JSON.stringify(name)}, { length: ${length} })` : (name: string) => `text(${JSON.stringify(name)})`;
  const integer = dialect === "mysql" ? "int" : "integer";
  const date = (name: string) => dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date", fsp: 3 })`;
  return `\n\nexport const realtimeOutbox = ${table}("qiy_realtime_outbox", {\n  id: ${string("id", 36)}.primaryKey(),\n  channel: ${string("channel", 190)}.notNull(),\n  type: ${string("type", 80)}.notNull(),\n  payload: text("payload").notNull(),\n  attempts: ${integer}("attempts").notNull(),\n  availableAt: ${date("availableAt")}.notNull(),\n  deliveredAt: ${date("deliveredAt")},\n  deadLetteredAt: ${date("deadLetteredAt")},\n  lastError: text("lastError"),\n  leaseOwner: ${string("leaseOwner", 80)},\n  leaseUntil: ${date("leaseUntil")},\n  createdAt: ${date("createdAt")}.notNull(),\n}, (table) => [index("qiy_realtime_outbox_pending_idx").on(table.deliveredAt, table.deadLetteredAt, table.availableAt, table.leaseUntil, table.createdAt)]);\n`;
}

/**
 * Background export jobs: the CSV is materialized by the worker and stored on the
 * job row so a client can download it later (or after a reconnect).
 */
function renderExportJobsModule(dialect: DatabaseIR["dialect"]): string {
  const sqlite = dialect === "sqlite";
  const now = "new Date()";
  return `import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { qiyExportJobs } from "./schema";

export type QiyExportJobStatus = "queued" | "running" | "completed" | "failed";

export interface QiyExportJob {
  id: string;
  resource: string;
  status: QiyExportJobStatus;
  total: number;
  processed: number;
  errors: string[];
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}

type QiyExportJobRow = typeof qiyExportJobs.$inferSelect;
const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();

function toJob(row: QiyExportJobRow): QiyExportJob {
  return {
    id: row.id,
    resource: row.resource,
    status: row.status as QiyExportJobStatus,
    total: Number(row.total),
    processed: Number(row.processed),
    errors: row.errors ? (JSON.parse(row.errors) as string[]) : [],
    actorId: row.actorId ?? null,
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function createExportJob(input: { resource: string; total: number; actorId: string | null; payload?: string }): Promise<string> {
  const id = crypto.randomUUID();
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, payload: input.payload ?? null, errors: null, actorId: input.actorId, leaseOwner: null, leaseUntil: null, createdAt: ${now}, updatedAt: ${now} };
  ${sqlite ? "db.insert(qiyExportJobs).values(values).run();" : "await db.insert(qiyExportJobs).values(values);"}
  return id;
}

export async function updateExportJob(id: string, patch: { status?: QiyExportJobStatus; processed?: number; payload?: string; result?: string; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
    ...(patch.result !== undefined ? { result: patch.result } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: ${now},
  };
  ${sqlite ? "db.update(qiyExportJobs).set(values).where(eq(qiyExportJobs.id, id)).run();" : "await db.update(qiyExportJobs).set(values).where(eq(qiyExportJobs.id, id));"}
}

export async function readExportJob(id: string): Promise<(QiyExportJob & { payload?: string; result?: string }) | undefined> {
  ${sqlite ? "const row = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, id)).get();" : "const [row] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, id)).limit(1);"}
  if (!row) return undefined;
  const job = toJob(row as QiyExportJobRow);
  const payload = (row as QiyExportJobRow).payload;
  const result = (row as QiyExportJobRow).result;
  return { ...job, ...(payload ? { payload } : {}), ...(result ? { result } : {}) };
}

/** Claims one export job with a conditional update so replicas cannot both run it. */
export async function claimExportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyExportJob & { payload: string }) | undefined> {
  ${sqlite ? `const candidates = db.select().from(qiyExportJobs).where(and(eq(qiyExportJobs.resource, resource), eq(qiyExportJobs.status, "queued"))).orderBy(qiyExportJobs.createdAt).all();` : `const candidates = await db.select().from(qiyExportJobs).where(and(eq(qiyExportJobs.resource, resource), eq(qiyExportJobs.status, "queued"))).orderBy(qiyExportJobs.createdAt);`}
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  ${sqlite ? `db.update(qiyExportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: ${now} }).where(and(eq(qiyExportJobs.id, candidate.id), eq(qiyExportJobs.status, "queued"))).run();` : `await db.update(qiyExportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: ${now} }).where(and(eq(qiyExportJobs.id, candidate.id), eq(qiyExportJobs.status, "queued")));`}
  ${sqlite ? `const claimed = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, candidate.id)).get();` : `const [claimed] = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.id, candidate.id)).limit(1);`}
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyExportJobRow), payload: claimed.payload };
}

/** Lists recent export jobs for a resource so a worker can find queued work. */
export async function listExportJobs(resource: string, limit = 50): Promise<QiyExportJob[]> {
  ${sqlite ? `const rows = db.select().from(qiyExportJobs).where(eq(qiyExportJobs.resource, resource)).orderBy(desc(qiyExportJobs.createdAt)).all();` : `const rows = await db.select().from(qiyExportJobs).where(eq(qiyExportJobs.resource, resource)).orderBy(desc(qiyExportJobs.createdAt));`}
  return rows.slice(0, limit).map((row) => toJob(row as QiyExportJobRow));
}
`;
}

/**
 * Server-side saved views: a per-user list of named filter/sort/column snapshots,
 * optionally shared with everyone who can read the resource. The browser keeps a
 * local copy too, so the UI works offline; this store is what makes views follow
 * the user across devices and lets teams share them.
 */
function renderSavedViewsModule(dialect: DatabaseIR["dialect"], resources: string[]): string {
  const sqlite = dialect === "sqlite";
  const now = "new Date()";
  return `import { and, desc, eq, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "./db";
import { qiySavedViews } from "./schema";
import type { Authenticator, Principal } from "./auth/guard";

export interface QiySavedView {
  id: string;
  resource: string;
  name: string;
  ownerId: string;
  shared: boolean;
  /** True when the caller owns this row; shared rows from other users report false. */
  mine: boolean;
  search?: string;
  filters?: unknown[];
  sorters?: unknown[];
  columns?: string[];
  createdAt: string;
  updatedAt: string;
}

const viewResources = ${JSON.stringify(resources)} as string[];
const MAX_VIEWS_PER_RESOURCE = 100;
const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();
const decode = (value: string | null): unknown[] | undefined => { if (!value) return undefined; try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : undefined; } catch { return undefined; } };

function toView(row: typeof qiySavedViews.$inferSelect, principalId: string): QiySavedView {
  return {
    id: row.id,
    resource: row.resource,
    name: row.name,
    ownerId: row.ownerId,
    shared: Boolean(row.shared),
    mine: row.ownerId === principalId,
    ...(row.search ? { search: row.search } : {}),
    ...(decode(row.filters) ? { filters: decode(row.filters) } : {}),
    ...(decode(row.sorters) ? { sorters: decode(row.sorters) } : {}),
    ...(decode(row.columns) ? { columns: decode(row.columns) as string[] } : {}),
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function listSavedViews(resource: string, principal: Principal): Promise<QiySavedView[]> {
  // Own views plus everyone's shared views, newest first. updatedAt then createdAt
  // plus the id tiebreaker keep the dropdown order stable for identical timestamps.
  ${sqlite
    ? "const rows = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, 1)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id)).all();"
    : dialect === "mysql"
      ? "const rows = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, 1)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id));"
      : "const rows = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, resource), or(eq(qiySavedViews.ownerId, principal.id), eq(qiySavedViews.shared, true)))).orderBy(desc(qiySavedViews.updatedAt), desc(qiySavedViews.createdAt), desc(qiySavedViews.id));"}
  return rows.map((row) => toView(row as typeof qiySavedViews.$inferSelect, principal.id));
}

export async function createSavedView(input: { resource: string; name: string; shared: boolean; search?: string; filters?: unknown[]; sorters?: unknown[]; columns?: string[]; principal: Principal }): Promise<QiySavedView> {
  ${sqlite
    ? "const existing = db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, input.resource), eq(qiySavedViews.ownerId, input.principal.id))).all();"
    : "const existing = await db.select().from(qiySavedViews).where(and(eq(qiySavedViews.resource, input.resource), eq(qiySavedViews.ownerId, input.principal.id)));"}
  // Publishing an existing name updates that row; only a new name counts toward the cap.
  // Rows duplicated by older releases are collapsed on the next publish.
  const duplicates = existing.filter((row) => row.name === input.name);
  const duplicate = duplicates[0];
  if (!duplicate && existing.length >= MAX_VIEWS_PER_RESOURCE) throw new Error("view.limit");
  const id = duplicate ? duplicate.id : crypto.randomUUID();
  const payload = {
    shared: ${dialect === "postgresql" ? "input.shared" : "input.shared ? 1 : 0"},
    search: input.search ?? null,
    filters: input.filters ? JSON.stringify(input.filters) : null,
    sorters: input.sorters ? JSON.stringify(input.sorters) : null,
    columns: input.columns ? JSON.stringify(input.columns) : null,
    updatedAt: ${now},
  };
  if (duplicate) {
    ${sqlite ? "for (const extra of duplicates.slice(1)) db.delete(qiySavedViews).where(eq(qiySavedViews.id, extra.id)).run();" : "for (const extra of duplicates.slice(1)) await db.delete(qiySavedViews).where(eq(qiySavedViews.id, extra.id));"}
    ${sqlite ? "db.update(qiySavedViews).set(payload).where(eq(qiySavedViews.id, id)).run();" : "await db.update(qiySavedViews).set(payload).where(eq(qiySavedViews.id, id));"}
  } else {
    ${sqlite ? "db.insert(qiySavedViews).values({ id, resource: input.resource, name: input.name, ownerId: input.principal.id, createdAt: new Date(), ...payload }).run();" : "await db.insert(qiySavedViews).values({ id, resource: input.resource, name: input.name, ownerId: input.principal.id, createdAt: new Date(), ...payload });"}
  }
  ${sqlite ? "const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();" : "const [row] = await db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).limit(1);"}
  return toView(row as typeof qiySavedViews.$inferSelect, input.principal.id);
}

export async function deleteSavedView(id: string, principal: Principal): Promise<"deleted" | "missing" | "forbidden"> {
  ${sqlite ? "const row = db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).get();" : "const [row] = await db.select().from(qiySavedViews).where(eq(qiySavedViews.id, id)).limit(1);"}
  if (!row) return "missing";
  // Owners delete their own rows; an admin may remove another user's shared row during cleanup.
  if (row.ownerId !== principal.id && principal.role !== "admin") return "forbidden";
  ${sqlite ? "db.delete(qiySavedViews).where(eq(qiySavedViews.id, id)).run();" : "await db.delete(qiySavedViews).where(eq(qiySavedViews.id, id));"}
  return "deleted";
}

export function createSavedViewsRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/saved-views" })
    .get("/", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!viewResources.includes(query.resource)) return status(400, { error: "Unknown view resource", errorKey: "views.unknownResource" });
      return { items: await listSavedViews(query.resource, principal) };
    }, { query: t.Object({ resource: t.String({ minLength: 1, maxLength: 160 }) }) })
    .post("/", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!viewResources.includes(body.resource)) return status(400, { error: "Unknown view resource", errorKey: "views.unknownResource" });
      const name = body.name.trim();
      if (!name) return status(400, { error: "View name is required", errorKey: "views.invalidName" });
      try {
        const view = await createSavedView({ ...body, name, shared: body.shared ?? false, principal });
        return status(201, view);
      } catch (error) {
        if (error instanceof Error && error.message === "view.limit") return status(400, { error: "Too many saved views for this resource", errorKey: "views.limit" });
        throw error;
      }
    }, { body: t.Object({ resource: t.String({ minLength: 1, maxLength: 160 }), name: t.String({ minLength: 1, maxLength: 80 }), shared: t.Optional(t.Boolean()), search: t.Optional(t.String({ maxLength: 300 })), filters: t.Optional(t.Array(t.Any(), { maxItems: 50 })), sorters: t.Optional(t.Array(t.Any(), { maxItems: 10 })), columns: t.Optional(t.Array(t.String({ maxLength: 80 }), { maxItems: 100 })) }, { additionalProperties: false }) })
    .delete("/:id", async ({ params, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      const outcome = await deleteSavedView(params.id, principal);
      if (outcome === "missing") return status(404, { error: "Saved view not found" });
      if (outcome === "forbidden") return status(403, { error: "Saved view belongs to another user", errorKey: "views.forbidden" });
      return status(204);
    });
}
`;
}

/**
 * Regression tests for the generated saved-view routes. Publishing the same name
 * must upsert instead of duplicating the dropdown entry, every row reports whether
 * it belongs to the caller, only the owner (or an admin) may delete, and the
 * per-user cap only applies to new names. SQLite runs on the in-memory test
 * database; PostgreSQL/MySQL need QIY_TEST_DATABASE_URL with migrations applied.
 */
function renderSavedViewsTest(dialect: DatabaseIR["dialect"], resources: string[]): string {
  const resource = resources[0]!;
  const exec = dialect === "sqlite" ? "client.exec(statement)" : dialect === "postgresql" ? "client.unsafe(statement)" : "client.query(statement)";
  const ddl = dialect === "sqlite"
    ? `CREATE TABLE IF NOT EXISTS "qiy_saved_views" ("id" text primary key, "resource" text not null, "name" text not null, "ownerId" text not null, "shared" integer not null, "search" text, "filters" text, "sorters" text, "columns" text, "createdAt" integer not null, "updatedAt" integer not null)`
    : dialect === "postgresql"
      ? `CREATE TABLE IF NOT EXISTS "qiy_saved_views" ("id" text primary key, "resource" text not null, "name" text not null, "ownerId" text not null, "shared" boolean not null, "search" text, "filters" text, "sorters" text, "columns" text, "createdAt" timestamp with time zone not null, "updatedAt" timestamp with time zone not null)`
      : "CREATE TABLE IF NOT EXISTS `qiy_saved_views` (`id` varchar(36) primary key, `resource` varchar(160) not null, `name` varchar(120) not null, `ownerId` varchar(36) not null, `shared` int not null, `search` text, `filters` text, `sorters` text, `columns` text, `createdAt` datetime(3) not null, `updatedAt` datetime(3) not null)";
  const available = dialect === "sqlite" ? "true" : "Boolean(Bun.env.QIY_TEST_DATABASE_URL)";
  const carolRows = dialect === "mysql"
    ? "DELETE FROM `qiy_saved_views` WHERE `ownerId` = '00000000-0000-4000-8000-0000000000c1'"
    : `DELETE FROM "qiy_saved_views" WHERE "ownerId" = '00000000-0000-4000-8000-0000000000c1'`;
  return `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { QiySavedView } from "../src/saved-views";

const dialect = ${JSON.stringify(dialect)};
const available = ${available};
const resource = ${JSON.stringify(resource)};
const ddl = ${JSON.stringify(ddl)};
const carolRows = ${JSON.stringify(carolRows)};

type Principal = { id: string; name: string; role: "admin" | "operator" | "viewer" };
const alice: Principal = { id: "00000000-0000-4000-8000-0000000000a1", name: "Alice", role: "admin" };
const bob: Principal = { id: "00000000-0000-4000-8000-0000000000b1", name: "Bob", role: "operator" };
const carol: Principal = { id: "00000000-0000-4000-8000-0000000000c1", name: "Carol", role: "operator" };

async function sql(statement: string): Promise<void> {
  const { client } = await import("../src/db");
  await ${exec};
}

async function setup() {
  await sql(ddl);
  const { createSavedViewsRoutes } = await import("../src/saved-views");
  let current: Principal | undefined = alice;
  const app = new Elysia().use(createSavedViewsRoutes(async () => current ?? null));
  const request = (user: Principal | undefined, path: string, init?: RequestInit) => { current = user; return app.handle(new Request("http://localhost" + path, init)); };
  const list = async (user: Principal): Promise<QiySavedView[]> => {
    const response = await request(user, "/api/v1/saved-views?resource=" + resource);
    expect(response.status).toBe(200);
    return ((await response.json()) as { items: QiySavedView[] }).items;
  };
  const create = (user: Principal, body: Record<string, unknown>) => request(user, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...body }) });
  const remove = (user: Principal | undefined, id: string) => request(user, "/api/v1/saved-views/" + id, { method: "DELETE" });
  return { request, list, create, remove };
}

test.skipIf(!available)("publishing the same name twice upserts one row and reports ownership", async () => {
  const { list, create } = await setup();
  const first = await create(alice, { name: "open-items", shared: true, search: "one", columns: ["id"] });
  expect(first.status).toBe(201);
  const created = (await first.json()) as QiySavedView;
  expect(created).toMatchObject({ resource, name: "open-items", ownerId: alice.id, shared: true, mine: true, search: "one", columns: ["id"] });

  // Republishing the same name keeps the id and replaces the stored payload.
  const second = await create(alice, { name: "open-items", shared: true, search: "two", columns: ["id", "title"] });
  expect(second.status).toBe(201);
  const updated = (await second.json()) as QiySavedView;
  expect(updated.id).toBe(created.id);
  expect(updated).toMatchObject({ search: "two", columns: ["id", "title"] });
  expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());

  // Exactly one row survives, and another user sees the shared copy flagged as not mine.
  expect((await list(alice)).filter((view) => view.name === "open-items")).toHaveLength(1);
  const sharedCopies = (await list(carol)).filter((view) => view.name === "open-items");
  expect(sharedCopies).toHaveLength(1);
  expect(sharedCopies[0]).toMatchObject({ id: created.id, ownerId: alice.id, mine: false });

  // Private views never leak into another user's list.
  await create(alice, { name: "admin-only" });
  expect((await list(carol)).some((view) => view.name === "admin-only")).toBe(false);
});

test.skipIf(!available)("owners and admins delete views while others get 403, 404 or 401", async () => {
  const { list, create, remove } = await setup();
  const adminView = (await (await create(alice, { name: "admin-private" })).json()) as QiySavedView;
  const bobShared = (await (await create(bob, { name: "bob-shared", shared: true })).json()) as QiySavedView;

  // A non-owner cannot delete another user's row, even a shared one.
  expect((await remove(bob, adminView.id)).status).toBe(403);
  // An admin may clean up another user's shared row.
  expect((await remove(alice, bobShared.id)).status).toBe(204);
  expect((await list(bob)).some((view) => view.id === bobShared.id)).toBe(false);
  // Owners delete their own rows; deleting twice is a 404.
  const ownView = (await (await create(bob, { name: "bob-own" })).json()) as QiySavedView;
  expect((await remove(bob, ownView.id)).status).toBe(204);
  expect((await remove(bob, ownView.id)).status).toBe(404);
  // Anonymous deletes are rejected before ownership is considered.
  expect((await remove(undefined, adminView.id)).status).toBe(401);
  expect((await list(alice)).some((view) => view.id === adminView.id)).toBe(true);
});

test.skipIf(!available)("validates the resource, the name and the caller", async () => {
  const { request, create } = await setup();
  expect((await request(undefined, "/api/v1/saved-views?resource=" + resource)).status).toBe(401);
  expect((await request(alice, "/api/v1/saved-views?resource=not-a-resource")).status).toBe(400);
  expect((await create(alice, { name: "   " })).status).toBe(400);
  expect((await create(alice, { name: "wrong-resource", resource: "not-a-resource" })).status).toBe(400);
  const anonymous = await request(undefined, "/api/v1/saved-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, name: "anonymous" }) });
  expect(anonymous.status).toBe(401);
});

test.skipIf(!available)("caps distinct view names but keeps upserting existing names", async () => {
  const { list, create } = await setup();
  // The test principal is unique, so it owns exactly the rows created here.
  await sql(carolRows);
  for (let index = 0; index < 100; index++) expect((await create(carol, { name: "bulk-" + index })).status).toBe(201);
  const rejected = await create(carol, { name: "one-too-many" });
  expect(rejected.status).toBe(400);
  expect(((await rejected.json()) as { errorKey?: string }).errorKey).toBe("views.limit");
  // Republishing an existing name updates in place and is not blocked by the cap.
  expect((await create(carol, { name: "bulk-0", search: "updated" })).status).toBe(201);
  const own = (await list(carol)).filter((view) => view.ownerId === carol.id && view.resource === resource);
  expect(own).toHaveLength(100);
  expect(own.find((view) => view.name === "bulk-0")?.search).toBe("updated");
});
`;
}

/**
 * Job store shared by every generated import route. Import can take longer than a
 * request should, so `POST /import?async=1` records the job here and the caller
 * polls `GET /import/jobs/:id`; the table is generated for every application.
 */
function renderImportJobsModule(dialect: DatabaseIR["dialect"]): string {
  const sqlite = dialect === "sqlite";
  const dateValue = sqlite ? "new Date()" : dialect === "mysql" ? "new Date()" : "new Date()";
  return `import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { qiyImportJobs } from "./schema";

export type QiyImportJobStatus = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface QiyImportJob {
  id: string;
  resource: string;
  status: QiyImportJobStatus;
  total: number;
  processed: number;
  failed: number;
  errors: string[];
  actorId: string | null;
  createdAt: string;
  updatedAt: string;
}

type QiyImportJobRow = typeof qiyImportJobs.$inferSelect;

function toJob(row: QiyImportJobRow): QiyImportJob {
  const iso = (value: Date | number | string) => value instanceof Date ? value.toISOString() : new Date(Number(value)).toISOString();
  return {
    id: row.id,
    resource: row.resource,
    status: row.status as QiyImportJobStatus,
    total: Number(row.total),
    processed: Number(row.processed),
    failed: Number(row.failed),
    errors: row.errors ? (JSON.parse(row.errors) as string[]) : [],
    actorId: row.actorId ?? null,
    createdAt: iso(row.createdAt as Date | number),
    updatedAt: iso(row.updatedAt as Date | number),
  };
}

export async function createImportJob(input: { resource: string; total: number; actorId: string | null; payload?: string }): Promise<string> {
  const id = crypto.randomUUID();
  const values = { id, resource: input.resource, status: "queued", total: input.total, processed: 0, failed: 0, errors: null, actorId: input.actorId, payload: input.payload ?? null, leaseOwner: null, leaseUntil: null, createdAt: ${dateValue}, updatedAt: ${dateValue} };
  ${sqlite ? "db.insert(qiyImportJobs).values(values).run();" : "await db.insert(qiyImportJobs).values(values);"}
  return id;
}

export async function updateImportJob(id: string, patch: { status?: QiyImportJobStatus; processed?: number; failed?: number; errors?: string[]; releaseLease?: boolean }): Promise<void> {
  const values = {
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.processed !== undefined ? { processed: patch.processed } : {}),
    ...(patch.failed !== undefined ? { failed: patch.failed } : {}),
    ...(patch.errors ? { errors: JSON.stringify(patch.errors) } : {}),
    updatedAt: ${dateValue},
  };
  ${sqlite ? "db.update(qiyImportJobs).set(values).where(eq(qiyImportJobs.id, id)).run();" : "await db.update(qiyImportJobs).set(values).where(eq(qiyImportJobs.id, id));"}
}

export async function readImportJob(id: string): Promise<QiyImportJob | undefined> {
  ${sqlite ? "const row = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, id)).get();" : "const [row] = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, id)).limit(1);"}
  return row ? toJob(row as QiyImportJobRow) : undefined;
}


/**
 * Claims the oldest runnable job for a resource. The conditional update means two
 * replicas racing for the same row cannot both win; the loser sees a different owner.
 */
export async function claimImportJob(resource: string, workerId: string, leaseUntil: Date, jobId?: string): Promise<(QiyImportJob & { payload: string }) | undefined> {
  ${sqlite ? `const candidates = db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt).all();` : dialect === "mysql" ? `const candidates = await db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt);` : `const candidates = await db.select().from(qiyImportJobs).where(and(eq(qiyImportJobs.resource, resource), eq(qiyImportJobs.status, "queued"))).orderBy(qiyImportJobs.createdAt);`}
  const candidate = candidates.find((row) => Boolean(row.payload) && (!jobId || row.id === jobId));
  if (!candidate) return undefined;
  const now = new Date();
  ${sqlite ? `db.update(qiyImportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: now }).where(and(eq(qiyImportJobs.id, candidate.id), eq(qiyImportJobs.status, "queued"))).run();` : `await db.update(qiyImportJobs).set({ status: "running", leaseOwner: workerId, leaseUntil, updatedAt: now }).where(and(eq(qiyImportJobs.id, candidate.id), eq(qiyImportJobs.status, "queued")));`}
  ${sqlite ? `const claimed = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, candidate.id)).get();` : `const [claimed] = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.id, candidate.id)).limit(1);`}
  if (!claimed || claimed.leaseOwner !== workerId || !claimed.payload) return undefined;
  return { ...toJob(claimed as QiyImportJobRow), payload: claimed.payload };
}

/** Lists recent jobs for a resource so a worker can find queued work. */
export async function listImportJobs(resource: string, limit = 50): Promise<QiyImportJob[]> {
  ${sqlite ? `const rows = db.select().from(qiyImportJobs).where(eq(qiyImportJobs.resource, resource)).orderBy(desc(qiyImportJobs.createdAt)).all();` : `const rows = await db.select().from(qiyImportJobs).where(eq(qiyImportJobs.resource, resource)).orderBy(desc(qiyImportJobs.createdAt));`}
  return rows.slice(0, limit).map((row) => toJob(row as QiyImportJobRow));
}
/** Marks a queued/running job as cancelled; finished jobs report notRunning. */
export async function requestImportJobCancel(id: string): Promise<"cancelled" | "notRunning" | "missing"> {
  const job = await readImportJob(id);
  if (!job) return "missing";
  if (job.status !== "queued" && job.status !== "running") return "notRunning";
  ${sqlite ? `db.update(qiyImportJobs).set({ status: "cancelling", updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, id)).run();` : `await db.update(qiyImportJobs).set({ status: "cancelling", updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, id));`}
  return "cancelled";
}

/** Cheap status probe used between rows so a cancelled import stops promptly. */
export async function isImportJobCancelled(id: string): Promise<boolean> {
  const job = await readImportJob(id);
  return job?.status === "cancelling" || job?.status === "cancelled";
}

/**
 * A crashed process leaves running jobs behind forever, so status and cancel calls
 * first age out jobs whose progress has not moved within the stale window.
 */
export async function releaseStaleImportJobs(now: Date = new Date()): Promise<number> {
  const configured = Number(Bun.env.QIY_IMPORT_JOB_STALE_MS ?? 300000);
  const staleMs = Number.isSafeInteger(configured) && configured >= 1000 ? configured : 300000;
  const cutoff = new Date(now.getTime() - staleMs);
  ${sqlite ? "const candidates = db.select().from(qiyImportJobs).all();" : "const candidates = await db.select().from(qiyImportJobs);"}
  const stale = candidates.filter((row) => (row.status === "queued" || row.status === "running") && row.updatedAt instanceof Date && row.updatedAt < cutoff);
  for (const row of stale) {
    ${sqlite ? `db.update(qiyImportJobs).set({ status: "failed", errors: JSON.stringify(["Stale import job timed out"]), updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, row.id)).run();` : `await db.update(qiyImportJobs).set({ status: "failed", errors: JSON.stringify(["Stale import job timed out"]), updatedAt: ${dateValue} }).where(eq(qiyImportJobs.id, row.id));`}
  }
  return stale.length;
}
`;
}

function renderRealtime(config: NonNullable<QiyProject["realtime"]>, dialect: DatabaseIR["dialect"], dataflows: NonNullable<QiyProject["dataflows"]> = []): string {
  const subscriptions = JSON.stringify(config.resources);
  const eventRoles = new Map<string, Set<string>>();
  for (const flow of dataflows) {
    for (const action of flow.steps.flatMap((step) => step.actions)) {
      if (action.kind !== "emit") continue;
      const roles = eventRoles.get(action.event) ?? new Set<string>();
      for (const role of flow.roles ?? ["admin", "operator"]) roles.add(role);
      eventRoles.set(action.event, roles);
    }
  }
  const eventSubscriptions = JSON.stringify([...eventRoles].map(([event, roles]) => ({ event, roles: [...roles] })));
  const metricsQuery = dialect === "sqlite"
    ? `const pendingCondition = and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt));
    const pending = db.select({ value: count() }).from(realtimeOutbox).where(pendingCondition).get()?.value ?? 0;
    const leased = db.select({ value: count() }).from(realtimeOutbox).where(and(pendingCondition, isNotNull(realtimeOutbox.leaseUntil), gt(realtimeOutbox.leaseUntil, now))).get()?.value ?? 0;
    const deadLettered = db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)).get()?.value ?? 0;
    const delivered = db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deliveredAt)).get()?.value ?? 0;
    const oldestPendingAt = db.select({ createdAt: realtimeOutbox.createdAt }).from(realtimeOutbox).where(pendingCondition).orderBy(asc(realtimeOutbox.createdAt)).limit(1).get()?.createdAt ?? null;
    return { pending, leased, deadLettered, delivered, oldestPendingAt };`
    : `const pendingCondition = and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt));
    const [pendingRows, leasedRows, deadRows, deliveredRows, oldestRows] = await Promise.all([
      db.select({ value: count() }).from(realtimeOutbox).where(pendingCondition),
      db.select({ value: count() }).from(realtimeOutbox).where(and(pendingCondition, isNotNull(realtimeOutbox.leaseUntil), gt(realtimeOutbox.leaseUntil, now))),
      db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)),
      db.select({ value: count() }).from(realtimeOutbox).where(isNotNull(realtimeOutbox.deliveredAt)),
      db.select({ createdAt: realtimeOutbox.createdAt }).from(realtimeOutbox).where(pendingCondition).orderBy(asc(realtimeOutbox.createdAt)).limit(1),
    ]);
    return { pending: Number(pendingRows[0]?.value ?? 0), leased: Number(leasedRows[0]?.value ?? 0), deadLettered: Number(deadRows[0]?.value ?? 0), delivered: Number(deliveredRows[0]?.value ?? 0), oldestPendingAt: oldestRows[0]?.createdAt ?? null };`;
  const auditValue = (action: string, resourceId: string, metadata: string) => `{ id: crypto.randomUUID(), actorId, action: ${JSON.stringify(action)}, resource: "qiy_realtime_outbox", resourceId: ${resourceId}, metadata: ${dialect === "sqlite" ? `JSON.stringify(${metadata})` : metadata}, createdAt: ${dialect === "mysql" ? "Date.now()" : "new Date()"} }`;
  return `import { Rest } from "ably";
import { timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "./db";
import { auditEvents, realtimeOutbox } from "./schema";
import { publishRealtimeEvent, subscribeRealtimeEvents, type QiyRealtimeRecordEvent } from "./realtime-bus";
import type { Authenticator, Principal } from "./auth/guard";

export type QiyRealtimeEvent = "created" | "updated" | "deleted";
export interface QiyRealtimeSubscription { resource: string; events: string[]; roles: string[]; claim?: { field: string; claim: string } }
export interface QiyRealtimeEventSubscription { event: string; roles: string[] }
// Declared element types: an empty capability list must still be typed, otherwise
// an empty const array becomes readonly never[] and the generated server fails tsc.
export const qiyRealtimeSubscriptions: readonly QiyRealtimeSubscription[] = ${subscriptions};
export const qiyRealtimeEventSubscriptions: readonly QiyRealtimeEventSubscription[] = ${eventSubscriptions};

type AblyClient = Pick<Rest, "auth" | "channels">;
type AblyClientFactory = () => AblyClient;
export interface RealtimeOutboxRecord { id: string; channel: string; type: string; payload: string; attempts: number; }
export interface RealtimeOutboxMetrics { pending: number; leased: number; deadLettered: number; delivered: number; oldestPendingAt: Date | null; }
export interface RealtimeOutboxStore {
  claim(limit: number, now: Date, leaseOwner: string, leaseUntil: Date): Promise<RealtimeOutboxRecord[]>;
  delivered(id: string, leaseOwner: string, deliveredAt: Date): Promise<void>;
  failed(id: string, leaseOwner: string, attempts: number, lastError: string, availableAt: Date): Promise<void>;
  dead(id: string, leaseOwner: string, attempts: number, lastError: string, deadLetteredAt: Date): Promise<void>;
  deadLetters(limit: number): Promise<RealtimeOutboxRecord[]>;
  replay(id: string, now: Date, actorId?: string): Promise<boolean>;
  replayMany(ids: string[], now: Date, actorId?: string): Promise<string[]>;
  cleanupDelivered(before: Date, audit?: { actorId: string; retentionDays: number }): Promise<number>;
  metrics(now: Date): Promise<RealtimeOutboxMetrics>;
}

const realtimeWorkerId: string = crypto.randomUUID();

function realtimeLeaseMs(): number {
  const leaseMs = Number(Bun.env.QIY_REALTIME_LEASE_MS ?? 30000);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000) throw new Error("QIY_REALTIME_LEASE_MS must be an integer of at least 1000ms");
  return leaseMs;
}

function realtimeMaxAttempts(): number {
  const attempts = Number(Bun.env.QIY_REALTIME_MAX_ATTEMPTS ?? 10);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 1000) throw new Error("QIY_REALTIME_MAX_ATTEMPTS must be an integer from 1 to 1000");
  return attempts;
}

function realtimeRetentionDays(): number {
  const days = Number(Bun.env.QIY_REALTIME_RETENTION_DAYS ?? 7);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) throw new Error("QIY_REALTIME_RETENTION_DAYS must be an integer from 1 to 3650");
  return days;
}

function realtimeCleanupMs(): number {
  const cleanupMs = Number(Bun.env.QIY_REALTIME_CLEANUP_MS ?? 86400000);
  if (!Number.isSafeInteger(cleanupMs) || cleanupMs < 60000) throw new Error("QIY_REALTIME_CLEANUP_MS must be an integer of at least 60000ms");
  return cleanupMs;
}

function realtimeAlertInteger(name: "QIY_REALTIME_ALERT_MAX_PENDING" | "QIY_REALTIME_ALERT_MAX_DEAD_LETTERED" | "QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", fallback: number): number {
  const value = Number(Bun.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + " must be a non-negative integer");
  return value;
}

export interface RealtimeOutboxAlertThresholds {
  maxPending: number;
  maxDeadLettered: number;
  maxOldestPendingMs: number;
}

export interface RealtimeOutboxHealth {
  status: "ok" | "degraded";
  alerts: string[];
  metrics: Omit<RealtimeOutboxMetrics, "oldestPendingAt"> & { oldestPendingAt: string | null; oldestPendingAgeMs: number };
  thresholds: RealtimeOutboxAlertThresholds;
}

export function realtimeAlertThresholds(): RealtimeOutboxAlertThresholds {
  return {
    maxPending: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_PENDING", 1000),
    maxDeadLettered: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_DEAD_LETTERED", 0),
    maxOldestPendingMs: realtimeAlertInteger("QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS", 300000),
  };
}

export function evaluateRealtimeOutboxHealth(metrics: RealtimeOutboxMetrics, now = new Date(), thresholds = realtimeAlertThresholds()): RealtimeOutboxHealth {
  const oldestPendingAt = metrics.oldestPendingAt ? new Date(metrics.oldestPendingAt) : null;
  const oldestPendingAgeMs = oldestPendingAt ? Math.max(0, now.getTime() - oldestPendingAt.getTime()) : 0;
  const alerts: string[] = [];
  if (metrics.pending > thresholds.maxPending) alerts.push("pending");
  if (metrics.deadLettered > thresholds.maxDeadLettered) alerts.push("deadLettered");
  if (oldestPendingAgeMs > thresholds.maxOldestPendingMs) alerts.push("oldestPendingAgeMs");
  return {
    status: alerts.length ? "degraded" : "ok",
    alerts,
    metrics: { ...metrics, oldestPendingAt: oldestPendingAt?.toISOString() ?? null, oldestPendingAgeMs },
    thresholds,
  };
}

export function renderRealtimePrometheus(metrics: RealtimeOutboxMetrics, now = new Date()): string {
  const health = evaluateRealtimeOutboxHealth(metrics, now);
  const lines = [
    "# HELP qiy_realtime_outbox_pending Pending outbox events awaiting delivery.",
    "# TYPE qiy_realtime_outbox_pending gauge",
    "qiy_realtime_outbox_pending " + metrics.pending,
    "# HELP qiy_realtime_outbox_leased Pending events currently leased by workers.",
    "# TYPE qiy_realtime_outbox_leased gauge",
    "qiy_realtime_outbox_leased " + metrics.leased,
    "# HELP qiy_realtime_outbox_dead_lettered Events that exhausted delivery attempts.",
    "# TYPE qiy_realtime_outbox_dead_lettered gauge",
    "qiy_realtime_outbox_dead_lettered " + metrics.deadLettered,
    "# HELP qiy_realtime_outbox_delivered Delivered events retained for operations.",
    "# TYPE qiy_realtime_outbox_delivered gauge",
    "qiy_realtime_outbox_delivered " + metrics.delivered,
    "# HELP qiy_realtime_outbox_oldest_pending_age_seconds Age of the oldest pending event.",
    "# TYPE qiy_realtime_outbox_oldest_pending_age_seconds gauge",
    "qiy_realtime_outbox_oldest_pending_age_seconds " + (health.metrics.oldestPendingAgeMs / 1000),
    "# HELP qiy_realtime_outbox_health Whether configured outbox alert thresholds are healthy.",
    "# TYPE qiy_realtime_outbox_health gauge",
    "qiy_realtime_outbox_health " + (health.status === "ok" ? 1 : 0),
  ];
  return lines.join("\\n") + "\\n";
}

function hasRealtimeMetricsToken(request: Request): boolean {
  const expected = Bun.env.QIY_REALTIME_METRICS_TOKEN?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function createAblyClient(): AblyClient {
  const key = Bun.env.QIY_ABLY_API_KEY;
  if (!key) throw new Error("QIY_ABLY_API_KEY is required when realtime is enabled");
  return new Rest({ key });
}

/** Row-scoped channels append the subscriber's claim value: qiy:orders:eu. */
export function realtimeChannel(resource: string, claimValue?: string | number | null): string {
  return claimValue === undefined || claimValue === null || claimValue === "" ? "qiy:" + resource : "qiy:" + resource + ":" + String(claimValue);
}

export function realtimeCapabilities(principal: Principal): Record<string, string[]> {
  return Object.fromEntries([
    ...qiyRealtimeSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      // A claim-scoped resource grants only the caller's own segment; a missing claim grants nothing.
      .flatMap((subscription): Array<[string, string[]]> => {
        if (!subscription.claim) return [["qiy:" + subscription.resource, ["subscribe"]]];
        const value = principal.claims?.[subscription.claim.claim];
        if (value === undefined || value === null || value === "") return [];
        return [[realtimeChannel(subscription.resource, value as string | number), ["subscribe"]]];
      }),
    ...qiyRealtimeEventSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      .map((subscription): [string, string[]] => ["qiy:event:" + subscription.event, ["subscribe"]]),
  ]);
}

export async function publishRealtime(resource: string, type: QiyRealtimeEvent, payload: Record<string, unknown>, clientFactory: AblyClientFactory = createAblyClient): Promise<void> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return;
  const subscription = qiyRealtimeSubscriptions.find((candidate) => candidate.resource === resource);
  if (!subscription || !(subscription.events as readonly string[]).includes(type)) return;
  const claimValue = subscription.claim ? payload[subscription.claim.field] as string | number | null | undefined : undefined;
  // Without the claim value there is no channel to publish to, so the event stays undelivered by design.
  if (subscription.claim && (claimValue === undefined || claimValue === null || claimValue === "")) return;
  await clientFactory().channels.get(realtimeChannel(resource, claimValue)).publish(type, payload);
}

export const databaseOutboxStore: RealtimeOutboxStore = {
  async claim(limit, now, leaseOwner, leaseUntil) {
    ${dialect === "sqlite"
      ? "const records = db.select().from(realtimeOutbox).where(and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt), lte(realtimeOutbox.availableAt, now), or(isNull(realtimeOutbox.leaseUntil), lte(realtimeOutbox.leaseUntil, now)))).orderBy(asc(realtimeOutbox.createdAt)).limit(limit).all(); if (records.length) db.update(realtimeOutbox).set({ leaseOwner, leaseUntil }).where(inArray(realtimeOutbox.id, records.map((record) => record.id))).run(); return records;"
      : "return await db.transaction(async (tx) => { const records = await tx.select().from(realtimeOutbox).where(and(isNull(realtimeOutbox.deliveredAt), isNull(realtimeOutbox.deadLetteredAt), lte(realtimeOutbox.availableAt, now), or(isNull(realtimeOutbox.leaseUntil), lte(realtimeOutbox.leaseUntil, now)))).orderBy(asc(realtimeOutbox.createdAt)).limit(limit).for(\"update\", { skipLocked: true }); if (records.length) await tx.update(realtimeOutbox).set({ leaseOwner, leaseUntil }).where(inArray(realtimeOutbox.id, records.map((record) => record.id))); return records; });"}
  },
  async delivered(id, leaseOwner, deliveredAt) {
    ${dialect === "sqlite" ? "db.update(realtimeOutbox).set({ deliveredAt, lastError: null, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();" : "await db.update(realtimeOutbox).set({ deliveredAt, lastError: null, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner)));"}
  },
  async failed(id, leaseOwner, attempts, lastError, availableAt) {
    ${dialect === "sqlite" ? "db.update(realtimeOutbox).set({ attempts, lastError, availableAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();" : "await db.update(realtimeOutbox).set({ attempts, lastError, availableAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner)));"}
  },
  async dead(id, leaseOwner, attempts, lastError, deadLetteredAt) {
    ${dialect === "sqlite" ? "db.update(realtimeOutbox).set({ attempts, lastError, deadLetteredAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner))).run();" : "await db.update(realtimeOutbox).set({ attempts, lastError, deadLetteredAt, leaseOwner: null, leaseUntil: null }).where(and(eq(realtimeOutbox.id, id), eq(realtimeOutbox.leaseOwner, leaseOwner)));"}
  },
  async deadLetters(limit) {
    ${dialect === "sqlite" ? "return db.select().from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)).orderBy(desc(realtimeOutbox.deadLetteredAt)).limit(limit).all();" : "return await db.select().from(realtimeOutbox).where(isNotNull(realtimeOutbox.deadLetteredAt)).orderBy(desc(realtimeOutbox.deadLetteredAt)).limit(limit);"}
  },
  async replay(id, now, actorId) {
    ${dialect === "sqlite"
      ? `return db.transaction((tx) => { const record = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(eq(realtimeOutbox.id, id), isNotNull(realtimeOutbox.deadLetteredAt))).get(); if (!record) return false; tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(eq(realtimeOutbox.id, id)).run(); if (actorId) tx.insert(auditEvents).values(${auditValue("realtime.outbox.replayed", "id", "{ operation: \"single\" }")}).run(); return true; });`
      : `return await db.transaction(async (tx) => { const records = await tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(eq(realtimeOutbox.id, id), isNotNull(realtimeOutbox.deadLetteredAt))).limit(1).for("update"); if (!records.length) return false; await tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(eq(realtimeOutbox.id, id)); if (actorId) await tx.insert(auditEvents).values(${auditValue("realtime.outbox.replayed", "id", "{ operation: \"single\" }")}); return true; });`}
  },
  async replayMany(ids, now, actorId) {
    ${dialect === "sqlite"
      ? `return db.transaction((tx) => { const records = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(inArray(realtimeOutbox.id, ids), isNotNull(realtimeOutbox.deadLetteredAt))).all(); const replayed = records.map((record) => record.id); if (replayed.length) tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(inArray(realtimeOutbox.id, replayed)).run(); if (actorId) tx.insert(auditEvents).values(${auditValue("realtime.outbox.bulk_replayed", "null", "{ requested: ids.length, replayed: replayed.length }")}).run(); return replayed; });`
      : `return await db.transaction(async (tx) => { const records = await tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(inArray(realtimeOutbox.id, ids), isNotNull(realtimeOutbox.deadLetteredAt))).for("update", { skipLocked: true }); const replayed = records.map((record) => record.id); if (replayed.length) await tx.update(realtimeOutbox).set({ attempts: 0, availableAt: now, deadLetteredAt: null, lastError: null, leaseOwner: null, leaseUntil: null }).where(inArray(realtimeOutbox.id, replayed)); if (actorId) await tx.insert(auditEvents).values(${auditValue("realtime.outbox.bulk_replayed", "null", "{ requested: ids.length, replayed: replayed.length }")}); return replayed; });`}
  },
  async cleanupDelivered(before, audit) {
    ${dialect === "sqlite"
      ? `return db.transaction((tx) => { const records = tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(isNotNull(realtimeOutbox.deliveredAt), lt(realtimeOutbox.deliveredAt, before))).all(); if (records.length) tx.delete(realtimeOutbox).where(inArray(realtimeOutbox.id, records.map((record) => record.id))).run(); if (audit) { const actorId = audit.actorId; tx.insert(auditEvents).values(${auditValue("realtime.outbox.cleaned", "null", "{ retentionDays: audit.retentionDays, deleted: records.length }")}).run(); } return records.length; });`
      : `return await db.transaction(async (tx) => { const records = await tx.select({ id: realtimeOutbox.id }).from(realtimeOutbox).where(and(isNotNull(realtimeOutbox.deliveredAt), lt(realtimeOutbox.deliveredAt, before))); if (records.length) await tx.delete(realtimeOutbox).where(inArray(realtimeOutbox.id, records.map((record) => record.id))); if (audit) { const actorId = audit.actorId; await tx.insert(auditEvents).values(${auditValue("realtime.outbox.cleaned", "null", "{ retentionDays: audit.retentionDays, deleted: records.length }")}); } return records.length; });`}
  },
  async metrics(now) {
    ${metricsQuery}
  },
};

export async function dispatchRealtimeOutbox(limit = 100, clientFactory: AblyClientFactory = createAblyClient, store: RealtimeOutboxStore = databaseOutboxStore, leaseOwner: string = realtimeWorkerId): Promise<{ delivered: number; failed: number; deadLettered: number }> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return { delivered: 0, failed: 0, deadLettered: 0 };
  const now = new Date();
  const records = await store.claim(limit, now, leaseOwner, new Date(now.getTime() + realtimeLeaseMs()));
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  const client = records.length ? clientFactory() : undefined;
  for (const record of records) {
    try {
      const payload = JSON.parse(record.payload) as Record<string, unknown>;
      await client!.channels.get(record.channel).publish(record.type, payload);
      await store.delivered(record.id, leaseOwner, new Date());
      // Subscribers on the same instance receive the delivered, already-redacted payload.
      publishRealtimeEvent({ id: record.id, channel: record.channel, event: record.type, record: payload });
      delivered++;
    } catch (error) {
      const attempts = record.attempts + 1;
      const message = String(error).slice(0, 2000);
      if (attempts >= realtimeMaxAttempts()) {
        await store.dead(record.id, leaseOwner, attempts, message, new Date());
        deadLettered++;
      } else {
        const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6));
        await store.failed(record.id, leaseOwner, attempts, message, new Date(Date.now() + delay));
        failed++;
      }
    }
  }
  return { delivered, failed, deadLettered };
}

export async function cleanupRealtimeOutbox(retentionDays = realtimeRetentionDays(), store: RealtimeOutboxStore = databaseOutboxStore, now = new Date(), actorId?: string): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error("Realtime retention days must be an integer from 1 to 3650");
  return store.cleanupDelivered(new Date(now.getTime() - retentionDays * 86400000), actorId ? { actorId, retentionDays } : undefined);
}

export interface RealtimeOutboxWorkerHandle {
  dispatchTimer: ReturnType<typeof setInterval>;
  cleanupTimer: ReturnType<typeof setInterval>;
  stop(): void;
}

export function startRealtimeOutboxWorker(): RealtimeOutboxWorkerHandle | undefined {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return undefined;
  const pollMs = Number(Bun.env.QIY_REALTIME_POLL_MS ?? 5000);
  if (!Number.isSafeInteger(pollMs) || pollMs < 250) throw new Error("QIY_REALTIME_POLL_MS must be an integer of at least 250ms");
  const cleanupMs = realtimeCleanupMs();
  const dispatch = () => void dispatchRealtimeOutbox().catch((error) => console.error("Realtime outbox dispatch failed", error));
  const cleanup = () => void cleanupRealtimeOutbox()
    .then((deleted) => { if (deleted > 0) console.info("Realtime outbox cleanup removed " + deleted + " delivered record(s)"); })
    .catch((error) => console.error("Realtime outbox cleanup failed", error));
  dispatch();
  cleanup();
  const dispatchTimer = setInterval(dispatch, pollMs);
  const cleanupTimer = setInterval(cleanup, cleanupMs);
  dispatchTimer.unref();
  cleanupTimer.unref();
  return {
    dispatchTimer,
    cleanupTimer,
    stop() {
      clearInterval(dispatchTimer);
      clearInterval(cleanupTimer);
    },
  };
}

export function createRealtimeRoutes(authenticate: Authenticator, clientFactory: AblyClientFactory = createAblyClient, store: RealtimeOutboxStore = databaseOutboxStore) {
  return new Elysia({ prefix: "/api/v1/realtime" }).post("/token", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    const capability = realtimeCapabilities(principal);
    if (!Object.keys(capability).length) return status(403, { error: "Realtime subscription is not permitted" });
    if (Bun.env.QIY_REALTIME_DISABLED === "1") return status(503, { error: "Realtime is disabled" });
    return clientFactory().auth.createTokenRequest({ clientId: principal.id, capability: JSON.stringify(capability) });
  }).get("/outbox/dead", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    return { data: await store.deadLetters(100) };
  }).get("/outbox/metrics", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    return await store.metrics(new Date());
  }).get("/outbox/metrics/prometheus", async ({ request, status }) => {
    if (!hasRealtimeMetricsToken(request)) {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    }
    const now = new Date();
    return new Response(renderRealtimePrometheus(await store.metrics(now), now), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
  }).get("/outbox/health", async ({ request, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    const now = new Date();
    const health = evaluateRealtimeOutboxHealth(await store.metrics(now), now);
    return status(health.status === "ok" ? 200 : 503, health);
  }).post("/outbox/replay", async ({ request, body, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    if (new Set(body.ids).size !== body.ids.length) return status(400, { error: "Realtime replay ids must be unique" });
    const replayedIds = new Set(await store.replayMany(body.ids, new Date(), principal.id));
    return { replayed: body.ids.filter((id) => replayedIds.has(id)), notFound: body.ids.filter((id) => !replayedIds.has(id)) };
  }, { body: t.Object({ ids: t.Array(t.String({ format: "uuid" }), { minItems: 1, maxItems: 100 }) })
  }).post("/outbox/:id/replay", async ({ request, params, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    if (!await store.replay(params.id, new Date(), principal.id)) return status(404, { error: "Dead-letter event was not found" });
    return { replayed: true, id: params.id };
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) }).delete("/outbox/delivered", async ({ request, query, status }) => {
    const principal = await authenticate(request);
    if (!principal) return status(401, { error: "Authentication required" });
    if (principal.role !== "admin") return status(403, { error: "Realtime outbox administration is not permitted" });
    const retentionDays = query.retentionDays ?? realtimeRetentionDays();
    return { deleted: await cleanupRealtimeOutbox(retentionDays, store, new Date(), principal.id), retentionDays };
  }, { query: t.Object({ retentionDays: t.Optional(t.Numeric({ minimum: 1, maximum: 3650 })) }) });
}

/**
 * Subscription source for GraphQL. The in-process bus keeps latency low on the
 * instance that delivered the event, and the outbox tail makes events delivered by
 * any other replica visible too, so subscriptions work with several API instances.
 */
export function realtimeChannelIterator(channel: string): AsyncIterableIterator<QiyRealtimeRecordEvent> & { close: () => void } {
  const queue: QiyRealtimeRecordEvent[] = [];
  const seen = new Set<string>();
  let pending: ((result: IteratorResult<QiyRealtimeRecordEvent>) => void) | undefined;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let cursor: { createdAt: Date; id: string } | undefined;
  const pollMs = Math.max(100, Number(Bun.env.QIY_REALTIME_SUBSCRIBE_POLL_MS ?? 1000));
  const emit = (event: QiyRealtimeRecordEvent) => {
    if (closed || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 5000) seen.clear();
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else queue.push(event);
  };
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (event.channel === channel) emit({ id: event.id, channel: event.channel, event: event.event, record: event.record });
  });
  const stop = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    unsubscribe();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const advance = (row: { id: string; createdAt: Date | number }) => { cursor = { createdAt: new Date(row.createdAt), id: row.id }; };
  const tail = async () => {
    if (closed) return;
    try {
      const after = cursor
        ? or(gt(realtimeOutbox.createdAt, cursor.createdAt), and(eq(realtimeOutbox.createdAt, cursor.createdAt), gt(realtimeOutbox.id, cursor.id)))
        : undefined;
      const rows = await db.select().from(realtimeOutbox)
        .where(and(eq(realtimeOutbox.channel, channel), isNotNull(realtimeOutbox.deliveredAt), after))
        .orderBy(asc(realtimeOutbox.createdAt), asc(realtimeOutbox.id))
        .limit(100);
      for (const row of rows) {
        advance(row);
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(row.payload) as Record<string, unknown>; } catch { payload = {}; }
        emit({ id: row.id, channel: row.channel, event: row.type, record: payload });
      }
    } catch { /* a transient read must not kill an active subscription */ }
  };
  const start = async () => {
    try {
      const latest = await db.select({ id: realtimeOutbox.id, createdAt: realtimeOutbox.createdAt }).from(realtimeOutbox)
        .where(and(eq(realtimeOutbox.channel, channel), isNotNull(realtimeOutbox.deliveredAt)))
        .orderBy(desc(realtimeOutbox.createdAt), desc(realtimeOutbox.id))
        .limit(1);
      if (latest[0]) advance(latest[0]);
    } catch { /* start from the beginning of the outbox */ }
    if (closed) return;
    timer = setInterval(() => { void tail(); }, pollMs);
    await tail();
  };
  void start();
  const iterator = {
    close: stop,
    [Symbol.asyncIterator]() { return iterator; },
    next() {
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      const queued = queue.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      return new Promise<IteratorResult<QiyRealtimeRecordEvent>>((resolve) => { pending = resolve; });
    },
    return() { stop(); return Promise.resolve({ value: undefined as never, done: true }); },
  };
  return iterator;
}
`;
}

function renderRealtimeAdminCli(): string {
  return `type RealtimeAdminEnvironment = {
  QIY_REALTIME_ADMIN_URL?: string;
  QIY_REALTIME_ADMIN_TOKEN?: string;
  PORT?: string;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function usage(): string {
  return "Usage: bun src/realtime-admin.ts <metrics|prometheus|health|dead|replay|cleanup> [ids...|retentionDays]";
}

function baseUrl(environment: RealtimeAdminEnvironment): string {
  const configured = environment.QIY_REALTIME_ADMIN_URL ?? \`http://127.0.0.1:\${environment.PORT ?? "3000"}/api/v1/realtime/outbox\`;
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("QIY_REALTIME_ADMIN_URL must use http or https");
  parsed.pathname = parsed.pathname.replace(/\\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\\/$/, "");
}

function parseRetentionDays(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("retentionDays must be an integer between 1 and 3650");
  return days;
}

export async function runRealtimeAdmin(
  argv: string[],
  environment: RealtimeAdminEnvironment = Bun.env as RealtimeAdminEnvironment,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  const token = environment.QIY_REALTIME_ADMIN_TOKEN?.trim();
  if (!token) throw new Error("QIY_REALTIME_ADMIN_TOKEN is required");
  const [command, ...arguments_] = argv;
  const root = baseUrl(environment);
  let url = root;
  let method = "GET";
  let body: string | undefined;
  if (command === "metrics") url += "/metrics";
  else if (command === "prometheus") url += "/metrics/prometheus";
  else if (command === "health") url += "/health";
  else if (command === "dead") url += "/dead";
  else if (command === "replay") {
    if (arguments_.length < 1 || arguments_.length > 100 || new Set(arguments_).size !== arguments_.length) throw new Error("replay requires 1-100 unique event UUIDs");
    method = "POST";
    url += "/replay";
    body = JSON.stringify({ ids: arguments_ });
  } else if (command === "cleanup") {
    if (arguments_.length > 1) throw new Error(usage());
    method = "DELETE";
    const retentionDays = parseRetentionDays(arguments_[0]);
    url += \`/delivered\${retentionDays === undefined ? "" : \`?retentionDays=\${retentionDays}\`}\`;
  } else throw new Error(usage());
  const response = await fetcher(url, {
    method,
    headers: { Authorization: \`Bearer \${token}\`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body,
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text && response.headers.get("content-type")?.startsWith("text/plain")) payload = text;
  else if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: text }; }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error: unknown }).error) : \`Realtime administration failed with HTTP \${response.status}\`;
    throw Object.assign(new Error(message), { statusCode: response.status, payload });
  }
  return payload;
}

if (import.meta.main) {
  runRealtimeAdmin(Bun.argv.slice(2)).then((payload) => console.log(typeof payload === "string" ? payload.trimEnd() : JSON.stringify(payload))).catch((error) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), statusCode: (error as { statusCode?: number }).statusCode }));
    process.exitCode = 1;
  });
}
`;
}

function renderRealtimeAdminCliTest(): string {
  return `import { expect, test } from "bun:test";
import { runRealtimeAdmin } from "../src/realtime-admin";

test("uses an administrator bearer token and returns machine-readable metrics", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await runRealtimeAdmin(["metrics"], {
    QIY_REALTIME_ADMIN_URL: "https://admin.example/api/v1/realtime/outbox/",
    QIY_REALTIME_ADMIN_TOKEN: "secret-admin-token",
  }, async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({ pending: 2, leased: 1, deadLettered: 0, delivered: 5, oldestPendingAt: null });
  });
  expect(result).toEqual({ pending: 2, leased: 1, deadLettered: 0, delivered: 5, oldestPendingAt: null });
  expect(requests[0]?.url).toBe("https://admin.example/api/v1/realtime/outbox/metrics");
  expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer secret-admin-token");
});

test("routes replay and cleanup through authenticated audited HTTP endpoints", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ ok: true });
  };
  const environment = { QIY_REALTIME_ADMIN_TOKEN: "admin", PORT: "3100" };
  await runRealtimeAdmin(["replay", "00000000-0000-4000-8000-000000000001"], environment, fetcher);
  await runRealtimeAdmin(["cleanup", "30"], environment, fetcher);
  expect(requests[0]?.url).toBe("http://127.0.0.1:3100/api/v1/realtime/outbox/replay");
  expect(requests[0]?.init?.method).toBe("POST");
  expect(requests[0]?.init?.body).toBe('{"ids":["00000000-0000-4000-8000-000000000001"]}');
  expect(requests[1]?.url).toBe("http://127.0.0.1:3100/api/v1/realtime/outbox/delivered?retentionDays=30");
  expect(requests[1]?.init?.method).toBe("DELETE");
});

test("reads health JSON and Prometheus text through the same authenticated API", async () => {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    requests.push(String(input));
    if (String(input).endsWith("/metrics/prometheus")) return new Response("qiy_realtime_outbox_pending 2\\n", { headers: { "content-type": "text/plain; version=0.0.4" } });
    return Response.json({ status: "ok", alerts: [] });
  };
  const environment = { QIY_REALTIME_ADMIN_TOKEN: "admin" };
  expect(await runRealtimeAdmin(["health"], environment, fetcher)).toEqual({ status: "ok", alerts: [] });
  expect(await runRealtimeAdmin(["prometheus"], environment, fetcher)).toBe("qiy_realtime_outbox_pending 2\\n");
  expect(requests).toEqual([
    "http://127.0.0.1:3000/api/v1/realtime/outbox/health",
    "http://127.0.0.1:3000/api/v1/realtime/outbox/metrics/prometheus",
  ]);
});

test("fails closed without credentials or with ambiguous arguments", async () => {
  await expect(runRealtimeAdmin(["metrics"], {})).rejects.toThrow("QIY_REALTIME_ADMIN_TOKEN is required");
  await expect(runRealtimeAdmin(["replay", "same", "same"], { QIY_REALTIME_ADMIN_TOKEN: "admin" })).rejects.toThrow("unique event UUIDs");
  await expect(runRealtimeAdmin(["cleanup", "0"], { QIY_REALTIME_ADMIN_TOKEN: "admin" })).rejects.toThrow("between 1 and 3650");
});
`;
}

function dataflowCallAdapters(dataflows: NonNullable<QiyProject["dataflows"]>): string[] {
  return [...new Set(dataflows.flatMap((flow) => flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "call" ? [action.adapter] : [])))].sort();
}

function renderDataflowCallContracts(dataflows: NonNullable<QiyProject["dataflows"]>): string | undefined {
  const adapters = dataflowCallAdapters(dataflows);
  if (!adapters.length) return undefined;
  return `import { dataflowCallHandlers } from "../extensions/dataflow-calls";

export type DataflowCallName = ${adapters.map((adapter) => JSON.stringify(adapter)).join(" | ")};
export interface DataflowCallRequest {
  flow: string;
  actor: { id: string; role: string };
  payload: Record<string, unknown>;
}
export type DataflowCallResult = { ok: true } | { ok: false; error: string; errorKey?: string };
export type DataflowCallHandlers = Record<DataflowCallName, (request: DataflowCallRequest) => DataflowCallResult>;

export function invokeDataflowCall(name: DataflowCallName, request: DataflowCallRequest): DataflowCallResult {
  return dataflowCallHandlers[name](request);
}
`;
}

function renderDataflowCallExtensions(dataflows: NonNullable<QiyProject["dataflows"]>): string | undefined {
  const adapters = dataflowCallAdapters(dataflows);
  if (!adapters.length) return undefined;
  return `import type { DataflowCallHandlers } from "../dataflows/calls";

// This file is intentionally not owned by Qiy sync. Implement deterministic,
// synchronous local validation here. Async network calls and irreversible external
// side effects are forbidden inside the database transaction; write an outbox event
// with \`emit\` and deliver it after commit.
export const dataflowCallHandlers: DataflowCallHandlers = {
${adapters.map((adapter) => `  ${JSON.stringify(adapter)}: () => ({ ok: false, error: ${JSON.stringify(`Implement dataflow call adapter ${adapter}`)}, errorKey: "qiy.dataflow.call.notImplemented" }),`).join("\n")}
};
`;
}

function renderDataflowRoutes(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, scopes: NonNullable<QiyProject["scopes"]> = [], qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false, permissions?: QiyPermissionModel): string | undefined {
  if (!dataflows.length) return undefined;
  const usesPermissions = dataflows.some((flow) => flow.permission || flow.verification);
  if (usesPermissions && !permissions) throw new Error("Dataflow permission rules require permission declarations");
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const scopeFor = (entity: EntityIR) => scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  const synchronous = database.dialect === "sqlite";
  const selectOne = (query: string) => synchronous ? `${query}.get()` : `(await ${query})[0]`;
  const routeBlocks = dataflows.map((flow) => {
    const batchAction = qiyActions.find((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name);
    const createdBindings = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "create");
    const bindings = [
      ...flow.context.map((binding) => ({ name: binding.name, entity: binding.entity })),
      ...createdBindings.map((action) => ({ name: action.context, entity: action.entity })),
    ];
    const contextNames = new Map(bindings.map((binding, index) => [binding.name, `context${index}`]));
    const entityByBinding = new Map(bindings.map((binding) => [binding.name, binding.entity]));
    const scopedEntities = [...new Set(bindings.map((binding) => binding.entity))].flatMap((name) => {
      const entity = entities.get(name)!;
      const scope = scopeFor(entity);
      return scope ? [{ entity, scope }] : [];
    });
    const scopeVariables = new Map(scopedEntities.map(({ entity }, index) => [entity.name, `dataScope${index}`]));
    const scopeSetup = scopedEntities.map(({ scope }, index) => `      const dataScope${index} = principal?.claims?.[${JSON.stringify(scope.claim)}];
      if (dataScope${index} === undefined || dataScope${index} === null || dataScope${index} === "") return status(403, { error: "Missing required data scope claim: " + ${JSON.stringify(scope.claim)} });`).join("\n");
    const inputSchema = flow.input.map((field) => {
      const enumeration = database.enums?.find((item) => item.name === field.type);
      if (enumeration) {
        const schema = `t.Union([${enumeration.values.map((value) => `t.Literal(${JSON.stringify(value.name)})`).join(", ")}], ${JSON.stringify(field.comment ? { description: field.comment } : {})})`;
        return `${generatedDocumentation(field, "      ")}      ${JSON.stringify(field.name)}: ${field.required ? schema : `t.Optional(${schema})`},`;
      }
      const base = dataflowInputField(field.type);
      const described = field.comment ? (base.includes("({") ? base.replace("({", `({ description: ${JSON.stringify(field.comment)},`) : base.replace("()", `({ description: ${JSON.stringify(field.comment)} })`)) : base;
      return `${generatedDocumentation(field, "      ")}      ${JSON.stringify(field.name)}: ${field.required ? described : `t.Optional(${described})`},`;
    }).join("\n");
    const contextLoads = flow.context.map((binding, index) => {
      const entity = entities.get(binding.entity);
      if (!entity) throw new Error(`Dataflow ${flow.name}: unknown entity ${binding.entity}`);
      const [key, source] = binding.id.split(":", 2);
      const inputName = source?.replace(/^input\./, "");
      if (!key || !inputName) throw new Error(`Dataflow ${flow.name}: invalid context source ${binding.id}`);
      const scope = scopeFor(entity);
      const scopeVariable = scopeVariables.get(entity.name);
      const condition = scope
        ? `and(eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}]), eq(${entity.name}[${JSON.stringify(scope.field)}], String(${scopeVariable})))`
        : `eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}])`;
      return `${generatedDocumentation(binding, "        ")}        let context${index} = ${selectOne(`tx.select().from(${entity.name}).where(${condition}).limit(1)${synchronous ? "" : '.for("update")'}`)};\n        if (!context${index}) throw new DataflowFailure(404, "Not found", ${JSON.stringify(entity.tableName)});`;
    }).join("\n\n");
    const actionCode = flow.steps.flatMap((step) => step.actions).map((action, actionIndex) => {
      if (action.kind === "require") {
        const [binding, field] = action.left.split(".", 2);
        const variable = binding === "input" ? "body" : contextNames.get(binding!);
        if (!variable || !field) throw new Error(`Dataflow ${flow.name}: invalid requirement ${action.left}`);
        return `        if (!(${variable}[${JSON.stringify(field)}] ${action.operator} ${JSON.stringify(action.right)})) throw new DataflowFailure(409, ${JSON.stringify(action.error)}${action.errorKey ? `, undefined, ${JSON.stringify(action.errorKey)}` : ""});`;
      }
      if (action.kind === "update") {
        const entityName = entityByBinding.get(action.context);
        const entity = entityName ? entities.get(entityName) : undefined;
        const variable = contextNames.get(action.context);
        if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid update context ${action.context}`);
        const values = `{ ${action.values.map((value) => `${JSON.stringify(value.field)}: ${value.source === "input" ? `body[${JSON.stringify(value.value)}]` : JSON.stringify(value.value)}`).join(", ")} }`;
        const where = `eq(${entity.name}.id, ${variable}.id)`;
        const update = database.dialect === "sqlite"
          ? `const updated = tx.update(${entity.name}).set(${values}).where(${where}).returning().get();\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`
          : database.dialect === "mysql"
            ? `await tx.update(${entity.name}).set(${values}).where(${where});\n        const updated = (await tx.select().from(${entity.name}).where(${where}).limit(1))[0];\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`
            : `const updated = (await tx.update(${entity.name}).set(${values}).where(${where}).returning())[0];\n        if (!updated) return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} };\n        ${variable} = updated;`;
        return `        {\n        ${update.replaceAll(`return { kind: "not-found" as const, resource: ${JSON.stringify(entity.tableName)} }`, `throw new DataflowFailure(404, "Not found", ${JSON.stringify(entity.tableName)})`)}\n        }`;
      }
      if (action.kind === "create") {
        const entity = entities.get(action.entity);
        const variable = contextNames.get(action.context);
        if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid create context ${action.context}`);
        const scope = scopeFor(entity);
        const scopeVariable = scopeVariables.get(entity.name);
        const values = [
          `id: crypto.randomUUID()`,
          ...action.values.map((value) => `${JSON.stringify(value.field)}: ${value.source === "input" ? `body[${JSON.stringify(value.value)}]` : JSON.stringify(value.value)}`),
          ...(scope ? [`${JSON.stringify(scope.field)}: String(${scopeVariable})`] : []),
        ].join(", ");
        if (database.dialect === "sqlite") return `        let ${variable} = tx.insert(${entity.name}).values({ ${values} } as typeof ${entity.name}.$inferInsert).returning().get();\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
        if (database.dialect === "mysql") {
          const id = `created${actionIndex}Id`;
          const mysqlValues = values.replace("id: crypto.randomUUID()", `id: ${id}`);
          return `        const ${id} = crypto.randomUUID();\n        await tx.insert(${entity.name}).values({ ${mysqlValues} } as typeof ${entity.name}.$inferInsert);\n        let ${variable} = (await tx.select().from(${entity.name}).where(eq(${entity.name}.id, ${id})).limit(1))[0];\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
        }
        return `        let ${variable} = (await tx.insert(${entity.name}).values({ ${values} } as typeof ${entity.name}.$inferInsert).returning())[0];\n        if (!${variable}) throw new DataflowFailure(409, "Unable to create", ${JSON.stringify(entity.tableName)});`;
      }
      if (action.kind === "emit") {
        const payloadFields = (action.payload ?? []).map((value) => {
          if (value.source === "literal") return `${JSON.stringify(value.name)}: ${JSON.stringify(value.value)}`;
          if (value.source === "input") return `${JSON.stringify(value.name)}: body[${JSON.stringify(value.value)}]`;
          const variable = contextNames.get(value.context!);
          if (!variable) throw new Error(`Dataflow ${flow.name}: invalid emit context ${value.context}`);
          return `${JSON.stringify(value.name)}: ${variable}[${JSON.stringify(value.value)}]`;
        });
        const payload = `JSON.stringify({ flow: ${JSON.stringify(flow.name)}${payloadFields.length ? `, ${payloadFields.join(", ")}` : ""} })`;
        const insert = `tx.insert(dataflowOutbox).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, event: ${JSON.stringify(action.event)}, payload: ${payload}, createdAt: new Date() })`;
        const realtimeInsert = `tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: ${JSON.stringify(`qiy:event:${action.event}`)}, type: ${JSON.stringify(action.event)}, payload: ${payload}, attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() })`;
        return `        ${database.dialect === "sqlite" ? `${insert}.run();${realtimeEnabled ? `\n        ${realtimeInsert}.run();` : ""}` : `await ${insert};${realtimeEnabled ? `\n        await ${realtimeInsert};` : ""}`}`;
      }
      if (action.kind === "call") {
        const payloadFields = (action.payload ?? []).map((value) => {
          if (value.source === "literal") return `${JSON.stringify(value.name)}: ${JSON.stringify(value.value)}`;
          if (value.source === "input") return `${JSON.stringify(value.name)}: body[${JSON.stringify(value.value)}]`;
          const variable = contextNames.get(value.context!);
          if (!variable) throw new Error(`Dataflow ${flow.name}: invalid call context ${value.context}`);
          return `${JSON.stringify(value.name)}: ${variable}[${JSON.stringify(value.value)}]`;
        });
        return `        {
          const callResult = invokeDataflowCall(${JSON.stringify(action.adapter)}, { flow: ${JSON.stringify(flow.name)}, actor: { id: principal.id, role: principal.role }, payload: { ${payloadFields.join(", ")} } });
          if (!callResult.ok) throw new DataflowFailure(409, callResult.error, undefined, callResult.errorKey);
        }`;
      }
      const entityName = entityByBinding.get(action.context);
      const entity = entityName ? entities.get(entityName) : undefined;
      const variable = contextNames.get(action.context);
      if (!entity || !variable) throw new Error(`Dataflow ${flow.name}: invalid delete context ${action.context}`);
      const deletion = database.dialect === "sqlite"
        ? `tx.delete(${entity.name}).where(eq(${entity.name}.id, ${variable}.id)).run();`
        : `await tx.delete(${entity.name}).where(eq(${entity.name}.id, ${variable}.id));`;
      return `        ${deletion}`;
    });
    let actionOffset = 0;
    const actions = flow.steps.map((step) => {
      const code = actionCode.slice(actionOffset, actionOffset + step.actions.length).join("\n");
      actionOffset += step.actions.length;
      return generatedDocumentation(step, "        ") + code;
    }).join("\n");
    const result = contextNames.get(flow.result);
    if (!result) throw new Error(`Dataflow ${flow.name}: missing result context ${flow.result}`);
    const resultEntityName = entityByBinding.get(flow.result);
    const resultEntity = resultEntityName ? entities.get(resultEntityName) : undefined;
    if (!resultEntity) throw new Error(`Dataflow ${flow.name}: missing result entity ${flow.result}`);
    const needsIdempotency = flow.idempotency?.required === true;
    const requestSetup = needsIdempotency ? `      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\\x21-\\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([${[...flow.input.map((field) => `body[${JSON.stringify(field.name)}]`), ...scopeVariables.values()].join(", ")} ]));
` : "";
    const transactionReplay = needsIdempotency ? `        const previous = ${selectOne(`tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1)`)};
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };
` : "";
    const auditWrite = flow.audit === undefined ? "" : `        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: ${JSON.stringify(flow.audit)}, resource: ${JSON.stringify(resultEntity.tableName)}, resourceId: String(value.id), metadata: ${database.dialect === "sqlite" ? 'JSON.stringify({ flow: ' + JSON.stringify(flow.name) + ' })' : '{ flow: ' + JSON.stringify(flow.name) + ' }'}, createdAt: ${database.dialect === "sqlite" || database.dialect === "postgresql" ? "new Date()" : "Date.now()"} });
`;
    const receiptWrite = needsIdempotency ? `        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(flow.name)}, requestKeyHash, requestHash, response: JSON.stringify(value) });
` : "";
    const catchReplay = needsIdempotency ? `      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
` : "      } catch (error) { if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) }); throw error; }\n";
    const permissionSetup = flow.permission || flow.verification ? "      const permissionSnapshot = await loadPermissions(principal);\n" : "";
    const declaredVerification = flow.verification ? permissions?.verifications.find((candidate) => candidate.name === flow.verification) : undefined;
    const verificationInputs = declaredVerification
      ? `{ ${declaredVerification.inputs.map((input) => `${JSON.stringify(input.name)}: ${input.type === "Text" ? `String(body[${JSON.stringify(input.name)}])` : `[String(body[${JSON.stringify(input.name)}])]`}`).join(", ")} }`
      : "{}";
    const authorizationCheck = flow.permission
      ? `${permissionSetup}      const requiredPermissions = ${JSON.stringify(requiredPermissionValues(permissions!, flow.permission))};
      const missingPermissions = requiredPermissions.filter((permission) => !permissionSnapshot.permissions.includes(permission));
      if (missingPermissions.length > 0) return status(403, { error: "Missing required permissions: " + missingPermissions.join(", "), errorKey: "command.forbidden", missing: missingPermissions });`
      : flow.verification
        ? `${permissionSetup}      const permissionVerdict = evaluatePermissionVerification(${JSON.stringify(flow.verification)}, { ...permissionSnapshot, role: principal.role }, ${verificationInputs});
      if (!permissionVerdict.found) return status(403, { error: "Unknown permission verification ${flow.verification}" });
      if ("error" in permissionVerdict) return status(400, { error: permissionVerdict.error });
      if (!permissionVerdict.allowed) return status(403, { error: "Permission verification ${flow.verification} denied this command", errorKey: "command.forbidden", ...(permissionVerdict.missing.length ? { missing: permissionVerdict.missing } : {}) });`
        : `      if (!${JSON.stringify(flow.roles ?? ["admin", "operator"])}.includes(principal.role)) return status(403, { error: "Command execution is restricted" });`;
    const singleRoute = `${generatedDocumentation(flow, "    ")}    .post(${JSON.stringify(`/${flow.name}`)}, async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
${authorizationCheck}
${scopeSetup ? `${scopeSetup}\n` : ""}${requestSetup}      let outcome;
      try {
      outcome = await db.transaction(${synchronous ? "" : "async "}(tx) => {
${transactionReplay}
${contextLoads}

${actions}

        const value = ${result};
${synchronous ? auditWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n") : auditWrite}${synchronous ? receiptWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n") : receiptWrite}        return { kind: "ok" as const, value };
      });
${catchReplay}${needsIdempotency ? `      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });
` : ""}
      return outcome.value;
    }, { body: t.Object({
${inputSchema}
    }, { additionalProperties: false }), detail: { summary: ${JSON.stringify(flow.label ?? flow.name)}, description: ${JSON.stringify(flow.comment ?? flow.label ?? flow.name)}, tags: ["Dataflow"] } })`;
    if (!batchAction) return singleRoute;
    if (!needsIdempotency) throw new Error(`Batch action ${batchAction.name}: dataflow ${flow.name} must require idempotency`);
    const batchEntity = database.entities.find((entity) => entity.tableName === batchAction.resource || entity.name === batchAction.resource);
    const batchBinding = batchEntity ? flow.context.find((binding) => binding.entity === batchEntity.name) : undefined;
    const batchIdInput = batchBinding?.id.split(":", 2)[1]?.replace(/^input\./, "");
    if (!batchEntity || !batchBinding || !batchIdInput) throw new Error(`Batch action ${batchAction.name}: cannot resolve resource id input`);
    const batchFlowName = `${flow.name}:batch`;
    const batchTransactionReplay = `        const previous = ${selectOne(`tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(batchFlowName)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1)`)};
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };
`;
    const batchAuditWrite = synchronous
      ? auditWrite.replace("await tx.insert", "tx.insert").replace(" });\n", " }).run();\n")
      : auditWrite;
    const batchReceiptWrite = synchronous
      ? `        tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(batchFlowName)}, requestKeyHash, requestHash, response: JSON.stringify(values) }).run();\n`
      : `        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(batchFlowName)}, requestKeyHash, requestHash, response: JSON.stringify(values) });\n`;
    const batchTopCheck = flow.verification
      ? `${permissionSetup}`
      : authorizationCheck;
    const batchVerificationCheck = flow.verification
      ? `                const batchPermissionVerdict = evaluatePermissionVerification(${JSON.stringify(flow.verification)}, { ...permissionSnapshot, role: principal.role }, ${verificationInputs});
                if (!batchPermissionVerdict.found || "error" in batchPermissionVerdict || !batchPermissionVerdict.allowed) throw new BatchDataflowFailure(403, "Permission verification ${flow.verification} denied this command", itemIndex, String(body[${JSON.stringify(batchIdInput)}]), undefined, "command.forbidden");
`
      : "";
    const batchRoute = `
    .post(${JSON.stringify(`/${flow.name}/batch`)}, async ({ body: batch, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
${batchTopCheck}
${scopeSetup ? `${scopeSetup}\n` : ""}      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\\x21-\\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const itemIds = batch.items.map((item) => String(item[${JSON.stringify(batchIdInput)}]));
      if (new Set(itemIds).size !== itemIds.length) return status(400, { error: "Batch item identifiers must be unique" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([batch.items, ${[...scopeVariables.values()].join(", ")} ]));
      let outcome;
      try {
        outcome = await db.transaction(${synchronous ? "" : "async "}(tx) => {
${batchTransactionReplay}          const values = [];
          for (let itemIndex = 0; itemIndex < batch.items.length; itemIndex += 1) {
            const body = batch.items[itemIndex]!;
            try {
${batchVerificationCheck}${contextLoads}

${actions}

              const value = ${result};
${batchAuditWrite}              values.push(value);
            } catch (error) {
              if (error instanceof DataflowFailure) throw new BatchDataflowFailure(error.status, error.message, itemIndex, String(body[${JSON.stringify(batchIdInput)}]), error.resource, error.errorKey);
              throw error;
            }
          }
${batchReceiptWrite}          return { kind: "ok" as const, value: values };
        });
      } catch (error) {
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal.id), eq(dataflowIdempotency.flow, ${JSON.stringify(batchFlowName)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        if (error instanceof BatchDataflowFailure) return status(error.status, { error: error.message, item: { index: error.index, id: error.id }, ...(error.resource ? { resource: error.resource } : {}), ...(error.errorKey ? { errorKey: error.errorKey } : {}) });
        throw error;
      }
      if (outcome.kind === "replay") return outcome.value;
      if (outcome.kind === "key-conflict") return status(409, { error: "Idempotency key was already used with a different request" });
      return outcome.value;
    }, { body: t.Object({ items: t.Array(t.Object({
${inputSchema}
    }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }), detail: { summary: ${JSON.stringify(`Batch ${flow.label ?? flow.name}`)}, description: ${JSON.stringify(`Atomically execute ${flow.comment ?? flow.label ?? flow.name} for a selected collection`)}, tags: ["Dataflow"] } })`;
    return singleRoute + batchRoute;
  }).join("\n");
  const usesIdempotency = dataflows.some((flow) => flow.idempotency?.required);
  const usesAudit = dataflows.some((flow) => flow.audit !== undefined);
  const usesOutbox = dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit")));
  const usesRealtimeOutbox = realtimeEnabled && usesOutbox;
  const usesCalls = dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "call")));
  const dataflowEntities = dataflows.flatMap((flow) => [
    ...flow.context.map((binding) => binding.entity),
    ...flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "create" ? [action.entity] : []),
  ]);
  return `import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
 import { ${[...new Set([...dataflowEntities, ...(usesIdempotency ? ["dataflowIdempotency"] : []), ...(usesAudit ? ["auditEvents"] : []), ...(usesOutbox ? ["dataflowOutbox"] : []), ...(usesRealtimeOutbox ? ["realtimeOutbox"] : [])])].join(", ")} } from "../schema";
import type { Authenticator } from "../auth/guard";
${usesPermissions ? 'import { evaluatePermissionVerification, loadPermissions } from "../auth/permissions";\n' : ""}
${usesCalls ? 'import { invokeDataflowCall } from "./calls";\n' : ""}

class DataflowFailure extends Error {
  constructor(public readonly status: 403 | 404 | 409, message: string, public readonly resource?: string, public readonly errorKey?: string) { super(message); }
}

class BatchDataflowFailure extends DataflowFailure {
  constructor(status: 403 | 404 | 409, message: string, public readonly index: number, public readonly id: string, resource?: string, errorKey?: string) { super(status, message, resource, errorKey); }
}

${usesIdempotency ? `async function hashDataflowValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}` : ""}

export function createDataflowRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/commands" })
${routeBlocks};
}
`;
}

function sqliteColumnType(field: FieldIR): string {
  switch (field.type) {
    case "Integer": return "integer";
    case "Decimal":
    case "Money": return "real";
    case "DateTime": return "integer";
    case "Vector": return "blob";
    default: return "text";
  }
}

function renderSqliteRealtimeOutboxTest(database: DatabaseIR, realtime: NonNullable<QiyProject["realtime"]>): string | undefined {
  if (database.dialect !== "sqlite") return undefined;
  const subscription = realtime.resources[0];
  const entity = database.entities.find((candidate) => candidate.name === subscription?.resource || candidate.tableName === subscription?.resource);
  if (!entity) return undefined;
  const columns = entity.fields.map((field) => `${JSON.stringify(field.columnName ?? field.name)} ${sqliteColumnType(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
  const fixture = (variant: 1 | 2) => entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => {
    const enumeration = database.enums?.find((item) => item.name === field.enumName);
    const value = enumeration ? JSON.stringify(enumeration.values[Math.min(variant - 1, enumeration.values.length - 1)]!.name)
      : field.type === "UUID" ? JSON.stringify(`00000000-0000-4000-8000-00000000000${variant}`)
        : field.type === "Integer" ? String(variant)
          : field.type === "Decimal" || field.type === "Money" ? String(variant)
            : field.type === "DateTime" ? `new Date(${variant})`
              : field.type === "Date" ? JSON.stringify(`2026-11-${String(27 + variant).padStart(2, "0")}`)
                : field.type === "Time" ? JSON.stringify(`0${variant}:30:00`)
                  : JSON.stringify(`Realtime fixture ${variant}`);
    return `${JSON.stringify(field.name)}: ${value}`;
  }).join(", ");
  const repositoryName = `${modelName(entity)}Repository`;
  return `import { expect, test } from "bun:test";
import { client } from "../src/db";
import { ${repositoryName} } from "../src/modules/${entity.name}/${entity.name}.repository";

test("commits CRUD records and realtime outbox rows atomically", async () => {
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS audit_events; DROP TABLE IF EXISTS qiy_realtime_outbox; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null); CREATE TABLE qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null);`)});
  const first = await ${repositoryName}.create({ ${fixture(1)} }, "actor-1");
  expect(first.id).toBeTruthy();
  expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(1);
  expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox").get()).toEqual({ channel: ${JSON.stringify(`qiy:${entity.tableName}`)}, type: "created" });
  client.exec("DROP TABLE qiy_realtime_outbox");
  await expect(${repositoryName}.create({ ${fixture(2)} }, "actor-2")).rejects.toThrow();
  expect(client.query<{ total: number }, []>(${JSON.stringify(`select count(*) as total from "${entity.tableName}"`)}).get()?.total).toBe(1);
  expect(client.query<{ total: number }, []>("select count(*) as total from audit_events").get()?.total).toBe(1);
});
`;
}

function dataflowFixtureValue(field: FieldIR, requires: Array<{ field: string; operator: "==" | "!=" | ">" | ">=" | "<" | "<="; right: string | number }>, enums: DatabaseIR["enums"]): string {
  const requirement = requires.find((item) => item.field === field.name);
  const enumeration = enums?.find((item) => item.name === field.enumName);
  if (field.type === "Integer" && requirement) {
    const rules = requires.filter((item) => item.field === field.name && typeof item.right === "number");
    const candidates = [7, 1, 0, -2147483648, 2147483647, ...rules.flatMap((rule) => [Number(rule.right), Number(rule.right) + 1, Number(rule.right) - 1])];
    const value = candidates.find((candidate) => candidate >= -2147483648 && candidate <= 2147483647 && rules.every((rule) => {
      const bound = Number(rule.right);
      switch (rule.operator) {
        case "==": return candidate === bound;
        case "!=": return candidate !== bound;
        case ">": return candidate > bound;
        case ">=": return candidate >= bound;
        case "<": return candidate < bound;
        case "<=": return candidate <= bound;
      }
    }));
    if (value === undefined) throw new Error(`Cannot infer a successful Dataflow test fixture for Integer field ${field.name}: contradictory requirements`);
    return JSON.stringify(value);
  }
  if (enumeration) return JSON.stringify(requirement?.operator === "==" ? requirement.right : enumeration.values.find((value) => value.name !== requirement?.right)?.name ?? enumeration.values[0]!.name);
  if (requirement) return JSON.stringify(requirement.operator === "==" ? requirement.right : `${requirement.right}-before`);
  if (field.primaryKey || field.type === "UUID") return '"00000000-0000-4000-8000-000000000001"';
  if (field.enumName || field.type === "Text" || field.type === "File") return '"Qiy fixture"';
  if (field.type === "Files") return '["uploads/sample.pdf"]';
  if (field.type === "Integer") return "1";
  if (field.type === "Decimal" || field.type === "Money") return "1";
  if (field.type === "DateTime") return "new Date(0)";
  if (field.type === "Date") return '"2026-11-30"';
  if (field.type === "Time") return '"08:30:00"';
  return "null";
}

function renderSqliteDataflowTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false, permissions?: QiyPermissionModel): string | undefined {
  if (database.dialect !== "sqlite" || !dataflows.length) return undefined;
  // Command authorization may be role-, permission- or verification-based. The
  // generated happy-path actor holds every declared permission so the fixture
  // input only has to satisfy the business rules, not the authorization model.
  const permissionPrincipal = permissions && !isPermissionModelEmpty(permissions)
    ? `, permissions: ${JSON.stringify(declaredPermissionValues(permissions))}, groups: ${JSON.stringify(permissions.groups.map((group) => group.name))}`
    : "";
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const callAdapters = dataflowCallAdapters(dataflows);
  const usedEntities = [...new Set(dataflows.flatMap((flow) => [
    ...flow.context.map((binding) => binding.entity),
    ...flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "create" ? [action.entity] : []),
  ]))].map((name) => entities.get(name)!);
  const imports = usedEntities.map((entity) => entity.name).join(", ");
  const schema = usedEntities.map((entity) => {
    const columns = entity.fields.map((field) => `${JSON.stringify(field.columnName ?? field.name)} ${sqliteColumnType(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    return `client.exec(${JSON.stringify(`CREATE TABLE IF NOT EXISTS ${entity.tableName} (${columns})`)});`;
  }).join("\n");
  const auxiliarySchema = [
    `client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");`,
    ...(dataflows.some((flow) => flow.idempotency?.required) ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");`] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_outbox (id text primary key, actorId text, event text not null, payload text not null, createdAt integer not null)");`] : []),
    ...(realtimeEnabled && dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? [`client.exec("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null)");`] : []),
  ].join("\n");
  const cleanup = [
    ...usedEntities.map((entity) => `client.exec(${JSON.stringify(`DELETE FROM ${entity.tableName}`)});`),
    "client.exec('DELETE FROM audit_events');",
    ...(dataflows.some((flow) => flow.idempotency?.required) ? ["client.exec('DELETE FROM dataflow_idempotency');"] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["client.exec('DELETE FROM dataflow_outbox');"] : []),
    ...(realtimeEnabled && dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["client.exec('DELETE FROM qiy_realtime_outbox');"] : []),
  ].join("\n");
  const tests = dataflows.map((flow) => {
    const input = Object.fromEntries(flow.input.map((field) => [field.name, database.enums?.find((item) => item.name === field.type)?.values.at(-1)?.name ?? (field.type === "UUID" ? "00000000-0000-4000-8000-000000000001" : field.type === "Text" ? "Qiy fixture reason" : field.type === "Integer" ? 7 : field.type === "Boolean" ? true : "1.00")]));
    for (const field of flow.input) {
      const requires = flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "require" && action.left === `input.${field.name}` ? [{ field: field.name, operator: action.operator, right: action.right }] : []);
      if (requires.length) input[field.name] = JSON.parse(dataflowFixtureValue({ name: field.name, type: field.type === "Integer" ? "Integer" : "Text", ...(database.enums?.some((item) => item.name === field.type) ? { enumName: field.type } : {}) }, requires, database.enums));
    }
    const seed = flow.context.map((binding) => {
      const entity = entities.get(binding.entity)!;
      const written = new Set<string>();
      const requires = flow.steps.flatMap((step) => step.actions).flatMap((action) => {
        if (action.kind === "update" && action.context === binding.name) action.values.forEach((value) => written.add(value.field));
        return action.kind === "require" && action.left.startsWith(`${binding.name}.`) && !written.has(action.left.slice(binding.name.length + 1)) ? [{ field: action.left.slice(binding.name.length + 1), operator: action.operator, right: action.right }] : [];
      });
      const values = entity.fields.map((field) => `${JSON.stringify(field.name)}: ${dataflowFixtureValue(field, requires, database.enums)}`).join(", ");
      return `await db.insert(${entity.name}).values({ ${values} } as any);`;
    }).join("\n    ");
    const flowActions = flow.steps.flatMap((step) => step.actions);
    const resultWrites = flowActions.flatMap((action) => (action.kind === "update" || action.kind === "create") && action.context === flow.result ? action.values : []);
    const finalWrites = new Map(resultWrites.map((write) => [write.field, write]));
    const assertions = [...finalWrites.values()].map((update) => `expect(result).toMatchObject({ ${JSON.stringify(update.field)}: ${JSON.stringify(update.source === "input" ? input[update.value] : update.value)} });`).join("\n    ");
    const resultCreateEntity = flowActions.flatMap((action) => action.kind === "create" && action.context === flow.result ? [action.entity] : []).at(0);
    const resultDeleted = flowActions.some((action) => action.kind === "delete" && action.context === flow.result);
    const resultEntityName = flow.context.find((binding) => binding.name === flow.result)?.entity ?? resultCreateEntity;
    const resultMutationCheck = resultCreateEntity && !resultDeleted
      ? `\n    expect(client.query("SELECT * FROM ${entities.get(resultCreateEntity)!.tableName} WHERE id = ?").get(result.id)).toBeTruthy();`
      : resultDeleted
        ? `\n    expect(client.query("SELECT * FROM ${entities.get(resultEntityName!)!.tableName} WHERE id = ?").get(result.id)).toBeNull();`
        : "";
    const headers = flow.idempotency?.required ? `{ "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }` : `{ "Content-Type": "application/json" }`;
    const missingKeyCheck = flow.idempotency?.required ? `    const missingKey = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missingKey.status).toBe(400);` : "";
    const changedInput = flow.input.find((field) => field.type !== "UUID" && (database.enums?.find((item) => item.name === field.type)?.values.length ?? 2) > 1) ?? flow.input[0];
    const changedEnum = database.enums?.find((item) => item.name === changedInput?.type);
    const changedValue = changedEnum ? changedEnum.values.find((value) => value.name !== input[changedInput!.name])?.name : changedInput?.type === "UUID" ? "00000000-0000-4000-8000-000000000099" : changedInput?.type === "Boolean" ? false : changedInput?.type === "Integer" ? 2 : changedInput?.type === "Decimal" ? "2.00" : "different value";
    const graphqlName = dataflowGraphqlName(flow.name);
    const graphqlOperation = `run${graphqlName}`;
    const graphqlDeclarations = [flow.input.length ? `$input: ${graphqlName}CommandInput!` : undefined, flow.idempotency?.required ? "$key: String!" : undefined].filter((value): value is string => Boolean(value));
    const graphqlArguments = [flow.input.length ? "input: $input" : undefined, flow.idempotency?.required ? "idempotencyKey: $key" : undefined].filter((value): value is string => Boolean(value));
    const graphqlQuery = `mutation${graphqlDeclarations.length ? `(${graphqlDeclarations.join(", ")})` : ""} { ${graphqlOperation}${graphqlArguments.length ? `(${graphqlArguments.join(", ")})` : ""} { id } }`;
    const graphqlVariables = { ...(flow.input.length ? { input } : {}), ...(flow.idempotency?.required ? { key: `graphql-${flow.name}-key` } : {}) };
    const graphqlCommandTest = `
  test(${JSON.stringify(`${flow.name} executes through GraphQL with REST-equivalent idempotency`)}, async () => {
    ${seed}
    const request = (variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? "admin")} }, body: JSON.stringify({ query: ${JSON.stringify(graphqlQuery)}, variables }) });
    const response = await graphqlApp.handle(request(${JSON.stringify(graphqlVariables)}));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data?: Record<string, { id: string }>; errors?: Array<{ message: string; extensions?: { status?: number; errorKey?: string } }> };
    expect(payload.errors).toBeUndefined();
    expect(payload.data?.[${JSON.stringify(graphqlOperation)}]?.id).toBeTruthy();
    ${flow.idempotency?.required ? `const replay = await graphqlApp.handle(request(${JSON.stringify(graphqlVariables)}));
    expect(await replay.json()).toEqual(payload);` : ""}
    ${flow.idempotency?.required && changedInput ? `const conflict = await graphqlApp.handle(request({ ...${JSON.stringify(graphqlVariables)}, input: { ...${JSON.stringify(input)}, ${JSON.stringify(changedInput.name)}: ${JSON.stringify(changedValue)} } }));
    const conflictPayload = await conflict.json() as { errors?: Array<{ extensions?: { status?: number } }> };
    expect(conflictPayload.errors?.[0]?.extensions?.status).toBe(409);` : ""}
  });`;
    const replayCheck = flow.idempotency?.required ? `
    const replay = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    ${changedInput ? `const changedPayload = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(changedInput.name)}: ${JSON.stringify(changedValue)} }) }));
    expect(changedPayload.status).toBe(409);` : ""}` : "";
    const auditCheck = flow.audit !== undefined ? `
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get(${JSON.stringify(flow.audit)})?.total).toBe(1);` : "";
    const emittedEvents = flow.steps.flatMap((step) => step.actions).filter((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "emit" }> => action.kind === "emit");
    const outboxCheck = emittedEvents.length ? `
    expect(client.query<{ total: number }, []>("select count(*) as total from dataflow_outbox").get()?.total).toBe(${emittedEvents.length});
    expect(client.query<{ event: string }, []>("select event from dataflow_outbox limit 1").get()?.event).toBe(${JSON.stringify(emittedEvents[0]!.event)});` : "";
    const realtimeOutboxCheck = realtimeEnabled && emittedEvents.length ? `
    expect(client.query<{ total: number }, []>("select count(*) as total from qiy_realtime_outbox").get()?.total).toBe(${emittedEvents.length});
    expect(client.query<{ channel: string; type: string }, []>("select channel, type from qiy_realtime_outbox limit 1").get()).toEqual({ channel: ${JSON.stringify(`qiy:event:${emittedEvents[0]!.event}`)}, type: ${JSON.stringify(emittedEvents[0]!.event)} });` : "";
    const firstCall = flow.steps.flatMap((step) => step.actions).find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "call" }> => action.kind === "call");
    const callRollbackTest = firstCall ? `
  test(${JSON.stringify(`${flow.name} rolls back when call adapter ${firstCall.adapter} rejects`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const previous = dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}];
    dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}] = () => ({ ok: false, error: "Adapter rejected", errorKey: "adapter.rejected" });
    try {
      const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(rejected.status).toBe(409);
      expect(await rejected.json()).toMatchObject({ error: "Adapter rejected", errorKey: "adapter.rejected" });
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    } finally { dataflowCallHandlers[${JSON.stringify(firstCall.adapter)}] = previous; }
  });` : "";
    const hasMutations = flow.steps.some((step) => step.actions.some((action) => action.kind === "update" || action.kind === "create" || action.kind === "delete" || action.kind === "emit"));
    const deniedRoles = flow.roles
      ? ["viewer", ...["admin", "operator"].filter((role) => !flow.roles!.includes(role as "admin" | "operator"))]
      : ["viewer"];
    const authorizationTest = `
  test(${JSON.stringify(`${flow.name} rejects unauthenticated and disallowed roles before writing`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    for (const role of [null, ...${JSON.stringify(deniedRoles)}] as const) {
      const deniedApp = new Elysia().use(createDataflowRoutes(async () => role === null ? null : ({ id: "00000000-0000-4000-8000-000000000010", name: "Denied", role })));
      const denied = await deniedApp.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(denied.status).toBe(role === null ? 401 : 403);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    }
  });`;
    const businessRollbackTest = hasMutations ? `
  test(${JSON.stringify(`${flow.name} rolls back earlier writes when a later requirement fails`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: ${JSON.stringify(flow.roles?.[0] ?? "admin")}${permissionPrincipal} })));
    const failed = await failureApp.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    ${realtimeEnabled && emittedEvents.length ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM qiy_realtime_outbox").get()?.total).toBe(0);' : ""}
  });` : "";
    const rollbackTests = [flow.audit !== undefined ? "audit_events" : undefined, flow.idempotency?.required ? "dataflow_idempotency" : undefined].filter((table): table is string => Boolean(table)).map((table) => `
  test(${JSON.stringify(`${flow.name} rolls back when ${table} insertion fails and allows retry`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    client.exec(${JSON.stringify(`CREATE TRIGGER qiy_fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'forced failure'); END`)});
    try {
      const failed = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
      expect(failed.status).toBe(500);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    } finally { client.exec("DROP TRIGGER qiy_fail_insert"); }
    const retry = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(retry.status).toBe(200);
  });`).join("\n");
    const inputValidationTests = flow.input.filter((field) => field.type === "Integer" || database.enums?.some((enumeration) => enumeration.name === field.type)).map((field) => `
  test(${JSON.stringify(`${flow.name} rejects invalid ${field.type} input ${field.name} without writes`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    for (const invalid of ${JSON.stringify(field.type === "Integer" ? [-2147483649, 2147483648, 1.5, "invalid", null] : ["qiy-undeclared-enum-value", 7, null, {}])}) {
      const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(field.name)}: invalid }) }));
      expect(rejected.status).toBe(422);
      expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
      expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
      ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    }
  });`).join("\n");
    const numericGuardTests = flow.steps.flatMap((step) => step.actions).flatMap((action, index) => {
      if (action.kind !== "require" || !action.left.startsWith("input.") || typeof action.right !== "number") return [];
      const invalid = action.operator === ">" || action.operator === "<" || action.operator === "!=" ? action.right : action.operator === ">=" ? action.right - 1 : action.operator === "<=" ? action.right + 1 : action.right === 2147483647 ? action.right - 1 : action.right + 1;
      if (invalid < -2147483648 || invalid > 2147483647) return [];
      const field = action.left.slice("input.".length);
      return [`
  test(${JSON.stringify(`${flow.name} rejects numeric business rule ${index} without writes or receipts`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const rejected = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(field)}: ${invalid} }) }));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject(${JSON.stringify({ error: action.error, ...(action.errorKey ? { errorKey: action.errorKey } : {}) })});
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    ${action.errorKey ? `const graphFailure = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? "admin")} }, body: JSON.stringify({ query: ${JSON.stringify(graphqlQuery)}, variables: { ...${JSON.stringify(graphqlVariables)}, input: { ...${JSON.stringify(input)}, ${JSON.stringify(field)}: ${invalid} } } }) }));
    const graphFailurePayload = await graphFailure.json() as { errors?: Array<{ extensions?: { status?: number; errorKey?: string } }> };
    expect(graphFailurePayload.errors?.[0]?.extensions).toMatchObject(${JSON.stringify({ status: 409, errorKey: action.errorKey })});` : ""}
    const retry = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(retry.status).toBe(200);
  });`];
    }).join("\n");
    const batchAction = qiyActions.find((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name);
    const batchBinding = batchAction ? flow.context.find((binding) => entities.get(binding.entity)?.tableName === batchAction.resource) : undefined;
    const batchEntity = batchBinding ? entities.get(batchBinding.entity) : undefined;
    const batchIdInput = batchBinding?.id.split(":", 2)[1]?.replace(/^input\./, "");
    const batchRequirement = batchBinding ? flow.steps.flatMap((step) => step.actions).find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "require" }> => action.kind === "require" && action.left.startsWith(`${batchBinding.name}.`)) : undefined;
    const batchRequirementField = batchRequirement && batchEntity ? batchEntity.fields.find((field) => field.name === batchRequirement.left.slice(batchRequirement.left.indexOf(".") + 1)) : undefined;
    let batchFailureSetup = "";
    let batchFailureReset = "";
    if (batchEntity && batchRequirement && batchRequirementField) {
      const fieldRequirements = [{ field: batchRequirementField.name, operator: batchRequirement.operator, right: batchRequirement.right }];
      const valid = dataflowFixtureValue(batchRequirementField, fieldRequirements, database.enums);
      const invalid = typeof batchRequirement.right === "number"
        ? batchRequirement.operator === ">" ? batchRequirement.right : batchRequirement.operator === ">=" ? batchRequirement.right - 1 : batchRequirement.operator === "<" ? batchRequirement.right : batchRequirement.operator === "<=" ? batchRequirement.right + 1 : batchRequirement.operator === "==" ? batchRequirement.right + 1 : batchRequirement.right
        : batchRequirement.operator === "==" ? "__qiy_batch_invalid__" : batchRequirement.right;
      batchFailureSetup = `    client.query(${JSON.stringify(`UPDATE ${batchEntity.tableName} SET ${batchRequirementField.columnName ?? batchRequirementField.name} = ? WHERE id = ?`)}).run(${JSON.stringify(invalid)}, "00000000-0000-4000-8000-000000000002");\n`;
      batchFailureReset = `    client.query(${JSON.stringify(`UPDATE ${batchEntity.tableName} SET ${batchRequirementField.columnName ?? batchRequirementField.name} = ? WHERE id = ?`)}).run(${valid}, "00000000-0000-4000-8000-000000000002");\n`;
    }
    const batchTest = batchAction && batchBinding && batchEntity && batchIdInput ? `
  test(${JSON.stringify(`${flow.name} batch executes atomically with one persistent idempotency receipt`)}, async () => {
    ${seed}
    ${seed.replaceAll("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002")}
${batchFailureSetup}    const items = [
      { ...${JSON.stringify(input)}, ${JSON.stringify(batchIdInput)}: "00000000-0000-4000-8000-000000000001" },
      { ...${JSON.stringify(input)}, ${JSON.stringify(batchIdInput)}: "00000000-0000-4000-8000-000000000002" },
    ];
    const headers = { "Content-Type": "application/json", "Idempotency-Key": ${JSON.stringify(`batch-${flow.name}-key`)} };
    const request = (body: unknown, requestHeaders = headers) => app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}/batch`)}, { method: "POST", headers: requestHeaders, body: JSON.stringify(body) }));
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table + " ORDER BY id").all());
    ${batchFailureSetup ? `const failed = await request({ items });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ item: { index: 1, id: "00000000-0000-4000-8000-000000000002" } });
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table + " ORDER BY id").all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);
${batchFailureReset}` : ""}    const graphResponse = await graphqlApp.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json", "X-Test-Role": ${JSON.stringify(flow.roles?.[0] ?? "admin")} }, body: JSON.stringify({ query: ${JSON.stringify(`mutation($items: [${graphqlName}CommandInput!]!, $key: String!) { ${graphqlOperation}Batch(items: $items, idempotencyKey: $key) { id } }`)}, variables: { items, key: ${JSON.stringify(`batch-${flow.name}-key`)} } }) }));
    expect(graphResponse.status).toBe(200);
    const graphPayload = await graphResponse.json() as { data?: { ${graphqlOperation}Batch?: Array<{ id: unknown }> }; errors?: unknown[] };
    expect(graphPayload.errors).toBeUndefined();
    const result = graphPayload.data?.${graphqlOperation}Batch ?? [];
    expect(result).toHaveLength(2);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency WHERE flow = '" + ${JSON.stringify(`${flow.name}:batch`)} + "'").get()?.total).toBe(1);
    const replay = await request({ items });
    expect(replay.status).toBe(200);
    const replayResult = await replay.json() as Array<Record<string, unknown>>;
    expect(replayResult.map((record) => ({ id: record.id }))).toEqual(result);
    const conflict = await request({ items: [...items].reverse() });
    expect(conflict.status).toBe(409);
    const duplicate = await request({ items: [items[0], items[0]] }, { "Content-Type": "application/json", "Idempotency-Key": ${JSON.stringify(`batch-${flow.name}-duplicate`)} });
    expect(duplicate.status).toBe(400);
  });` : "";
    return `test(${JSON.stringify(flow.idempotency?.required ? "replays a successful command without a second audit event" : `${flow.name} returns not-found and commits its supported update`)}, async () => {
${missingKeyCheck}
    ${flow.context.length ? `const missing = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missing.status).toBe(404);` : ""}
    ${seed}
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    ${assertions || "expect(result).toHaveProperty(\"id\");"}${resultMutationCheck}
    ${replayCheck}${auditCheck}${outboxCheck}${realtimeOutboxCheck}
  });${graphqlCommandTest}${authorizationTest}${rollbackTests}${businessRollbackTest}${callRollbackTest}${inputValidationTests}${numericGuardTests}${batchTest}`;
  }).join("\n\n");
  return `import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client, db } from "../src/db";
import { ${imports} } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
${callAdapters.length ? 'import { dataflowCallHandlers } from "../src/extensions/dataflow-calls";\n' : ""}import { createApp, type Repositories } from "../src/app";
import { createDataflowRoutes as createFailureRoutes } from "./fixtures/dataflow-failure";

beforeAll(() => {
${schema}
${auxiliarySchema}
${callAdapters.map((adapter) => `dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});

afterEach(() => {
${cleanup}
});

const testRoles: Record<string, "admin" | "operator"> = ${JSON.stringify(Object.fromEntries(dataflows.map((flow) => [flow.name, flow.roles?.[0] ?? "admin"])))};
const app = new Elysia().use(createDataflowRoutes(async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: testRoles[new URL(request.url).pathname.split("/").at(-1)!] ?? "admin"${permissionPrincipal} })));
const graphqlApp = await createApp({} as Repositories, async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "GraphQL Dataflow Test", role: (request.headers.get("x-test-role") ?? "admin") as "admin" | "operator"${permissionPrincipal} }), false, false, undefined, true);

describe("generated dataflow routes", () => {
${tests}
});
`;
}

function sqliteTestIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function scenarioPrincipal(scenario: QiyTestScenario, flow: DataflowIR, permissionPrincipal = ""): string {
  if (scenario.identity?.kind === "anonymous") return "null";
  const identity = scenario.identity;
  const principal = identity ? {
    id: resolveQiyTestValue(scenario, identity.id), name: "Qiy Scenario", role: identity.role,
    claims: Object.fromEntries(Object.entries(identity.claims).map(([claim, value]) => [claim, resolveQiyTestValue(scenario, value)])),
  } : { id: "00000000-0000-4000-8000-000000000010", name: "Qiy Scenario", role: flow.roles?.[0] ?? "admin" };
  return identity ? JSON.stringify(principal) : JSON.stringify(principal).slice(0, -1) + `${permissionPrincipal} }`;
}

function scenarioPermissionPrincipal(permissions?: QiyPermissionModel): string {
  return permissions && !isPermissionModelEmpty(permissions)
    ? `, permissions: ${JSON.stringify(declaredPermissionValues(permissions))}, groups: ${JSON.stringify(permissions.groups.map((group) => group.name))}`
    : "";
}

function renderQiyScenarioTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, suite?: QiyTestSuite, permissions?: QiyPermissionModel): string | undefined {
  if (!suite) return undefined;
  if (database.dialect === "postgresql" || database.dialect === "mysql") return renderServerQiyScenarioTest(database, dataflows, suite, permissions);
  if (database.dialect !== "sqlite") throw new Error("Declarative app.test.qiy scenarios require sqlite, postgresql or mysql");
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const selectedFlows = suite.scenarios.map((scenario) => dataflows.find((flow) => flow.name === scenario.dataflow)!);
  const entityNames = new Set<string>();
  for (const scenario of suite.scenarios) for (const fixture of scenario.given) entityNames.add(fixture.entity);
  for (const flow of selectedFlows) {
    for (const context of flow.context) entityNames.add(context.entity);
    for (const action of flow.steps.flatMap((step) => step.actions)) if (action.kind === "create") entityNames.add(action.entity);
  }
  const usedEntities = [...entityNames].map((name) => entities.get(name)!);
  const schema = usedEntities.map((entity) => {
    const columns = entity.fields.map((field) => `${sqliteTestIdentifier(field.columnName ?? field.name)} ${sqliteColumnType(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    return `client.exec(${JSON.stringify(`CREATE TABLE IF NOT EXISTS ${sqliteTestIdentifier(entity.tableName)} (${columns})`)});`;
  }).join("\n");
  const usesAudit = selectedFlows.some((flow) => flow.audit !== undefined);
  const usesIdempotency = selectedFlows.some((flow) => flow.idempotency?.required);
  const usesOutbox = selectedFlows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) || suite.scenarios.some((scenario) => scenario.expectedOutbox?.length);
  const callAdapters = dataflowCallAdapters(selectedFlows);
  const auxiliary = [
    ...(usesAudit ? [`client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");`] : []),
    ...(usesIdempotency ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");`] : []),
    ...(usesOutbox ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_outbox (id text primary key, actorId text, event text not null, payload text not null, createdAt integer not null)");`] : []),
  ].join("\n");
  const cleanup = [
    ...[...usedEntities].reverse().map((entity) => `client.exec(${JSON.stringify(`DELETE FROM ${sqliteTestIdentifier(entity.tableName)}`)});`),
    ...(usesAudit ? ["client.exec('DELETE FROM audit_events');"] : []),
    ...(usesIdempotency ? ["client.exec('DELETE FROM dataflow_idempotency');"] : []),
    ...(usesOutbox ? ["client.exec('DELETE FROM dataflow_outbox');"] : []),
  ].join("\n");
  const tests = suite.scenarios.map((scenario) => {
    const flow = dataflows.find((item) => item.name === scenario.dataflow)!;
    const seed = scenario.given.map((fixture) => {
      const entity = entities.get(fixture.entity)!;
      const fields = Object.keys(fixture.values);
      const columns = fields.map((name) => sqliteTestIdentifier(entity.fields.find((field) => field.name === name)!.columnName ?? name));
      const placeholders = fields.map(() => "?");
      const values = fields.map((name) => fixture.values[name]);
      return `client.query(${JSON.stringify(`INSERT INTO ${sqliteTestIdentifier(entity.tableName)} (${columns.join(", ")}) VALUES (${placeholders.join(", ")})`)}).run(...${JSON.stringify(values)});`;
    }).join("\n    ");
    const input = Object.fromEntries(Object.entries(scenario.input).map(([name, configured]) => [name, resolveQiyTestValue(scenario, configured)]));
    const headers = `{ "Content-Type": "application/json"${flow.idempotency?.required ? `, "Idempotency-Key": ${JSON.stringify(`qiy-scenario-${scenario.name}`)}` : ""} }`;
    const payloadExpectation = scenario.expectedErrorKey === undefined ? "" : `\n    expect(payload).toMatchObject({ errorKey: ${JSON.stringify(scenario.expectedErrorKey)} });`;
    const fieldExpectations = scenario.expectedFields.map((expectation) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = entities.get(fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const primaryValue = fixture.values[primary.name]!;
      const field = entity.fields.find((item) => item.name === expectation.field)!;
      const expected = resolveQiyTestValue(scenario, expectation.value);
      const query = `SELECT ${sqliteTestIdentifier(field.columnName ?? field.name)} AS value FROM ${sqliteTestIdentifier(entity.tableName)} WHERE ${sqliteTestIdentifier(primary.columnName ?? primary.name)} = ?`;
      return `expect(client.query<{ value: unknown }, [string | number]>(${JSON.stringify(query)}).get(${JSON.stringify(primaryValue)})?.value).toBe(${JSON.stringify(expected)});`;
    }).join("\n    ");
    const existenceExpectations = (scenario.expectedExists ?? []).map((expectation) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = entities.get(fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const query = `SELECT 1 AS value FROM ${sqliteTestIdentifier(entity.tableName)} WHERE ${sqliteTestIdentifier(primary.columnName ?? primary.name)} = ?`;
      return `expect(Boolean(client.query<{ value: number }, [string | number]>(${JSON.stringify(query)}).get(${JSON.stringify(fixture.values[primary.name])}))).toBe(${expectation.exists});`;
    }).join("\n    ");
    const outboxExpectations = (scenario.expectedOutbox ?? []).map((expectation) => `expect(client.query<{ total: number }, [string]>("SELECT COUNT(*) AS total FROM dataflow_outbox WHERE event = ?").get(${JSON.stringify(expectation.event)})?.total).toBe(${expectation.count});`).join("\n    ");
    return `  test(${JSON.stringify(scenario.name)}, async () => {
    ${seed}
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow, scenarioPermissionPrincipal(permissions))})));
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${scenario.dataflow}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(${scenario.expectedStatus});
    const payload = await response.json();${payloadExpectation}
    ${fieldExpectations || "expect(payload).toBeDefined();"}
    ${existenceExpectations}
    ${outboxExpectations}
  });`;
  }).join("\n\n");
  return `import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createDataflowRoutes } from "../src/dataflows";
${callAdapters.length ? 'import { dataflowCallHandlers } from "../src/extensions/dataflow-calls";\n' : ""}
beforeAll(() => {
${schema}
${auxiliary}
${callAdapters.map((adapter) => `dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});

afterEach(() => {
${cleanup}
});

describe("declarative qiy scenarios", () => {
${tests}
});
`;
}

function renderServerQiyScenarioTest(database: DatabaseIR, dataflows: DataflowIR[], suite: QiyTestSuite, permissions?: QiyPermissionModel): string {
  const orderedEntities: EntityIR[] = [];
  const visiting = new Set<string>();
  const visit = (entity: EntityIR) => {
    if (orderedEntities.includes(entity)) return;
    if (visiting.has(entity.name)) throw new Error("Declarative database scenarios cannot automatically clean cyclic foreign keys");
    visiting.add(entity.name);
    for (const relation of database.relations ?? []) {
      if (relation.fromEntity === entity.name) visit(database.entities.find((item) => item.name === relation.toEntity)!);
    }
    visiting.delete(entity.name);
    orderedEntities.push(entity);
  };
  database.entities.forEach(visit);
  const selectedFlows = suite.scenarios.map((scenario) => dataflows.find((flow) => flow.name === scenario.dataflow)!);
  const callAdapters = dataflowCallAdapters(selectedFlows);
  const valueCode = (field: FieldIR, value: string | number | boolean) => field.type === "DateTime"
    ? `new Date(${JSON.stringify(value)})`
    : field.type === "Decimal" || field.type === "Money" ? JSON.stringify(String(value)) : JSON.stringify(value);
  const scenarios = suite.scenarios.map((scenario) => {
    const flow = selectedFlows.find((item) => item.name === scenario.dataflow)!;
    const seed = [...scenario.given].sort((first, second) => orderedEntities.findIndex((entity) => entity.name === first.entity) - orderedEntities.findIndex((entity) => entity.name === second.entity)).map((fixture) => {
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const values = Object.entries(fixture.values).map(([name, value]) => `${JSON.stringify(name)}: ${valueCode(entity.fields.find((field) => field.name === name)!, value)}`);
      return `await db.insert(schema.${entity.name}).values({ ${values.join(", ")} });`;
    }).join("\n    ");
    const input = Object.fromEntries(Object.entries(scenario.input).map(([name, value]) => [name, resolveQiyTestValue(scenario, value)]));
    const expected = scenario.expectedFields.map((expectation, index) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      const field = entity.fields.find((item) => item.name === expectation.field)!;
      return `const rows${index} = await db.select({ value: schema.${entity.name}.${field.name} }).from(schema.${entity.name}).where(eq(schema.${entity.name}.${primary.name}, ${valueCode(primary, fixture.values[primary.name]!)}));\n    expect(rows${index}[0]?.value).toEqual(${valueCode(field, resolveQiyTestValue(scenario, expectation.value))});`;
    }).join("\n    ");
    const existenceExpectations = (scenario.expectedExists ?? []).map((expectation, index) => {
      const fixture = scenario.given.find((item) => item.alias === expectation.alias)!;
      const entity = database.entities.find((item) => item.name === fixture.entity)!;
      const primary = entity.fields.find((field) => field.primaryKey)!;
      return `const exists${index} = await db.select({ id: schema.${entity.name}.${primary.name} }).from(schema.${entity.name}).where(eq(schema.${entity.name}.${primary.name}, ${valueCode(primary, fixture.values[primary.name]!)})).limit(1);\n    expect(exists${index}.length > 0).toBe(${expectation.exists});`;
    }).join("\n    ");
    const outboxExpectations = (scenario.expectedOutbox ?? []).map((expectation, index) => `const outbox${index} = await db.select({ total: count() }).from(schema.dataflowOutbox).where(eq(schema.dataflowOutbox.event, ${JSON.stringify(expectation.event)}));\n    expect(Number(outbox${index}[0]?.total)).toBe(${expectation.count});`).join("\n    ");
    return `  test(${JSON.stringify(scenario.name)}, async () => {
    ${seed}
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow, scenarioPermissionPrincipal(permissions))})));
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${scenario.dataflow}`)}, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(${scenario.expectedStatus});
    const payload = await response.json();
    ${scenario.expectedErrorKey === undefined ? "expect(payload).toBeDefined();" : `expect(payload).toMatchObject({ errorKey: ${JSON.stringify(scenario.expectedErrorKey)} });`}
    ${expected}
    ${existenceExpectations}
    ${outboxExpectations}
  });`;
  }).join("\n\n");
  const cleanup = orderedEntities.slice().reverse().map((entity) => `  await db.delete(schema.${entity.name});`).join("\n");
  const auxiliary = [
    ...(dataflows.some((flow) => flow.audit) ? ["auditEvents"] : []),
    ...(dataflows.some((flow) => flow.idempotency?.required) ? ["dataflowIdempotency"] : []),
    ...(dataflows.some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? ["dataflowOutbox"] : []),
  ].map((name) => `  await db.delete(schema.${name});`).join("\n");
  return `import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq${suite.scenarios.some((scenario) => scenario.expectedOutbox?.length) ? ", count" : ""} } from "drizzle-orm";
import { Elysia } from "elysia";

const testUrl = Bun.env.QIY_TEST_DATABASE_URL;
if (!testUrl || testUrl !== Bun.env.DATABASE_URL || !/^\\/qiy_test_[a-zA-Z0-9_]+$/.test(new URL(testUrl).pathname)) {
  throw new Error("Declarative scenarios require DATABASE_URL = QIY_TEST_DATABASE_URL pointing to a dedicated qiy_test_* database; migrate it first");
}
const { db } = await import("../src/db");
const schema = await import("../src/schema");
const { createDataflowRoutes } = await import("../src/dataflows");
${callAdapters.length ? 'const { dataflowCallHandlers } = await import("../src/extensions/dataflow-calls");' : ""}
async function cleanup() {
${auxiliary}
${cleanup}
}
beforeEach(async () => {
  await cleanup();
${callAdapters.map((adapter) => `  dataflowCallHandlers[${JSON.stringify(adapter)}] = () => ({ ok: true });`).join("\n")}
});
afterEach(cleanup);
describe("declarative qiy scenarios", () => {
${scenarios}
});
`;
}

/**
 * Generated permission provider (`api/src/auth/permissions.ts`). Resolution is a
 * union of the role group, the configured database permission column and the
 * verified id_token claims; verification expressions are data-driven so the same
 * HTTP/command checks run in every generated app.
 */
function renderPermissionModule(auth: NonNullable<QiyProject["auth"]>, permissions: QiyPermissionModel): string {
  const expansion = permissionExpansionTables(permissions);
  const claimSources = permissions.claims ?? [];
  const databaseSource = permissions.database;
  const schemaName = auth.userEntity;
  const dbImports = databaseSource
    ? `import { eq } from "drizzle-orm";\nimport { db } from "../db";\nimport { ${schemaName} } from "../schema";\n`
    : "";
  const databaseLoad = databaseSource
    ? `  let databasePermissions: string[] | undefined;
  try {
    const rows = await db.select({ value: ${schemaName}.${databaseSource.field} }).from(${schemaName}).where(eq(${schemaName}.id, principal.id)).limit(1);
    databasePermissions = normalizeDatabasePermissionColumn(rows[0]?.value);
  } catch {
    // A missing row/table must not break /auth/me: the role group and verified
    // claims still apply, and the database source only ever adds permissions.
    databasePermissions = undefined;
  }
`
    : "";
  const verifications = Object.fromEntries(permissions.verifications.map((verification) => [verification.name, { inputs: verification.inputs, expression: verification.expression }]));
  return `import type { Principal } from "./guard";
${dbImports}
export interface QiyPermissionSnapshot { permissions: string[]; groups: string[] }

/** Permission field name -> permission value. */
const PERMISSION_FIELD_VALUES: Record<string, string> = ${JSON.stringify(expansion.fieldValues)};
/** Declared permission values: provider entries are values or group names. */
const PERMISSION_DECLARED_VALUES: readonly string[] = ${JSON.stringify(declaredPermissionValues(permissions))};
/** Permission group name -> member permission field or group names. */
const PERMISSION_GROUPS: Record<string, string[]> = ${JSON.stringify(expansion.groups)};
/** Verified id_token claim sources declared with \`permission from claim\`. */
const PERMISSION_CLAIM_SOURCES: Array<{ provider: string; claim: string }> = ${JSON.stringify(claimSources)};

function splitPermissionEntries(value: string): string[] {
  return [...new Set(value.split(/[\\s,]+/).map((entry) => entry.trim()).filter(Boolean))];
}

/** Claim values may be a string array, one comma/space separated string, or one string. */
export function normalizeClaimPermissionValues(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  return splitPermissionEntries(value);
}

/** The database permission column is a JSON string array; separated text is accepted too. */
export function normalizeDatabasePermissionColumn(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))];
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return Array.isArray(parsed) ? [...new Set(parsed.filter((entry): entry is string => typeof entry === "string"))] : [];
    } catch { return []; }
  }
  return splitPermissionEntries(trimmed);
}

function expandPermissionEntry(entry: string, values: Set<string>, groups: Set<string>, visiting: Set<string>): void {
  const fieldValue = PERMISSION_FIELD_VALUES[entry];
  if (fieldValue !== undefined) { values.add(fieldValue); return; }
  const members = PERMISSION_GROUPS[entry];
  if (!members || visiting.has(entry)) return;
  visiting.add(entry);
  groups.add(entry);
  for (const member of members) expandPermissionEntry(member, values, groups, visiting);
  visiting.delete(entry);
}

export function expandPermissionEntries(entries: Iterable<string>): QiyPermissionSnapshot {
  const values = new Set<string>();
  const groups = new Set<string>();
  for (const entry of entries) expandPermissionEntry(entry, values, groups, new Set());
  return { permissions: [...values].sort(), groups: [...groups].sort() };
}

export function resolvePermissionSnapshot(source: { role: string; claims?: Principal["claims"]; databasePermissions?: readonly string[] }): QiyPermissionSnapshot {
  const values = new Set<string>();
  const groups = new Set<string>();
  expandPermissionEntry(source.role, values, groups, new Set());
  for (const entry of source.databasePermissions ?? []) {
    if (PERMISSION_DECLARED_VALUES.includes(entry)) values.add(entry);
    else expandPermissionEntry(entry, values, groups, new Set());
  }
  for (const claimSource of PERMISSION_CLAIM_SOURCES) {
    for (const entry of normalizeClaimPermissionValues(source.claims?.[claimSource.claim])) {
      if (PERMISSION_DECLARED_VALUES.includes(entry)) values.add(entry);
      else expandPermissionEntry(entry, values, groups, new Set());
    }
  }
  return { permissions: [...values].sort(), groups: [...groups].sort() };
}

/** Effective permissions for the authenticated principal; never throws for missing rows. */
export async function loadPermissions(principal: Principal): Promise<QiyPermissionSnapshot> {
${databaseLoad}  return resolvePermissionSnapshot({ role: principal.role, ...(principal.claims ? { claims: principal.claims } : {})${databaseSource ? ", databasePermissions" : ""} });
}

export type QiyPermissionVerdict = { allowed: boolean; missing: string[] };
type QiyPermissionInputType = "Text" | "Array<String>";
type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };

const PERMISSION_VERIFICATIONS: Record<string, { inputs: Array<{ name: string; type: QiyPermissionInputType }>; expression: QiyPermissionExpression }> = ${JSON.stringify(verifications)};
export const permissionVerificationNames: string[] = Object.keys(PERMISSION_VERIFICATIONS).sort();

function operandValues(operand: QiyPermissionOperand, self: QiyPermissionSnapshot & { role: string }, input: Record<string, string[]>): string[] {
  if (operand.kind === "self") return operand.set === "role" ? [self.role] : [...(operand.set === "permissions" ? self.permissions : self.groups)];
  if (operand.kind === "literal") return [operand.value];
  return [...(input[operand.name] ?? [])];
}

export function comparePermissionSets(operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals", left: readonly string[], right: readonly string[]): QiyPermissionVerdict {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry)).sort();
  if (operator === "all-in") return { allowed: difference.length === 0, missing: difference };
  if (operator === "some-in") { const shared = [...leftSet].filter((entry) => rightSet.has(entry)); return { allowed: shared.length > 0, missing: shared.length > 0 ? [] : difference }; }
  if (operator === "not-all-in") return { allowed: difference.length > 0, missing: [] };
  if (operator === "not-some-in") { const shared = [...leftSet].filter((entry) => rightSet.has(entry)).sort(); return { allowed: shared.length === 0, missing: shared }; }
  if (operator === "equals") {
    const symmetric = [...new Set([...difference, ...[...rightSet].filter((entry) => !leftSet.has(entry))])].sort();
    return { allowed: symmetric.length === 0, missing: symmetric };
  }
  return { allowed: !(difference.length === 0 && rightSet.size === leftSet.size), missing: [] };
}

function evaluatePermissionExpression(expression: QiyPermissionExpression, self: QiyPermissionSnapshot & { role: string }, input: Record<string, string[]>): QiyPermissionVerdict {
  const evaluate = (node: QiyPermissionExpression): QiyPermissionVerdict => {
    if (node.kind === "comparison") return comparePermissionSets(node.operator, operandValues(node.left, self, input), operandValues(node.right, self, input));
    if (node.kind === "not") { const inner = evaluate(node.expression); return { allowed: !inner.allowed, missing: inner.allowed ? [] : inner.missing }; }
    const results = node.children.map(evaluate);
    if (node.kind === "and") { const failed = results.filter((result) => !result.allowed); return { allowed: failed.length === 0, missing: failed.flatMap((result) => result.missing) }; }
    return { allowed: results.some((result) => result.allowed), missing: results.some((result) => result.allowed) ? [] : results.flatMap((result) => result.missing) };
  };
  const verdict = evaluate(expression);
  return { allowed: verdict.allowed, missing: verdict.allowed ? [] : [...new Set(verdict.missing)].sort() };
}

/**
 * Evaluates one declared verification. Unknown names report \`found: false\`;
 * invalid input shapes report \`error\` so the HTTP route can answer 400; extra
 * input fields are ignored. Declared inputs are required.
 */
export function evaluatePermissionVerification(
  name: string,
  self: QiyPermissionSnapshot & { role: string },
  input: Record<string, unknown>,
): { found: false } | { found: true; allowed: boolean; missing: string[] } | { found: true; error: string } {
  const verification = PERMISSION_VERIFICATIONS[name];
  if (!verification) return { found: false };
  const normalized: Record<string, string[]> = {};
  for (const declared of verification.inputs) {
    const value = input[declared.name];
    if (value === undefined) return { found: true, error: "Verification " + name + " requires input field " + declared.name };
    if (declared.type === "Text") {
      if (typeof value !== "string") return { found: true, error: "Verification " + name + " input field " + declared.name + " must be a string" };
      normalized[declared.name] = [value];
    } else {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return { found: true, error: "Verification " + name + " input field " + declared.name + " must be an array of strings" };
      normalized[declared.name] = [...(value as string[])];
    }
  }
  const verdict = evaluatePermissionExpression(verification.expression, self, normalized);
  return { found: true, allowed: verdict.allowed, missing: verdict.missing };
}
`;
}

/** Generated HTTP surface for permissions: current snapshot and verification checks. */
function renderPermissionRoutes(): string {
  return `import { Elysia, t } from "elysia";
import type { Authenticator } from "./guard";
import { evaluatePermissionVerification, loadPermissions, permissionVerificationNames } from "./permissions";

export function createPermissionRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .get("/permissions", async ({ request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      return await loadPermissions(principal);
    })
    .post("/verify-permission", async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!permissionVerificationNames.includes(body.verification)) return status(400, { error: "Unknown permission verification: " + body.verification });
      const snapshot = await loadPermissions(principal);
      const verdict = evaluatePermissionVerification(body.verification, { ...snapshot, role: principal.role }, body.input ?? {});
      if (!verdict.found) return status(400, { error: "Unknown permission verification: " + body.verification });
      if ("error" in verdict) return status(400, { error: verdict.error });
      return verdict.allowed ? { allowed: true } : { allowed: false, missing: verdict.missing };
    }, { body: t.Object({ verification: t.String({ minLength: 1, maxLength: 120 }), input: t.Optional(t.Record(t.String(), t.Any())) }) });
}
`;
}

/**
 * Generated permission tests. Expected provider snapshots and verification
 * verdicts are computed at generation time with tools/permissions.ts and asserted
 * against the generated runtime module, so the two implementations cannot drift.
 */
function renderPermissionTest(database: DatabaseIR, permissions: QiyPermissionModel): string {
  const roles = ["admin", "operator", "viewer"].filter((role) => permissions.groups.some((group) => group.name === role));
  const snapshots = Object.fromEntries(roles.map((role) => [role, resolvePermissionSnapshot(permissions, { role })]));
  const sampleValues = declaredPermissionValues(permissions);
  const positiveValue = sampleValues[0] ?? "qiy:permission";
  const pool = sampleValues.length > 1 ? sampleValues : [positiveValue];
  const verificationCases = permissions.verifications.flatMap((verification) => {
    const samples: Array<Record<string, unknown>> = [];
    const build = (values: string[]) => Object.fromEntries(verification.inputs.map((input, index) => [input.name, input.type === "Text" ? values[index] : [values[index]]]));
    if (verification.inputs.every((input) => input.type === "Text")) {
      samples.push(build(pool.slice(0, verification.inputs.length).concat(Array(Math.max(0, verification.inputs.length - pool.length)).fill(positiveValue))));
      samples.push(build(Array(verification.inputs.length).fill("qiy:unknown-permission")));
    } else {
      samples.push(build(Array(verification.inputs.length).fill(positiveValue)));
      samples.push(build(Array(verification.inputs.length).fill("qiy:unknown-permission")));
      if (pool.length > 1) samples.push(build(Array(verification.inputs.length).fill(pool[1])));
    }
    return roles.flatMap((role) => samples.map((input) => {
      const snapshot = snapshots[role]!;
      const verdict = evaluateDeclaredVerification(permissions, verification.name, { permissions: snapshot.permissions, groups: snapshot.groups, role }, input);
      if (!verdict.found || "error" in verdict) throw new Error(`Permission verification ${verification.name}: cannot build a generated test case`);
      return {
        role,
        verification: verification.name,
        input,
        expected: { found: true, allowed: verdict.allowed, missing: verdict.missing },
      };
    }));
  });
  const textOnlyVerification = permissions.verifications.find((verification) => verification.inputs.length > 0 && verification.inputs.every((input) => input.type === "Text"));
  const arrayOnlyVerification = permissions.verifications.find((verification) => verification.inputs.length > 0 && verification.inputs.every((input) => input.type === "Array<String>"));
  const invalidInputChecks = [
    textOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(textOnlyVerification.name)}, input: {} })).status).toBe(400);` : "",
    textOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(textOnlyVerification.name)}, input: ${JSON.stringify(Object.fromEntries(textOnlyVerification.inputs.map((input) => [input.name, 7])))} })).status).toBe(400);` : "",
    arrayOnlyVerification ? `expect((await post({ verification: ${JSON.stringify(arrayOnlyVerification.name)}, input: ${JSON.stringify(Object.fromEntries(arrayOnlyVerification.inputs.map((input) => [input.name, "not-an-array"])))} })).status).toBe(400);` : "",
  ].filter(Boolean).join("\n    ");
  // The database loader is covered end-to-end by the HTTP acceptance matrix
  // against a seeded database; generated tests assert the pure contract because a
  // generated test cannot own the auth user table without racing other suites.
  const databaseTest = "";
  const dataset = JSON.stringify({
    snapshots: Object.fromEntries(roles.map((role) => [role, snapshots[role]])),
    cases: verificationCases,
    positiveValue,
    firstVerification: permissions.verifications[0]?.name ?? "Unknown",
    hasDatabaseSource: Boolean(permissions.database),
  }, null, 2);
  return `import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
${databaseTest ? 'import { client } from "../src/db";' : ""}
import { createApp, type Repositories } from "../src/app";
import { createPermissionRoutes } from "../src/auth/permission-routes";
import {
  evaluatePermissionVerification,
  loadPermissions,
  normalizeClaimPermissionValues,
  normalizeDatabasePermissionColumn,
  permissionVerificationNames,
  resolvePermissionSnapshot,
} from "../src/auth/permissions";

interface PermissionSnapshot { permissions: string[]; groups: string[] }
interface PermissionCase { role: string; verification: string; input: Record<string, unknown>; expected: { found: true; allowed: boolean; missing: string[] } }
const dataset = ${dataset} as {
  snapshots: Record<string, PermissionSnapshot>;
  cases: PermissionCase[];
  positiveValue: string;
  firstVerification: string;
  textInputVerification?: string;
  arrayInputVerification?: string;
  hasDatabaseSource: boolean;
};

const principal = (role: string) => ({ id: "00000000-0000-4000-8000-000000000010", name: role, role: role as "admin" | "operator" | "viewer" });
const authenticate = async (request: Request) => {
  const role = request.headers.get("x-test-role");
  return role ? principal(role) : null;
};
const app = new Elysia().use(createPermissionRoutes(authenticate));
const request = (path: string, role: string | undefined, init: RequestInit = {}) => app.handle(new Request("http://localhost" + path, { ...init, headers: { ...(role ? { "x-test-role": role } : {}), ...(init.headers ?? {}) } }));

describe("generated permission provider", () => {
  test("resolves role-group permissions without any claims or database rows", () => {
${roles.map((role) => `    expect(resolvePermissionSnapshot({ role: ${JSON.stringify(role)} })).toEqual(${JSON.stringify(snapshots[role])});`).join("\n") || "    expect(resolvePermissionSnapshot({ role: \"admin\" })).toEqual({ permissions: [], groups: [] });"}
  });

  test("claim values accept arrays, comma-separated text and space-separated text", () => {
    expect(normalizeClaimPermissionValues(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a,b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues(7)).toEqual([]);
    expect(normalizeClaimPermissionValues([1, true, "a"])).toEqual(["a"]);
  });

  test("the database permission column accepts JSON arrays and separated text, failing closed on garbage", () => {
    expect(normalizeDatabasePermissionColumn('["GroupOne","api:getUser"]')).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("GroupOne, api:getUser")).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("  ")).toEqual([]);
    expect(normalizeDatabasePermissionColumn("[not-json")).toEqual([]);
    expect(normalizeDatabasePermissionColumn(null)).toEqual([]);
  });
${permissions.claims?.length ? `  test("verified claim sources are only trusted when the claim is present", () => {
${permissions.claims.map((claim) => `    expect(resolvePermissionSnapshot({ role: "viewer", claims: { ${JSON.stringify(claim.claim)}: dataset.positiveValue } }).permissions).toContain(dataset.positiveValue);`).join("\n")}
    expect(resolvePermissionSnapshot({ role: "viewer", claims: { "qiy-unrelated": "x" } })).toEqual(resolvePermissionSnapshot({ role: "viewer" }));
  });` : ""}${permissions.database ? `  test("database permission entries are unioned with the role group", () => {
    const expected = resolvePermissionSnapshot({ role: "viewer", databasePermissions: [dataset.positiveValue, "qiy-unknown-group"] });
    expect(expected).toEqual(resolvePermissionSnapshot({ role: "viewer", databasePermissions: [dataset.positiveValue] }));
    expect(expected.groups).not.toContain("qiy-unknown-group");
  });` : ""}
${permissions.verifications.length ? `  test("verification truth table matches the declared expressions", () => {
    for (const testCase of dataset.cases) {
      const self = { ...dataset.snapshots[testCase.role]!, role: testCase.role };
      expect({ verification: testCase.verification, input: testCase.input, verdict: evaluatePermissionVerification(testCase.verification, self, testCase.input) }).toEqual({ verification: testCase.verification, input: testCase.input, verdict: testCase.expected });
    }
  });

  test("unknown verification names are rejected", () => {
    expect(evaluatePermissionVerification("QiyUnknownVerification", { permissions: [], groups: [], role: "viewer" }, {})).toEqual({ found: false });
  });` : ""}
});

describe("generated permission HTTP routes", () => {
  test("GET /api/v1/auth/permissions returns the effective snapshot for the bearer", async () => {
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await request("/api/v1/auth/permissions", role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(dataset.snapshots[role]!);
    }
    expect((await request("/api/v1/auth/permissions", undefined)).status).toBe(401);
  });
${permissions.verifications.length ? `  test("POST /api/v1/auth/verify-permission answers the same verdicts as the provider", async () => {
    for (const testCase of dataset.cases) {
      const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: testCase.input }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
    }
  });

  test("POST /api/v1/auth/verify-permission rejects unknown verifications and malformed input", async () => {
    const post = (body: unknown, role = "admin") => request("/api/v1/auth/verify-permission", role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ verification: "QiyUnknownVerification", input: {} })).status).toBe(400);
    ${invalidInputChecks}
    expect((await request("/api/v1/auth/verify-permission", undefined, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: "QiyUnknownVerification" }) })).status).toBe(401);
  });

  test("extra verification input fields are ignored", async () => {
    const testCase = dataset.cases[0]!;
    const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: { ...testCase.input, qiyExtra: "ignored" } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
  });` : ""}
});
${databaseTest ? `\ndescribe("generated database permission source", () => {${databaseTest}});\n` : ""}
describe("generated /auth/me permission metadata", () => {
  test("includes effective permissions and groups without removing the principal fields", async () => {
    const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
    const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
    const application = await createApp(repositories, authenticate, false, false);
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await application.handle(new Request("http://localhost/api/v1/auth/me", { headers: { "x-test-role": role } }));
      expect(response.status).toBe(200);
      const payload = await response.json() as { id: string; name: string; role: string; permissions: string[]; groups: string[] };
      expect(payload.id).toBe("00000000-0000-4000-8000-000000000010");
      expect(payload.role).toBe(role);
      expect({ permissions: payload.permissions, groups: payload.groups }).toEqual(dataset.snapshots[role]!);
    }
  });

  test("exposes the declared verification names", async () => {
    expect(permissionVerificationNames).toEqual(${JSON.stringify(permissions.verifications.map((verification) => verification.name).sort())});
    expect(await loadPermissions(principal("admin"))).toBeTruthy();
  });
});
`;
}

export function generateServer(database: DatabaseIR, options: Pick<QiyProject, "storageProvider" | "auth" | "permissions" | "scopes" | "restrictions" | "pages" | "corsOrigins" | "elysiaPlugins" | "workflows" | "dataflows" | "actions" | "realtime"> & { testSuite?: QiyTestSuite } = {}): Record<string, string> {
  if (options.realtime && !options.auth) throw new Error("Realtime requires generated authentication");
  const errors = validateDatabaseIR(database);
  if (errors.length) throw new Error(errors.join("\n"));
  const uploadField = database.entities.flatMap((entity) => entity.fields.filter((field) => field.type === "File").map((field) => ({ entity, field }))).at(0);
  const graphqlTypes = new Set(["String", "Int", "Float", "Boolean", "ID", "Query", "Mutation", "QiyFilterInput", "QiyDistribution", "QiyTrend"]);
  const graphqlQueries = new Set<string>();
  const graphqlMutations = new Set<string>();
  if (database.entities.length === 0) errors.push("GraphQL: at least one entity is required");
  const validGraphqlName = (name: string) => /^[_A-Za-z][_0-9A-Za-z]*$/.test(name) && !name.startsWith("__");
  const registerGraphqlType = (name: string) => {
    if (!validGraphqlName(name) || graphqlTypes.has(name)) errors.push(`GraphQL: invalid or duplicate type name ${name}`);
    graphqlTypes.add(name);
  };
  for (const enumeration of database.enums ?? []) {
    registerGraphqlType(graphqlName(enumeration.name));
    for (const value of enumeration.values ?? []) {
      if (!validGraphqlName(value.name) || ["true", "false", "null"].includes(value.name)) errors.push(`GraphQL: invalid enum value ${enumeration.name}.${value.name}`);
    }
  }
  for (const entity of database.entities) {
    const name = modelName(entity);
    for (const type of [name, `${name}Page`, `${name}CreateInput`, `${name}UpdateInput`]) registerGraphqlType(type);
    for (const query of [entity.name, `${entity.name}ById`, `${entity.name}Distribution`, `${entity.name}Trend`]) {
      if (!validGraphqlName(query) || graphqlQueries.has(query)) errors.push(`GraphQL: invalid or duplicate query name ${query}`);
      graphqlQueries.add(query);
    }
    for (const field of entity.fields) {
      if (!validGraphqlName(field.name)) errors.push(`GraphQL: invalid field name ${entity.name}.${field.name}`);
    }
    for (const mutation of [`create${name}`, `update${name}`, `delete${name}`, `delete${name}Many`]) {
      if (graphqlMutations.has(mutation)) errors.push(`GraphQL: duplicate mutation name ${mutation}`);
      graphqlMutations.add(mutation);
    }
    if (!entity.fields.some((field) => !field.primaryKey)) errors.push(`GraphQL: ${entity.name} requires a non-primary field for create/update inputs`);
  }
  for (const flow of options.dataflows ?? []) {
    const name = dataflowGraphqlName(flow.name);
    if (flow.input.length > 0) registerGraphqlType(`${name}CommandInput`);
    const mutation = `run${name}`;
    if (!validGraphqlName(mutation) || graphqlMutations.has(mutation)) errors.push(`GraphQL: invalid or duplicate mutation name ${mutation}`);
    graphqlMutations.add(mutation);
    if ((options.actions ?? []).some((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name)) {
      const batchMutation = `${mutation}Batch`;
      if (!validGraphqlName(batchMutation) || graphqlMutations.has(batchMutation)) errors.push(`GraphQL: invalid or duplicate mutation name ${batchMutation}`);
      graphqlMutations.add(batchMutation);
    }
    for (const field of flow.input) {
      if (!validGraphqlName(field.name)) errors.push(`GraphQL: invalid dataflow input name ${flow.name}.${field.name}`);
    }
  }
  if (database.entities.some((entity) => entity.fields.some((field) => field.type === "Vector")) && database.dialect !== "postgresql") errors.push("Vector fields require PostgreSQL with pgvector");
  for (const entity of database.entities) {
    const keys = entity.fields.filter((field) => field.primaryKey);
    if (keys.length !== 1 || keys[0]?.name !== "id" || keys[0]?.type !== "UUID") {
      errors.push(`${entity.name}: V0 CRUD requires exactly one UUID primary key named id`);
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(entity.tableName)) errors.push(`${entity.name}: route path must be lowercase and URL-safe`);
  }
  const auth = options.auth;
  // Authentication modes are derived once so every generation branch agrees:
  // local-only (password), hybrid (password + OAuth), legacy single OAuth and
  // multi-provider OAuth.
  const hasLocalAuth = Boolean(auth && authHasLocal(auth));
  const oidcProviders = auth ? authOAuthProviders(auth) : [];
  const hasOidcAuth = oidcProviders.length > 0;
  const hybridAuth = Boolean(auth && authIsHybrid(auth));
  const providerChooserAuth = Boolean(auth && authUsesProviderChooser(auth));
  const multiProviderAuth = Boolean(auth && providerChooserAuth && !hybridAuth);
  const singleOidcAuth = Boolean(auth && hasOidcAuth && !providerChooserAuth);
  // Permission declarations need generated authentication to resolve a principal.
  const permissions = options.permissions && !isPermissionModelEmpty(options.permissions) ? options.permissions : undefined;
  if (permissions && !auth) errors.push("Permission declarations require a generated auth block");
  if (permissions && permissions.fields.length === 0) errors.push("Permission declarations require at least one permission field");
  if (permissions?.claims?.length && oidcProviders.length === 0) errors.push("Permission claim sources require at least one OAuth/OIDC provider");
  for (const claim of permissions?.claims ?? []) {
    if (!oidcProviders.includes(claim.provider as (typeof oidcProviders)[number])) errors.push(`Permission claim source ${claim.provider}: provider is not configured`);
  }
  if (permissions?.database) {
    const userEntity = database.entities.find((entity) => entity.name === auth?.userEntity);
    const field = userEntity?.fields.find((candidate) => candidate.name === permissions.database!.field);
    if (!userEntity) errors.push(`Permission database source: unknown auth user entity ${auth?.userEntity ?? "(missing)"}`);
    else if (!field) errors.push(`Permission database source: unknown field ${userEntity.name}.${permissions.database.field}`);
    else if (field.type !== "Text") errors.push(`Permission database source: ${userEntity.name}.${permissions.database.field} must be a Text column`);
  }
  const realtimeResources = new Set<string>();
  for (const subscription of options.realtime?.resources ?? []) {
    const entity = database.entities.find((candidate) => candidate.name === subscription.resource || candidate.tableName === subscription.resource);
    if (!entity) errors.push(`Realtime: unknown resource ${subscription.resource}`);
    else if (realtimeResources.has(entity.tableName)) errors.push(`Realtime: duplicate resource ${entity.tableName}`);
    else realtimeResources.add(entity.tableName);
    if (!subscription.events.length || new Set(subscription.events).size !== subscription.events.length) errors.push(`Realtime ${subscription.resource}: events must be unique and non-empty`);
    if (!subscription.roles.length || new Set(subscription.roles).size !== subscription.roles.length) errors.push(`Realtime ${subscription.resource}: roles must be unique and non-empty`);
    // Row predicates cannot be evaluated per subscriber on one shared channel, so
    // publishing would hand every subscriber records they cannot read over HTTP.
    const restrictedRows = (options.restrictions ?? []).find((restriction) => restriction.resource === entity?.name)?.rows ?? [];
    if (restrictedRows.length) errors.push(`Realtime ${subscription.resource}: restrict row predicates cannot be enforced on a shared channel; remove the realtime events or the row predicates`);
    if (subscription.claim) {
      const field = entity?.fields.find((candidate) => candidate.name === subscription.claim!.field);
      // The segmented channel name is built from the value, so it must always exist.
      if (!field) errors.push(`Realtime ${subscription.resource}: unknown claim field ${subscription.claim.field}`);
      else if (field.nullable) errors.push(`Realtime ${subscription.resource}: claim field ${field.name} must be non-nullable`);
      else if (!["Text", "Integer"].includes(field.type)) errors.push(`Realtime ${subscription.resource}: claim field ${field.name} must be Text or Integer`);
      if (restrictedRows.length) errors.push(`Realtime ${subscription.resource}: a claim-scoped channel already isolates rows; remove the restrict row predicates`);
    }
  }
  const cronNames = new Set<string>();
  for (const job of options.elysiaPlugins?.cron ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(job.name)) errors.push(`Cron: invalid job name ${job.name}`);
    if (cronNames.has(job.name)) errors.push(`Cron: duplicate job name ${job.name}`);
    cronNames.add(job.name);
    if (!/^\S+(?:\s+\S+){4,5}$/.test(job.pattern)) errors.push(`Cron ${job.name}: pattern must have 5 or 6 fields`);
    if (job.task !== "cleanupMissingAttachments") errors.push(`Cron ${job.name}: unsupported task ${job.task}`);
  }
  const staticConfig = options.elysiaPlugins?.static;
  if (staticConfig) {
    if (!/^public(?:\/[a-zA-Z0-9_-]+)*$/.test(staticConfig.assets)) errors.push("Elysia Static: assets must be public or a subdirectory of public");
    if (!/^\/[a-zA-Z][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9_-]+)*$/.test(staticConfig.prefix)
      || ["api", "graphql", "assets"].includes(staticConfig.prefix.split("/")[1] ?? "")) {
      errors.push("Elysia Static: prefix must be a dedicated path outside /api, /graphql and /assets");
    }
  }
  const scopedResources = new Set<string>();
  for (const scope of options.scopes ?? []) {
    const entity = database.entities.find((item) => item.tableName === scope.resource || item.name === scope.resource);
    if (!entity) errors.push(`Scope: unknown resource ${scope.resource}`);
    if (entity && scopedResources.has(entity.name)) errors.push(`Scope: duplicate resource ${entity.name}`);
    if (entity) scopedResources.add(entity.name);
    const field = entity?.fields.find((item) => item.name === scope.field);
    if (!field) errors.push(`Scope ${scope.resource}.${scope.field}: unknown field`);
    if (field && !["UUID", "Text"].includes(field.type)) errors.push(`Scope ${scope.resource}.${scope.field}: field must be UUID or Text`);
    if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(scope.claim)) errors.push(`Scope ${scope.resource}.${scope.field}: invalid claim`);
    if (scope.tree) {
      const treeEntity = database.entities.find((item) => item.name === scope.tree!.entity || item.tableName === scope.tree!.entity);
      if (!treeEntity) errors.push(`Scope ${scope.resource}.${scope.field}: unknown tree entity ${scope.tree.entity}`);
      else {
        const parentField = treeEntity.fields.find((item) => item.name === scope.tree!.parentField);
        if (!parentField) errors.push(`Scope ${scope.resource}.${scope.field}: tree entity ${treeEntity.name} has no field ${scope.tree.parentField}`);
        else if (!["UUID", "Text"].includes(parentField.type)) errors.push(`Scope ${scope.resource}.${scope.field}: tree parent field ${parentField.name} must be UUID or Text`);
        const treeId = treeEntity.fields.find((item) => item.primaryKey);
        // The claim value, the tree id and the scoped column must be comparable text.
        if (field && treeId && field.type !== treeId.type) errors.push(`Scope ${scope.resource}.${scope.field}: field ${field.name} (${field.type}) must match tree id ${treeEntity.name}.${treeId.name} (${treeId.type})`);
        if (field && parentField && field.type !== parentField.type) errors.push(`Scope ${scope.resource}.${scope.field}: field ${field.name} (${field.type}) must match tree parent ${treeEntity.name}.${parentField.name} (${parentField.type})`);
      }
    }
  }
  const restrictedResources = new Set<string>();
  const normalizedRestrictions: QiyResourceRestriction[] = [];
  for (const restriction of options.restrictions ?? []) {
    const entity = database.entities.find((item) => item.tableName === restriction.resource || item.name === restriction.resource);
    if (!entity) {
      errors.push(`Restrict: unknown resource ${restriction.resource}`);
      continue;
    }
    if (restrictedResources.has(entity.name)) errors.push(`Restrict: duplicate resource ${entity.name}`);
    restrictedResources.add(entity.name);
    if (restriction.roles && (new Set(restriction.roles).size !== restriction.roles.length || !restriction.roles.length)) {
      errors.push(`Restrict ${entity.name}: roles must be unique and non-empty`);
    }
    for (const role of restriction.roles ?? []) {
      if (!["admin", "operator", "viewer"].includes(role)) errors.push(`Restrict ${entity.name}: unsupported role ${role}`);
    }
    const rows: QiyRowPredicate[] = [];
    const groups: QiyRowPredicate[][] = [];
    /** Validates one row predicate; the flag keeps group duplicates local to their group. */
    const normalizeRow = (row: QiyRowPredicate, siblings: QiyRowPredicate[]) => {
      const field = entity.fields.find((item) => item.name === row.field);
      if (!field) { errors.push(`Restrict ${entity.name}: unknown row condition field ${row.field}`); return; }
      if (field.primaryKey) errors.push(`Restrict ${entity.name}: row conditions cannot target primary key ${row.field}`);
      if (siblings.some((candidate) => candidate.field === row.field)) errors.push(`Restrict ${entity.name}: duplicate row condition on ${row.field}`);
      if (row.source === "claim") {
        if (!row.claim || !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(row.claim)) errors.push(`Restrict ${entity.name}: invalid claim ${row.claim ?? "<missing>"}`);
        if (row.operator !== "==") errors.push(`Restrict ${entity.name}: claim row conditions support == only`);
        if (field.nullable) errors.push(`Restrict ${entity.name}: row condition on nullable field ${row.field} is not supported`);
      } else {
        if (!row.values?.length) errors.push(`Restrict ${entity.name}: row condition on ${row.field} requires at least one value`);
        if (new Set(row.values ?? []).size !== (row.values ?? []).length) errors.push(`Restrict ${entity.name}: duplicate row value on ${row.field}`);
        if (!["==", "!=", "in", "notIn"].includes(row.operator)) errors.push(`Restrict ${entity.name}: unsupported row operator ${row.operator}`);
        if ((row.operator === "==" || row.operator === "!=") && (row.values ?? []).length !== 1) errors.push(`Restrict ${entity.name}: ${row.operator} on ${row.field} requires exactly one value`);
        const comparable = ["Text", "Integer", "Decimal", "Money", "Date", "Time", "DateTime"].includes(field.type) || Boolean(field.enumName);
        if (!comparable) errors.push(`Restrict ${entity.name}: value comparisons require Text, enum, Integer, Decimal, Money, Date, Time or DateTime field ${row.field}`);
        if (row.operator === "in" || row.operator === "notIn") {
          if ((row.values ?? []).length > 64) errors.push(`Restrict ${entity.name}: ${row.operator} on ${row.field} accepts at most 64 values`);
        }
        if (field.enumName) {
          const known = database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values.map((value) => value.name) ?? [];
          for (const value of row.values ?? []) {
            if (!known.includes(value)) errors.push(`Restrict ${entity.name}: unknown enum value ${field.enumName}.${value}`);
          }
        }
        if (field.type === "Integer") {
          for (const value of row.values ?? []) {
            if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) errors.push(`Restrict ${entity.name}: ${row.field} requires integer values`);
          }
        }
      }
      siblings.push(row);
    };
    for (const row of restriction.rows ?? []) normalizeRow(row, rows);
    for (const group of restriction.groups ?? []) {
      if (group.length < 2) errors.push(`Restrict ${entity.name}: a when group needs at least two conditions`);
      const normalized: QiyRowPredicate[] = [];
      for (const row of group) normalizeRow(row, normalized);
      groups.push(normalized);
    }
    /** Expression leaves go through the same checks as a standalone row predicate. */
    const normalizeExpression = (node: QiyPolicyExpression): void => {
      if (node.kind === "predicate") { normalizeRow(node.predicate, []); return; }
      if (node.kind === "cross") {
        const left = entity.fields.find((field) => field.name === node.field);
        const right = entity.fields.find((field) => field.name === node.otherField);
        if (!left) errors.push(`Restrict ${entity.name}: unknown row condition field ${node.field}`);
        if (!right) errors.push(`Restrict ${entity.name}: unknown cross-field ${node.otherField}`);
        if (left?.primaryKey || right?.primaryKey) errors.push(`Restrict ${entity.name}: cross-field comparisons cannot target a primary key`);
        return;
      }
      if (node.kind === "scope") return;
      if (node.kind === "not") { normalizeExpression(node.expression); return; }
      for (const child of node.children) normalizeExpression(child);
    };
    const expressionMentionsScope = (node: QiyPolicyExpression): boolean =>
      node.kind === "scope" ? true
        : node.kind === "not" ? expressionMentionsScope(node.expression)
          : node.kind === "and" || node.kind === "or" ? node.children.some(expressionMentionsScope)
            : false;
    if ((restriction.expressions ?? []).some(expressionMentionsScope)
      && !(options.scopes ?? []).some((scope) => scope.resource === entity.name || scope.resource === entity.tableName)) {
      errors.push(`Restrict ${entity.name}: when scope requires a matching scope declaration`);
    }
    for (const expression of restriction.expressions ?? []) normalizeExpression(expression);
    const masks: QiyFieldMask[] = [];
    for (const mask of restriction.masks ?? []) {
      const field = entity.fields.find((item) => item.name === mask.field);
      if (!field) { errors.push(`Restrict ${entity.name}: unknown mask field ${mask.field}`); continue; }
      if (field.primaryKey) errors.push(`Restrict ${entity.name}: primary key ${mask.field} cannot be masked`);
      if (field.type === "Vector") errors.push(`Restrict ${entity.name}: Vector field ${mask.field} cannot be masked`);
      if (masks.some((candidate) => candidate.field === mask.field)) errors.push(`Restrict ${entity.name}: duplicate mask for ${mask.field}`);
      if (mask.roles && (new Set(mask.roles).size !== mask.roles.length || !mask.roles.length)) errors.push(`Restrict ${entity.name}: mask roles for ${mask.field} must be unique and non-empty`);
      for (const role of mask.roles ?? []) {
        if (!["admin", "operator", "viewer"].includes(role)) errors.push(`Restrict ${entity.name}: unsupported mask role ${role}`);
      }
      if (!["omit", "null", "redact"].includes(mask.mode)) errors.push(`Restrict ${entity.name}: unsupported mask mode ${mask.mode}`);
      if (mask.mode === "redact" && typeof mask.replacement !== "string") errors.push(`Restrict ${entity.name}: mask mode redact for ${mask.field} requires a replacement string`);
      if (mask.mode !== "redact" && mask.replacement !== undefined) errors.push(`Restrict ${entity.name}: mask replacement for ${mask.field} requires mode redact`);
      if (mask.claim && !/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(mask.claim)) errors.push(`Restrict ${entity.name}: invalid mask claim ${mask.claim}`);
      if (mask.claim && mask.claimState !== "present" && mask.claimState !== "absent") errors.push(`Restrict ${entity.name}: mask claim for ${mask.field} must state present or absent`);
      if (!mask.claim && mask.claimState !== undefined) errors.push(`Restrict ${entity.name}: mask claimState for ${mask.field} requires a claim`);
      masks.push(mask);
    }
    normalizedRestrictions.push({
      resource: entity.name,
      ...(restriction.roles ? { roles: [...restriction.roles] } : {}),
      ...(rows.length ? { rows } : {}),
      ...(groups.length ? { groups } : {}),
      ...(restriction.expressions?.length ? { expressions: restriction.expressions } : {}),
      ...(masks.length ? { masks } : {}),
    });
  }
  for (const flow of options.dataflows ?? []) {
    const used = new Set(flow.context.map((binding) => binding.entity));
    for (const step of flow.steps) for (const action of step.actions) {
      if (action.kind === "create") used.add(action.entity);
    }
    for (const resource of used) {
      if (restrictedResources.has(resource)) errors.push(`Restrict ${resource}: dataflow ${flow.name} cannot use a restricted resource until command authorization applies the same row policy`);
    }
  }
  if (options.workflows?.includes("orderInventory")) {
    for (const resource of ["orders", "orderItems", "inventoryItems"]) {
      if (restrictedResources.has(resource)) errors.push(`Restrict ${resource}: orderInventory does not apply row policy yet`);
    }
  }
  if (auth) {
    const user = database.entities.find((entity) => entity.name === auth.userEntity);
    const subject = user?.fields.find((field) => field.name === auth.subjectField);
    const role = user?.fields.find((field) => field.name === auth.roleField);
    if (!user) errors.push(`Auth: unknown user entity ${auth.userEntity}`);
    if (hasLocalAuth) {
      const username = user?.fields.find((field) => field.name === auth.usernameField);
      if (!username || username.type !== "Text" || username.nullable || !username.unique) errors.push("Auth: usernameField must be a required unique Text field");
      const password = user?.fields.find((field) => field.name === auth.passwordField);
      if (!password || !["Text"].includes(password.type) || !password.nullable) errors.push("Auth: passwordField must be a nullable Text field storing the password hash");
      if (username && password && username.name === password.name) errors.push("Auth: usernameField and passwordField must be different fields");
    }
    if (hasOidcAuth && (!subject || subject.type !== "Text" || subject.nullable || !subject.unique)) {
      errors.push("Auth: subjectField must be a required unique Text field");
    }
    // Hybrid projects store one identifier per OAuth provider in its own users
    // column. Binding needs a per-provider identity that can be null, so the
    // mapped columns must be nullable and unique.
    if (hybridAuth) {
      for (const provider of oidcProviders) {
        if (authProviderSubjectField(auth, provider) === auth.subjectField && !auth.providerMappings?.some((mapping) => mapping.provider === provider)) {
          errors.push(`Auth: provider ${provider} needs its own nullable subjectField mapping when local password login is combined with OAuth`);
          continue;
        }
        const column = user?.fields.find((field) => field.name === authProviderSubjectField(auth, provider));
        if (!column) { errors.push(`Auth: provider ${provider} maps to unknown user field ${authProviderSubjectField(auth, provider)}`); continue; }
        if (column.type !== "Text") errors.push(`Auth: provider ${provider} subjectField must be a Text field`);
        if (!column.nullable) errors.push(`Auth: provider ${provider} subjectField ${column.name} must be nullable so accounts can exist without that binding`);
        if (!column.unique) errors.push(`Auth: provider ${provider} subjectField ${column.name} must be unique`);
      }
    }
    if (auth.profileField) {
      const profile = user?.fields.find((field) => field.name === auth.profileField);
      if (!profile || profile.type !== "Text" || !profile.nullable) errors.push("Auth: profileField must be a nullable Text field storing per-provider profile metadata");
    }
    if (hasLocalAuth && hasOidcAuth) {
      // First OAuth login creates a users row. Every required non-id column must
      // be populated by the generated onboarding endpoint.
      const autoFields = new Set([auth.usernameField, auth.passwordField, auth.roleField, auth.subjectField, auth.profileField, ...oidcProviders.map((provider) => authProviderSubjectField(auth, provider)), "email", "displayName", "name"].filter((value): value is string => Boolean(value)));
      const uncovered = (user?.fields ?? []).filter((field) => !field.primaryKey && !field.nullable && !autoFields.has(field.name));
      if (uncovered.length) errors.push(`Auth: OAuth onboarding cannot populate required user fields: ${uncovered.map((field) => field.name).join(", ")}; make them nullable`);
    }
    const roleValues = database.enums?.find((item) => item.name === role?.enumName)?.values.map((item) => item.name);
    if (!role || !roleValues || !["admin", "operator", "viewer"].every((value) => roleValues.includes(value)) || roleValues.some((value) => !["admin", "operator", "viewer"].includes(value))) errors.push("Auth: roleField must be an enum with admin, operator and viewer values");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const scopedDatabase = { ...database, scopes: (options.scopes ?? []).map((scope) => ({ ...scope, resource: database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)!.name })), restrictions: normalizedRestrictions };
  const testClaims = JSON.stringify(Object.fromEntries((options.scopes ?? []).map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"])));

  const imports = database.entities.map((entity) => `import { ${modelName(entity)}Routes } from "./modules/${entity.name}/${entity.name}.routes";`).join("\n");
  const repositoryImports = database.entities.map((entity) => `import { ${modelName(entity)}Repository } from "./modules/${entity.name}/${entity.name}.repository";`).join("\n");
  const apps = database.entities.map((entity) => `    .use(${modelName(entity)}Routes(repositories.${entity.name}, authenticate))`).join("\n");
  const interfaces = database.entities.map((entity) => `  ${entity.name}: import("./modules/${entity.name}/${entity.name}.contract").${modelName(entity)}Repository;`).join("\n");
  const orderWorkflow = renderOrderWorkflow(database, options.scopes ?? [], options.workflows?.includes("orderInventory"));
  const dataflowRoutes = renderDataflowRoutes(database, options.dataflows ?? [], options.scopes ?? [], options.actions ?? [], options.realtime !== undefined, permissions);
  const protectedResources = JSON.stringify([
    ...database.entities.map((entity) => ({ path: entity.tableName, query: entity.name })),
    { path: "files", query: "files" },
    ...(dataflowRoutes ? [{ path: "commands", query: "commands", mutations: (options.dataflows ?? []).flatMap((flow) => {
      const operation = `run${dataflowGraphqlName(flow.name)}`;
      return (options.actions ?? []).some((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name) ? [operation, `${operation}Batch`] : [operation];
    }) }] : []),
  ]);
  // Page-level rules are handed to the guard so REST and GraphQL share one decision.
  const pageRules = JSON.stringify(Object.fromEntries((options.pages ?? []).map((page) => [page.resource, Object.fromEntries(page.actions.map((entry) => [entry.action, entry.roles]))])));
  const postgresSchema = database.dialect === "postgresql" ? generateDrizzlePostgres(database) : "";
  const baseSchema = database.dialect === "postgresql" ? postgresSchema.replace("import { ", orderWorkflow && !postgresSchema.includes("uniqueIndex") ? "import { uniqueIndex, " : "import { ") + (orderWorkflow ? `
export const orderReservations = pgTable("order_reservations", {
  id: uuid("id").primaryKey(),
  orderId: uuid("orderId").notNull().references(() => orders.id, { onDelete: "cascade" }),
  orderItemId: uuid("orderItemId").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventoryItemId").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
}, (table) => [index("order_reservations_order_idx").on(table.orderId)]);

export const orderIdempotency = pgTable("order_idempotency", {
  id: uuid("id").primaryKey(),
  orderId: uuid("orderId").notNull().references(() => orders.id, { onDelete: "cascade" }),
  actorId: uuid("actorId").notNull(),
  requestKey: text("requestKey").notNull(),
  response: jsonb("response").notNull(),
}, (table) => [uniqueIndex("order_idempotency_scope_idx").on(table.orderId, table.actorId, table.requestKey)]);
` : "") : database.dialect === "sqlite" ? generateDrizzleSqlite(database) : generateDrizzleMysql(database);
  const usesDataflowIdempotency = (options.dataflows ?? []).some((flow) => flow.idempotency?.required);
  const generatedSchema = baseSchema
    + (usesDataflowIdempotency ? renderDataflowIdempotencySchema(database.dialect) : "")
    + ((options.dataflows ?? []).some((flow) => flow.steps.some((step) => step.actions.some((action) => action.kind === "emit"))) ? renderDataflowOutboxSchema(database.dialect) : "")
    + (options.realtime ? renderRealtimeOutboxSchema(database.dialect) : "");
  const pluginDependencies: Record<string, string> = {};
  if (options.elysiaPlugins?.bearer) pluginDependencies["@elysia/bearer"] = "1.4.4";
  if (options.elysiaPlugins?.serverTiming) pluginDependencies["@elysia/server-timing"] = "1.4.1";
  if (options.elysiaPlugins?.cron?.length) pluginDependencies["@elysia/cron"] = "1.4.2";
  if (options.elysiaPlugins?.jwt) pluginDependencies["@elysia/jwt"] = "1.4.2";
  if (options.elysiaPlugins?.static) pluginDependencies["@elysia/static"] = "1.4.11";
  if (options.elysiaPlugins?.html) pluginDependencies["@elysia/html"] = "1.4.1";
  if (options.elysiaPlugins?.graphqlAdapter === "yoga") {
    pluginDependencies["@elysia/graphql-yoga"] = "1.4.1";
    pluginDependencies["graphql-yoga"] = "5.16.0";
  }
  if (options.elysiaPlugins?.graphqlAdapter === "apollo") {
    pluginDependencies["@elysia/apollo"] = "1.4.1";
    pluginDependencies["@apollo/server"] = "5.0.0";
  }
  if (options.elysiaPlugins?.drizzle) pluginDependencies["drizzle-typebox"] = "0.3.3";
  if (options.realtime) pluginDependencies.ably = "2.29.0";
  const files: Record<string, string> = {
    ...renderAppTemplate("server", "api"),
    ...(normalizedRestrictions.length ? { "api/src/security/policy.ts": renderPolicyModule(normalizedRestrictions, database, options.scopes ?? []) } : {}),
    "api/src/import-jobs.ts": renderImportJobsModule(database.dialect),
    "api/src/saved-views.ts": renderSavedViewsModule(database.dialect, database.entities.map((entity) => entity.tableName)),
    "api/tests/saved-views.test.ts": renderSavedViewsTest(database.dialect, database.entities.map((entity) => entity.tableName)),
    "api/src/export-jobs.ts": renderExportJobsModule(database.dialect),
    "api/src/db.ts": database.dialect === "postgresql" ? `import { SQL } from "bun";\nimport { drizzle } from "drizzle-orm/bun-sql";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = new SQL(url);\nexport const db = drizzle({ client, schema });\n` : database.dialect === "sqlite" ? `import { Database } from "bun:sqlite";\nimport { drizzle } from "drizzle-orm/bun-sqlite";\nimport * as schema from "./schema";\n\nconst filename = Bun.env.DATABASE_URL ?? "./qiy.sqlite";\nexport const client = new Database(filename);\nexport const db = drizzle(client, { schema });\n` : `import mysql from "mysql2/promise";\nimport { drizzle } from "drizzle-orm/mysql2";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = mysql.createPool({ uri: url, timezone: "Z" });\nexport const db = drizzle({ client, schema, mode: "default" });\n`,
    ...(database.entities.some((entity) => temporalFieldsOf(entity).length) ? { "api/src/temporal.ts": renderTemporalModule() } : {}),
    "api/src/schema-drift.ts": `import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/${database.dialect === "postgresql" ? "pg-core" : database.dialect === "mysql" ? "mysql-core" : "sqlite-core"}";
import * as schema from "./schema";
import { client } from "./db";

export const DIALECT: string = ${JSON.stringify(database.dialect)};
export { client };

export interface DriftColumn { name: string; nullable: boolean; type: string; primary: boolean }
export interface DriftTable { name: string; columns: DriftColumn[] }
export interface DriftReport { ok: boolean; errors: string[]; warnings: string[]; unverified: string[] }

/** Maps a Drizzle column type onto a portable category. Unknown stays unknown, never a guess. */
export function canonicalFromDrizzle(columnType: string, dataType: string): string {
  const type = (columnType || "").toLowerCase();
  if (type.includes("uuid")) return "uuid";
  if (type.includes("vector")) return "vector";
  if (type.includes("json")) return "json";
  if (type.includes("bytea") || type.includes("blob") || type.includes("binary") || type.includes("buffer")) return "binary";
  if (type.includes("bool")) return "boolean";
  if (type.includes("timestamp") || type.includes("datetime")) return "timestamp";
  if (type.includes("date")) return "date";
  if (type.includes("time")) return "time";
  if (type.includes("bigint") || type.includes("bigserial")) return "bigint";
  if (type.includes("int") || type.includes("serial")) return "integer";
  if (type.includes("numeric") || type.includes("decimal") || type.includes("money") || type.includes("real") || type.includes("double") || type.includes("float")) return "decimal";
  if (type.includes("char") || type.includes("text") || type.includes("clob")) return "text";
  if (dataType === "string") return "text";
  if (dataType === "number") return "decimal";
  if (dataType === "boolean") return "boolean";
  if (dataType === "date") return "timestamp";
  if (dataType === "json") return "json";
  if (dataType === "bigint") return "bigint";
  return "unknown";
}

/** Maps a live database type onto the same categories. Second argument carries the full column type when available. */
export function canonicalFromLive(dataType: string, columnType?: string): string {
  const type = (dataType || "").toLowerCase();
  const full = (columnType || "").toLowerCase();
  if (DIALECT === "postgresql") {
    if (type === "uuid") return "uuid";
    if (type === "vector") return "vector";
    if (type === "json" || type === "jsonb") return "json";
    if (type === "bytea") return "binary";
    if (type === "bool") return "boolean";
    if (type === "timestamptz" || type === "timestamp") return "timestamp";
    if (type === "date") return "date";
    if (type === "timetz" || type === "time") return "time";
    if (type === "int8" || type === "bigserial" || type === "serial8") return "bigint";
    if (type === "int2" || type === "int4" || type === "serial" || type === "serial4") return "integer";
    if (type === "numeric" || type === "money" || type === "float4" || type === "float8") return "decimal";
    if (type === "text" || type === "varchar" || type === "bpchar" || type === "char" || type === "citext" || type === "name") return "text";
    if (type.startsWith("_")) return "array";
    return "unknown";
  }
  if (DIALECT === "mysql") {
    if (type === "char" || type === "varchar" || type === "text" || type === "tinytext" || type === "mediumtext" || type === "longtext" || type === "enum" || type === "set") return "text";
    if (type === "tinyint" && full.startsWith("tinyint(1)")) return "boolean";
    if (type === "tinyint" || type === "smallint" || type === "mediumint" || type === "int" || type === "integer") return "integer";
    if (type === "bigint") return "bigint";
    if (type === "decimal" || type === "numeric" || type === "float" || type === "double" || type === "real") return "decimal";
    if (type === "datetime" || type === "timestamp") return "timestamp";
    if (type === "date") return "date";
    if (type === "time") return "time";
    if (type === "json") return "json";
    if (type === "binary" || type === "varbinary" || type === "blob" || type === "tinyblob" || type === "mediumblob" || type === "longblob") return "binary";
    return "unknown";
  }
  if (type === "") return "unknown";
  if (type.includes("int")) return "integer";
  if (type.includes("char") || type.includes("clob") || type.includes("text")) return "text";
  if (type.includes("blob")) return "binary";
  if (type.includes("bool")) return "boolean";
  if (type.includes("real") || type.includes("floa") || type.includes("doub") || type.includes("dec") || type.includes("num")) return "decimal";
  if (type.includes("date") || type.includes("time")) return "timestamp";
  return "unknown";
}

/** Only documented storage equivalences are tolerated; everything else is reported. */
function compatible(expected: string, found: string): boolean {
  if (expected === found) return true;
  if (DIALECT === "sqlite") {
    const affinity = (type: string) => type === "boolean" || type === "bigint" || type === "timestamp" || type === "date" || type === "time" ? "integer" : type === "json" ? "text" : type === "vector" ? "binary" : type;
    return affinity(expected) === affinity(found);
  }
  if (DIALECT === "mysql") return (expected === "boolean" && found === "integer") || (expected === "integer" && found === "boolean");
  return false;
}

export function compareSchema(expected: DriftTable[], live: DriftTable[]): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unverified: string[] = [];
  const liveByName = new Map(live.map((table) => [table.name, table]));
  for (const table of expected) {
    const actual = liveByName.get(table.name);
    if (!actual) { errors.push("missing table " + table.name); continue; }
    const actualColumns = new Map(actual.columns.map((column) => [column.name, column]));
    for (const column of table.columns) {
      const found = actualColumns.get(column.name);
      if (!found) { errors.push(table.name + "." + column.name + ": missing column"); continue; }
      actualColumns.delete(column.name);
      if (found.nullable !== column.nullable) errors.push(table.name + "." + column.name + ": expected " + (column.nullable ? "NULL" : "NOT NULL") + " but the database has " + (found.nullable ? "NULL" : "NOT NULL"));
      if (found.primary !== column.primary) errors.push(table.name + "." + column.name + ": " + (column.primary ? "expected a primary key column" : "column is not expected to be a primary key"));
      if (column.type === "unknown" || found.type === "unknown") unverified.push(table.name + "." + column.name + ": type not compared (" + column.type + " / " + found.type + ")");
      else if (!compatible(column.type, found.type)) errors.push(table.name + "." + column.name + ": expected " + column.type + " but the database has " + found.type);
    }
    for (const extra of actualColumns.values()) warnings.push(table.name + "." + extra.name + ": column exists in the database but not in the schema");
  }
  for (const table of live) if (!expected.some((item) => item.name === table.name)) warnings.push("unexpected table " + table.name);
  return { ok: errors.length === 0, errors, warnings, unverified };
}

export function expectedTables(): DriftTable[] {
  return (Object.values(schema) as unknown[]).filter(isTable).map((table) => {
    const config = getTableConfig(table as never) as unknown as { name: string; columns: Array<{ name: string; notNull: boolean; primary: boolean; dataType: string; columnType: string }> };
    return {
      name: config.name,
      columns: config.columns.map((column) => ({ name: column.name, nullable: !column.notNull, type: canonicalFromDrizzle(column.columnType ?? "", column.dataType ?? ""), primary: Boolean(column.primary) })),
    };
  });
}
${database.dialect === "postgresql" ? `
export async function introspect(): Promise<DriftTable[]> {
  const columns = await client.unsafe("select table_name, column_name, is_nullable, coalesce(udt_name, data_type) as type from information_schema.columns where table_schema = current_schema() and table_name <> '__drizzle_migrations'") as Array<{ table_name: string; column_name: string; is_nullable: string; type: string }>;
  const keys = await client.unsafe("select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = current_schema()") as Array<{ table_name: string; column_name: string }>;
  const primary = new Set(keys.map((row) => row.table_name + "." + row.column_name));
  const tables = new Map<string, DriftTable>();
  for (const row of columns) {
    const table = tables.get(row.table_name) ?? { name: row.table_name, columns: [] };
    table.columns.push({ name: row.column_name, nullable: row.is_nullable === "YES", type: canonicalFromLive(row.type), primary: primary.has(row.table_name + "." + row.column_name) });
    tables.set(row.table_name, table);
  }
  return [...tables.values()];
}

export async function appliedMigrations(): Promise<number | null> {
  try {
    const rows = await client.unsafe("select count(*)::int as count from drizzle.__drizzle_migrations") as Array<{ count: number }>;
    return Number(rows[0]?.count ?? 0);
  } catch { return 0; }
}
` : database.dialect === "mysql" ? `
export async function introspect(): Promise<DriftTable[]> {
  // MySQL returns information_schema column names in uppercase, so every field is
  // aliased to an explicit lowercase name instead of relying on the driver keys.
  const [rows] = await client.query("select table_name as tbl, column_name as col, is_nullable as nullable, data_type as dtype, column_type as ctype, column_key as ckey from information_schema.columns where table_schema = database() and table_name <> '__drizzle_migrations'") as unknown as [Array<{ tbl: string; col: string; nullable: string; dtype: string; ctype: string; ckey: string }>, unknown];
  const tables = new Map<string, DriftTable>();
  for (const row of rows) {
    const table = tables.get(row.tbl) ?? { name: row.tbl, columns: [] };
    table.columns.push({ name: row.col, nullable: row.nullable === "YES", type: canonicalFromLive(row.dtype, row.ctype), primary: row.ckey === "PRI" });
    tables.set(row.tbl, table);
  }
  return [...tables.values()];
}

export async function appliedMigrations(): Promise<number | null> {
  try {
    const [rows] = await client.query("select count(*) as count from __drizzle_migrations") as unknown as [Array<{ count: number | string }>, unknown];
    return Number(rows[0]?.count ?? 0);
  } catch { return 0; }
}
` : `
export async function introspect(): Promise<DriftTable[]> {
  const names = client.query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name <> '__drizzle_migrations'").all() as Array<{ name: string }>;
  const tables: DriftTable[] = [];
  for (const { name } of names) {
    const info = client.query("pragma table_info(" + JSON.stringify(name) + ")").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
    tables.push({ name, columns: info.map((column) => ({ name: column.name, nullable: column.notnull === 0, type: canonicalFromLive(column.type), primary: column.pk > 0 })) });
  }
  return tables;
}

export function appliedMigrations(): Promise<number | null> {
  try {
    const rows = client.query("select count(*) as count from __drizzle_migrations").all() as Array<{ count: number }>;
    return Promise.resolve(Number(rows[0]?.count ?? 0));
  } catch { return Promise.resolve(0); }
}
`}
`,
    "api/src/db-check.ts": `import { appliedMigrations, client, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const expected = expectedTables();
const report = compareSchema(expected, await introspect());
const journalFile = Bun.file(new URL("../drizzle/meta/_journal.json", import.meta.url));
const journal = await journalFile.exists() ? (await journalFile.json() as { entries?: unknown[] }).entries?.length ?? 0 : 0;
const applied = await appliedMigrations();
if (applied !== null && applied < journal) report.errors.push("pending migrations: " + (journal - applied) + " of " + journal + " not applied");
if (applied !== null && applied > journal) report.warnings.push("database has " + applied + " applied migrations but this checkout only declares " + journal);
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);
for (const item of report.unverified) console.log("unverified: " + item);
console.log("qiy db:check (" + DIALECT + ") checked " + expected.length + " tables, migrations applied " + (applied ?? "unknown") + "/" + journal + ", " + report.errors.length + " error(s), " + report.warnings.length + " warning(s)");
${database.dialect === "mysql" ? "await client.end();" : database.dialect === "sqlite" ? "client.close();" : ""}
process.exit(report.errors.length ? 1 : 0);
`,
    "api/tests/schema-drift.test.ts": `import { expect, test } from "bun:test";
import { canonicalFromDrizzle, canonicalFromLive, compareSchema, expectedTables, type DriftTable } from "../src/schema-drift";

test("treats the generated schema as its own expectation", () => {
  const expected = expectedTables();
  expect(expected.length).toBeGreaterThan(0);
  const live: DriftTable[] = expected.map((table) => ({ name: table.name, columns: table.columns.map((column) => ({ ...column })) }));
  expect(compareSchema(expected, live).errors).toEqual([]);
});

test("reports missing tables, missing columns, nullability, primary key and type drift", () => {
  const expected: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: false, type: "text", primary: true }, { name: "amount", nullable: true, type: "decimal", primary: false }] }];
  const live: DriftTable[] = [{ name: "orders", columns: [{ name: "id", nullable: true, type: "integer", primary: false }, { name: "extra", nullable: true, type: "text", primary: false }] }];
  const report = compareSchema(expected, live);
  expect(report.ok).toBe(false);
  expect(report.errors).toContain("orders.amount: missing column");
  expect(report.errors).toContain("orders.id: expected NOT NULL but the database has NULL");
  expect(report.errors).toContain("orders.id: expected a primary key column");
  expect(report.warnings).toContain("orders.extra: column exists in the database but not in the schema");
  expect(compareSchema(expected, []).errors).toContain("missing table orders");
  expect(compareSchema([], live).warnings).toContain("unexpected table orders");
});

test("does not report drift for documented storage equivalences or unknown types", () => {
  const equivalentPairs: Array<[string, string]> = ${JSON.stringify(database.dialect === "sqlite" ? [["boolean", "integer"], ["bigint", "integer"], ["timestamp", "integer"], ["date", "integer"], ["json", "text"], ["vector", "binary"]] : database.dialect === "mysql" ? [["boolean", "integer"], ["integer", "boolean"]] : [])};
  for (const [expectedType, foundType] of equivalentPairs) {
    const report = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: expectedType, primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: foundType, primary: false }] }]);
    expect(report.errors).toEqual([]);
  }
  const unknown = compareSchema([{ name: "t", columns: [{ name: "a", nullable: true, type: "unknown", primary: false }] }], [{ name: "t", columns: [{ name: "a", nullable: true, type: "text", primary: false }] }]);
  expect(unknown.errors).toEqual([]);
  expect(unknown.unverified).toHaveLength(1);
  expect(canonicalFromDrizzle("PgUUID", "string")).toBe("uuid");
  expect(canonicalFromDrizzle("SQLiteTimestamp", "date")).toBe("timestamp");
  expect(canonicalFromDrizzle("MySqlDecimal", "string")).toBe("decimal");
  expect(canonicalFromLive("nonsense")).toBe("unknown");
});
`,
    "api/src/backup-codec.ts": `/** Portable logical backup document written by db:backup and read by db:restore. */
export interface QiyBackupDocument {
  version: 1;
  dialect: string;
  createdAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

/** Values that JSON cannot carry faithfully are tagged so restore can rebuild them. */
export function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return { $qiy: "date", value: value.toISOString() };
  if (value instanceof Uint8Array) return { $qiy: "bytes", value: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return { $qiy: "bigint", value: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, encodeValue(item)]));
  return value;
}

export function decodeValue(value: unknown, dataType: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "$qiy" in (value as Record<string, unknown>)) {
    const tagged = value as { $qiy: string; value: string };
    if (tagged.$qiy === "date") return new Date(tagged.value);
    if (tagged.$qiy === "bytes") return Buffer.from(tagged.value, "base64");
    if (tagged.$qiy === "bigint") return BigInt(tagged.value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, dataType));
  // A driver that returns timestamps as strings still has to satisfy a date column.
  if (dataType === "date" && typeof value === "string") { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed; }
  return value;
}

export function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeValue(value)]));
}

export function decodeRow(row: Record<string, unknown>, columnTypes: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, decodeValue(value, columnTypes[key] ?? "unknown")]));
}
`,
    "api/src/schema-tables.ts": `import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/${database.dialect === "postgresql" ? "pg-core" : database.dialect === "mysql" ? "mysql-core" : "sqlite-core"}";
import * as schema from "./schema";

export interface QiySchemaTable {
  name: string;
  table: unknown;
  columns: Array<{ name: string; dataType: string }>;
  /** The table objects this table references, used to order writes safely. */
  references: unknown[];
}

export function qiySchemaTables(): QiySchemaTable[] {
  return (Object.values(schema) as unknown[]).filter(isTable).map((table) => {
    const config = getTableConfig(table as never) as unknown as {
      name: string;
      columns: Array<{ name: string; dataType: string }>;
      foreignKeys: Array<{ reference: () => { foreignTable: unknown } }>;
    };
    // Foreign keys are matched by table identity, not by name: a dialect may
    // qualify or wrap names, and an identity match cannot silently miss.
    const references = config.foreignKeys.map((key) => key.reference().foreignTable).filter((referenced) => referenced !== table);
    return { name: config.name, table, columns: config.columns.map((column) => ({ name: column.name, dataType: column.dataType ?? "unknown" })), references };
  });
}

/**
 * Tables ordered so that a referenced table is written before the table that
 * references it. Cyclic references are reported instead of guessed.
 */
export function qiyWriteOrder(tables: QiySchemaTable[] = qiySchemaTables()): string[] {
  const ordered: string[] = [];
  const visiting = new Set<unknown>();
  const done = new Set<unknown>();
  const visit = (entry: QiySchemaTable, path: string[]): void => {
    if (done.has(entry.table)) return;
    if (visiting.has(entry.table)) throw new Error("Cyclic foreign keys are not supported by db:backup/db:restore: " + [...path, entry.name].join(" -> "));
    visiting.add(entry.table);
    for (const reference of entry.references) {
      const target = tables.find((candidate) => candidate.table === reference);
      if (target) visit(target, [...path, entry.name]);
    }
    visiting.delete(entry.table);
    done.add(entry.table);
    ordered.push(entry.name);
  };
  for (const table of tables) visit(table, []);
  return ordered;
}
`,
    "api/src/db-backup.ts": `import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { encodeRow, type QiyBackupDocument } from "./backup-codec";
import { qiySchemaTables, qiyWriteOrder } from "./schema-tables";
import { DIALECT } from "./schema-drift";

const argument = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};
const retention = (() => {
  const raw = Bun.env.QIY_BACKUP_RETENTION;
  if (raw === undefined || raw === "") return 7;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error("QIY_BACKUP_RETENTION must be a non-negative integer");
  return value;
})();

const directory = resolve(import.meta.dir, "..", argument("--out-dir") ?? "backups");
await mkdir(directory, { recursive: true });
const tables = qiySchemaTables();
const order = qiyWriteOrder(tables);
const document: QiyBackupDocument = { version: 1, dialect: DIALECT, createdAt: new Date().toISOString(), tables: {} };
let total = 0;
for (const name of order) {
  const table = tables.find((candidate) => candidate.name === name)!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await db.select().from(table.table as never) as Array<Record<string, unknown>>;
  document.tables[name] = rows.map((row) => encodeRow(row));
  total += rows.length;
  console.log("qiy db:backup: " + name + " " + rows.length + " row(s)");
}
const stamp = document.createdAt.replace(/[:.]/g, "-");
const file = resolve(directory, argument("--out") ?? ("qiy-" + stamp + ".json"));
await Bun.write(file, JSON.stringify(document));
console.log("qiy db:backup (" + DIALECT + "): wrote " + total + " row(s) from " + order.length + " table(s) to " + file);

let removed = 0;
if (retention > 0) {
  const entries = (await readdir(directory)).filter((name) => name.startsWith("qiy-") && name.endsWith(".json"));
  const sorted: Array<{ name: string; modified: number }> = [];
  for (const name of entries) sorted.push({ name, modified: (await stat(resolve(directory, name))).mtimeMs });
  sorted.sort((first, second) => second.modified - first.modified || second.name.localeCompare(first.name));
  for (const stale of sorted.slice(retention)) { await rm(resolve(directory, stale.name)); removed++; }
  if (removed) console.log("qiy db:backup: retention " + retention + " removed " + removed + " older backup(s)");
}
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
process.exit(0);
`,
    "api/src/db-restore.ts": `import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { decodeRow, type QiyBackupDocument } from "./backup-codec";
import { qiySchemaTables, qiyWriteOrder } from "./schema-tables";
import { DIALECT } from "./schema-drift";

const argument = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};
if (!Bun.argv.includes("--confirm")) {
  console.error("qiy db:restore replaces every row in this database. Re-run with --confirm to proceed.");
  process.exit(1);
}
const target = argument("--file");
if (!target) { console.error("qiy db:restore: --file <backup.json> is required"); process.exit(1); }
const source = Bun.file(resolve(target));
if (!await source.exists()) { console.error("qiy db:restore: backup file not found: " + resolve(target)); process.exit(1); }
const document = JSON.parse(await source.text()) as QiyBackupDocument;
if (document.version !== 1) { console.error("qiy db:restore: unsupported backup version " + String(document.version)); process.exit(1); }
if (document.dialect !== DIALECT) { console.error("qiy db:restore: backup was written for " + document.dialect + " but this project targets " + DIALECT); process.exit(1); }

const tables = qiySchemaTables();
const order = qiyWriteOrder(tables);
const known = new Set(order);
const missing = order.filter((name) => !(name in document.tables));
const unexpected = Object.keys(document.tables).filter((name) => !known.has(name));
if (missing.length || unexpected.length) {
  console.error("qiy db:restore: the backup does not match src/schema.ts" + (missing.length ? " (missing: " + missing.join(", ") + ")" : "") + (unexpected.length ? " (unknown: " + unexpected.join(", ") + ")" : ""));
  process.exit(1);
}

const rowsFor = (name: string): Array<Record<string, unknown>> => {
  const table = tables.find((candidate) => candidate.name === name)!;
  const types = Object.fromEntries(table.columns.map((column) => [column.name, column.dataType]));
  return (document.tables[name] ?? []).map((row) => decodeRow(row, types));
};

let total = 0;
${database.dialect === "sqlite" ? `db.transaction((tx) => {
  for (const name of [...order].reverse()) (tx.delete(tables.find((candidate) => candidate.name === name)!.table as never) as any).run();
  for (const name of order) {
    const rows = rowsFor(name);
    for (const values of rows) (tx.insert(tables.find((candidate) => candidate.name === name)!.table as never).values(values as never) as any).run();
    total += rows.length;
  }
});
` : `await db.transaction(async (tx) => {
  for (const name of [...order].reverse()) await (tx.delete(tables.find((candidate) => candidate.name === name)!.table as never) as any);
  for (const name of order) {
    const rows = rowsFor(name);
    for (const values of rows) await (tx.insert(tables.find((candidate) => candidate.name === name)!.table as never).values(values as never) as any);
    total += rows.length;
  }
});
`}console.log("qiy db:restore (" + DIALECT + "): restored " + total + " row(s) into " + order.length + " table(s) from " + resolve(target));
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
process.exit(0);
`,
    "api/tests/backup-codec.test.ts": `import { expect, test } from "bun:test";
import { decodeRow, decodeValue, encodeRow, encodeValue } from "../src/backup-codec";

test("round-trips values that JSON cannot carry faithfully", () => {
  const when = new Date("2026-02-03T04:05:06.789Z");
  const bytes = new Uint8Array([0, 1, 250, 255]);
  expect(encodeValue(when)).toEqual({ $qiy: "date", value: "2026-02-03T04:05:06.789Z" });
  expect(decodeValue(encodeValue(when), "date")).toEqual(when);
  expect(encodeValue(bytes)).toEqual({ $qiy: "bytes", value: Buffer.from(bytes).toString("base64") });
  expect(Array.from(decodeValue(encodeValue(bytes), "buffer") as Uint8Array)).toEqual([0, 1, 250, 255]);
  expect(encodeValue(9007199254740993n)).toEqual({ $qiy: "bigint", value: "9007199254740993" });
  expect(decodeValue(encodeValue(9007199254740993n), "bigint")).toBe(9007199254740993n);
  expect(encodeValue(null)).toBeNull();
  expect(encodeValue(undefined)).toBeNull();
  expect(encodeValue("text")).toBe("text");
  expect(encodeValue(12.5)).toBe(12.5);
  expect(encodeValue({ nested: when })).toEqual({ nested: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" } });
  for (const value of [when, bytes, 9007199254740993n, { nested: when }]) expect(() => JSON.stringify(encodeValue(value))).not.toThrow();
});

test("decodes rows using the declared column types", () => {
  const row = { id: "one", placedAt: { $qiy: "date", value: "2026-02-03T04:05:06.789Z" }, amount: "10.50", note: null };
  const decoded = decodeRow(row, { id: "string", placedAt: "date", amount: "string", note: "string" });
  expect(decoded.id).toBe("one");
  expect(decoded.placedAt).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decoded.amount).toBe("10.50");
  expect(decoded.note).toBeNull();
  // A string timestamp for a date column is coerced, an unparsable one is kept as-is.
  expect(decodeValue("2026-02-03T04:05:06.789Z", "date")).toEqual(new Date("2026-02-03T04:05:06.789Z"));
  expect(decodeValue("not-a-date", "date")).toBe("not-a-date");
  expect(decodeRow(encodeRow({ when: new Date("2026-02-03T04:05:06.789Z") }), { when: "date" }).when).toEqual(new Date("2026-02-03T04:05:06.789Z"));
});
`,
    "api/src/db-migrate.ts": `import { migrate } from "drizzle-orm/${database.dialect === "postgresql" ? "bun-sql" : database.dialect === "mysql" ? "mysql2" : "bun-sqlite"}/migrator";
import { resolve } from "node:path";
import { db${database.dialect === "postgresql" ? "" : ", client"} } from "./db";
import { appliedMigrations, compareSchema, DIALECT, expectedTables, introspect } from "./schema-drift";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
${database.dialect === "postgresql" ? `// A dedicated single-connection session holds the advisory lock for the whole run.
const { SQL } = await import("bun");
const session = new SQL(Bun.env.DATABASE_URL!, { max: 1 });
const lockKey = 4815162342;
await session.unsafe("select pg_advisory_lock(" + lockKey + ")");
console.log("qiy db:migrate: acquired advisory lock " + lockKey);
` : database.dialect === "mysql" ? `// GET_LOCK is per session, so use one dedicated pooled connection.
const session = await client.getConnection();
const [lockRows] = await session.query("select get_lock('qiy_migrate', 60) as acquired") as unknown as [Array<{ acquired: number | null }>, unknown];
if (Number(lockRows[0]?.acquired ?? 0) !== 1) throw new Error("Could not acquire the qiy_migrate lock within 60s");
console.log("qiy db:migrate: acquired the qiy_migrate lock");
` : `// SQLite is a single-writer file database; concurrent migrations are documented as unsupported.
console.log("qiy db:migrate: SQLite has no cross-process lock; run migrations from one process");
`}const before = await appliedMigrations();
try {
  await migrate(db, { migrationsFolder });
} finally {
${database.dialect === "postgresql" ? `  await session.unsafe("select pg_advisory_unlock(" + lockKey + ")");
  await session.close();
` : database.dialect === "mysql" ? `  await session.query("select release_lock('qiy_migrate')");
  session.release();
` : ""}}
const after = await appliedMigrations();
console.log("qiy db:migrate (" + DIALECT + "): applied " + (after === null ? "unknown" : after) + " migration(s), previously " + (before ?? "unknown"));

// Migrating is not the same as matching the code: verify the live structure now.
const report = compareSchema(expectedTables(), await introspect());
for (const error of report.errors) console.error("drift: " + error);
for (const warning of report.warnings) console.warn("warning: " + warning);
${database.dialect === "sqlite" ? "client.close();" : database.dialect === "mysql" ? "await client.end();" : ""}
if (report.errors.length) {
  console.error("qiy db:migrate (" + DIALECT + "): migrations ran but the database still does not match src/schema.ts");
  process.exit(1);
}
console.log("qiy db:migrate (" + DIALECT + "): database matches src/schema.ts");
process.exit(0);
`,
    "api/src/db-rollback.ts": `import { resolve } from "node:path";
import { appliedMigrations, client } from "./schema-drift";

// Rolling back is a reviewed operation: Qiy applies a reverse migration that a
// human wrote for a specific migration tag, then removes its bookkeeping row.
if (!Bun.argv.includes("--confirm")) {
  console.error("qiy db:rollback reverts the most recent applied migration. Re-run with --confirm to proceed.");
  process.exit(1);
}
const journalFile = Bun.file(new URL("../drizzle/meta/_journal.json", import.meta.url));
if (!await journalFile.exists()) { console.error("qiy db:rollback: drizzle/meta/_journal.json is missing; run db:generate first"); process.exit(1); }
const entries = (await journalFile.json() as { entries?: Array<{ tag?: string }> }).entries ?? [];
const applied = (await appliedMigrations()) ?? 0;
if (applied < 1) { console.error("qiy db:rollback: this database has no applied migration to revert"); process.exit(1); }
const last = entries[applied - 1];
if (!last?.tag) { console.error("qiy db:rollback: could not resolve the tag of applied migration " + applied + "; the journal and the database are out of sync"); process.exit(1); }
const reverseFile = resolve(import.meta.dir, "../drizzle/down/" + last.tag + ".sql");
const reverse = Bun.file(reverseFile);
if (!await reverse.exists()) {
  console.error("qiy db:rollback: no reviewed reverse migration for " + last.tag);
  console.error("Author " + reverseFile + " with the statements that undo that migration, review them, and run this command again.");
  process.exit(1);
}
const statements = (await reverse.text()).split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
if (!statements.length) { console.error("qiy db:rollback: " + reverseFile + " contains no statements"); process.exit(1); }
${database.dialect === "postgresql" ? `const { SQL } = await import("bun");
const session = new SQL(Bun.env.DATABASE_URL!, { max: 1 });
const run = (statement: string) => session.unsafe(statement);
const close = async () => { await session.close(); };
` : database.dialect === "mysql" ? `const session = await client.getConnection();
const run = (statement: string) => session.query(statement);
const close = async () => { session.release(); await client.end(); };
` : `const run = (statement: string) => { client.exec(statement); return Promise.resolve(); };
const close = async () => { client.close(); };
`}try {
  await run("BEGIN");
  for (const statement of statements) await run(statement);
  await run(${database.dialect === "postgresql" ? '"delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)"' : database.dialect === "mysql" ? '"delete from __drizzle_migrations order by id desc limit 1"' : '"delete from __drizzle_migrations where rowid = (select max(rowid) from __drizzle_migrations)"'});
  await run("COMMIT");
  console.log("qiy db:rollback: reverted " + last.tag + " and removed its migration record");
  console.log("qiy db:rollback: revert the matching change in src/schema.ts and any generated code, then re-run db:check");
} catch (error) {
  await run("ROLLBACK").catch(() => undefined);
  console.error("qiy db:rollback: rolled back the reverse migration because it failed");
  throw error;
} finally {
  await close();
}
`,
    "api/src/pagination.ts": `export function withPaginationLimit<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "list" || typeof value !== "function") return value;
      return (page: number, pageSize: number, ...args: unknown[]) => {
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid pagination");
        return Reflect.apply(value, target, [page, pageSize, ...args]);
      };
    },
  });
}
`,
    "api/src/schema.ts": `${generatedDocumentation(database)}${generatedSchema}`,
    "api/drizzle.config.ts": database.dialect === "postgresql" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://qiy:qiy@localhost:5432/qiy" } });\n` : database.dialect === "sqlite" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "sqlite", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "./qiy.sqlite" } });\n` : `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "mysql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://qiy:qiy@localhost:3306/qiy" } });\n`,
    "api/src/app.ts": `import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 ${permissions ? 'import { loadPermissions } from "./auth/permissions";' : ""}
 ${options.realtime ? 'import { createRealtimeRoutes } from "./realtime";' : ""}
 ${imports}

export interface Repositories {
${interfaces}
}

export function normalizeCorsOrigins(origins: string[]): string[] {
  const unique = new Set<string>();
  for (const origin of origins) {
    if (origin.includes("*")) throw new Error("CORS origin must be an exact http(s) origin without a path or wildcard: " + origin);
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error("Invalid CORS origin: " + origin); }
    if (origin.includes("*") || (parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error("CORS origin must be an exact http(s) origin without a path or wildcard: " + origin);
    }
    unique.add(origin);
  }
  return [...unique];
}

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeWorkflows = true, includeStorage = true, corsOrigins?: string[], includeDataflows = true) {
   const configuredOrigins = ${JSON.stringify(options.corsOrigins ?? [])} as string[];
   const environmentOrigins = Bun.env.QIY_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
   const allowedOrigins = normalizeCorsOrigins(corsOrigins ?? (environmentOrigins.length > 0 ? environmentOrigins : configuredOrigins));
   const guard = createAuthorizationGuard(authenticate, ${protectedResources}, ${pageRules}, ${JSON.stringify(hybridAuth ? ["/api/v1/auth/providers", "/api/v1/auth/exchange", "/api/v1/auth/oauth/register"] : multiProviderAuth ? ["/api/v1/auth/providers", "/api/v1/auth/exchange"] : [])}, ${JSON.stringify(dataflowRoutes ? ["commands"] : [])});
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => {
      const principal = await authenticate(request);
      if (!principal) return null;${permissions ? `
      // Effective permissions are always additive: role group, database column and verified claims.
      const permissionSnapshot = await loadPermissions(principal);
      return { ...principal, permissions: permissionSnapshot.permissions, groups: permissionSnapshot.groups };` : ""}
    })
 ${apps};
 ${orderWorkflow ? '   const workflow = includeWorkflows ? (await import("./workflows/order")).createOrderWorkflowRoutes(authenticate) : undefined;' : ''}
 ${dataflowRoutes ? '   const dataflows = includeDataflows ? (await import("./dataflows")).createDataflowRoutes(authenticate) : undefined;' : ''}
    ${options.realtime ? "const realtime = createRealtimeRoutes(authenticate);" : ""}
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
    ${hasLocalAuth ? 'const authRoutes = (await import("./auth/local")).createLocalAuthRoutes();' : auth?.provider === "otp" ? 'const authRoutes = (await import("./auth/otp")).createOtpAuthRoutes();' : ''}
    ${hasLocalAuth ? 'const accountRoutes = (await import("./auth/account")).createAccountRoutes(authenticate);' : ''}
    ${hybridAuth ? 'const authProviderRoutes = (await import("./auth/oidc")).createHybridAuthRoutes(authenticate);' : multiProviderAuth ? 'const authProviderRoutes = (await import("./auth/oidc")).createAuthProviderRoutes();' : ''}
    ${permissions ? 'const permissionRoutes = (await import("./auth/permission-routes")).createPermissionRoutes(authenticate);' : ''}
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes)${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? '' : '.use(createGraphQLRoutes(repositories, authenticate))'};
    let composed = application;
    ${hasLocalAuth || auth?.provider === "otp" ? "composed = composed.use(authRoutes);" : ""}
    ${hasLocalAuth ? "composed = composed.use(accountRoutes);" : ""}
    ${hybridAuth || multiProviderAuth ? "composed = composed.use(authProviderRoutes);" : ""}
    ${permissions ? "composed = composed.use(permissionRoutes);" : ""}
    ${orderWorkflow ? "composed = workflow ? composed.use(workflow) : composed;" : ""}
    ${dataflowRoutes ? "composed = dataflows ? composed.use(dataflows) : composed;" : ""}
    ${options.realtime ? "composed = composed.use(realtime);" : ""}
    composed = storage ? composed.use(storage) : composed;
    composed = composed.use((await import("./saved-views")).createSavedViewsRoutes(authenticate));
    ${auth ? 'composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticate));' : ""}
    return registerPlugins(composed, { repositories, authenticate });
}
`,
    "api/src/modules/index.ts": database.entities.map((entity) => `export { ${modelName(entity)}Routes } from "./${entity.name}/${entity.name}.routes";`).join("\n") + "\n",
    "api/src/graphql.ts": renderGraphQL(scopedDatabase, hasLocalAuth ? { [options.auth!.userEntity]: [options.auth!.passwordField!] } : {}, options.dataflows ?? [], options.actions ?? [], (options.realtime?.resources ?? []).flatMap((resource) => {
      const entity = scopedDatabase.entities.find((candidate) => candidate.name === resource.resource || candidate.tableName === resource.resource);
      return entity ? [entity] : [];
    })),
    "api/src/graphql-adapter.ts": renderGraphQLAdapter(scopedDatabase, options.dataflows ?? [], options.actions ?? []),
    ...(options.realtime ? {
      "api/src/realtime-bus.ts": `export interface QiyRealtimeBusEvent { id: string; channel: string; event: string; record: Record<string, unknown> }

export type QiyRealtimeRecordEvent = { id: string; channel: string; event: string; record: Record<string, unknown> };

type Listener = (event: QiyRealtimeBusEvent) => void;
const listeners = new Set<Listener>();

/** In-process fan-out for delivered realtime events. Cross-replica delivery still uses Ably. */
export function publishRealtimeEvent(event: QiyRealtimeBusEvent): void {
  for (const listener of [...listeners]) {
    try { listener(event); } catch { /* one slow subscriber must not break delivery */ }
  }
}

export function subscribeRealtimeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export type QiyRealtimeIterator = AsyncIterableIterator<QiyRealtimeBusEvent> & { close: () => void };

/** Bridges the bus into the async iterator graphql-js subscriptions consume. */
export function realtimeEventIterator(channel: string): QiyRealtimeIterator {
  const queue: QiyRealtimeBusEvent[] = [];
  let pending: ((result: IteratorResult<QiyRealtimeBusEvent>) => void) | undefined;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    const resolve = pending;
    pending = undefined;
    resolve?.({ value: undefined as never, done: true });
  };
  const unsubscribe = subscribeRealtimeEvents((event) => {
    if (closed || event.channel !== channel) return;
    const resolve = pending;
    if (resolve) { pending = undefined; resolve({ value: event, done: false }); }
    else queue.push(event);
  });
  const iterator: QiyRealtimeIterator = {
    close: stop,
    [Symbol.asyncIterator]() { return iterator; },
    next() {
      if (closed) return Promise.resolve({ value: undefined as never, done: true });
      const queued = queue.shift();
      if (queued) return Promise.resolve({ value: queued, done: false });
      return new Promise<IteratorResult<QiyRealtimeBusEvent>>((resolve) => { pending = resolve; });
    },
    return() { stop(); return Promise.resolve({ value: undefined as never, done: true }); },
  };
  return iterator;
}
`,
      "api/src/realtime.ts": renderRealtime(options.realtime, database.dialect, options.dataflows ?? []),
      "api/src/realtime-admin.ts": renderRealtimeAdminCli(),
      "api/tests/realtime-admin.test.ts": renderRealtimeAdminCliTest(),
      "api/tests/realtime.test.ts": `import { afterEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
${database.dialect === "sqlite" ? 'import { inArray } from "drizzle-orm";\nimport { client, db } from "../src/db";\nimport { auditEvents, realtimeOutbox } from "../src/schema";\n' : ""}import { cleanupRealtimeOutbox, createRealtimeRoutes, dispatchRealtimeOutbox, publishRealtime, realtimeCapabilities, type RealtimeOutboxRecord, type RealtimeOutboxStore } from "../src/realtime";

afterEach(() => { Bun.env.QIY_REALTIME_DISABLED = "1"; });

test("isolates and rotates read-only metrics credentials without granting administrator access", async () => {
  const previousToken = Bun.env.QIY_REALTIME_METRICS_TOKEN;
  let reads = 0;
  const store = { metrics: async () => { reads++; return { pending: 2, leased: 0, deadLettered: 0, delivered: 3, oldestPendingAt: null }; } } as unknown as RealtimeOutboxStore;
  const app = new Elysia().use(createRealtimeRoutes(async () => null, undefined, store));
  const request = (path: string, token?: string, method = "GET", body?: string) => app.handle(new Request("http://localhost/api/v1/realtime" + path, {
    method, headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body,
  }));
  try {
    delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
    expect((await request("/outbox/metrics/prometheus", "scrape-token-a")).status).toBe(401);
    Bun.env.QIY_REALTIME_METRICS_TOKEN = "scrape-token-a";
    expect((await request("/outbox/metrics/prometheus")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "wrong")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "scrape-token-b")).status).toBe(401);
    expect(reads).toBe(0);
    const accepted = await request("/outbox/metrics/prometheus", "scrape-token-a");
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("qiy_realtime_outbox_pending 2");
    for (const path of ["/outbox/metrics", "/outbox/health", "/outbox/dead"]) expect((await request(path, "scrape-token-a")).status).toBe(401);
    expect((await request("/token", "scrape-token-a", "POST")).status).toBe(401);
    expect((await request("/outbox/replay", "scrape-token-a", "POST", JSON.stringify({ ids: ["11111111-1111-4111-8111-111111111111"] }))).status).toBe(401);
    expect((await request("/outbox/delivered", "scrape-token-a", "DELETE")).status).toBe(401);
    Bun.env.QIY_REALTIME_METRICS_TOKEN = "scrape-token-b";
    expect((await request("/outbox/metrics/prometheus", "scrape-token-a")).status).toBe(401);
    expect((await request("/outbox/metrics/prometheus", "scrape-token-b")).status).toBe(200);
    expect(reads).toBe(2);
  } finally {
    if (previousToken === undefined) delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
    else Bun.env.QIY_REALTIME_METRICS_TOKEN = previousToken;
  }
});

test("issues role-scoped subscribe-only Ably token requests", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = { auth: { createTokenRequest: async (request: Record<string, unknown>) => { requests.push(request); return { keyName: "test", nonce: "nonce", mac: "mac", timestamp: 1, capability: request.capability, clientId: request.clientId }; } }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const app = new Elysia().use(createRealtimeRoutes(async () => ({ id: "operator-1", name: "Operator", role: "operator" }), () => client));
  const response = await app.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0]!.capability))).toEqual(realtimeCapabilities({ id: "operator-1", name: "Operator", role: "operator" }));
  const operations = Object.values(JSON.parse(String(requests[0]!.capability)) as Record<string, string[]>).flat();
  expect(operations.length).toBeGreaterThan(0);
  expect(operations.every((operation) => operation === "subscribe")).toBe(true);
});

test("rejects anonymous principals and roles without subscribed channels", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const client = { auth: { createTokenRequest: async () => { throw new Error("token request must not be issued"); } }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  const anonymous = new Elysia().use(createRealtimeRoutes(async () => null, () => client));
  const anonymousResponse = await anonymous.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(anonymousResponse.status).toBe(401);
  expect(await anonymousResponse.json()).toEqual({ error: "Authentication required" });

  const unauthorized = new Elysia().use(createRealtimeRoutes(async () => ({ id: "viewer-1", name: "Viewer", role: "viewer" }), () => client));
  const unauthorizedResponse = await unauthorized.handle(new Request("http://localhost/api/v1/realtime/token", { method: "POST" }));
  expect(unauthorizedResponse.status).toBe(403);
  expect(await unauthorizedResponse.json()).toEqual({ error: "Realtime subscription is not permitted" });
});

test("publishes only declared resource events after callers commit", async () => {
  const published: unknown[] = [];
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const client = { auth: { createTokenRequest: async () => ({}) }, channels: { get: (channel: string) => ({ publish: async (type: string, payload: unknown) => published.push({ channel, type, payload }) }) } } as any;
  const subscription = ${JSON.stringify(options.realtime.resources[0])};
  await publishRealtime(subscription.resource, subscription.events[0] as "created" | "updated" | "deleted", { id: "record-1" }, () => client);
  await publishRealtime("unknown", "created", { id: "record-2" }, () => client);
  expect(published).toEqual([{ channel: "qiy:" + subscription.resource, type: subscription.events[0], payload: { id: "record-1" } }]);
});

test("keeps failed outbox records pending and retries them", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  const record: RealtimeOutboxRecord = { id: "event-1", channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  const delivered: string[] = [];
  const failures: Array<{ id: string; attempts: number; error: string; availableAt: Date }> = [];
  const store: RealtimeOutboxStore = {
    claim: async () => [record],
    delivered: async (id) => { delivered.push(id); },
    failed: async (id, _leaseOwner, attempts, error, availableAt) => { failures.push({ id, attempts, error, availableAt }); record.attempts = attempts; },
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async () => 0,
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const failedClient = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { throw new Error("provider unavailable"); } }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => failedClient, store)).toEqual({ delivered: 0, failed: 1, deadLettered: 0 });
  expect(failures[0]?.id).toBe("event-1");
  expect(failures[0]?.attempts).toBe(1);
  expect(failures[0]?.availableAt.getTime()).toBeGreaterThan(Date.now());
  const workingClient = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => {} }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => workingClient, store)).toEqual({ delivered: 1, failed: 0, deadLettered: 0 });
  expect(delivered).toEqual(["event-1"]);
});

test("claims an outbox record only once across concurrent workers", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_LEASE_MS = "30000";
  const record: RealtimeOutboxRecord = { id: "event-1", channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  let claimed = false;
  const delivered: string[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => claimed ? [] : (claimed = true, [record]),
    delivered: async (id, leaseOwner) => { delivered.push(leaseOwner + ":" + id); },
    failed: async () => {},
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async () => 0,
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const published: string[] = [];
  const client = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { published.push("event-1"); } }) } } as any;
  expect(await Promise.all([
    dispatchRealtimeOutbox(10, () => client, store, "worker-a"),
    dispatchRealtimeOutbox(10, () => client, store, "worker-b"),
  ])).toEqual(expect.arrayContaining([{ delivered: 1, failed: 0, deadLettered: 0 }, { delivered: 0, failed: 0, deadLettered: 0 }]));
  expect(published).toEqual(["event-1"]);
  expect(delivered).toHaveLength(1);
});

test("dead-letters exhausted events and restricts replay and cleanup to admins", async () => {
  Bun.env.QIY_REALTIME_DISABLED = "0";
  Bun.env.QIY_REALTIME_MAX_ATTEMPTS = "1";
  const eventId = "00000000-0000-4000-8000-000000000099";
  const missingId = "00000000-0000-4000-8000-000000000100";
  const record: RealtimeOutboxRecord = { id: eventId, channel: "qiy:orders", type: "updated", payload: JSON.stringify({ id: "order-1" }), attempts: 0 };
  const dead: RealtimeOutboxRecord[] = [];
  const replayed: string[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => dead.length ? [] : [record],
    delivered: async () => {},
    failed: async () => {},
    dead: async (_id, _leaseOwner, attempts, lastError) => { record.attempts = attempts; Object.assign(record, { lastError }); dead.push(record); },
    deadLetters: async () => dead,
    replay: async (id) => { if (id !== eventId) return false; replayed.push(id); return true; },
    replayMany: async (ids) => { const found = ids.filter((id) => id === eventId); replayed.push(...found); return found; },
    cleanupDelivered: async () => 2,
    metrics: async () => ({ pending: 4, leased: 1, deadLettered: dead.length, delivered: 9, oldestPendingAt: new Date("2026-10-01T00:00:00.000Z") }),
  };
  const unavailable = { auth: { createTokenRequest: async () => ({}) }, channels: { get: () => ({ publish: async () => { throw new Error("provider unavailable"); } }) } } as any;
  expect(await dispatchRealtimeOutbox(10, () => unavailable, store, "worker-a")).toEqual({ delivered: 0, failed: 0, deadLettered: 1 });
  expect(dead).toHaveLength(1);
  const authenticate = async (request: Request) => ({ id: "user-1", name: "User", role: request.headers.get("x-role") === "admin" ? "admin" as const : "operator" as const });
  const app = new Elysia().use(createRealtimeRoutes(authenticate, () => unavailable, store));
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { "x-role": "operator" } }))).status).toBe(403);
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/health", { headers: { "x-role": "operator" } }))).status).toBe(403);
  Bun.env.QIY_REALTIME_METRICS_TOKEN = "metrics-only-token";
  const scrape = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { authorization: "Bearer metrics-only-token" } }));
  expect(scrape.status).toBe(200);
  expect(await scrape.text()).toContain("qiy_realtime_outbox_pending 4");
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { authorization: "Bearer metrics-only-token" } }))).status).toBe(403);
  delete Bun.env.QIY_REALTIME_METRICS_TOKEN;
  expect((await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "operator" }, body: JSON.stringify({ ids: [eventId] }) }))).status).toBe(403);
  const listed = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/dead", { headers: { "x-role": "admin" } }));
  expect(listed.status).toBe(200);
  expect((await listed.json() as { data: unknown[] }).data).toHaveLength(1);
  const metrics = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics", { headers: { "x-role": "admin" } }));
  expect(metrics.status).toBe(200);
  expect(await metrics.json()).toEqual({ pending: 4, leased: 1, deadLettered: 1, delivered: 9, oldestPendingAt: "2026-10-01T00:00:00.000Z" });
  Bun.env.QIY_REALTIME_ALERT_MAX_PENDING = "3";
  Bun.env.QIY_REALTIME_ALERT_MAX_DEAD_LETTERED = "0";
  Bun.env.QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS = "1000";
  const health = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/health", { headers: { "x-role": "admin" } }));
  expect(health.status).toBe(503);
  const healthPayload = await health.json() as { status: string; alerts: string[]; metrics: { oldestPendingAgeMs: number } };
  expect(healthPayload.status).toBe("degraded");
  expect(healthPayload.alerts).toEqual(["pending", "deadLettered", "oldestPendingAgeMs"]);
  expect(healthPayload.metrics.oldestPendingAgeMs).toBeGreaterThan(1000);
  const prometheus = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/metrics/prometheus", { headers: { "x-role": "admin" } }));
  expect(prometheus.status).toBe(200);
  expect(prometheus.headers.get("content-type")).toContain("text/plain");
  const prometheusText = await prometheus.text();
  expect(prometheusText).toContain("qiy_realtime_outbox_pending 4");
  expect(prometheusText).toContain("qiy_realtime_outbox_dead_lettered 1");
  expect(prometheusText).toContain("qiy_realtime_outbox_health 0");
  delete Bun.env.QIY_REALTIME_ALERT_MAX_PENDING;
  delete Bun.env.QIY_REALTIME_ALERT_MAX_DEAD_LETTERED;
  delete Bun.env.QIY_REALTIME_ALERT_MAX_OLDEST_PENDING_MS;
  const duplicateReplay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "admin" }, body: JSON.stringify({ ids: [eventId, eventId] }) }));
  expect(duplicateReplay.status).toBe(400);
  const bulkReplay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json", "x-role": "admin" }, body: JSON.stringify({ ids: [eventId, missingId] }) }));
  expect(bulkReplay.status).toBe(200);
  expect(await bulkReplay.json()).toEqual({ replayed: [eventId], notFound: [missingId] });
  const replay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/" + eventId + "/replay", { method: "POST", headers: { "x-role": "admin" } }));
  expect(replay.status).toBe(200);
  expect(replayed).toEqual([eventId, eventId]);
  const cleanup = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/delivered?retentionDays=30", { method: "DELETE", headers: { "x-role": "admin" } }));
  expect(cleanup.status).toBe(200);
  expect(await cleanup.json()).toEqual({ deleted: 2, retentionDays: 30 });
});

${database.dialect === "sqlite" ? `test("audits bulk replay and cleanup in the same SQLite transactions", async () => {
  const actorId = "00000000-0000-4000-8000-000000000201";
  const firstId = "00000000-0000-4000-8000-000000000202";
  const secondId = "00000000-0000-4000-8000-000000000203";
  const deliveredId = "00000000-0000-4000-8000-000000000204";
  const eventIds = [firstId, secondId, deliveredId];
  const actions = ["realtime.outbox.bulk_replayed", "realtime.outbox.cleaned"];
  client.exec("CREATE TABLE IF NOT EXISTS qiy_realtime_outbox (id text primary key, channel text not null, type text not null, payload text not null, attempts integer not null, availableAt integer not null, deliveredAt integer, deadLetteredAt integer, lastError text, leaseOwner text, leaseUntil integer, createdAt integer not null)");
  db.insert(realtimeOutbox).values([
    { id: firstId, channel: "qiy:event:test", type: "test.failed", payload: "{}", attempts: 1, availableAt: new Date(0), deadLetteredAt: new Date(0), createdAt: new Date(0) },
    { id: secondId, channel: "qiy:event:test", type: "test.failed", payload: "{}", attempts: 1, availableAt: new Date(0), deadLetteredAt: new Date(0), createdAt: new Date(0) },
    { id: deliveredId, channel: "qiy:event:test", type: "test.delivered", payload: "{}", attempts: 0, availableAt: new Date(0), deliveredAt: new Date(0), createdAt: new Date(0) },
  ]).run();
  const app = new Elysia().use(createRealtimeRoutes(async () => ({ id: actorId, name: "Admin", role: "admin" })));
  try {
    const replay = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/replay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [firstId, secondId] }) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ replayed: [firstId, secondId], notFound: [] });
    const cleanup = await app.handle(new Request("http://localhost/api/v1/realtime/outbox/delivered?retentionDays=1", { method: "DELETE" }));
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ deleted: 1, retentionDays: 1 });
    const audits = db.select().from(auditEvents).where(inArray(auditEvents.action, actions)).all();
    expect(audits.map((audit) => audit.action).sort()).toEqual([...actions].sort());
    expect(audits.every((audit) => audit.actorId === actorId)).toBe(true);
  } finally {
    db.delete(realtimeOutbox).where(inArray(realtimeOutbox.id, eventIds)).run();
    db.delete(auditEvents).where(inArray(auditEvents.action, actions)).run();
    client.exec("DROP TABLE qiy_realtime_outbox");
  }
});

` : ""}test("calculates automatic cleanup cutoff from an explicit maintenance time", async () => {
  const cutoffs: Date[] = [];
  const store: RealtimeOutboxStore = {
    claim: async () => [],
    delivered: async () => {},
    failed: async () => {},
    dead: async () => {},
    deadLetters: async () => [],
    replay: async () => false,
    replayMany: async () => [],
    cleanupDelivered: async (before) => { cutoffs.push(before); return 3; },
    metrics: async () => ({ pending: 0, leased: 0, deadLettered: 0, delivered: 0, oldestPendingAt: null }),
  };
  const now = new Date("2026-10-12T12:00:00.000Z");
  expect(await cleanupRealtimeOutbox(7, store, now)).toBe(3);
  expect(cutoffs).toEqual([new Date("2026-10-05T12:00:00.000Z")]);
});
`,
    } : {}),
    "api/tests/pagination.test.ts": `import { expect, test } from "bun:test";
import { withPaginationLimit } from "../src/pagination";

test("rejects page sizes above the API limit", async () => {
  const service = withPaginationLimit({ list: async (page: number, pageSize: number) => ({ page, pageSize }) });
  expect(() => service.list(1, 101)).toThrow("Invalid pagination");
  expect(() => service.list(0, 10)).toThrow("Invalid pagination");
  expect(await service.list(2, 50)).toEqual({ page: 2, pageSize: 50 });
});
`,
    "api/tests/app.test.ts": `import { expect, test } from "bun:test";
import { createApp, normalizeCorsOrigins, type Repositories } from "../src/app";
import { createHandler } from "../src/http";

const repository = {
  distribution: async () => [],
  list: async () => ({ data: [], total: 0 }),
  one: async () => undefined,
  create: async () => ({}),
  update: async () => undefined,
  delete: async () => undefined,
  deleteMany: async () => [],
};

test("mounts REST and GraphQL at their public paths", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: crypto.randomUUID(), name: "Test Admin", role: "admin", claims: ${testClaims} }));
  const handle = createHandler((request) => app.handle(request), "./build/client");
  expect((await handle(new Request("http://localhost/api/v1/health"))).status).toBe(200);
  const specification = await handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(specification.status).toBe(200);
  expect((await specification.json() as { paths: Record<string, unknown> }).paths["/api/v1/${database.entities[0]!.tableName}/"]).toBeDefined();
  const graphql = await handle(new Request("http://localhost/graphql", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "query { ${database.entities[0]!.name} { total } }" }),
  }));
  expect(graphql.status).toBe(200);
  expect((await graphql.json() as { data: { ${database.entities[0]!.name}: { total: number } } }).data.${database.entities[0]!.name}.total).toBe(0);
  expect((await handle(new Request("http://localhost/api/v1/graphql", { method: "POST" }))).status).toBe(404);
});

test("enables CORS only for explicitly configured origins", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "cors-test", name: "Admin", role: "admin", claims: ${testClaims} }), false, false, ["https://admin.example"]);
  const allowed = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://admin.example" } }));
  expect(allowed.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  const preflight = await app.handle(new Request("http://localhost/api/v1/health", { method: "OPTIONS", headers: { Origin: "https://admin.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBe("https://admin.example");
  expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  const denied = await app.handle(new Request("http://localhost/api/v1/health", { headers: { Origin: "https://untrusted.example" } }));
  expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  expect(normalizeCorsOrigins(["https://admin.example", "https://admin.example"])).toEqual(["https://admin.example"]);
  expect(() => normalizeCorsOrigins(["*"])).toThrow("exact http(s) origin");
  expect(() => normalizeCorsOrigins(["https://admin.example/path"])).toThrow("exact http(s) origin");
});

test("denies anonymous REST and GraphQL and enforces role permissions", async () => {
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const target = "http://localhost/api/v1/${database.entities.find((entity) => entity.tableName !== "users")?.tableName ?? database.entities[0]!.tableName}/";
  const graph = "http://localhost/graphql";
  const anonymous = await createApp(repositories);
  expect((await anonymous.handle(new Request(target))).status).toBe(401);
  expect((await anonymous.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${database.entities[0]!.name} { total } }" }) }))).status).toBe(401);
  const viewer = await createApp(repositories, async () => ({ id: "viewer", name: "Viewer", role: "viewer", claims: ${testClaims} }));
  expect((await viewer.handle(new Request(target))).status).toBe(200);
  expect((await viewer.handle(new Request(target, { method: "DELETE" }))).status).toBe(403);
  expect((await viewer.handle(new Request(graph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(database.entities[0]!)}(id: \\"00000000-0000-4000-8000-000000000002\\") { id } }" }) }))).status).toBe(403);
});

test("passes the authenticated actor through REST and GraphQL mutations", async () => {
  const actors: Array<string | undefined> = [];
  const id = "00000000-0000-4000-8000-000000000002";
  const tracked = { ...repository, async delete(_id: string, actorId?: string) { actors.push(actorId); return { id }; } };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, tracked])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id, name: "Admin", role: "admin", claims: ${testClaims} }));
  expect((await app.handle(new Request("http://localhost/api/v1/${database.entities[0]!.tableName}/" + id, { method: "DELETE" }))).status).toBe(200);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(database.entities[0]!)}(id: \\"" + id + "\\") { id } }" }) }));
  expect(graph.status).toBe(200);
  expect(actors).toEqual([id, id]);
});

${uploadField ? "test" : "test.skip"}("protects file storage endpoints and rejects traversal", async () => {
  Bun.env.QIY_STORAGE_METADATA = "memory";
  Bun.env.QIY_STORAGE_PROVIDER = "local";
  Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: ${testClaims} }));
  const resource = ${JSON.stringify(uploadField?.entity.tableName ?? "missing")};
  const field = ${JSON.stringify(uploadField?.field.name ?? "missing")};
  const uploadMode = String(${JSON.stringify(uploadField?.field.uploadMode ?? "binary")}) as "binary" | "base64" | "both";
  const maxBytes = ${uploadField?.field.maxBytes ?? 25 * 1024 * 1024};
  const contentType = ${JSON.stringify(uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? (uploadField?.field.mimeTypes?.find((mime) => mime.endsWith("/*"))?.replace("*", "qiy-test") ?? "application/octet-stream"))};
  const restrictsMime = ${JSON.stringify(Boolean(uploadField?.field.mimeTypes?.length && !uploadField.field.mimeTypes.includes("*/*")))};
  const key = resource + "/" + crypto.randomUUID() + ".bin";
  const fileUrlFor = (targetKey: string, targetField = field) => "http://localhost/api/v1/files?key=" + encodeURIComponent(targetKey) + "&fileName=fixture.bin&resource=" + resource + "&field=" + targetField + "&resourceId=00000000-0000-4000-8000-000000000001";
  const base64Url = "http://localhost/api/v1/files/base64";
  const upload = (targetKey: string, bytes = "invoice", mime = contentType) => uploadMode === "base64"
    ? app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: targetKey, fileName: "fixture.bin", resource, field, resourceId: "00000000-0000-4000-8000-000000000001", contentType: mime, data: Buffer.from(bytes).toString("base64") }) }))
    : app.handle(new Request(fileUrlFor(targetKey), { method: "POST", body: new Blob([bytes], { type: mime }) }));
  const fileUrl = fileUrlFor(key);
  const metadataUrl = "http://localhost/api/v1/files/metadata?key=" + encodeURIComponent(key);
  expect((await upload(key)).status).toBe(200);
  const metadata = await app.handle(new Request(metadataUrl));
  expect(metadata.status).toBe(200);
  expect(await metadata.json() as { ownerId: string; size: number; storageKey: string; fileName: string; resource: string; resourceId: string }).toMatchObject({ ownerId: "admin", size: 7, storageKey: key, fileName: "fixture.bin", resource: ${JSON.stringify(uploadField?.entity.tableName ?? "missing")}, resourceId: "00000000-0000-4000-8000-000000000001" });
  expect((await upload(key)).status).toBe(409);
  expect((await app.handle(new Request(fileUrlFor(resource + "/unknown.bin", "missing"), { method: "POST", body: new Blob(["ok"], { type: contentType }) }))).status).toBe(400);
  if (restrictsMime) expect((await upload(resource + "/wrong-mime.bin", "ok", "application/x-qiy-disallowed")).status).toBe(415);
  expect((await upload(resource + "/too-large.bin", "x".repeat(maxBytes + 1))).status).toBe(413);
  expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: resource + "/malformed.bin", resource, field, contentType, data: "not base64" }) }))).status).toBe(400);
  if (uploadMode === "binary") {
    expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: resource + "/base64-rejected.bin", resource, field, contentType, data: Buffer.from("ok").toString("base64") }) }))).status).toBe(415);
  } else {
    const base64Key = resource + "/" + crypto.randomUUID() + "-base64.bin";
    expect((await app.handle(new Request(base64Url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: base64Key, resource, field, contentType, data: Buffer.from("base64").toString("base64") }) }))).status).toBe(200);
    expect((await app.handle(new Request(fileUrlFor(base64Key)))).status).toBe(200);
    expect((await app.handle(new Request(fileUrlFor(base64Key), { method: "DELETE" }))).status).toBe(200);
  }
  if (uploadMode === "base64") expect((await app.handle(new Request(fileUrlFor(resource + "/binary-rejected.bin"), { method: "POST", body: new Blob(["ok"], { type: contentType }) }))).status).toBe(415);
  const download = await app.handle(new Request(fileUrl));
  expect(download.status).toBe(200);
  expect(await download.text()).toBe("invoice");
  const viewer = await createApp(repositories, async () => ({ id: "another-user", name: "Viewer", role: "viewer", claims: ${testClaims} }));
  expect((await viewer.handle(new Request(fileUrl))).status).toBe(404);
  expect((await viewer.handle(new Request(metadataUrl))).status).toBe(404);
  expect((await app.handle(new Request("http://localhost/api/v1/files?key=../secret"))).status).toBe(400);
  expect((await app.handle(new Request(fileUrl, { method: "DELETE" }))).status).toBe(200);
  expect((await app.handle(new Request(metadataUrl))).status).toBe(404);
});
`,
    "api/package.json": (() => {
      const base = JSON.parse(renderAppTemplate("server", "api")["api/package.json"] ?? "{}") as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      base.dependencies = { ...(base.dependencies ?? {}), ...pluginDependencies };
      // drizzle-kit loads migrations through a dialect driver that is separate from
      // the runtime driver used by src/db.ts, so PostgreSQL projects need `postgres`
      // installed before `bun run db:migrate` can connect.
      if (database.dialect === "postgresql") base.devDependencies = { ...(base.devDependencies ?? {}), postgres: "3.4.7" };
      return JSON.stringify(base, null, 2) + "\n";
    })(),

    "api/src/plugins/index.ts": `import type { Elysia } from "elysia";
${options.elysiaPlugins?.bearer ? 'import { bearer } from "@elysia/bearer";' : ""}
${options.elysiaPlugins?.serverTiming ? 'import { serverTiming } from "@elysia/server-timing";' : ""}
${options.elysiaPlugins?.cron?.length ? 'import { cron } from "@elysia/cron";' : ""}
${options.elysiaPlugins?.jwt ? 'import { jwt } from "@elysia/jwt";' : ""}
${options.elysiaPlugins?.static ? 'import { staticPlugin } from "@elysia/static";' : ""}
${options.elysiaPlugins?.html ? 'import { html } from "@elysia/html";' : ""}
${options.elysiaPlugins?.graphqlAdapter === "yoga" ? 'import { yoga } from "@elysia/graphql-yoga";' : ""}
${options.elysiaPlugins?.graphqlAdapter === "apollo" ? 'import { apollo } from "@elysia/apollo";' : ""}
${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? 'import { createGraphQLContext, graphqlTypeDefs } from "../graphql";\nimport { createGraphQLAdapterResolvers } from "../graphql-adapter";' : ""}
${options.elysiaPlugins?.drizzle ? 'import { db } from "../db";' : ""}
${options.elysiaPlugins?.cron?.some((job) => job.task === "cleanupMissingAttachments") ? 'import { cleanupMissingAttachmentObjects } from "../storage/routes";' : ""}

export interface PluginContext {
  repositories: import("../app").Repositories;
  authenticate: import("../auth/guard").Authenticator;
}
export interface QiyPlugin {
  name: string;
  setup(app: any, context?: PluginContext): any;
}
${options.elysiaPlugins?.cron?.length ? `export function createCleanupCronJob(name: string, pattern: string, cleanup = cleanupMissingAttachmentObjects) {
  return cron({ name, pattern, unref: true, protect: true,
    catch: (error) => console.error(\`[qiy:cron:\${name}] failed\`, error),
    async run() {
    const limit = Number(Bun.env.QIY_ATTACHMENT_CLEANUP_LIMIT ?? 1000);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("QIY_ATTACHMENT_CLEANUP_LIMIT must be an integer from 1 to 10000");
    const result = await cleanup({ dryRun: false, limit });
    console.info(\`[qiy:cron:\${name}]\`, result);
  } });
}` : ""}
export const plugins: QiyPlugin[] = [
${options.elysiaPlugins?.bearer ? '  { name: "bearer", setup: (app) => app.use(bearer()) },' : ""}
${options.elysiaPlugins?.serverTiming ? '  { name: "server-timing", setup: (app) => app.use(serverTiming()) },' : ""}
${options.elysiaPlugins?.html ? '  { name: "html", setup: (app) => app.use(html()) },' : ""}
${options.elysiaPlugins?.drizzle ? '  { name: "drizzle", setup: (app) => app.decorate("db", db) },' : ""}
${options.elysiaPlugins?.jwt ? `  { name: "jwt", setup: (app) => {
    const secret = Bun.env[${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)}];
    if (!secret) throw new Error(${JSON.stringify(`${options.elysiaPlugins.jwt.secretEnv} is required when the Elysia JWT plugin is enabled`)});
    return app.use(jwt({ name: ${JSON.stringify(options.elysiaPlugins.jwt.name)}, secret }));
  } },` : ""}
${options.elysiaPlugins?.static ? `  { name: "static", setup: async (app) => app.use(await staticPlugin({ assets: ${JSON.stringify(options.elysiaPlugins.static.assets)}, prefix: ${JSON.stringify(options.elysiaPlugins.static.prefix)} })) },` : ""}
${options.elysiaPlugins?.graphqlAdapter === "yoga" ? `  { name: "graphql-yoga", setup: (app, context) => context ? app.use(yoga({ path: "/graphql", graphiql: false, landingPage: false, typeDefs: graphqlTypeDefs, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate) as any, context: ({ request }) => ({ request }) })) : app },` : ""}
${options.elysiaPlugins?.graphqlAdapter === "apollo" ? `  { name: "graphql-apollo", setup: async (app, context) => context ? app.use(await apollo({ path: "/graphql", enablePlayground: false, typeDefs: graphqlTypeDefs, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate) as any, context: async ({ request }: any) => ({ request }) })) : app },` : ""}
${(options.elysiaPlugins?.cron ?? []).map((job) => `  { name: ${JSON.stringify(job.name)}, setup: (app) => Bun.env.QIY_CRON_ENABLED === "1" ? app.use(createCleanupCronJob(${JSON.stringify(job.name)}, ${JSON.stringify(job.pattern)})) : app },`).join("\n")}
];
export async function registerPlugins(app: Elysia, context?: PluginContext): Promise<Elysia> {
  let configured: any = app;
  for (const plugin of plugins) configured = await plugin.setup(configured, context);
  return configured as Elysia;
}
`,
    ...(options.elysiaPlugins?.jwt ? { "api/tests/jwt-plugin.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { registerPlugins } from "../src/plugins";

const secretName = ${JSON.stringify(options.elysiaPlugins.jwt.secretEnv)};

test("JWT plugin refuses to start without its configured secret", async () => {
  const secret = Bun.env[secretName];
  delete Bun.env[secretName];
  try {
    await expect(registerPlugins(new Elysia())).rejects.toThrow(secretName + " is required");
  } finally {
    if (secret === undefined) delete Bun.env[secretName];
    else Bun.env[secretName] = secret;
  }
});

test("JWT plugin signs and verifies tokens through the generated registration", async () => {
  const app = (await registerPlugins(new Elysia())).get("/plugin-token", async (context) => {
    const tokenService = (context as unknown as Record<string, {
      sign(value: { sub: string }): Promise<string>;
      verify(value: string): Promise<{ sub: string } | false>;
    }>)[${JSON.stringify(options.elysiaPlugins.jwt.name)}];
    const token = await tokenService.sign({ sub: "test-user" });
    const verified = await tokenService.verify(token);
    return { subject: verified ? verified.sub : null${options.elysiaPlugins?.bearer ? ', bearer: (context as unknown as { bearer?: string }).bearer' : ''} };
  });
  const response = await app.handle(new Request("http://localhost/plugin-token"${options.elysiaPlugins?.bearer ? ', { headers: { authorization: "Bearer test-access" } }' : ''}));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ subject: "test-user"${options.elysiaPlugins?.bearer ? ', bearer: "test-access"' : ''} });
});
` } : {}),
    ...(options.elysiaPlugins?.static ? { "api/tests/static-plugin.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { registerPlugins } from "../src/plugins";

test("serves the configured public directory but does not expose server source", async () => {
  const fixture = ${JSON.stringify(`${options.elysiaPlugins.static.assets}/qiy-plugin-probe.txt`)};
  await Bun.write(fixture, "qiy-public-fixture");
  try {
    const app = await registerPlugins(new Elysia());
    const publicFile = await app.handle(new Request(${JSON.stringify(`http://localhost${options.elysiaPlugins.static.prefix}/qiy-plugin-probe.txt`)}));
    expect(publicFile.status).toBe(200);
    expect(await publicFile.text()).toBe("qiy-public-fixture");
    const source = await app.handle(new Request(${JSON.stringify(`http://localhost${options.elysiaPlugins.static.prefix}/src/db.ts`)}));
    expect(source.status).toBe(404);
  } finally {
    await unlink(fixture);
  }
});
` } : {}),
    ...(options.elysiaPlugins?.serverTiming || options.elysiaPlugins?.drizzle ? { "api/tests/plugin-context.test.ts": `import { Elysia } from "elysia";
import { expect, test } from "bun:test";
import { registerPlugins } from "../src/plugins";
${options.elysiaPlugins?.drizzle ? 'import { db } from "../src/db";' : ""}

test("configured Elysia plugins expose their runtime capabilities", async () => {
  const app = (await registerPlugins(new Elysia())).get("/plugin-context", (context) => ({
${options.elysiaPlugins?.drizzle ? '    hasDb: (context as unknown as { db: unknown }).db === db,' : ""}
    ok: true,
  }));
  const response = await app.handle(new Request("http://localhost/plugin-context"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ${options.elysiaPlugins?.drizzle ? "hasDb: true, " : ""}ok: true });
${options.elysiaPlugins?.serverTiming ? '  expect(response.headers.get("server-timing")).toMatch(/total;dur=/);' : ""}
});
` } : {}),
    ...(options.elysiaPlugins?.cron?.length ? { "api/tests/cron.test.ts": `import { Elysia } from "elysia";
import { expect, mock, test } from "bun:test";
import { createCleanupCronJob, registerPlugins } from "../src/plugins";

test("does not start Cron unless explicitly enabled", async () => {
  const previous = Bun.env.QIY_CRON_ENABLED;
  delete Bun.env.QIY_CRON_ENABLED;
  try {
    const app = (await registerPlugins(new Elysia())).get("/has-cron", ({ store }) => "cron" in store);
    const response = await app.handle(new Request("http://localhost/has-cron"));
    expect(await response.text()).toBe("false");
  } finally {
    if (previous === undefined) delete Bun.env.QIY_CRON_ENABLED;
    else Bun.env.QIY_CRON_ENABLED = previous;
  }
});

test("triggers the configured attachment cleanup task", async () => {
  const cleanup = mock(async () => ({ checked: 1, removed: 1, dryRun: false }));
  const captured: { job?: { stop(): void; trigger(): Promise<void> } } = {};
  const app = new Elysia().use(createCleanupCronJob("testCleanup", "0 0 * * *", cleanup))
    .get("/capture-cron", ({ store }) => {
      captured.job = (store as { cron: Record<string, { stop(): void; trigger(): Promise<void> }> }).cron.testCleanup;
      return "ok";
    });
  await app.handle(new Request("http://localhost/capture-cron"));
  const job = captured.job;
  if (!job) throw new Error("Cron plugin did not register the cleanup job");
  job.stop();
  const previous = console.info;
  console.info = () => {};
  try {
    await job.trigger();
    expect(cleanup).toHaveBeenCalledWith({ dryRun: false, limit: 1000 });
  } finally {
    console.info = previous;
  }
});

test("reports cleanup failures without a silent cron callback", async () => {
  const cleanup = mock(async () => { throw new Error("storage unavailable"); });
  const captured: { job?: { stop(): void; trigger(): Promise<void> } } = {};
  const app = new Elysia().use(createCleanupCronJob("failedCleanup", "0 0 * * *", cleanup))
    .get("/capture-failed-cron", ({ store }) => {
      captured.job = (store as { cron: Record<string, { stop(): void; trigger(): Promise<void> }> }).cron.failedCleanup;
      return "ok";
    });
  await app.handle(new Request("http://localhost/capture-failed-cron"));
  const job = captured.job;
  if (!job) throw new Error("Cron plugin did not register the failure test job");
  job.stop();
  const previous = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await job.trigger();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(errors[0]?.[0]).toBe("[qiy:cron:failedCleanup] failed");
  } finally {
    console.error = previous;
  }
});
` } : {}),
    "api/src/hooks/index.ts": `export interface ServerHooks {
  beforeRequest?(request: Request): void | Promise<void>;
  afterResponse?(request: Request, response: Response): void | Promise<void>;
}
`,
    "api/src/shared/errors.ts": `export class AppError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
`,
    "api/src/server.ts": `import { resolve } from "node:path";
import { createApp } from "./app";
import { createHandler } from "./http";
${auth ? `import { createProductionAuthenticator } from ${hybridAuth ? '"./auth/hybrid"' : hasLocalAuth ? '"./auth/local"' : auth.provider === "otp" ? '"./auth/otp"' : '"./auth/oidc"'};` : ''}
${options.realtime ? 'import { startRealtimeOutboxWorker } from "./realtime";' : ''}
${repositoryImports}

${auth ? '' : 'if (Bun.env.QIY_DEV_MODE !== "1") {'}
${auth ? '' : '  throw new Error("Unauthenticated V0 admin API is disabled: set QIY_DEV_MODE=1 for local development only");'}
${auth ? '' : '}'}

if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ ${database.entities.map((entity) => `${entity.name}: ${modelName(entity)}Repository`).join(", ")} }, ${auth ? 'createProductionAuthenticator()' : 'async () => ({ id: "dev", name: "Local Admin", role: "admin" })'});
${options.realtime ? 'startRealtimeOutboxWorker();' : ''}
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: Bun.env.HOST ?? "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(\`Qiy app listening on http://localhost:\${server.port}\`);
`,
    "api/src/preview.ts": `import { resolve } from "node:path";
import { createApp, type Repositories } from "./app";
import { createHandler } from "./http";

const repositories: Repositories = {
${database.entities.map((entity) => previewRepository(entity, database, options.scopes ?? [])).join("\n")}
};
const app = await createApp(repositories, async () => ({ id: "preview", name: "Preview Admin", role: "admin", claims: ${JSON.stringify(Object.fromEntries((options.scopes ?? []).map((scope) => [scope.claim, database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : `Demo ${database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)?.name}`])))} }), false, ${options.storageProvider !== "s3"});
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(\`Local-only Qiy preview: http://127.0.0.1:\${server.port}\`);
`,
  };
  if (dataflowRoutes) files["api/src/dataflows/index.ts"] = dataflowRoutes;
  const dataflowCallContracts = renderDataflowCallContracts(options.dataflows ?? []);
  const dataflowCallExtensions = renderDataflowCallExtensions(options.dataflows ?? []);
  if (dataflowCallContracts) files["api/src/dataflows/calls.ts"] = dataflowCallContracts;
  if (dataflowCallExtensions) files["api/src/extensions/dataflow-calls.ts"] = dataflowCallExtensions;
  const realtimeOutboxTest = options.realtime ? renderSqliteRealtimeOutboxTest(database, options.realtime) : undefined;
  if (realtimeOutboxTest) files["api/tests/realtime-outbox-transaction.test.ts"] = realtimeOutboxTest;
  const dataflowTest = renderSqliteDataflowTest(database, options.dataflows ?? [], options.actions ?? [], options.realtime !== undefined, permissions);
  if (dataflowTest) {
    files["api/tests/dataflow.test.ts"] = dataflowTest;
    const failureFlows = (options.dataflows ?? []).map((flow) => {
      const mutations = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "create" || action.kind === "delete");
      const mutation = mutations.at(-1);
      if (mutation) {
        const creation = mutation.kind === "create" ? mutation : flow.steps.flatMap((step) => step.actions).find((action) => action.kind === "create" && action.context === mutation.context);
        return { ...flow, steps: [...flow.steps, { name: "qiyTestLateFailure", order: Math.max(...flow.steps.map((step) => step.order)) + 1, actions: [{ kind: "require" as const, left: `${mutation.context}.id`, operator: creation ? "==" as const : "!=" as const, right: creation ? "00000000-0000-4000-8000-000000000000" : "00000000-0000-4000-8000-000000000001", error: "qiy.test.lateFailure" }] }] };
      }
      const updates = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "update");
      const last = updates.at(-1);
      if (!last) return flow;
      const value = last.values.at(-1)!;
      const binding = flow.context.find((context) => context.name === last.context)!;
      const input = value.source === "input" ? flow.input.find((field) => field.name === value.value) : undefined;
      const numericInput = input?.type === "Integer" || database.enums?.some((enumeration) => enumeration.name === input?.type);
      return { ...flow, steps: [...flow.steps, { name: "qiyTestLateFailure", order: Math.max(...flow.steps.map((step) => step.order)) + 1, actions: [{ kind: "require" as const, left: `${last.context}.${numericInput ? binding.id.split(":")[0] : value.field}`, operator: "!=" as const, right: numericInput ? "00000000-0000-4000-8000-000000000001" : value.source === "input" ? "Qiy fixture reason" : value.value, error: "qiy.test.lateFailure" }] }] };
    });
    files["api/tests/fixtures/dataflow-failure.ts"] = renderDataflowRoutes(database, failureFlows, options.scopes ?? [], [], options.realtime !== undefined, permissions)!
      .replaceAll('"../db"', '"../../src/db"').replaceAll('"../schema"', '"../../src/schema"').replaceAll('"../auth/guard"', '"../../src/auth/guard"').replaceAll('"../auth/permissions"', '"../../src/auth/permissions"').replaceAll('"./calls"', '"../../src/dataflows/calls"');
  }
  const scenarioTest = renderQiyScenarioTest(database, options.dataflows ?? [], options.testSuite, permissions);
  if (scenarioTest) files["api/tests/qiy-scenarios.test.ts"] = scenarioTest;
  if (orderWorkflow) {
    files["api/src/workflows/order.ts"] = orderWorkflow;
    files["api/src/workflows/allocation.ts"] = `export interface StockBalance { id: string; quantity: number; reservedQuantity: number; }
export interface InventoryAllocation { inventoryItemId: string; quantity: number; }

export function planInventoryAllocation(stocks: StockBalance[], requested: number): InventoryAllocation[] {
  if (!Number.isSafeInteger(requested) || requested <= 0) throw new Error("Order item quantity must be positive");
  let remaining = requested;
  const allocations: InventoryAllocation[] = [];
  for (const stock of [...stocks].sort((left, right) => left.id.localeCompare(right.id))) {
    const available = Math.max(0, stock.quantity - stock.reservedQuantity);
    const allocated = Math.min(remaining, available);
    if (allocated > 0) allocations.push({ inventoryItemId: stock.id, quantity: allocated });
    remaining -= allocated;
    if (remaining === 0) break;
  }
  if (remaining !== 0) throw new Error("Insufficient inventory across warehouses");
  return allocations;
}
`;
    files["api/tests/allocation.test.ts"] = `import { expect, test } from "bun:test";
import { planInventoryAllocation } from "../src/workflows/allocation";

test("splits reservations across warehouses in stable order", () => {
  const stocks = [{ id: "warehouse-b", quantity: 3, reservedQuantity: 1 }, { id: "warehouse-a", quantity: 5, reservedQuantity: 3 }];
  expect(planInventoryAllocation(stocks, 4)).toEqual([{ inventoryItemId: "warehouse-a", quantity: 2 }, { inventoryItemId: "warehouse-b", quantity: 2 }]);
  expect(stocks[0]?.id).toBe("warehouse-b");
});

test("rejects shortages and invalid quantities instead of partially reserving", () => {
  const stocks = [{ id: "warehouse-a", quantity: 2, reservedQuantity: 1 }];
  expect(() => planInventoryAllocation(stocks, 2)).toThrow("Insufficient inventory");
  expect(() => planInventoryAllocation(stocks, 0)).toThrow("must be positive");
  expect(() => planInventoryAllocation(stocks, -1)).toThrow("must be positive");
});
`;
  }
  files["api/src/storage/index.ts"] = files["api/src/storage/index.ts"]!.replaceAll("__QIY_STORAGE_PROVIDER__", options.storageProvider ?? "local");
  files["api/src/storage/routes.ts"] = files["api/src/storage/routes.ts"]!.replace("__QIY_UPLOAD_POLICIES__", JSON.stringify(Object.fromEntries(database.entities.flatMap((entity) => entity.fields.filter((field) => field.type === "File" || field.type === "Files").map((field) => [`${entity.tableName}.${field.name}`, { mode: field.uploadMode ?? "binary", maxBytes: field.maxBytes ?? 25 * 1024 * 1024, mimeTypes: field.mimeTypes ?? ["*/*"], maxFiles: field.type === "Files" ? field.maxFiles ?? 6 : 1 }]))), null, 2));
  files["api/tests/storage.test.ts"] = files["api/tests/storage.test.ts"]!
    .replace("__QIY_STORAGE_TEST_FUNCTION__", uploadField ? "test" : "test.skip")
    .replace("__QIY_STORAGE_TEST_RESOURCE__", uploadField?.entity.tableName ?? "missing")
    .replace("__QIY_STORAGE_TEST_FIELD__", uploadField?.field.name ?? "missing")
    .replace("__QIY_STORAGE_TEST_MIME__", uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? (uploadField?.field.mimeTypes?.find((mime) => mime.endsWith("/*"))?.replace("*", "qiy-test") ?? "application/octet-stream"));
  if (database.dialect === "sqlite") {
    files["api/tests/storage-metadata.test.ts"] = `import { expect, test } from "bun:test";
import "./setup";
import { Elysia } from "elysia";
import { client } from "../src/db";
import { createStorageRoutes, cleanupMissingAttachmentObjects } from "../src/storage/routes";

${uploadField ? "test" : "test.skip"}("database attachment removal revokes reads and cleanup defaults to dry run", async () => {
  const previous = Bun.env.QIY_STORAGE_METADATA;
  Bun.env.QIY_STORAGE_METADATA = "database";
  const key = "metadata/" + crypto.randomUUID() + ".txt";
  try {
    client.exec('CREATE TABLE IF NOT EXISTS attachments (id text primary key, storageKey text unique not null, fileName text, contentType text not null, size integer not null, ownerId text, resource text not null, resourceId text, createdAt integer not null)');
    const app = new Elysia().use(createStorageRoutes(async () => ({ id: "metadata-owner", name: "Owner", role: "admin", claims: {} })));
    const url = "http://localhost/api/v1/files?key=" + key + "&resource=" + ${JSON.stringify(uploadField?.entity.tableName ?? "missing")} + "&field=" + ${JSON.stringify(uploadField?.field.name ?? "missing")};
    expect((await app.handle(new Request(url, { method: "POST", body: new Blob(["metadata test"], { type: ${JSON.stringify(uploadField?.field.mimeTypes?.find((mime) => !mime.endsWith("/*") && mime !== "*/*") ?? "application/octet-stream")} }) }))).status).toBe(200);
    client.query("DELETE FROM attachments WHERE storageKey = ?").run(key);
    expect((await app.handle(new Request(url))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/metadata?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request("http://localhost/api/v1/files/signed?key=" + key))).status).toBe(404);
    expect((await app.handle(new Request(url, { method: "DELETE" }))).status).toBe(200);
    const missingKey = "missing/" + crypto.randomUUID() + ".txt";
    client.query("INSERT INTO attachments (id, storageKey, contentType, size, resource, createdAt) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), missingKey, "text/plain", 1, "test", Date.now());
    expect((await cleanupMissingAttachmentObjects()).dryRun).toBe(true);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeTruthy();
    expect((await cleanupMissingAttachmentObjects({ dryRun: false })).dryRun).toBe(false);
    expect(client.query("SELECT id FROM attachments WHERE storageKey = ?").get(missingKey)).toBeNull();
  } finally {
    if (previous === undefined) delete Bun.env.QIY_STORAGE_METADATA; else Bun.env.QIY_STORAGE_METADATA = previous;
  }
});
`;
  }
  if (options.storageProvider === "s3") {
    files["api/tests/storage-config.test.ts"] = `import { expect, test } from "bun:test";
import { createStorageFromEnv } from "../src/storage";

test("S3 default fails closed without a bucket while tests can explicitly use local storage", () => {
  const provider = Bun.env.QIY_STORAGE_PROVIDER;
  const bucket = Bun.env.QIY_S3_BUCKET;
  try {
    delete Bun.env.QIY_STORAGE_PROVIDER;
    delete Bun.env.QIY_S3_BUCKET;
    expect(() => createStorageFromEnv()).toThrow("S3 bucket is required");
    Bun.env.QIY_STORAGE_PROVIDER = "local";
    expect(createStorageFromEnv().signedUrl("files/example.txt")).toBeNull();
  } finally {
    if (provider === undefined) delete Bun.env.QIY_STORAGE_PROVIDER; else Bun.env.QIY_STORAGE_PROVIDER = provider;
    if (bucket === undefined) delete Bun.env.QIY_S3_BUCKET; else Bun.env.QIY_S3_BUCKET = bucket;
  }
});
`;
  }
  files["api/src/storage/cleanup.ts"] = `import { cleanupMissingAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const result = await cleanupMissingAttachmentObjects({ dryRun, limit: Number(Bun.env.QIY_ATTACHMENT_CLEANUP_LIMIT ?? 1000) });
console.log(JSON.stringify(result));
`;
  files["api/src/storage/orphans.ts"] = `import { scanOrphanAttachmentObjects } from "./routes";

const dryRun = !Bun.argv.includes("--apply");
const limit = Number(Bun.env.QIY_ATTACHMENT_ORPHAN_LIMIT ?? 1000);
try {
  const result = await scanOrphanAttachmentObjects({ dryRun, limit });
  console.log(JSON.stringify(result));
  if (result.orphans.length) console.log("orphan objects: " + result.orphans.join(", "));
  if (result.truncated) console.log("more orphans exist than the --limit/retention window; re-run after applying");
  if (result.missingObjects) console.log("metadata rows without an object: " + result.missingObjects + " (run attachments:cleanup to remove them)");
  if (dryRun && result.orphans.length) console.log("dry run: nothing was deleted. Re-run with --apply after reviewing the list.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
  if (auth) {
    if (permissions) {
      files["api/src/auth/permissions.ts"] = renderPermissionModule(auth, permissions);
      files["api/src/auth/permission-routes.ts"] = renderPermissionRoutes();
      files["api/tests/permissions.test.ts"] = renderPermissionTest(database, permissions);
    }
    if (hybridAuth) {
      files["api/src/auth/oidc.ts"] = renderHybridAuthModule(auth, database);
      files["api/src/auth/hybrid.ts"] = renderHybridAuthenticatorModule();
    } else if (multiProviderAuth) {
      files["api/src/auth/oidc.ts"] = renderMultiProviderOidcModule(auth);
    } else if (singleOidcAuth) files["api/src/auth/oidc.ts"] = `import { createRemoteJWKSet } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { createOidcAuthenticator } from "./verify";

export function createProductionAuthenticator() {
  const issuer = Bun.env.QIY_OIDC_ISSUER;
  const audience = Bun.env.QIY_OIDC_AUDIENCE;
  const jwksUrl = Bun.env.QIY_OIDC_JWKS_URL;
  if (!issuer || !audience || !jwksUrl) throw new Error("OIDC issuer, audience and JWKS URL are required");
  if (new URL(issuer).protocol !== "https:" || new URL(jwksUrl).protocol !== "https:") throw new Error("OIDC endpoints must use HTTPS");
  // Rotation and revocation windows are operator decisions: without these knobs the
  // generated defaults would silently pin a 5s fetch timeout, a 30s missing-key
  // cooldown and a 10min key cache, which is untunable per identity provider.
  const positiveInteger = (name: string, fallback: number, minimum: number): number => {
    const raw = Bun.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < minimum) throw new Error(name + " must be an integer of at least " + minimum);
    return value;
  };
  const timeoutDuration = positiveInteger("QIY_OIDC_JWKS_TIMEOUT_MS", 5000, 1);
  const cooldownDuration = positiveInteger("QIY_OIDC_JWKS_COOLDOWN_MS", 30000, 0);
  const cacheMaxAge = positiveInteger("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", 600000, 1);
  return createOidcAuthenticator({ issuer, audience, keySet: createRemoteJWKSet(new URL(jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge }), roleField: ${JSON.stringify(auth.roleField)},
    async findUser(externalSubject) {
      const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${auth.subjectField}, externalSubject)).limit(2);
      return rows.length === 1 ? rows[0]! : null;
    },
  });
}
`;
    if (hasLocalAuth) {
      const usernameField = auth.usernameField!;
      const passwordField = auth.passwordField!;
      const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
      const bootstrapFields = userEntity.fields.filter((field) => !field.primaryKey && !field.nullable && ![usernameField, passwordField, auth.roleField].includes(field.name) && !(hybridAuth && field.name === auth.subjectField));
      const bootstrapHasDisplayName = bootstrapFields.some((field) => field.name === "displayName");
      // A hybrid account needs the required canonical subject column too; it is
      // derived instead of prompted because no OAuth identity exists yet.
      const bootstrapCanonicalSubject = hybridAuth ? `${JSON.stringify(auth.subjectField)}: "local:" + username, ` : "";
      const bootstrapValues = bootstrapFields.map((field) => {
        const value = field.name === "displayName" ? "displayName"
          : field.type === "Integer" ? `Number(await terminal.question(${JSON.stringify(field.name + ": ")}))`
            : field.type === "DateTime" ? `new Date(await terminal.question(${JSON.stringify(field.name + " (ISO date-time): ")}))`
              : field.type === "Date" ? `await terminal.question(${JSON.stringify(field.name + " (YYYY-MM-DD): ")})`
                : field.type === "Time" ? `await terminal.question(${JSON.stringify(field.name + " (HH:mm:ss): ")})`
                  : `await terminal.question(${JSON.stringify(field.name + ": ")})`;
        return `${JSON.stringify(field.name)}: ${value}`;
      }).join(",\n    ");
      files["api/src/auth/password.ts"] = `import { jwtVerify, SignJWT } from "jose";

const ROLES = ["admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Qiy stores password hashes produced by \`Bun.password.hash(password, { algorithm: "argon2id" })\`.
 * The plaintext password is never persisted and never leaves the login request.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  try { return await Bun.password.verify(password, hash); }
  catch { return false; }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  return await Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function signAccessToken(user: { id: string; role: Role }, secret: string, issuer: string): Promise<string> {
  return await new SignJWT({ role: user.role, typ: "qiy-local" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(issuer)
    .setAudience(issuer)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(token: string, secret: string, issuer: string): Promise<{ id: string; role: Role } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer, audience: issuer, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || !isRole(payload.role)) return null;
    return { id: payload.sub, role: payload.role };
  } catch { return null; }
}
`;
      // Local password sessions have no identity-provider token, so claims used by
      // data scopes are resolved from the authenticated user row instead. A scope
      // claim such as "org.id" maps to the user field "orgId" (dotted segments are
      // camel-cased); the mapping is validated at generation time so a broken claim
      // cannot silently produce 403 responses at runtime.
      const localScopeClaims = [...new Set((options.scopes ?? []).map((scope) => scope.claim))].map((claim) => {
        const fieldName = claim.replace(/\.([a-zA-Z0-9])/g, (_match: string, char: string) => char.toUpperCase());
        const field = userEntity.fields.find((candidate) => candidate.name === claim || candidate.name === fieldName);
        if (!field) throw new Error(`Data scope claim ${claim} needs a matching field on ${userEntity.name} (expected ${fieldName}) to resolve local password sessions`);
        return { claim, field: field.name };
      });
      const localScopeClaimLines = localScopeClaims.map(({ claim, field }) => `  if (row.${field} !== null && row.${field} !== undefined && row.${field} !== "") claims[${JSON.stringify(claim)}] = typeof row.${field} === "boolean" || typeof row.${field} === "number" ? row.${field} : String(row.${field});`).join("\n");
      files["api/src/auth/local.ts"] = `import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { isRole, signAccessToken, verifyAccessToken, verifyPassword } from "./password";
import type { Authenticator, Principal } from "./guard";

const ISSUER = "qiy-admin";
function secret(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for local password login");
  return value;
}

async function findUserById(id: string): Promise<Principal | null> {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1);
  const row = rows[0];
  if (!row || typeof row.id !== "string" || !isRole(row.${auth.roleField})) return null;
  const claims: Record<string, string | number | boolean | null> = {};
${localScopeClaimLines}
  return { id: row.id, name: ${principalNameExpression(userEntity, "displayName", auth.usernameField)}, role: row.${auth.roleField}, ...(Object.keys(claims).length ? { claims } : {}) };
}

export function createProductionAuthenticator(): Authenticator {
  const key = secret();
  return async (request) => {
    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    const verified = await verifyAccessToken(match[1]!, key, ISSUER);
    return verified ? findUserById(verified.id) : null;
  };
}

export type LocalUser = typeof ${auth.userEntity}.$inferSelect;
type UserLookup = (username: string) => Promise<LocalUser | null>;

export function createLocalAuthRoutes(findUser: UserLookup = async (username) => {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, username)).limit(2);
  return rows.length === 1 ? rows[0]! : null;
}) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .post("/login", async ({ body, status }) => {
      const key = secret();
      const identifier = body.username.trim();
      if (!identifier || !body.password) return status(400, { error: "Username and password are required" });
      const row = await findUser(identifier);
      if (!row) {
        await verifyPassword("\$argon2id\$v=19\$m=65536,t=3,p=4\$c29tZXNhbHRzb21lc2FsdA\$0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8v0G5v8", body.password);
        return status(401, { error: "Invalid username or password" });
      }
      if (!isRole(row.${auth.roleField}) || !await verifyPassword(row.${passwordField}, body.password)) return status(401, { error: "Invalid username or password" });
      const token = await signAccessToken({ id: row.id, role: row.${auth.roleField} }, key, ISSUER);
      return { accessToken: token, tokenType: "Bearer", expiresIn: 43200, id: row.id, name: ${principalNameExpression(userEntity, "displayName", auth.usernameField)}, role: row.${auth.roleField} };
    }, { body: t.Object({ username: t.String({ minLength: 1, maxLength: 190 }), password: t.String({ minLength: 1, maxLength: 200 }) }) });
}
`;
      files["api/src/auth/set-password.ts"] = `import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const username = (await terminal.question("Username or email: ")).trim();
  const password = await terminal.question("New password (minimum 8 characters): ");
  const passwordHash = await hashPassword(password);
  const rows = await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, username)).limit(2);
  if (rows.length !== 1) throw new Error("Expected exactly one matching user");
  await db.update(${auth.userEntity}).set({ ${passwordField}: passwordHash }).where(eq(${auth.userEntity}.id, rows[0]!.id));
  console.log("Password updated for " + username);
} finally { terminal.close(); }
`;
      files["api/src/auth/bootstrap-admin.ts"] = `import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { hashPassword } from "./password";

const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  if ((await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(${auth.userEntity}.${auth.roleField}, "admin")).limit(1)).length) throw new Error("An admin account already exists");
  const username = (await terminal.question("${usernameField}: ")).trim();
  if (!username) throw new Error("Username is required");
  ${bootstrapHasDisplayName ? 'const displayName = (await terminal.question("Display name: ")).trim() || username;' : ""}
  const password = await terminal.question("Password (minimum 8 characters): ");
  const values = { ${JSON.stringify(usernameField)}: username, ${JSON.stringify(auth.roleField)}: "admin", ${JSON.stringify(passwordField)}: await hashPassword(password), ${bootstrapCanonicalSubject}${bootstrapValues} };
  await db.insert(${auth.userEntity}).values({ ...values, id: crypto.randomUUID() } as typeof ${auth.userEntity}.$inferInsert);
  console.log("Initial admin account created for " + username);
} finally { terminal.close(); }
`;
      files["api/tests/local-auth.test.ts"] = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createLocalAuthRoutes } from "../src/auth/local";
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from "../src/auth/password";

const secret = "qiy-local-auth-test-secret-value-32";

test("hashes and verifies local passwords without storing plaintext", async () => {
  const hash = await hashPassword("correct-horse-battery");
  expect(hash).toStartWith("\$argon2id\$");
  expect(hash).not.toContain("correct-horse-battery");
  expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
  expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  expect(await verifyPassword(null, "correct-horse-battery")).toBe(false);
});

test("round-trips a signed local access token and rejects tampering", async () => {
  const token = await signAccessToken({ id: "user-1", role: "admin" }, secret, "qiy-admin");
  expect(await verifyAccessToken(token, secret, "qiy-admin")).toEqual({ id: "user-1", role: "admin" });
  expect(await verifyAccessToken(token, secret + "x", "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token + "x", secret, "qiy-admin")).toBeNull();
  expect(await verifyAccessToken(token, secret, "other-app")).toBeNull();
});

test("local login route issues a bearer token and rejects invalid credentials", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const passwordHash = await hashPassword("correct-password");
  const user = { id: "user-1", ${JSON.stringify(auth.usernameField)}: "admin", ${JSON.stringify(auth.passwordField)}: passwordHash, ${JSON.stringify(auth.roleField)}: "admin" } as unknown as import("../src/auth/local").LocalUser;
  const app = new Elysia().use(createLocalAuthRoutes(async (username) => username === "admin" ? user : null));
  const login = (username: string, password: string) => app.handle(new Request("http://localhost/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }));
  const success = await login("admin", "correct-password");
  expect(success.status).toBe(200);
  const payload = await success.json() as { accessToken: string; role: string };
  expect(payload.role).toBe("admin");
  expect(await verifyAccessToken(payload.accessToken, secret, "qiy-admin")).toEqual({ id: "user-1", role: "admin" });
  expect((await login("admin", "wrong-password")).status).toBe(401);
  expect((await login("missing", "wrong-password")).status).toBe(401);
  expect((await app.handle(new Request("http://localhost/api/v1/auth/password", { method: "POST" }))).status).toBe(404);
});
`;
    }
    if (auth.provider === "otp") {
      const usernameField = auth.usernameField!;
      const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
      files["api/src/auth/otp.ts"] = `import { createHmac, timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import type { Authenticator, Principal } from "./guard";

const ISSUER = "qiy-admin";
const roles = new Set(["admin", "operator", "viewer"]);
function secret(): string { const value = Bun.env.QIY_AUTH_SECRET; if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for OTP login"); return value; }
function otpHash(identifier: string, code: string, key: string): string { return createHmac("sha256", key).update(identifier + "\\n" + code).digest("hex"); }
function matchesHash(left: string, right: string): boolean { const a = Buffer.from(left, "hex"); const b = Buffer.from(right, "hex"); return a.length === b.length && timingSafeEqual(a, b); }
function randomCode(): string { return String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0"); }
async function findUser(identifier: string) { const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${usernameField}, identifier)).limit(2); return rows.length === 1 ? rows[0]! : null; }
async function findPrincipal(id: string): Promise<Principal | null> { const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1); const row = rows[0]; if (!row || typeof row.id !== "string" || !roles.has(String(row.${auth.roleField}))) return null; return { id: row.id, name: ${principalNameExpression(userEntity, "displayName", usernameField)}, role: row.${auth.roleField} as Principal["role"] }; }
class OtpDeliveryError extends Error {}
async function deliver(identifier: string, code: string): Promise<void> {
  const endpoint = Bun.env.QIY_OTP_DELIVERY_URL;
  if (!endpoint) {
    if (Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE) return;
    throw new OtpDeliveryError("QIY_OTP_DELIVERY_URL is required outside explicit development OTP mode");
  }
  if (new URL(endpoint).protocol !== "https:") throw new OtpDeliveryError("QIY_OTP_DELIVERY_URL must use HTTPS");
  const timeout = Number(Bun.env.QIY_OTP_DELIVERY_TIMEOUT_MS ?? "10000");
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) throw new OtpDeliveryError("QIY_OTP_DELIVERY_TIMEOUT_MS must be an integer between 100 and 60000");
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(Bun.env.QIY_OTP_DELIVERY_TOKEN ? { Authorization: "Bearer " + Bun.env.QIY_OTP_DELIVERY_TOKEN } : {}) }, body: JSON.stringify({ recipient: identifier, code, expiresIn: 300 }), signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new OtpDeliveryError(error instanceof Error && error.name === "TimeoutError" ? "OTP delivery adapter timed out" : "OTP delivery adapter is unreachable");
  }
  if (!response.ok) throw new OtpDeliveryError("OTP delivery adapter rejected the request");
}
async function signAccessToken(user: { id: string; role: string }, key: string): Promise<string> { return new SignJWT({ role: user.role, typ: "qiy-otp" }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(key)); }

export function createProductionAuthenticator(): Authenticator { const key = secret(); return async (request) => { const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? ""); if (!match) return null; try { const { payload } = await jwtVerify(match[1]!, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp" || typeof payload.sub !== "string" || !roles.has(String(payload.role))) return null; return await findPrincipal(payload.sub); } catch { return null; } }; }

export function createOtpAuthRoutes(lookup = findUser, send = deliver, resolvePrincipal = findPrincipal) { return new Elysia({ prefix: "/api/v1/auth/otp" })
  .post("/request", async ({ body, status }) => { const identifier = body.identifier.trim(); if (!identifier) return status(400, { error: "Login identifier is required" }); const key = secret(); const row = await lookup(identifier); const role = row && roles.has(String(row.${auth.roleField})) ? String(row.${auth.roleField}) : "viewer"; const code = Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? Bun.env.QIY_OTP_DEV_CODE : randomCode(); const valid = Boolean(row && typeof row.id === "string" && roles.has(role));
    if (valid) {
      try { await send(identifier, code); }
      catch (error) {
        // Never log or return the one-time code, and never mint a challenge whose
        // code the provider did not accept.
        console.error("OTP delivery failed", { provider: Bun.env.QIY_OTP_DELIVERY_URL, error });
        return status(502, { error: Bun.env.QIY_DEV_MODE === "1" && error instanceof Error ? error.message : "Could not send the one-time password", errorKey: "auth.otpDeliveryFailed" });
      }
    }
    const challengeToken = await new SignJWT({ typ: "qiy-otp-challenge", identifier, otpHash: otpHash(identifier, code, key), role, valid }).setProtectedHeader({ alg: "HS256" }).setSubject(valid ? row!.id : "unknown").setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(key)); return { challengeToken, expiresIn: 300, ...(Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? { devCode: code } : {}) }; }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }) }) })
  .post("/verify", async ({ body, status }) => { const key = secret(); try { const { payload } = await jwtVerify(body.challengeToken, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp-challenge" || payload.valid !== true || payload.identifier !== body.identifier || typeof payload.otpHash !== "string" || typeof payload.sub !== "string" || !roles.has(String(payload.role)) || !matchesHash(payload.otpHash, otpHash(body.identifier, body.code, key))) return status(401, { error: "Invalid or expired one-time password" }); const principal = await resolvePrincipal(payload.sub); if (!principal) return status(401, { error: "Invalid or expired one-time password" }); return { accessToken: await signAccessToken({ id: principal.id, role: principal.role }, key), tokenType: "Bearer", expiresIn: 43200, ...principal }; } catch { return status(401, { error: "Invalid or expired one-time password" }); } }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }), challengeToken: t.String({ minLength: 1, maxLength: 4096 }), code: t.String({ minLength: 4, maxLength: 12 }) }) }); }
`;
      files["api/tests/otp-auth.test.ts"] = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createOtpAuthRoutes } from "../src/auth/otp";

test("issues and verifies a short-lived OTP challenge without exposing a production code", async () => { Bun.env.QIY_AUTH_SECRET = "qiy-otp-test-secret-value-at-least-32"; Bun.env.QIY_DEV_MODE = "1"; Bun.env.QIY_OTP_DEV_CODE = "246810"; const sent: Array<{ identifier: string; code: string }> = []; const user = { id: "user-1", ${JSON.stringify(usernameField)}: "admin@example.com", ${JSON.stringify(auth.roleField)}: "admin" } as any; const principal = { id: "user-1", name: "Admin", role: "admin" } as const; const app = new Elysia().use(createOtpAuthRoutes(async (identifier) => identifier === "admin@example.com" ? user : null, async (identifier, code) => { sent.push({ identifier, code }); }, async (id) => id === "user-1" ? principal : null)); const request = await app.handle(new Request("http://localhost/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com" }) })); expect(request.status).toBe(200); const challenge = await request.json() as { challengeToken: string; devCode?: string }; expect(challenge.devCode).toBe("246810"); expect(sent).toEqual([{ identifier: "admin@example.com", code: "246810" }]); const verify = (code: string) => app.handle(new Request("http://localhost/api/v1/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com", challengeToken: challenge.challengeToken, code }) })); expect((await verify("wrong")).status).toBe(401); const success = await verify("246810"); expect(success.status).toBe(200); expect((await success.json() as { accessToken: string }).accessToken.length).toBeGreaterThan(40); });
`;
    }
    if (hasLocalAuth) files["api/src/auth/account.ts"] = renderAccountModule(auth, database);
    if (hybridAuth) files["api/tests/hybrid-auth.test.ts"] = renderHybridAuthTest(auth);
    files["api/tests/auth.test.ts"] = `import { expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createOidcAuthenticator } from "../src/auth/verify";

test("verifies issuer, audience and rotating JWKS keys before resolving subject", async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  const firstJwk = { ...await exportJWK(first.publicKey), kid: "first", alg: "RS256" };
  const secondJwk = { ...await exportJWK(second.publicKey), kid: "second", alg: "RS256" };
  const seen: string[] = [];
  const authenticate = createOidcAuthenticator({ issuer: "https://id.example.test", audience: "qiy-admin", keySet: createLocalJWKSet({ keys: [firstJwk, secondJwk] }), roleField: "role", findUser: async (subject) => { seen.push(subject); return subject === "https://id.example.test|user-1" ? { id: "user-1", role: "operator", displayName: "Operator" } : null; } });
  const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "second" }).setIssuer("https://id.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(second.privateKey);
  const request = (value: string) => new Request("http://localhost/api/v1/orders", { headers: { Authorization: "Bearer " + value } });
  expect(await authenticate(request(token))).toEqual({ id: "user-1", name: "Operator", role: "operator" });
  expect(seen).toEqual(["https://id.example.test|user-1"]);
  expect(await authenticate(new Request("http://localhost/api/v1/orders"))).toBeNull();
  const wrongAudience = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://id.example.test").setAudience("other-app").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongAudience))).rejects.toThrow();
  const wrongIssuer = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "first" }).setIssuer("https://other.example.test").setAudience("qiy-admin").setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(first.privateKey);
  await expect(authenticate(request(wrongIssuer))).rejects.toThrow();
  expect(seen).toEqual(["https://id.example.test|user-1"]);
});
`;
  }
  for (const entity of database.entities) {
    const moduleRoot = `api/src/modules/${entity.name}`;
    const realtimeSubscription = options.realtime?.resources.find((subscription) => subscription.resource === entity.name || subscription.resource === entity.tableName);
    const realtimeEvents = new Set(realtimeSubscription?.events ?? []);
    const realtimeMasked = realtimeSubscription ? maskedRealtimeFields(normalizedRestrictions.find((restriction) => restriction.resource === entity.name), realtimeSubscription.roles) : [];
    const realtimeClaim = realtimeSubscription?.claim;
    const hiddenFields = hasLocalAuth && entity.name === options.auth!.userEntity ? [options.auth!.passwordField!] : [];
    const publicEntity = hiddenFields.length ? { ...entity, fields: entity.fields.filter((field) => !hiddenFields.includes(field.name)) } : entity;
    const entityRestricted = normalizedRestrictions.some((restriction) => restriction.resource === entity.name);
    files[`${moduleRoot}/${entity.name}.repository.ts`] = `import { and, asc, avg, count, desc, eq, gt, gte, lt, lte, max, min, sql, sum, ${database.dialect === "postgresql" ? "ilike" : "like"}, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { ${entity.name}, auditEvents${realtimeSubscription ? ", realtimeOutbox" : ""}${resolveScopeTree(scopedDatabase, publicEntity) && resolveScopeTree(scopedDatabase, publicEntity)!.table.name !== entity.name ? `, ${resolveScopeTree(scopedDatabase, publicEntity)!.table.name}` : ""} } from "../../schema";
import type { FilterClause, FilterExpression, ${modelName(entity)}Repository as ${modelName(entity)}RepositoryContract } from "./${entity.name}.contract";
${entityRestricted ? 'import { QiyPolicyError, type QiyPolicy } from "../../security/policy";' : ""}
${realtimeMasked.length ? `\n// Every role that may subscribe has one of these fields masked, so the shared\n// channel must not carry them.\nfunction qiyRealtimePayload(record: Record<string, unknown>): Record<string, unknown> {\n  const safe = { ...record };\n  for (const field of ${JSON.stringify(realtimeMasked)}) delete safe[field];\n  return safe;\n}\n` : ""}
${renderScopeTreeHelper(scopedDatabase, publicEntity)}export const ${modelName(entity)}Repository: ${modelName(entity)}RepositoryContract = {
${renderRepositoryMethods(publicEntity, scopedDatabase, realtimeEvents, entityRestricted, realtimeMasked, realtimeClaim)}
};
`;
    files[`${moduleRoot}/${entity.name}.contract.ts`] = `${generatedDocumentation(entity)}${entityRestricted ? 'import type { QiyPolicy } from "../../security/policy";\n' : ""}export interface ${modelName(entity)}Repository {
  distribution(field: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ value: string | null; count: number }>>;
  /** Optional so generated test doubles and hand-written repositories keep compiling. */
  aggregate?(field: string, operator: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<{ value: number | null; operator: string }>;
  trend(field: string, days: number, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  create(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown>>;
  update(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}): Promise<Array<Record<string, unknown>>>;
  /** Optional so test doubles and hand-written repositories keep working. */
  recordExportAudit?(input: { rows: number; filters: number; principalId?: string }): Promise<void>;
  recordImportAudit?(input: { rows: number; principalId?: string }): Promise<void>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }
export interface FilterGroup { operator: "and" | "or"; filters: FilterExpression[]; }
export type FilterExpression = FilterClause | FilterGroup;

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterExpression[];
  scope?: { field: string; value: string };
${entityRestricted ? "  policy?: QiyPolicy;" : ""}
}
`;
    const temporalFields = temporalFieldsOf(entity);
    const temporalImport = temporalFields.length ? 'import { normalizeTemporalValues } from "../../temporal";\n' : "";
    const temporalDeclaration = temporalFields.length ? `const temporalFields = ${JSON.stringify(Object.fromEntries(temporalFields))} as Record<string, "Date" | "Time">;\n` : "";
    const normalizeWrite = (expression: string) => temporalFields.length ? `normalizeDates(normalizeTemporalValues(${expression}, temporalFields))` : `normalizeDates(${expression})`;
    files[`${moduleRoot}/${entity.name}.service.ts`] = `${temporalImport}${entityRestricted ? 'import type { QiyPolicy } from "../../security/policy";\n' : ""}import type { ${modelName(entity)}Repository, ListQuery } from "./${entity.name}.contract";
 ${realtimeSubscription ? 'import { dispatchRealtimeOutbox } from "../../realtime";' : ""}
${temporalDeclaration}const dateFields = ${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 ${realtimeSubscription ? `async function dispatchCommitted(): Promise<void> {
   try { await dispatchRealtimeOutbox(); }
   catch (error) { console.error("Realtime outbox dispatch failed after committed mutation", { resource: ${JSON.stringify(entity.tableName)}, error }); }
}` : ""}
${generatedDocumentation(entity)}export function create${modelName(entity)}Service(repository: ${modelName(entity)}Repository) {
  return {
  aggregate: (field: string, operator: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.aggregate ? repository.aggregate(field, operator, scope${entityRestricted ? ", policy" : ""}) : Promise.resolve({ value: null, operator }),
    distribution: (field: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.distribution(field, scope${entityRestricted ? ", policy" : ""}),
    trend: (field: string, days: number, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.trend(field, days, scope${entityRestricted ? ", policy" : ""}),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.one(id, scope${entityRestricted ? ", policy" : ""}),
    create: ${realtimeEvents.has("created") ? `async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.create(${normalizeWrite("values")}, actorId, scope${entityRestricted ? ", policy" : ""}); await dispatchCommitted(); return record; }` : `(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.create(${normalizeWrite("values")}, actorId, scope${entityRestricted ? ", policy" : ""})`},
    update: ${realtimeEvents.has("updated") ? `async (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.update(id, ${normalizeWrite("values")}, actorId, scope${entityRestricted ? ", policy" : ""}); if (record) await dispatchCommitted(); return record; }` : `(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.update(id, ${normalizeWrite("values")}, actorId, scope${entityRestricted ? ", policy" : ""})`},
    delete: ${realtimeEvents.has("deleted") ? `async (id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const record = await repository.delete(id, actorId, scope${entityRestricted ? ", policy" : ""}); if (record) await dispatchCommitted(); return record; }` : `(id: string, actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.delete(id, actorId, scope${entityRestricted ? ", policy" : ""})`},
    deleteMany: ${realtimeEvents.has("deleted") ? `async (ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => { const records = await repository.deleteMany(ids, actorId, scope${entityRestricted ? ", policy" : ""}); if (records.length) await dispatchCommitted(); return records; }` : `(ids: string[], actorId?: string, scope?: { field: string; value: string }${entityRestricted ? ", policy?: QiyPolicy" : ""}) => repository.deleteMany(ids, actorId, scope${entityRestricted ? ", policy" : ""})`},
  };
}
`;
    files[`${moduleRoot}/${entity.name}.routes.ts`] = `import { Elysia, t } from "elysia";
import type { Authenticator${entityRestricted ? "" : ", Principal"} } from "../../auth/guard";
${temporalFields.length ? 'import { QiyTemporalValueError } from "../../temporal";\n' : ""}import { create${modelName(entity)}Service } from "./${entity.name}.service";
import { claimImportJob, createImportJob, isImportJobCancelled, listImportJobs, readImportJob, releaseStaleImportJobs, requestImportJobCancel, updateImportJob } from "../../import-jobs";
import { claimExportJob, createExportJob, listExportJobs, readExportJob, updateExportJob } from "../../export-jobs";
import type { ${modelName(entity)}Repository as ${modelName(entity)}RepositoryPort } from "./${entity.name}.contract";
${entityRestricted ? 'import { QiyPolicyError, resolvePolicy, type QiyPolicy } from "../../security/policy";\nimport { ' + entity.name + ' } from "../../schema";\nimport type { Principal } from "../../auth/guard";\n' : ""}
${renderRoutes(publicEntity, database, options.scopes, hiddenFields, entityRestricted, temporalFields.length ? "QiyTemporalValueError" : "").replace(`repository: ${modelName(entity)}Repository`, `repository: ${modelName(entity)}RepositoryPort`).replace("  return new Elysia({", `  const service = create${modelName(entity)}Service(repository);\n  return new Elysia({`).replaceAll("repository.list(", "service.list(").replaceAll("repository.one(", "service.one(").replaceAll("repository.create(", "service.create(").replaceAll("repository.update(", "service.update(").replaceAll("repository.delete(", "service.delete(")}`;
    files[`api/src/routes/${entity.name}.ts`] = `export { ${modelName(entity)}Routes } from "../modules/${entity.name}/${entity.name}.routes";\nexport type { ${modelName(entity)}Repository } from "../modules/${entity.name}/${entity.name}.contract";\n`;
    files[`api/tests/${entity.name}.test.ts`] = renderRouteTest(publicEntity, database, options.scopes ?? [], hiddenFields);
  }
  files["api/tests/graphql.test.ts"] = renderGraphQLTest(scopedDatabase, hasLocalAuth && database.entities[0]!.name === options.auth!.userEntity ? [options.auth!.passwordField!] : []);
  files["api/tests/graphql-schema.test.ts"] = `import { expect, test } from "bun:test";
import { buildSchema, isObjectType, isInputObjectType, validateSchema } from "graphql";
import { graphqlTypeDefs } from "../src/graphql";

test("generated GraphQL schema satisfies the GraphQL type system", () => {
  expect(validateSchema(buildSchema(graphqlTypeDefs)).map((error) => error.message)).toEqual([]);
});
${database.entities.map((entity) => {
    const hidden = hasLocalAuth && options.auth!.userEntity === entity.name ? [options.auth!.passwordField!] : [];
    const fields = entity.fields.filter((field) => field.comment !== undefined && !hidden.includes(field.name));
    if (entity.comment === undefined && !fields.length) return "";
    return `\ntest(${JSON.stringify(`${entity.name} GraphQL descriptions match the model`)}, () => {
  const schema = buildSchema(graphqlTypeDefs);
  for (const typeName of ${JSON.stringify([modelName(entity), `${modelName(entity)}CreateInput`, `${modelName(entity)}UpdateInput`])}) {
    const type = schema.getType(typeName);
    if (!isObjectType(type) && !isInputObjectType(type)) throw new Error("Missing documented GraphQL type");
    ${entity.comment !== undefined ? `expect(type.description).toBe(${JSON.stringify(entity.comment)});` : ""}
    ${fields.map((field) => `${field.primaryKey ? `if (isObjectType(type)) ` : ""}expect(type.getFields()[${JSON.stringify(field.name)}]?.description).toBe(${JSON.stringify(field.comment)});`).join("\n    ")}
  }
});\n`;
  }).join("")}
`;
  const graphqlListOptionsTest = renderGraphQLListOptionsTest(scopedDatabase);
  if (graphqlListOptionsTest) files["api/tests/graphql-list-options.test.ts"] = graphqlListOptionsTest;
  if (options.elysiaPlugins?.graphqlAdapter === "yoga" || options.elysiaPlugins?.graphqlAdapter === "apollo") {
    const adapterScope = (options.scopes ?? []).map((scope) => ({
      scope,
      entity: database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource),
    })).find((entry) => entry.entity);
    const adapterEntity = adapterScope?.entity ?? database.entities[0]!;
    const adapterScopeValue = adapterScope?.entity?.fields.find((field) => field.name === adapterScope.scope.field)?.type === "UUID"
      ? "00000000-0000-4000-8000-000000000002"
      : "Example";
    const adapterRecord = Object.fromEntries(adapterEntity.fields.map((field) => {
      if (field.nullable && !field.primaryKey) return [field.name, null];
      const value = field.enumName ? database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? ""
        : field.type === "Integer" ? 1
          : field.type === "Decimal" || field.type === "Money" ? "1.00"
            : field.type === "DateTime" ? "2026-10-06T00:00:00.000Z"
              : field.type === "Date" ? "2026-11-30"
                : field.type === "Time" ? "08:30:00"
                  : field.type === "UUID" ? "00000000-0000-4000-8000-000000000002"
                  : field.type === "Vector" ? Array(field.dimension).fill(0)
                  : field.type === "Files" ? ["uploads/sample.pdf"]
                    : "Example";
      return [field.name, value];
    }));
    const providerSortField = adapterEntity.fields.find((field) => field.sortable !== false && !field.primaryKey) ?? adapterEntity.fields.find((field) => field.sortable !== false)!;
    const providerFilterField = adapterEntity.fields.find((field) => field.filterable !== false && !field.primaryKey)!;
    const providerFilterValue = providerFilterField.enumName
      ? database.enums?.find((enumeration) => enumeration.name === providerFilterField.enumName)?.values[0]?.name ?? ""
        : providerFilterField.type === "Integer" ? "1"
          : "Example";
    const providerCreateValues = Object.fromEntries(adapterEntity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => [field.name, adapterRecord[field.name]]));
    const disabledSort = database.entities.flatMap((entity) => entity.fields.filter((field) => field.sortable === false).map((field) => ({ entity, field })))[0];
    const disabledFilter = database.entities.flatMap((entity) => entity.fields.filter((field) => field.filterable === false).map((field) => ({ entity, field })))[0];
    files["api/tests/graphql-adapter.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createGraphQLDataProvider } from "../../web/app/data-provider";

test("official GraphQL adapter mounts the public endpoint and preserves authorization", async () => {
  const seenScopes: Array<{ field: string; value: string } | undefined> = [];
  const seenLists: Array<{ page: number; pageSize: number; options?: { search?: string; sort?: string; order?: string; filters?: Record<string, string> | Array<{ field: string; operator: string; value: string }>; scope?: { field: string; value: string } } }> = [];
  const seenMutations: Array<{ operation: string; actorId?: string; scope?: { field: string; value: string } }> = [];
  const repository = { distribution: async () => [], trend: async () => [], list: async (page: number, pageSize: number, options?: { search?: string; sort?: string; order?: "asc" | "desc"; filters?: Record<string, string> | Array<{ field: string; operator: "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in"; value: string }>; scope?: { field: string; value: string } }) => { seenScopes.push(options?.scope); seenLists.push({ page, pageSize, options }); return { data: [${JSON.stringify(adapterRecord)}], total: 1 }; }, one: async (_id: string, scope?: { field: string; value: string }) => { seenScopes.push(scope); return ${JSON.stringify(adapterRecord)}; }, create: async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "create", actorId, scope }); return { id: "00000000-0000-4000-8000-000000000001", ...values }; }, update: async (_id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "update", actorId, scope }); return { ...${JSON.stringify(adapterRecord)}, ...values }; }, delete: async (_id: string, actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "delete", actorId, scope }); return ${JSON.stringify(adapterRecord)}; }, deleteMany: async (_ids: string[], actorId?: string, scope?: { field: string; value: string }) => { seenMutations.push({ operation: "deleteMany", actorId, scope }); return [${JSON.stringify(adapterRecord)}]; } };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "adapter-user", name: "Adapter User", role: "admin", claims: ${testClaims} }), false, false);
  expect(app.routes.some((route) => route.path === "/graphql" && route.method === "POST")).toBe(true);
  const browserPage = await app.handle(new Request("http://localhost/graphql"));
  expect(browserPage.status).toBe(405);
  expect(browserPage.headers.get("content-type")).not.toContain("text/html");
  const response = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }));
  expect(response.status).toBe(200);
  expect((await response.json() as { data: Record<string, { total: number }> }).data.${adapterEntity.name}.total).toBe(1);
${adapterScope ? `  expect(seenScopes.at(-1)).toEqual({ field: ${JSON.stringify(adapterScope.scope.field)}, value: ${JSON.stringify(adapterScopeValue)} });
  const provider = createGraphQLDataProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
  const providerResult = await provider.getList({ resource: ${JSON.stringify(adapterEntity.tableName)}, pagination: { currentPage: 2, pageSize: 25 }, sorters: [{ field: ${JSON.stringify(providerSortField.name)}, order: "desc" }], filters: [{ field: ${JSON.stringify(providerFilterField.name)}, operator: "eq", value: ${JSON.stringify(providerFilterValue)} }] });
  expect(providerResult).toEqual({ data: [${JSON.stringify(adapterRecord)}], total: 1 });
  expect(seenLists.at(-1)).toEqual({ page: 2, pageSize: 25, options: { search: undefined, sort: ${JSON.stringify(providerSortField.name)}, order: "desc", filters: { [${JSON.stringify(providerFilterField.name)}]: ${JSON.stringify(providerFilterValue)} }, scope: { field: ${JSON.stringify(adapterScope.scope.field)}, value: ${JSON.stringify(adapterScopeValue)} } } });
  const providerOne = await provider.getOne({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002" });
  expect(providerOne.data).toEqual(${JSON.stringify(adapterRecord)});
  const providerCreate = await provider.create({ resource: ${JSON.stringify(adapterEntity.tableName)}, variables: ${JSON.stringify(providerCreateValues)} });
  expect(providerCreate.data).toMatchObject(${JSON.stringify(providerCreateValues)});
  const providerUpdate = await provider.update({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002", variables: { ${JSON.stringify(providerFilterField.name)}: ${JSON.stringify(providerFilterValue)} } });
  expect(providerUpdate.data[${JSON.stringify(providerFilterField.name)}]).toBe(${JSON.stringify(providerFilterValue)});
  expect((await provider.deleteOne({ resource: ${JSON.stringify(adapterEntity.tableName)}, id: "00000000-0000-4000-8000-000000000002" })).data).toEqual(${JSON.stringify(adapterRecord)});
  expect((await provider.deleteMany?.({ resource: ${JSON.stringify(adapterEntity.tableName)}, ids: ["00000000-0000-4000-8000-000000000002"] }))?.data).toEqual([${JSON.stringify(adapterRecord)}]);
  expect(seenMutations.map(({ operation }) => operation)).toEqual(["create", "update", "delete", "deleteMany"]);
  expect(seenMutations.every(({ actorId, scope }) => actorId === "adapter-user" && scope?.field === ${JSON.stringify(adapterScope.scope.field)} && scope.value === ${JSON.stringify(adapterScopeValue)})).toBe(true);
  expect(seenScopes).toHaveLength(3);
  const oversizedPage = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($pageSize: Int) { ${adapterEntity.name}(pageSize: $pageSize) { total } }", variables: { pageSize: 101 } }) }));
  expect((await oversizedPage.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);
${disabledSort ? `  const rejectedSort = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($sort: String) { ${disabledSort.entity.name}(sort: $sort) { total } }", variables: { sort: ${JSON.stringify(disabledSort.field.name)} } }) }));
  expect((await rejectedSort.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);` : ""}
${disabledFilter ? `  const rejectedFilter = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query($filters: [QiyFilterInput!]) { ${disabledFilter.entity.name}(filters: $filters) { total } }", variables: { filters: [{ field: ${JSON.stringify(disabledFilter.field.name)}, value: "x" }] } }) }));
  expect((await rejectedFilter.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);` : ""}
  const mutation = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "mutation { delete${modelName(adapterEntity)}(id: \\"00000000-0000-4000-8000-000000000001\\") { id } }" }) }));
  expect(mutation.status).toBe(200);
  expect(seenMutations.map(({ operation }) => operation)).toEqual(["create", "update", "delete", "deleteMany", "delete"]);
  const missingClaim = await createApp(repositories, async () => ({ id: "adapter-user", name: "Adapter User", role: "admin", claims: {} }), false, false);
  const denied = await missingClaim.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }));
  expect((await denied.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  expect(seenScopes).toHaveLength(3);
  expect(seenMutations).toHaveLength(5);` : ""}
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ ${adapterEntity.name} { total } }" }) }))).status).toBe(401);
});
`;
  }
  const dataScopeTest = renderDataScopeTest(database, options.scopes ?? [], Boolean(orderWorkflow));
  if (dataScopeTest) files["api/tests/data-scope.test.ts"] = dataScopeTest;
  if (orderWorkflow) {
    const orderScope = options.scopes?.find((scope) => scope.resource === "orders" || scope.resource === database.entities.find((entity) => entity.name === "orders")?.tableName);
    const scopeField = database.entities.find((entity) => entity.name === "orders")?.fields.find((field) => field.name === orderScope?.field);
    const claims = orderScope ? { [orderScope.claim]: scopeField?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example" } : {};
    files["api/tests/workflow-provider.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createDataProvider, createGraphQLDataProvider } from "../../web/app/data-provider";

const orderId = "00000000-0000-4000-8000-000000000001";
const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
const command = "/api/v1/orders/" + orderId + "/submit";

for (const [transport, createProvider] of [["REST", createDataProvider], ["GraphQL", createGraphQLDataProvider]] as const) {
  test(transport + " provider sends workflow commands to guarded REST route", async () => {
    const app = await createApp(repositories, async () => ({ id: "viewer", name: "Viewer", role: "viewer", claims: ${JSON.stringify(claims)} }), true, false);
    const urls: string[] = [];
    const provider = createProvider(async (input, init) => {
      urls.push(String(input));
      return app.handle(new Request(new URL(String(input), "http://localhost"), init));
    });
    ${orderScope ? `const list = await provider.getList({ resource: "orders" });
    expect(list.total).toBe(0);
    expect(urls[0]).toBe(transport === "GraphQL" ? "/graphql" : "/api/v1/orders?page=1&pageSize=20");` : ""}
    await expect(provider.custom?.({ url: command, method: "post", meta: { idempotencyKey: "request-1" } })).rejects.toThrow("Permission denied");
    expect(urls.at(-1)).toBe(command);
    await expect(provider.custom?.({ url: "/api/v1/orders/" + orderId + "/publish", method: "post" })).rejects.toThrow("Unknown workflow command");
    expect(urls.at(-1)).toBe(command);
  });
  test(transport + " provider preserves workflow validation without a database connection", async () => {
    const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: ${JSON.stringify(claims)} }), true, false);
    const provider = createProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
    await expect(provider.custom?.({ url: command, method: "post", meta: { idempotencyKey: "x".repeat(129) } })).rejects.toThrow("Idempotency key is too long");
  });
}
`;
  }
  const sqliteScopeTest = renderSqliteScopeTest(database, options.scopes ?? []);
  if (sqliteScopeTest) files["api/tests/sqlite-scope.test.ts"] = sqliteScopeTest;
  const distributionEntity = database.entities.find((entity) => entity.fields.some((field) => field.enumName));
  if (options.elysiaPlugins?.graphqlAdapter === "yoga" || options.elysiaPlugins?.graphqlAdapter === "apollo") {
    const analyticsEntity = database.entities.find((entity) =>
      (options.scopes ?? []).some((scope) => scope.resource === entity.name || scope.resource === entity.tableName)
      && entity.fields.some((field) => field.enumName || field.type === "DateTime"),
    ) ?? database.entities.find((entity) => entity.fields.some((field) => field.enumName || field.type === "DateTime"));
    if (analyticsEntity) {
      const distributionField = analyticsEntity.fields.find((field) => field.enumName);
      const trendField = analyticsEntity.fields.find((field) => field.type === "DateTime");
      const scope = options.scopes?.find((item) => item.resource === analyticsEntity.name || item.resource === analyticsEntity.tableName);
      const scopeValue = scope && analyticsEntity.fields.find((field) => field.name === scope.field)?.type === "UUID"
        ? "00000000-0000-4000-8000-000000000002" : "Example";
      files["api/tests/graphql-adapter-analytics.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";
import { createGraphQLDataProvider } from "../../web/app/data-provider";

test("official GraphQL analytics match REST and enforce data scope", async () => {
  const seen: Array<{ operation: string; field: string; days?: number; scope?: { field: string; value: string } }> = [];
  const distributionRows = [{ value: ${JSON.stringify(distributionField ? database.enums?.find((item) => item.name === distributionField.enumName)?.values[0]?.name ?? "draft" : "draft")}, count: 2 }];
  const trendRows = [{ day: "2026-10-06", count: 2 }];
  const repository = {
    distribution: async (field: string, scope?: { field: string; value: string }) => { seen.push({ operation: "distribution", field, scope }); return distributionRows; },
    trend: async (field: string, days: number, scope?: { field: string; value: string }) => { seen.push({ operation: "trend", field, days, scope }); return trendRows; },
    list: async () => ({ data: [], total: 0 }), one: async () => undefined,
    create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [],
  };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "analytics-admin", name: "Admin", role: "admin", claims: ${testClaims} }), false, false);
  const provider = createGraphQLDataProvider(async (input, init) => app.handle(new Request(new URL(String(input), "http://localhost"), init)));
${distributionField ? `  const distributionRest = await app.handle(new Request("http://localhost/api/v1/${analyticsEntity.tableName}/distribution?field=${distributionField.name}"));
  expect(distributionRest.status).toBe(200);
  const distribution = await provider.custom?.({ url: "/api/v1/${analyticsEntity.tableName}/distribution", method: "get", query: { field: "${distributionField.name}" } });
  expect(distribution?.data.items).toEqual(await distributionRest.json());
  expect(seen.at(-1)).toEqual({ operation: "distribution", field: "${distributionField.name}", scope: ${scope ? `{ field: ${JSON.stringify(scope.field)}, value: ${JSON.stringify(scopeValue)} }` : "undefined"} });
  const invalidDistribution = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}Distribution(field: \\"id\\") { value count } }" }) }));
  expect((await invalidDistribution.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(2);` : ""}
${trendField ? `  const trendRest = await app.handle(new Request("http://localhost/api/v1/${analyticsEntity.tableName}/trend?field=${trendField.name}&days=30"));
  expect(trendRest.status).toBe(200);
  const trend = await provider.custom?.({ url: "/api/v1/${analyticsEntity.tableName}/trend", method: "get", query: { field: "${trendField.name}", days: 30 } });
  expect(trend?.data.items).toEqual(await trendRest.json());
  expect(seen.at(-1)).toEqual({ operation: "trend", field: "${trendField.name}", days: 30, scope: ${scope ? `{ field: ${JSON.stringify(scope.field)}, value: ${JSON.stringify(scopeValue)} }` : "undefined"} });
  const invalidTrend = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}Trend(field: \\"${trendField.name}\\", days: 0) { day count } }" }) }));
  expect((await invalidTrend.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(${distributionField ? 4 : 2});` : ""}
${scope ? `  const missingClaim = await createApp(repositories, async () => ({ id: "analytics-admin", name: "Admin", role: "admin", claims: {} }), false, false);
  const denied = await missingClaim.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${analyticsEntity.name}${distributionField ? `Distribution(field: \\"${distributionField.name}\\") { value count }` : `Trend(field: \\"${trendField!.name}\\", days: 30) { day count }`} }" }) }));
  expect((await denied.json() as { errors?: unknown[] }).errors?.length).toBeGreaterThan(0);
  expect(seen).toHaveLength(${(distributionField ? 2 : 0) + (trendField ? 2 : 0)});` : ""}
});
`;
    }
  }
  if (distributionEntity) {
    const field = distributionEntity.fields.find((item) => item.enumName)!;
    files["api/tests/distribution.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL expose the full authorized enum distribution", async () => {
  const rows = [{ value: "draft", count: 150 }, { value: "approved", count: 100 }];
  const repository = { distribution: async () => rows, list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const viewer = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: ${testClaims} }), false, false);
  const endpoint = "http://localhost/api/v1/${distributionEntity.tableName}/distribution?field=${field.name}";
  expect(await (await viewer.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await viewer.handle(new Request(endpoint.replace("${field.name}", "not_a_field")))).status).toBe(400);
  const graph = await viewer.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${distributionEntity.name}Distribution(field: \\"${field.name}\\") { value count } }" }) }));
  expect((await graph.json() as { data: { ${distributionEntity.name}Distribution: typeof rows } }).data.${distributionEntity.name}Distribution).toEqual(rows);
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
});
`;
  }
  const trendEntity = database.entities.find((entity) => entity.fields.some((field) => field.type === "DateTime"));
  if (trendEntity) {
    const field = trendEntity.fields.find((item) => item.type === "DateTime")!;
    const scope = options.scopes?.find((item) => item.resource === trendEntity.name || item.resource === trendEntity.tableName);
    files["api/tests/trend.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("REST and GraphQL trend uses the authorized data scope", async () => {
  const rows = [{ day: "2026-10-06", count: 3 }];
  const seen: unknown[] = [];
  const repository = { trend: async (_field: string, _days: number, scope?: unknown) => { seen.push(scope); return rows; }, distribution: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const principal = { id: "admin", name: "Admin", role: "admin" as const, claims: ${JSON.stringify(scope ? { [scope.claim]: "tenant-a" } : {})} };
  const app = await createApp(repositories, async () => principal, false, false);
  const endpoint = "http://localhost/api/v1/${trendEntity.tableName}/trend?field=${field.name}&days=30";
  expect(await (await app.handle(new Request(endpoint))).json()).toEqual(rows);
  expect((await app.handle(new Request(endpoint.replace("${field.name}", "missing")))).status).toBe(400);
  expect((await app.handle(new Request(endpoint.replace("days=30", "days=366")))).status).toBe(422);
  const graph = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${trendEntity.name}Trend(field: \\"${field.name}\\", days: 30) { day count } }" }) }));
  expect(graph.status).toBe(200);
  expect((await graph.json() as { data: { ${trendEntity.name}Trend: typeof rows } }).data.${trendEntity.name}Trend).toEqual(rows);
  expect(seen).toEqual(${scope ? '[{ field: "' + scope.field + '", value: "tenant-a" }, { field: "' + scope.field + '", value: "tenant-a" }]' : '[undefined, undefined]'});
  const anonymous = await createApp(repositories, async () => null, false, false);
  expect((await anonymous.handle(new Request(endpoint))).status).toBe(401);
${scope ? `  const missing = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin" }), false, false);
  expect((await missing.handle(new Request(endpoint))).status).toBe(403);
  const deniedGraph = await missing.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "query { ${trendEntity.name}Trend(field: \\"${field.name}\\", days: 30) { day } }" }) }));
  if (deniedGraph.status === 200) expect((await deniedGraph.json() as { errors?: Array<{ message: string }> }).errors?.length).toBeGreaterThan(0);
  else expect(deniedGraph.status).toBe(403);
  expect(seen).toHaveLength(2);
` : ""}});
`;
  }
  if (database.dialect === "sqlite") {
    const entity = database.entities[0]!;
    const columns = entity.fields.map((field) => `"${field.name}" ${field.type === "Integer" || field.type === "DateTime" ? "integer" : field.type === "Decimal" || field.type === "Money" ? "real" : "text"}${field.primaryKey ? " primary key" : ""}${!field.nullable && !field.primaryKey ? " not null" : ""}`).join(", ");
    const values = entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => `${JSON.stringify(field.name)}: ${field.enumName ? JSON.stringify(database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name) : field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"' : field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"' : field.type === "Files" ? '["uploads/sample.pdf"]' : '"Example"'}`).join(", ");
    files["api/tests/audit.test.ts"] = `import { expect, test } from "bun:test";

test("SQLite CRUD audit rolls back the mutation when the audit insert fails", async () => {
  Bun.env.DATABASE_URL = ":memory:";
  const { client } = await import("../src/db");
  const { ${modelName(entity)}Repository } = await import("../src/modules/${entity.name}/${entity.name}.repository");
  client.exec(${JSON.stringify(`DROP TABLE IF EXISTS "${entity.tableName}"; DROP TABLE IF EXISTS "audit_events"; CREATE TABLE "${entity.tableName}" (${columns}); CREATE TABLE "audit_events" ("id" text primary key, "actorId" text, "action" text not null, "resource" text not null, "resourceId" text, "metadata" text, "createdAt" integer not null);`)});
  const actorId = "00000000-0000-4000-8000-000000000001";
  const values = { ${values} };
  const created = await ${modelName(entity)}Repository.create(values, actorId);
  expect(created.id).toBeTruthy();
  expect(client.query<{ action: string; actorId: string }, []>("select action, actorId from audit_events").get()).toEqual({ action: "${entity.tableName}.created", actorId });
  client.exec("DROP TABLE audit_events");
  await expect(${modelName(entity)}Repository.create(values, actorId)).rejects.toThrow();
  expect(client.query<{ total: number }, []>("select count(*) as total from ${entity.tableName}").get()?.total).toBe(1);
});
`;
  }
  const documentedFields = (entity: EntityIR) => entity.fields.filter((field) => !field.primaryKey && field.comment !== undefined && !(hasLocalAuth && entity.name === options.auth!.userEntity && field.name === options.auth!.passwordField));
  const describedEntities = database.entities.filter((entity) => entity.comment !== undefined || documentedFields(entity).length);
  const describedDataflows = (options.dataflows ?? []).filter((flow) => flow.label !== undefined || flow.comment !== undefined);
  if (describedEntities.length || describedDataflows.length) {
    files["api/tests/documentation.test.ts"] = `import { expect, test } from "bun:test";
import { createApp, type Repositories } from "../src/app";

test("publishes model descriptions in the actual OpenAPI request schemas", async () => {
  const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories);
  const response = await app.handle(new Request("http://localhost/api/v1/openapi/json"));
  expect(response.status).toBe(200);
  const specification = await response.json();
  const expected: Array<{ resource: string; description?: string; fields: Record<string, string> }> = ${JSON.stringify(describedEntities.map((entity) => ({ resource: entity.tableName, description: entity.comment, fields: Object.fromEntries(documentedFields(entity).map((field) => [field.name, field.comment])) })))};
  for (const entity of expected) {
    for (const method of ["post", "patch"]) {
      const path = "/api/v1/" + entity.resource + (method === "post" ? "/" : "/{id}");
      const original = specification.paths[path][method].requestBody.content["application/json"].schema;
      const schema = original.$ref ? specification.components.schemas[original.$ref.split("/").at(-1)] : original;
      if (entity.description !== undefined) expect(schema.description).toBe(entity.description);
      for (const [name, description] of Object.entries(entity.fields)) expect(schema.properties[name].description).toBe(description);
    }
  }
  const dataflows: Array<{ name: string; summary: string; description: string }> = ${JSON.stringify(describedDataflows.map((flow) => ({ name: flow.name, summary: flow.label ?? flow.name, description: flow.comment ?? flow.label ?? flow.name })))};
  for (const flow of dataflows) {
    const operation = specification.paths["/api/v1/commands/" + flow.name].post;
    expect(operation.summary).toBe(flow.summary);
    expect(operation.description).toBe(flow.description);
    expect(operation.tags).toContain("Dataflow");
  }
});
`;
  }
  if (auth) {
    Object.assign(files, generateAudit(database, auth, options.scopes));
    const userTable = database.entities.find((entity) => entity.name === auth.userEntity)!.tableName;
    files["api/src/auth/guard.ts"] = files["api/src/auth/guard.ts"]!.replace('resource.path === "users"', `resource.path === ${JSON.stringify(userTable)}`);
  }
  return files;
}










function renderMultiProviderOidcModule(auth: NonNullable<QiyProject["auth"]>): string {
  const providerIds = JSON.stringify(auth.providers ?? [auth.provider]);
  const labels = JSON.stringify({
    oidc: "OpenID Connect", oauth2: "OAuth2", sso: "SSO", okta: "Okta", auth0: "Auth0",
    "azure-ad-b2c": "Azure AD B2C", keycloak: "Keycloak", google: "Google", kinde: "Kinde",
  });
  const mappings = JSON.stringify(Object.fromEntries((auth.providerMappings ?? []).map((mapping) => [mapping.provider, { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) }])));
  const roleField = JSON.stringify(auth.roleField);
  const defaultSubjectField = JSON.stringify(auth.subjectField);
  const userEntity = auth.userEntity;
  const lines: string[] = [];
  lines.push("import { createRemoteJWKSet } from \"jose\";");
  lines.push("import { eq } from \"drizzle-orm\";");
  lines.push("import { Elysia } from \"elysia\";");
  lines.push("import { db } from \"../db\";");
  lines.push("import { " + userEntity + " } from \"../schema\";");
  lines.push("import { createOidcAuthenticator } from \"./verify\";");
  lines.push("import type { Authenticator } from \"./guard\";");
  lines.push("");
  lines.push("export interface QiyOidcProviderConfig {");
  lines.push("  id: string; label: string; issuer: string; audience: string; jwksUrl: string;");
  lines.push("  authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope: string; redirectUri?: string; logoutUrl?: string; clientSecret?: string;");
  lines.push("  subjectField?: string; claim?: string;");
  lines.push("}");
  lines.push("");
  lines.push("const providerIds = " + providerIds + " as const;");
  lines.push("const providerLabels: Record<string, string> = " + labels + ";");
  lines.push("const providerMappings: Record<string, { subjectField: string; claim?: string }> = " + mappings + ";");
  lines.push("const defaultSubjectField: string = " + defaultSubjectField + ";");
  lines.push("function envSuffix(id: string): string { return id.toUpperCase().replace(/[^A-Z0-9]/g, \"_\"); }");
  lines.push("function readEnv(name: string): string | undefined { const value = Bun.env[name]; return value && value.trim() !== \"\" ? value.trim() : undefined; }");
  lines.push("function providerEnv(id: string, suffix: string): string | undefined { return readEnv(\"QIY_OIDC_\" + envSuffix(id) + \"_\" + suffix); }");
  lines.push("");
  lines.push("export function providerConfigs(): QiyOidcProviderConfig[] {");
  lines.push("  return providerIds.flatMap((id) => {");
  lines.push("    const issuer = providerEnv(id, \"ISSUER\");");
  lines.push("    const audience = providerEnv(id, \"AUDIENCE\");");
  lines.push("    const jwksUrl = providerEnv(id, \"JWKS_URL\");");
  lines.push("    if (!issuer || !audience || !jwksUrl) return [];");
  lines.push("    const mapping = providerMappings[id];");
  lines.push("    return [{ id, label: providerLabels[id] ?? id, issuer, audience, jwksUrl,");
  lines.push("      authorizationUrl: providerEnv(id, \"AUTHORIZATION_URL\"), tokenUrl: providerEnv(id, \"TOKEN_URL\"),");
  lines.push("      clientId: providerEnv(id, \"CLIENT_ID\"), scope: providerEnv(id, \"SCOPE\") ?? \"openid profile email\",");
  lines.push("      redirectUri: providerEnv(id, \"REDIRECT_URI\") ?? readEnv(\"QIY_OIDC_REDIRECT_URI\"), logoutUrl: providerEnv(id, \"LOGOUT_URL\"),");
  lines.push("      clientSecret: providerEnv(id, \"CLIENT_SECRET\"),");
  lines.push("      ...(mapping ? { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) } : {}) }];");
  lines.push("  });");
  lines.push("}");
  lines.push("");
  lines.push("export function publicAuthProviders() {");
  lines.push("  return providerConfigs().filter((config) => config.authorizationUrl && config.clientId).map((config) => ({");
  lines.push("    id: config.id, label: config.label, authorizationUrl: config.authorizationUrl!, clientId: config.clientId!,");
  lines.push("    tokenUrl: config.tokenUrl, scope: config.scope, redirectUri: config.redirectUri, ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),");
  lines.push("  }));");
  lines.push("}");
  lines.push("");
  lines.push("export function createAuthProviderRoutes() {");
  lines.push("  return new Elysia({ prefix: \"/api/v1/auth\" })");
  lines.push("    .get(\"/providers\", () => ({ providers: publicAuthProviders() }))");
  lines.push("    .post(\"/exchange\", async (context: any) => {");
  lines.push("      const { body, set } = context;");
  lines.push("      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string };");
  lines.push("      const config = input.provider ? providerConfigs().find((candidate) => candidate.id === input.provider) : undefined;");
  lines.push("      if (!config || !config.tokenUrl || !config.clientId || !input.code) { set.status = 400; return { error: \"invalid token exchange request\" }; }");
  lines.push("      const form = new URLSearchParams({ grant_type: \"authorization_code\", code: input.code, client_id: config.clientId, redirect_uri: input.redirectUri ?? config.redirectUri ?? \"\" });");
  lines.push("      if (input.codeVerifier) form.set(\"code_verifier\", input.codeVerifier);");
  lines.push("      if (config.clientSecret) form.set(\"client_secret\", config.clientSecret);");
  lines.push("      const response = await fetch(config.tokenUrl, { method: \"POST\", headers: { \"Content-Type\": \"application/x-www-form-urlencoded\", Accept: \"application/json\" }, body: form.toString() });");
  lines.push("      const tokens = (await response.json().catch(() => ({}))) as { access_token?: string; id_token?: string; expires_in?: number; error?: string };");
  lines.push("      if (!response.ok || !tokens.access_token) { set.status = 401; return { error: tokens.error ?? \"provider token exchange failed\" }; }");
  lines.push("      return { access_token: tokens.access_token, ...(tokens.id_token ? { id_token: tokens.id_token } : {}), ...(typeof tokens.expires_in === \"number\" ? { expires_in: tokens.expires_in } : {}) };");
  lines.push("    });");
  lines.push("}");
  lines.push("");
  lines.push("function positiveInteger(name: string, fallback: number, minimum: number): number {");
  lines.push("  const raw = Bun.env[name];");
  lines.push("  if (raw === undefined || raw === \"\") return fallback;");
  lines.push("  const value = Number(raw);");
  lines.push("  if (!Number.isInteger(value) || value < minimum) throw new Error(name + \" must be an integer of at least \" + minimum);");
  lines.push("  return value;");
  lines.push("}");
  lines.push("");
  lines.push("export function createProductionAuthenticator(): Authenticator {");
  lines.push("  const configs = providerConfigs();");
  lines.push("  if (configs.length === 0) throw new Error(\"No OIDC provider is configured: set QIY_OIDC_<PROVIDER>_ISSUER, _AUDIENCE and _JWKS_URL (for example QIY_OIDC_GOOGLE_ISSUER)\");");
  lines.push("  const timeoutDuration = positiveInteger(\"QIY_OIDC_JWKS_TIMEOUT_MS\", 5000, 1);");
  lines.push("  const cooldownDuration = positiveInteger(\"QIY_OIDC_JWKS_COOLDOWN_MS\", 30000, 0);");
  lines.push("  const cacheMaxAge = positiveInteger(\"QIY_OIDC_JWKS_CACHE_MAX_AGE_MS\", 600000, 1);");
  lines.push("  const subjectColumns = " + userEntity + " as unknown as Record<string, Parameters<typeof eq>[0]>;");
  lines.push("  const authenticators = configs.map((config) => ({");
  lines.push("    issuer: config.issuer.replace(/\\/+$/, \"\"),");
  lines.push("    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,");
  lines.push("      keySet: createRemoteJWKSet(new URL(config.jwksUrl), { timeoutDuration, cooldownDuration, cacheMaxAge }), roleField: " + roleField + ",");
  lines.push("      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === \"string\" && payload[config.claim!] !== \"\" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === \"string\" && payload.sub !== \"\" ? String(payload.sub) : null } : {}),");
  lines.push("      async findUser(externalSubject) {");
  lines.push("        const column = subjectColumns[config.subjectField ?? defaultSubjectField];");
  lines.push("        const rows = await db.select().from(" + userEntity + ").where(eq(column!, externalSubject)).limit(2);");
  lines.push("        return rows.length === 1 ? rows[0]! : null;");
  lines.push("      },");
  lines.push("    }),");
  lines.push("  }));");
  lines.push("  // Route by the unverified issuer first, then verify only against that provider's JWKS.");
  lines.push("  return async (request) => {");
  lines.push("    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get(\"authorization\") ?? \"\");");
  lines.push("    if (!match) return null;");
  lines.push("    let issuer: string | undefined;");
  lines.push("    try { const payload = JSON.parse(Buffer.from(match[1]!.split(\".\")[1] ?? \"\", \"base64url\").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }");
  lines.push("    if (!issuer) return null;");
  lines.push("    const normalized = issuer.replace(/\\/+$/, \"\");");
  lines.push("    const selected = authenticators.find((candidate) => candidate.issuer === normalized);");
  lines.push("    if (!selected) return null;");
  lines.push("    return selected.authenticate(request);");
  lines.push("  };");
  lines.push("}");
  return lines.join("\n") + "\n";
}

/**
 * Composes the password authenticator and the OAuth provider authenticator into
 * one bearer authenticator for hybrid apps. Password (`qiy-admin` HS256) sessions
 * are checked first; provider tokens are routed by their `iss` claim.
 */
function renderHybridAuthenticatorModule(): string {
  return `import { createProductionAuthenticator as createLocalAuthenticator } from "./local";
import { createProductionAuthenticator as createProviderAuthenticator } from "./oidc";
import type { Authenticator } from "./guard";

/**
 * Hybrid authentication: signed password sessions (issuer "qiy-admin") and
 * OAuth/OIDC provider tokens share one bearer authenticator. The provider side
 * only verifies tokens whose issuer matches a configured provider, so an
 * unknown or forged token is never accepted.
 */
export function createProductionAuthenticator(): Authenticator {
  const local = createLocalAuthenticator();
  const providers = createProviderAuthenticator();
  return async (request) => (await local(request)) ?? (await providers(request));
}
`;
}

/**
 * GET /api/v1/auth/identities: the signed-in account plus every configured
 * login method. Bind/unbind uses the per-provider subject columns as the binding
 * store, so this module only reads them (plus the optional profile metadata
 * column that remembers the email/name returned by the provider).
 */
function renderAccountModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR): string {
  const user = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const providerIdentities = (auth.providers ?? []).map((provider) => ({ id: provider, label: providerLabel(provider), subjectField: authProviderSubjectField(auth, provider) }));
  const emailField = user.fields.some((field) => field.name === "email") && auth.usernameField !== "email" ? "email" : null;
  const displayNameField = ["displayName", "name"].find((name) => user.fields.some((field) => field.name === name)) ?? null;
  return `import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import type { Authenticator } from "./guard";

interface QiyProviderIdentitySummary { id: string; label: string; bound: boolean; subject?: string; email?: string; name?: string }
interface QiyProfileMetadata { email?: string; name?: string; sub?: string }

const providerIdentities: Array<{ id: string; label: string; subjectField: string }> = ${JSON.stringify(providerIdentities)};
const USERNAME_FIELD = ${JSON.stringify(auth.usernameField)};
const PASSWORD_FIELD = ${JSON.stringify(auth.passwordField)};
const ROLE_FIELD = ${JSON.stringify(auth.roleField)};
const PROFILE_FIELD: string | null = ${JSON.stringify(auth.profileField ?? null)};
const EMAIL_FIELD: string | null = ${JSON.stringify(emailField)};
const DISPLAY_NAME_FIELD: string | null = ${JSON.stringify(displayNameField)};

function readProfiles(record: Record<string, unknown>): Record<string, QiyProfileMetadata> {
  if (!PROFILE_FIELD) return {};
  const raw = record[PROFILE_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try { const parsed = JSON.parse(raw) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, QiyProfileMetadata> : {}; } catch { return {}; }
}

export function createAccountRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" }).get("/identities", async (context: any) => {
    const { request, set } = context;
    const principal = await authenticate(request);
    if (!principal) { set.status = 401; return { error: "Authentication required" }; }
    const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, principal.id)).limit(1);
    const row = rows[0];
    if (!row) { set.status = 401; return { error: "Unknown account" }; }
    const record = row as unknown as Record<string, unknown>;
    const profiles = readProfiles(record);
    const username = String(record[USERNAME_FIELD] ?? "");
    const email = EMAIL_FIELD ? String(record[EMAIL_FIELD] ?? username) : username;
    const name = DISPLAY_NAME_FIELD ? String(record[DISPLAY_NAME_FIELD] ?? username) : username;
    const passwordSet = Boolean(record[PASSWORD_FIELD]);
    const providers: QiyProviderIdentitySummary[] = providerIdentities.map((provider) => {
      const subject = record[provider.subjectField];
      const metadata = profiles[provider.id];
      return { id: provider.id, label: provider.label, bound: typeof subject === "string" && subject !== "", ...(typeof subject === "string" && subject !== "" ? { subject } : {}), ...(metadata?.email ? { email: metadata.email } : {}), ...(metadata?.name ? { name: metadata.name } : {}) };
    });
    const loginMethodCount = providers.filter((provider) => provider.bound).length + (passwordSet ? 1 : 0);
    return { user: { id: String(record.id), username, email, name, role: String(record[ROLE_FIELD] ?? "") }, password: { set: passwordSet }, providers, loginMethodCount };
  });
}
`;
}

/**
 * Generated unit test for the onboarding-token contract. It does not need a
 * database or an identity provider, so it runs with the other generated tests.
 */
function renderHybridAuthTest(auth: NonNullable<QiyProject["auth"]>): string {
  const provider = (auth.providers ?? ["oidc"])[0]!;
  return `import { expect, test } from "bun:test";
import { SignJWT } from "jose";
import { createOnboardingToken, readOnboardingToken } from "../src/auth/oidc";

const secret = "qiy-hybrid-auth-test-secret-value-at-least-32";

test("signs and verifies a short-lived provider onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: ${JSON.stringify(provider)}, subject: "subject-1", username: "new@example.test", email: "new@example.test", name: "New User" });
  const claims = await readOnboardingToken(token);
  expect(claims.provider).toBe(${JSON.stringify(provider)});
  expect(claims.subject).toBe("subject-1");
  expect(claims.email).toBe("new@example.test");
});

test("rejects a tampered, expired or foreign onboarding token", async () => {
  Bun.env.QIY_AUTH_SECRET = secret;
  const token = await createOnboardingToken({ provider: ${JSON.stringify(provider)}, subject: "subject-1" });
  await expect(readOnboardingToken(token + "x")).rejects.toThrow();
  const foreign = await new SignJWT({ typ: "qiy-onboarding", provider: ${JSON.stringify(provider)}, identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode("a-different-secret-that-is-long-enough-32"));
  await expect(readOnboardingToken(foreign)).rejects.toThrow();
  const expired = await new SignJWT({ typ: "qiy-onboarding", provider: ${JSON.stringify(provider)}, identitySubject: "subject-1" }).setProtectedHeader({ alg: "HS256" }).setIssuer("qiy-admin").setAudience("qiy-admin").setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 1800).sign(new TextEncoder().encode(secret));
  await expect(readOnboardingToken(expired)).rejects.toThrow();
});
`;
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    oidc: "OpenID Connect", oauth2: "OAuth2", sso: "SSO", okta: "Okta", auth0: "Auth0",
    "azure-ad-b2c": "Azure AD B2C", keycloak: "Keycloak", google: "Google", kinde: "Kinde",
  };
  return labels[provider] ?? provider;
}

/**
 * Hybrid auth server module (`auth/oidc.ts` for a project that combines password
 * login with OAuth providers). It keeps the multi-provider configuration and
 * issuer routing, and adds:
 *  - POST /api/v1/auth/exchange  -> session token, or needsOnboarding + signed onboarding token
 *  - POST /api/v1/auth/oauth/register -> create the users row and sign in
 *  - POST /api/v1/auth/bind       -> link an additional provider to the current account
 *  - POST /api/v1/auth/unbind     -> remove a provider, refusing the last login method
 *  - GET  /api/v1/auth/providers  -> public provider list for the login page
 * Account reads live in ./account (GET /api/v1/auth/identities).
 */
function renderHybridAuthModule(auth: NonNullable<QiyProject["auth"]>, database: DatabaseIR): string {
  const user = database.entities.find((entity) => entity.name === auth.userEntity)!;
  const providerIds = auth.providers ?? [];
  const mappings = Object.fromEntries((auth.providerMappings ?? [])
    .filter((mapping) => providerIds.includes(mapping.provider))
    .map((mapping) => [mapping.provider, { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) }]));
  const roleValues = database.enums?.find((item) => item.name === user.fields.find((field) => field.name === auth.roleField)?.enumName)?.values.map((item) => item.name);
  const emailField = user.fields.some((field) => field.name === "email") && auth.usernameField !== "email" ? "email" : null;
  const displayNameField = ["displayName", "name"].find((name) => user.fields.some((field) => field.name === name)) ?? null;
  const nameExpression = principalNameExpression(user, displayNameField ?? undefined, auth.usernameField);
  const labels = Object.fromEntries(providerIds.map((provider) => [provider, providerLabel(provider)]));
  return `import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "../db";
import { ${auth.userEntity} } from "../schema";
import { createOidcAuthenticator } from "./verify";
import { hashPassword, isRole, signAccessToken, type Role } from "./password";
import type { Authenticator } from "./guard";

const ISSUER = "qiy-admin";
const TOKEN_TTL_SECONDS = 43200;
const ONBOARDING_TTL = "10m";
const DEFAULT_SUBJECT_FIELD = ${JSON.stringify(auth.subjectField)};
const USERNAME_FIELD = ${JSON.stringify(auth.usernameField)};
const PASSWORD_FIELD = ${JSON.stringify(auth.passwordField)};
const ROLE_FIELD = ${JSON.stringify(auth.roleField)};
const PROFILE_FIELD: string | null = ${JSON.stringify(auth.profileField ?? null)};
const EMAIL_FIELD: string | null = ${JSON.stringify(emailField)};
const DISPLAY_NAME_FIELD: string | null = ${JSON.stringify(displayNameField)};
const ALLOWED_ROLES: readonly string[] = ${JSON.stringify(roleValues ?? ["admin", "operator", "viewer"])};
const DEFAULT_ROLE_ENV = "QIY_OIDC_DEFAULT_ROLE";

export interface QiyOidcProviderConfig {
  id: string; label: string; issuer: string; audience: string; jwksUrl: string;
  authorizationUrl?: string; tokenUrl?: string; clientId?: string; scope: string; redirectUri?: string; logoutUrl?: string; clientSecret?: string;
  subjectField?: string; claim?: string;
}

export interface QiyProviderIdentity { provider: string; subject: string; username?: string; email?: string; name?: string }
export interface QiyOnboardingClaims { provider: string; subject: string; username?: string; email?: string; name?: string }
interface QiyProviderTokens { accessToken?: string; idToken?: string }
interface QiyProfileMetadata { email?: string; name?: string; sub?: string }
type UserRow = typeof ${auth.userEntity}.$inferSelect;

const providerIds = ${JSON.stringify(providerIds)} as const;
const providerLabels: Record<string, string> = ${JSON.stringify(labels)};
const providerMappings: Record<string, { subjectField: string; claim?: string }> = ${JSON.stringify(mappings)};

function envSuffix(id: string): string { return id.toUpperCase().replace(/[^A-Z0-9]/g, "_"); }
function readEnv(name: string): string | undefined { const value = Bun.env[name]; return value && value.trim() !== "" ? value.trim() : undefined; }
function providerEnv(id: string, suffix: string): string | undefined { return readEnv("QIY_OIDC_" + envSuffix(id) + "_" + suffix); }

export function providerConfigs(): QiyOidcProviderConfig[] {
  return providerIds.flatMap((id) => {
    const issuer = providerEnv(id, "ISSUER");
    const audience = providerEnv(id, "AUDIENCE");
    const jwksUrl = providerEnv(id, "JWKS_URL");
    if (!issuer || !audience || !jwksUrl) return [];
    const mapping = providerMappings[id];
    return [{ id, label: providerLabels[id] ?? id, issuer, audience, jwksUrl,
      authorizationUrl: providerEnv(id, "AUTHORIZATION_URL"), tokenUrl: providerEnv(id, "TOKEN_URL"),
      clientId: providerEnv(id, "CLIENT_ID"), scope: providerEnv(id, "SCOPE") ?? "openid profile email",
      redirectUri: providerEnv(id, "REDIRECT_URI") ?? readEnv("QIY_OIDC_REDIRECT_URI"), logoutUrl: providerEnv(id, "LOGOUT_URL"),
      clientSecret: providerEnv(id, "CLIENT_SECRET"),
      ...(mapping ? { subjectField: mapping.subjectField, ...(mapping.claim ? { claim: mapping.claim } : {}) } : {}) }];
  });
}

export function publicAuthProviders() {
  return providerConfigs().filter((config) => config.authorizationUrl && config.clientId).map((config) => ({
    id: config.id, label: config.label, authorizationUrl: config.authorizationUrl!, clientId: config.clientId!,
    tokenUrl: config.tokenUrl, scope: config.scope, redirectUri: config.redirectUri, ...(config.logoutUrl ? { logoutUrl: config.logoutUrl } : {}),
  }));
}

function authSecret(): string {
  const value = Bun.env.QIY_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("QIY_AUTH_SECRET must be at least 32 characters for hybrid password and OAuth authentication");
  return value;
}

/** Default role for accounts created through first-time OAuth onboarding. */
export function defaultRole(): Role {
  const configured = Bun.env[DEFAULT_ROLE_ENV]?.trim();
  const role = configured && configured !== "" ? configured : "viewer";
  if (!ALLOWED_ROLES.includes(role) || !isRole(role)) throw new Error(DEFAULT_ROLE_ENV + " must be one of " + ALLOWED_ROLES.join(", "));
  return role;
}

function positiveInteger(name: string, fallback: number, minimum: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(name + " must be an integer of at least " + minimum);
  return value;
}

const providerKeySets = new Map<string, JWTVerifyGetKey>();
function providerKeySet(config: QiyOidcProviderConfig): JWTVerifyGetKey {
  const existing = providerKeySets.get(config.id);
  if (existing) return existing;
  const keySet = createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: positiveInteger("QIY_OIDC_JWKS_TIMEOUT_MS", 5000, 1),
    cooldownDuration: positiveInteger("QIY_OIDC_JWKS_COOLDOWN_MS", 30000, 0),
    cacheMaxAge: positiveInteger("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS", 600000, 1),
  });
  providerKeySets.set(config.id, keySet);
  return keySet;
}

function providerAudiences(config: QiyOidcProviderConfig): string[] {
  return [...new Set([config.audience, config.clientId].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function claimString(payload: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) { const value = payload[name]; if (typeof value === "string" && value.trim() !== "") return value.trim(); }
  return undefined;
}

/** Matches ./verify: a mapped provider uses sub (or its claim); an unmapped provider uses issuer|sub. */
function mappedSubject(config: QiyOidcProviderConfig, payload: Record<string, unknown>): string | null {
  if (config.claim) { const value = payload[config.claim]; return typeof value === "string" && value !== "" ? value : null; }
  if (config.subjectField) return typeof payload.sub === "string" && payload.sub !== "" ? payload.sub : null;
  return typeof payload.sub === "string" && payload.sub !== "" && typeof payload.iss === "string" ? payload.iss + "|" + payload.sub : null;
}

function identityFromPayload(config: QiyOidcProviderConfig, payload: Record<string, unknown>): QiyProviderIdentity | null {
  const subject = mappedSubject(config, payload);
  if (!subject) return null;
  const username = claimString(payload, ["preferred_username", "username", "email"]);
  const email = claimString(payload, ["email"]);
  const name = claimString(payload, ["name", "display_name", "preferred_username", "given_name"]);
  return { provider: config.id, subject, ...(username ? { username } : {}), ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

async function exchangeAuthorizationCode(config: QiyOidcProviderConfig, input: { code: string; codeVerifier?: string; redirectUri?: string }): Promise<QiyProviderTokens> {
  if (!config.tokenUrl || !config.clientId) throw new Error("The provider token endpoint and client id are required");
  const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, client_id: config.clientId, redirect_uri: input.redirectUri ?? config.redirectUri ?? "" });
  if (input.codeVerifier) form.set("code_verifier", input.codeVerifier);
  if (config.clientSecret) form.set("client_secret", config.clientSecret);
  const response = await fetch(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
  const tokens = (await response.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string };
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error ?? "The provider token exchange failed");
  return { accessToken: tokens.access_token, ...(tokens.id_token ? { idToken: tokens.id_token } : {}) };
}

async function resolveProviderIdentity(config: QiyOidcProviderConfig, tokens: QiyProviderTokens): Promise<QiyProviderIdentity> {
  const candidates = [tokens.idToken, tokens.accessToken].filter((value): value is string => typeof value === "string" && value.length > 0);
  let failure = "the identity provider did not return a verifiable token";
  for (const token of candidates) {
    try {
      const { payload } = await jwtVerify(token, providerKeySet(config), { issuer: config.issuer, audience: providerAudiences(config), algorithms: ["RS256", "ES256"] });
      const identity = identityFromPayload(config, payload as Record<string, unknown>);
      if (identity) return identity;
      failure = "the identity provider token did not contain an identity subject";
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  }
  throw new Error("The identity provider token could not be verified: " + failure);
}

function userColumn(name: string): Parameters<typeof eq>[0] | undefined {
  return (${auth.userEntity} as unknown as Record<string, Parameters<typeof eq>[0]>)[name];
}

async function findUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1);
  return rows[0] ?? null;
}

async function findUserBySubject(config: QiyOidcProviderConfig, subject: string): Promise<UserRow | null> {
  const columnName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
  const column = userColumn(columnName);
  if (!column) throw new Error("Auth mapping references an unknown user field: " + columnName);
  const rows = await db.select().from(${auth.userEntity}).where(eq(column, subject)).limit(2);
  return rows.length === 1 ? rows[0] ?? null : null;
}

function roleOf(row: UserRow): Role {
  const role = (row as unknown as Record<string, unknown>)[ROLE_FIELD];
  if (!isRole(role)) throw new Error("The user account has an invalid role");
  return role;
}

function readProfiles(row: UserRow): Record<string, QiyProfileMetadata> {
  if (!PROFILE_FIELD) return {};
  const raw = (row as unknown as Record<string, unknown>)[PROFILE_FIELD];
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try { const parsed = JSON.parse(raw) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, QiyProfileMetadata> : {}; } catch { return {}; }
}

function profileMetadata(identity: QiyProviderIdentity): QiyProfileMetadata {
  return { ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}), sub: identity.subject };
}

async function issueSession(row: UserRow) {
  const role = roleOf(row);
  return {
    accessToken: await signAccessToken({ id: row.id, role }, authSecret(), ISSUER),
    tokenType: "Bearer" as const,
    expiresIn: TOKEN_TTL_SECONDS,
    user: { id: row.id, name: ${nameExpression}, role },
  };
}

/** Short-lived signed token that lets a verified provider identity finish registration. */
export async function createOnboardingToken(identity: QiyProviderIdentity): Promise<string> {
  return await new SignJWT({ typ: "qiy-onboarding", provider: identity.provider, identitySubject: identity.subject, ...(identity.username ? { username: identity.username } : {}), ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.provider + ":" + identity.subject)
    .setIssuer(ISSUER)
    .setAudience(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ONBOARDING_TTL)
    .sign(new TextEncoder().encode(authSecret()));
}

export async function readOnboardingToken(token: string): Promise<QiyOnboardingClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(authSecret()), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] });
  if (payload.typ !== "qiy-onboarding" || typeof payload.provider !== "string" || typeof payload.identitySubject !== "string") throw new Error("Invalid or expired onboarding token");
  return {
    provider: payload.provider,
    subject: payload.identitySubject,
    ...(typeof payload.username === "string" && payload.username !== "" ? { username: payload.username } : {}),
    ...(typeof payload.email === "string" && payload.email !== "" ? { email: payload.email } : {}),
    ...(typeof payload.name === "string" && payload.name !== "" ? { name: payload.name } : {}),
  };
}

function validEmail(value: string): boolean { return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value); }

export function createProductionAuthenticator(): Authenticator {
  const configs = providerConfigs();
  if (configs.length === 0) return async () => null;
  const authenticators = configs.map((config) => ({
    issuer: config.issuer.replace(/\\/+$/, ""),
    authenticate: createOidcAuthenticator({ issuer: config.issuer, audience: config.audience,
      keySet: providerKeySet(config), roleField: ROLE_FIELD,
      ...(config.claim ? { subject: (payload: Record<string, unknown>) => typeof payload[config.claim!] === "string" && payload[config.claim!] !== "" ? String(payload[config.claim!]) : null } : config.subjectField ? { subject: (payload: Record<string, unknown>) => typeof payload.sub === "string" && payload.sub !== "" ? String(payload.sub) : null } : {}),
      async findUser(externalSubject) {
        const column = userColumn(config.subjectField ?? DEFAULT_SUBJECT_FIELD);
        if (!column) throw new Error("Auth mapping references an unknown user field: " + (config.subjectField ?? DEFAULT_SUBJECT_FIELD));
        const rows = await db.select().from(${auth.userEntity}).where(eq(column, externalSubject)).limit(2);
        return rows.length === 1 ? rows[0]! : null;
      },
    }),
  }));
  // Password sessions use the "qiy-admin" issuer and are handled by ./local;
  // provider tokens are routed by their unverified issuer first and then verified
  // against that provider's JWKS only.
  return async (request) => {
    const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? "");
    if (!match) return null;
    let issuer: string | undefined;
    try { const payload = JSON.parse(Buffer.from(match[1]!.split(".")[1] ?? "", "base64url").toString()) as { iss?: string }; issuer = payload.iss; } catch { return null; }
    if (!issuer) return null;
    const normalized = issuer.replace(/\\/+$/, "");
    if (normalized === ISSUER) return null;
    const selected = authenticators.find((candidate) => candidate.issuer === normalized);
    if (!selected) return null;
    try { return await selected.authenticate(request); } catch { return null; }
  };
}

function providerForRequest(provider: string | undefined): QiyOidcProviderConfig | undefined {
  return provider ? providerConfigs().find((candidate) => candidate.id === provider) : undefined;
}

export function createHybridAuthRoutes(authenticate: Authenticator) {
  return new Elysia({ prefix: "/api/v1/auth" })
    .get("/providers", () => ({ providers: publicAuthProviders(), local: true }))
    .post("/exchange", async (context: any) => {
      const { body, set } = context;
      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string };
      const config = providerForRequest(input.provider);
      if (!config || !config.tokenUrl || !config.clientId || typeof input.code !== "string" || input.code === "") { set.status = 400; return { error: "invalid token exchange request" }; }
      let identity: QiyProviderIdentity;
      try {
        identity = await resolveProviderIdentity(config, await exchangeAuthorizationCode(config, { code: input.code, ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) }));
      } catch (error) { set.status = 401; return { error: error instanceof Error ? error.message : "The provider token exchange failed" }; }
      const existing = await findUserBySubject(config, identity.subject);
      if (existing) return await issueSession(existing);
      return {
        needsOnboarding: true,
        onboardingToken: await createOnboardingToken(identity),
        provider: { id: config.id, label: config.label },
        profile: { sub: identity.subject, ...(identity.username ? { username: identity.username } : {}), ...(identity.email ? { email: identity.email } : {}), ...(identity.name ? { name: identity.name } : {}) },
      };
    })
    .post("/oauth/register", async (context: any) => {
      const { body, set } = context;
      const input = (body ?? {}) as { onboardingToken?: string; username?: string; email?: string; password?: string };
      const token = typeof input.onboardingToken === "string" ? input.onboardingToken : "";
      const username = typeof input.username === "string" ? input.username.trim() : "";
      const email = typeof input.email === "string" ? input.email.trim() : "";
      const password = typeof input.password === "string" ? input.password : "";
      if (!token || !username || !password) { set.status = 400; return { error: "An onboarding token, username and password are required" }; }
      let claims: QiyOnboardingClaims;
      try { claims = await readOnboardingToken(token); } catch { set.status = 401; return { error: "The onboarding session is invalid or has expired. Start the provider sign-in again." }; }
      const config = providerForRequest(claims.provider);
      if (!config) { set.status = 400; return { error: "The identity provider is no longer configured" }; }
      if (USERNAME_FIELD === "email" && !validEmail(username)) { set.status = 400; return { error: "Enter a valid email address" }; }
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      if (await findUserBySubject(config, claims.subject)) { set.status = 409; return { error: "This identity is already registered. Sign in with that provider instead." }; }
      const usernameColumn = userColumn(USERNAME_FIELD);
      if (!usernameColumn) { set.status = 500; return { error: "The generated auth configuration is missing its username field" }; }
      if ((await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(usernameColumn, username)).limit(1)).length > 0) { set.status = 409; return { error: "That " + USERNAME_FIELD + " is already registered" }; }
      const emailValue = email || username;
      if (EMAIL_FIELD === "email" && !validEmail(emailValue)) { set.status = 400; return { error: "Enter a valid email address" }; }
      if (EMAIL_FIELD) {
        const emailColumn = userColumn(EMAIL_FIELD);
        if (emailColumn && (await db.select({ id: ${auth.userEntity}.id }).from(${auth.userEntity}).where(eq(emailColumn, emailValue)).limit(1)).length > 0) { set.status = 409; return { error: "That email is already registered" }; }
      }
      let passwordHash: string;
      try { passwordHash = await hashPassword(password); } catch (error) { set.status = 400; return { error: error instanceof Error ? error.message : "Password must be at least 8 characters" }; }
      const role = defaultRole();
      const id = crypto.randomUUID();
      const displayName = claims.name && claims.name.trim() !== "" ? claims.name.trim() : username;
      const values: Record<string, unknown> = {
        id,
        [USERNAME_FIELD]: username,
        [PASSWORD_FIELD]: passwordHash,
        [ROLE_FIELD]: role,
        [DEFAULT_SUBJECT_FIELD]: claims.provider + ":" + claims.subject,
        [subjectFieldName]: claims.subject,
      };
      if (EMAIL_FIELD) values[EMAIL_FIELD] = emailValue;
      if (DISPLAY_NAME_FIELD) values[DISPLAY_NAME_FIELD] = displayName;
      if (PROFILE_FIELD) values[PROFILE_FIELD] = JSON.stringify({ [claims.provider]: profileMetadata({ provider: claims.provider, subject: claims.subject, ...(claims.username ? { username: claims.username } : {}), ...(claims.email ? { email: claims.email } : {}), ...(claims.name ? { name: claims.name } : {}) }) });
      try {
        await db.insert(${auth.userEntity}).values(values as typeof ${auth.userEntity}.$inferInsert);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/unique|duplicate/i.test(message)) { set.status = 409; return { error: "That account already exists. Sign in or bind the provider from your profile." }; }
        console.error("OAuth onboarding failed", error);
        set.status = 500;
        return { error: "Could not create the account" };
      }
      return {
        accessToken: await signAccessToken({ id, role }, authSecret(), ISSUER),
        tokenType: "Bearer" as const,
        expiresIn: TOKEN_TTL_SECONDS,
        user: { id, name: displayName, role },
      };
    })
    .post("/bind", async (context: any) => {
      const { body, request, set } = context;
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const input = (body ?? {}) as { provider?: string; code?: string; codeVerifier?: string; redirectUri?: string; onboardingToken?: string };
      let config: QiyOidcProviderConfig | undefined;
      let identity: QiyProviderIdentity | undefined;
      try {
        if (typeof input.onboardingToken === "string" && input.onboardingToken !== "") {
          const claims = await readOnboardingToken(input.onboardingToken);
          config = providerForRequest(claims.provider);
          identity = { provider: claims.provider, subject: claims.subject, ...(claims.username ? { username: claims.username } : {}), ...(claims.email ? { email: claims.email } : {}), ...(claims.name ? { name: claims.name } : {}) };
        } else {
          config = providerForRequest(input.provider);
          if (!config || typeof input.code !== "string" || input.code === "") { set.status = 400; return { error: "invalid provider link request" }; }
          identity = await resolveProviderIdentity(config, await exchangeAuthorizationCode(config, { code: input.code, ...(input.codeVerifier ? { codeVerifier: input.codeVerifier } : {}), ...(input.redirectUri ? { redirectUri: input.redirectUri } : {}) }));
        }
      } catch (error) { set.status = 401; return { error: error instanceof Error ? error.message : "Could not verify the provider identity" }; }
      if (!config || !identity) { set.status = 400; return { error: "invalid provider link request" }; }
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      const existing = await findUserBySubject(config, identity.subject);
      if (existing && existing.id !== principal.id) { set.status = 409; return { error: "This " + config.label + " identity is already linked to another account" }; }
      const row = await findUserById(principal.id);
      if (!row) { set.status = 401; return { error: "Unknown account" }; }
      const values: Record<string, unknown> = { [subjectFieldName]: identity.subject };
      if (PROFILE_FIELD) { const profiles = readProfiles(row); profiles[config.id] = profileMetadata(identity); values[PROFILE_FIELD] = JSON.stringify(profiles); }
      await db.update(${auth.userEntity}).set(values as Partial<typeof ${auth.userEntity}.$inferInsert>).where(eq(${auth.userEntity}.id, principal.id));
      return { ok: true, provider: config.id, label: config.label, bound: true };
    })
    .post("/unbind", async (context: any) => {
      const { body, request, set } = context;
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      const input = (body ?? {}) as { provider?: string };
      const config = providerForRequest(input.provider);
      if (!config) { set.status = 400; return { error: "Unknown identity provider" }; }
      const row = await findUserById(principal.id);
      if (!row) { set.status = 401; return { error: "Unknown account" }; }
      const record = row as unknown as Record<string, unknown>;
      const subjectFieldName = config.subjectField ?? DEFAULT_SUBJECT_FIELD;
      if (typeof record[subjectFieldName] !== "string" || record[subjectFieldName] === "") { set.status = 400; return { error: config.label + " is not linked to your account" }; }
      const hasPassword = Boolean(record[PASSWORD_FIELD]);
      const otherBindings = providerConfigs().filter((candidate) => candidate.id !== config.id && Boolean(record[candidate.subjectField ?? DEFAULT_SUBJECT_FIELD]));
      if (!hasPassword && otherBindings.length === 0) { set.status = 409; return { error: "Cannot remove the last login method. Set a password or link another provider first." }; }
      const values: Record<string, unknown> = { [subjectFieldName]: null };
      if (PROFILE_FIELD) { const profiles = readProfiles(row); delete profiles[config.id]; values[PROFILE_FIELD] = JSON.stringify(profiles); }
      await db.update(${auth.userEntity}).set(values as Partial<typeof ${auth.userEntity}.$inferInsert>).where(eq(${auth.userEntity}.id, principal.id));
      return { ok: true, provider: config.id, label: config.label, bound: false };
    });
}
`;
}

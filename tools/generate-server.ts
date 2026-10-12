import type { DatabaseIR, EntityIR, FieldIR, FilterMode } from "./database-ir";
import type { QiyProject, DataflowIR } from "./qiy-project";
import { resolveQiyTestValue, type QiyTestSuite, type QiyTestScenario } from "./qiy-test";
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
    case "Integer": return "t.Integer()";
    case "DateTime": return "t.String({ format: \"date-time\" })";
    case "Decimal":
    case "Money": return "t.String({ pattern: \"^-?[0-9]+(\\\\.[0-9]+)?$\" })";
    case "Vector": return `t.Array(t.Number(), { minItems: ${field.dimension}, maxItems: ${field.dimension} })`;
  }
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

function graphqlSchema(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = []): string {
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
  return `${enums ? `${enums}\n\n` : ""}input QiyFilterInput {\n  field: String!\n  operator: String = "eq"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\n${types}${dataflowInputs ? `\n\n${dataflowInputs}` : ""}\n\ntype Query {\n${queries}\n}\n\ntype Mutation {\n${mutations}${dataflowMutations ? `\n${dataflowMutations}` : ""}\n}`;
}

function graphqlResolver(entity: EntityIR): string {
  const name = modelName(entity);
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify(entity.fields.filter((field) => field.filterable !== false).map((field) => field.name));
  const filterModes = JSON.stringify(Object.fromEntries(entity.fields.filter((field) => field.filterable !== false).map((field) => [field.name, filterModesForField(field)])));
  return `  ${entity.name}Distribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (${JSON.stringify(entity.fields.filter((item) => item.enumName).map((item) => item.name))} as string[]).includes(field) ? services.${entity.name}.distribution(field, context.scopeFor("${entity.name}")) : Promise.reject(new Error("Unsupported distribution field")),\n  ${entity.name}Trend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (${JSON.stringify(entity.fields.filter((item) => item.type === "DateTime").map((item) => item.name))} as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.${entity.name}.trend(field, days, context.scopeFor("${entity.name}")) : Promise.reject(new Error("Invalid trend query")),\n` + `  ${entity.name}: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {\n    const sortableFields = ${sortableFields} as string[];\n    const filterableFields = ${filterableFields} as string[];\n    const filterModes = ${filterModes} as Record<string, FilterOperator[]>;\n    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");\n    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");\n    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");\n    const result = await services.${entity.name}.list(args.page ?? 1, args.pageSize ?? 20, {\n      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",\n      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("${entity.name}"),\n    });\n    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };\n  },\n  ${entity.name}ById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.one(id, context.scopeFor("${entity.name}")),\n  create${name}: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.create(input, context.actorId, context.scopeFor("${entity.name}")),\n  update${name}: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.update(id, input, context.actorId, context.scopeFor("${entity.name}")),\n  delete${name}: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.delete(id, context.actorId, context.scopeFor("${entity.name}")),\n  delete${name}Many: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.deleteMany(ids, context.actorId, context.scopeFor("${entity.name}")),`;
}

function renderGraphQL(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = []): string {
  const schema = JSON.stringify(graphqlSchema(database, hiddenFields, dataflows, actions));
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const serviceImports = database.entities.map((entity) => `import { create${modelName(entity)}Service } from "./modules/${entity.name}/${entity.name}.service";`).join("\n") + '\nimport { withPaginationLimit } from "./pagination";\n\ntype FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";';
  const services = database.entities.map((entity) => `  ${entity.name}: withPaginationLimit(create${modelName(entity)}Service(repositories.${entity.name})),`).join("\n");
  const resolvers = database.entities.map(graphqlResolver).join("\n");
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
  const commandParameter = dataflows.length ? ", commandRoutes: ReturnType<typeof createDataflowRoutes>" : "";
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
import { buildSchema, graphql, parse, getOperationAST, Kind, GraphQLError } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator } from "./auth/guard";
${commandImport}${serviceImports}

export const graphqlTypeDefs = ${schema};
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = ${scopeDefinitions} as Array<{ resource: string; field: string; claim: string }>;

${commandHelpers}export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } };
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
      return graphql({ schema, rootValue: resolvers(services${commandArgument}), contextValue: { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) });
}

function resolvers(services: {
${database.entities.map((entity) => `  ${entity.name}: ReturnType<typeof create${modelName(entity)}Service>;`).join("\n")}
}${commandParameter}) {
  return {
${resolvers}${commandResolvers ? `\n${commandResolvers}` : ""}
  };
}

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

function renderGraphQLTest(database: DatabaseIR): string {
  const entity = database.entities[0]!;
  const scopes = (database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? [];
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, "00000000-0000-4000-8000-000000000002"])));
  const name = modelName(entity);
  const values = entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => {
    const example = field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
        : field.enumName ? JSON.stringify(database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? "") : '"Example"';
    return `${JSON.stringify(field.name)}: ${example}`;
  }).join(", ");
  const fields = entity.fields.slice(0, 3).map((field) => field.name).join(" ");
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
    const value = field.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : field.type === "Integer" ? 1 : field.type === "Decimal" || field.type === "Money" ? "1.00" : field.enumName ? database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name : "Example";
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
  return `${entity.name}: (() => {
    const records: Array<Record<string, unknown>> = [${previewRecord(entity, database, scope)}];
    const visible = (record: Record<string, unknown>, scope?: { field: string; value: string }) => !scope || record[scope.field] === scope.value;
    return {
      async distribution(field: string, scope?: { field: string; value: string }) { const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },
      async trend(field: string, days: number, scope?: { field: string; value: string }) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.filter((item) => visible(item, scope))) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },
      async list(page: number, pageSize: number, options?: { scope?: { field: string; value: string } }) { const rows = records.filter((record) => visible(record, options?.scope)); return { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length }; },
      async one(id: string, scope?: { field: string; value: string }) { return records.find((record) => record.id === id && visible(record, scope)); },
      async create(values: Record<string, unknown>, _actor?: string, scope?: { field: string; value: string }) {
        const record = { id: crypto.randomUUID(), ...values, ...(scope ? { [scope.field]: scope.value } : {}) };
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

function renderRoutes(entity: EntityIR, database: DatabaseIR, scopes: Array<{ resource: string; field: string; claim: string }> = [], hiddenFields: string[] = []): string {
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
  return `
const create${name} = t.Object({
${createFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

const patch${name} = t.Object({
${patchFields(entity, database)}
}, { additionalProperties: false${entity.comment !== undefined ? `, description: ${JSON.stringify(entity.comment)}` : ""} });

export interface ${name}Repository {
  distribution(field: string, scope?: { field: string; value: string }): Promise<Array<{ value: string | null; count: number }>>;
  trend(field: string, days: number, scope?: { field: string; value: string }): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  create(values: typeof create${name}.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown>>;
  update(id: string, values: typeof patch${name}.static, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }): Promise<Array<Record<string, unknown>>>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterClause[];
  scope?: { field: string; value: string };
}

export function ${name}Routes(repository: ${name}Repository, authenticate: Authenticator = async () => null) {
  ${sanitize}
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
  };
  return new Elysia({ prefix: ${route} })${privateInputGuard}\n    .onError(({ error, status }) => error instanceof Error && error.message.startsWith("Missing required data scope claim:") ? status(403, { error: error.message }) : undefined)\n    .get("/distribution", async ({ query, status, request }) => (${JSON.stringify(entity.fields.filter((field) => field.enumName).map((field) => field.name))} as string[]).includes(query.field) ? repository.distribution(query.field, await resolveScope(request)) : status(400, { error: "Unsupported distribution field" }), { query: t.Object({ field: t.String() }) })
    .get("/trend", async ({ query, status, request }) => (${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[]).includes(query.field) ? repository.trend(query.field, query.days, await resolveScope(request)) : status(400, { error: "Unsupported trend field" }), { query: t.Object({ field: t.String(), days: t.Numeric({ minimum: 1, maximum: 365 }) }) })
    .get("/", async ({ query, status, request }) => {
      let filters: Record<string, string> | FilterClause[] | undefined;
      if (query.filters) {
        try {
          const parsed: unknown = JSON.parse(query.filters);
          const oldShape = parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.values(parsed).every((value) => typeof value === "string");
          const newShape = Array.isArray(parsed) && parsed.every((filter) => filter && typeof filter === "object" && typeof filter.field === "string" && typeof filter.operator === "string" && typeof filter.value === "string");
          if (!oldShape && !newShape) return status(400, { error: "Invalid filters" });
          filters = parsed as Record<string, string> | FilterClause[];
        }
        catch { return status(400, { error: "Invalid filters" }); }
      }
      if (query.sort && !sortableFields.includes(query.sort)) return status(400, { error: "Unsupported sort field" });
      const filterClauses = Array.isArray(filters) ? filters : Object.entries(filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
      if (filterClauses.some((filter) => !filterableFields.includes(filter.field))) return status(400, { error: "Unsupported filter field" });
      if (filterClauses.some((filter) => !filterModes[filter.field]?.includes(filter.operator))) return status(400, { error: "Unsupported filter operator" });
      const scope = await resolveScope(request);
      const result = await repository.list(query.page ?? 1, query.pageSize ?? 20, { ...query, filters, scope });
      return { ...result, data: result.data.map((record) => redact(record)) };
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
    .get("/:id", async ({ params, status, request }) => {
      const record = await repository.one(params.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
    .post("/", async ({ body, status, request }) => status(201, redact(await repository.create(body, (await authenticate(request))?.id, await resolveScope(request)))), { body: create${name} })
    .patch("/:id", async ({ params, body, status, request }) => {
      if (Object.keys(body).length === 0) return status(400, { error: "Empty update" });
      const principal = await authenticate(request);
      const record = await repository.update(params.id, body, principal?.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }), body: patch${name} })
    .delete("/", async ({ query, request }) => (await repository.deleteMany(query.ids.split(","), (await authenticate(request))?.id, await resolveScope(request))).map((record) => redact(record)), {
      query: t.Object({ ids: t.String({ minLength: 1 }) }),
    })
    .delete("/:id", async ({ params, status, request }) => {
      const record = await repository.delete(params.id, (await authenticate(request))?.id, await resolveScope(request));
      return record ? redact(record) : status(404, { error: "Not found" });
    }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
}

export const ${entity.name}WritableFields = [${allowed}] as const;
`;
}

function renderRepositoryMethods(entity: EntityIR, database: DatabaseIR, realtimeEvents: ReadonlySet<string> = new Set()): string {
  const searchOperator = database.dialect === "postgresql" ? "ilike" : "like";
  const searchableFields = entity.fields.filter((field) => field.type === "Text").map((field) => `${entity.name}.${field.name}`).join(", ");
  const sortFields = entity.fields.filter((field) => field.sortable !== false).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterableEntityFields = entity.fields.filter((field) => field.filterable !== false);
  const filterFields = filterableEntityFields.map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const filterTypes = JSON.stringify(Object.fromEntries(filterableEntityFields.map((field) => [field.name, field.type])));
  const configuredScopes = (database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? [];
  const scopeFields = entity.fields.filter((field) => configuredScopes.some((scope) => (scope.resource === entity.name || scope.resource === entity.tableName) && scope.field === field.name));
  const scopeColumnFields = [...new Set([...filterableEntityFields, ...scopeFields])].map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const groupFields = entity.fields.filter((field) => field.enumName).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const dateFields = entity.fields.filter((field) => field.type === "DateTime").map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ");
  const scopeColumns = scopeColumnFields || "";
  const realtimeWrite = (type: "created" | "updated" | "deleted", payload: string) => realtimeEvents.has(type)
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values({ id: crypto.randomUUID(), channel: ${JSON.stringify(`qiy:${entity.tableName}`)}, type: ${JSON.stringify(type)}, payload: JSON.stringify(${payload}), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() })${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const realtimeDeleteManyWrite = realtimeEvents.has("deleted")
    ? `${database.dialect === "sqlite" ? "" : "await "}tx.insert(realtimeOutbox).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), channel: ${JSON.stringify(`qiy:${entity.tableName}`)}, type: "deleted", payload: JSON.stringify(record), attempts: 0, availableAt: new Date(), deliveredAt: null, lastError: null, createdAt: new Date() })))${database.dialect === "sqlite" ? ".run()" : ""};`
    : "";
  const auditedMutationMethods = database.dialect === "sqlite" ? `  async create(values, actorId, scope) {
    return db.transaction((tx) => {
      const record = tx.insert(${entity.name}).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.update(${entity.name}).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(${entity.name}.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition)).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
` : database.dialect === "mysql" ? `  async create(values, actorId, scope) {
    return db.transaction(async (tx) => {
      const id = crypto.randomUUID();
      await tx.insert(${entity.name}).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id } as typeof ${entity.name}.$inferInsert);
      const [record] = await tx.select().from(${entity.name}).where(eq(${entity.name}.id, id)).limit(1);
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [existing] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).limit(1).for("update");
      if (!existing) return undefined;
      await tx.update(${entity.name}).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(${entity.name}.id, id), scopeCondition));
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).limit(1);
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) }, createdAt: Date.now() });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.select().from(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).limit(1).for("update");
      if (!record) return undefined;
      await tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition));
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {}, createdAt: Date.now() });
       ${realtimeWrite("deleted", "record")}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = await tx.select().from(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition)).for("update");
      if (deletedRows.length) {
        await tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, deletedRows.map((record) => record.id)), scopeCondition));
        await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {}, createdAt: Date.now() })));
         ${realtimeDeleteManyWrite}
      }
      return deletedRows;
    });
  },
` : `  async create(values, actorId, scope) {
    return db.transaction(async (tx) => {
      const [record] = await tx.insert(${entity.name}).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: { fields: Object.keys(values) } });
       ${realtimeWrite("created", "record")}
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.update(${entity.name}).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(${entity.name}.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) } });
       if (record) ${realtimeWrite("updated", "record") || "void 0;"}
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {} });
       if (record) ${realtimeWrite("deleted", "record") || "void 0;"}
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = await tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition)).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {} })));
       if (deletedRows.length) ${realtimeDeleteManyWrite || "void 0;"}
      return deletedRows;
    });
  },
`;
  return `  async distribution(field, scope) {
    const columns: Record<string, any> = { ${groupFields} };
    const column = columns[field];
    if (!column) throw new Error("Unsupported distribution field");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    return db.select({ value: column, count: count() }).from(${entity.name}).where(scopeCondition).groupBy(column);
  },
  async trend(field, days, scope) {
    const columns: Record<string, any> = { ${dateFields} };
    const column = columns[field];
    if (!column || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("Invalid trend query");
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(today - (days - 1) * 86400000);
    const end = new Date(today + 86400000);
    const day = ${database.dialect === "postgresql" ? "sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`" : database.dialect === "sqlite" ? "sql<string>`strftime('%Y-%m-%d', ${column} / 1000, 'unixepoch')`" : "sql<string>`date_format(${column}, '%Y-%m-%d')`"};
    return db.select({ day, count: count() }).from(${entity.name}).where(and(gte(column, start), lt(column, end), scopeCondition)).groupBy(day).orderBy(day);
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
    if (filters.some(({ field }) => !filterColumns[field])) throw new Error("Unsupported filter field");
    const coerce = (field: string, value: string) => filterTypes[field] === "Integer" ? Number(value) : filterTypes[field] === "DateTime" ? new Date(value) : value;
    const filterConditions = filters.map(({ field, operator, value }) => {
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
    });
    const scopeColumns: Record<string, any> = { ${scopeColumns} };
    const scopeCondition = options.scope && scopeColumns[options.scope.field] ? eq(scopeColumns[options.scope.field], options.scope.value) : undefined;
    const whereCondition = and(searchCondition, scopeCondition, ...filterConditions);
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
  async one(id, scope) {
    const scopeColumns: Record<string, any> = { ${filterFields} };
    const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
    const [record] = await db.select().from(
${entity.name}
).where(and(eq(
${entity.name}
.id, id), scopeCondition)).limit(1);
    return record;
  },
${auditedMutationMethods}
`;
}

function renderRouteTest(entity: EntityIR, database: DatabaseIR, scopes: NonNullable<QiyProject["scopes"]> = [], hiddenFields: string[] = []): string {
  const name = modelName(entity);
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"])));
  const values = entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => {
    const example = field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
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
    const clauses = Array.isArray(options.filters) ? options.filters : Object.entries(options.filters ?? {}).map(([field, value]) => ({ field, operator: "eq" as const, value }));
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
${hiddenFieldTests}
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
  return `\n\nexport const dataflowOutbox = ${table}("dataflow_outbox", {\n  id: ${dialect === "mysql" ? 'varchar("id", { length: 36 })' : 'text("id")'}.primaryKey(),\n  actorId: ${dialect === "mysql" ? 'varchar("actorId", { length: 128 })' : 'text("actorId")'},\n  event: ${dialect === "mysql" ? 'varchar("event", { length: 190 })' : 'text("event")'}.notNull(),\n  payload: text("payload").notNull(),\n  createdAt: ${dialect === "postgresql" ? 'timestamp("createdAt", { withTimezone: true })' : dialect === "sqlite" ? 'integer("createdAt", { mode: "timestamp" })' : 'datetime("createdAt")'}.notNull(),\n});\n`;
}

function renderRealtimeOutboxSchema(dialect: DatabaseIR["dialect"]): string {
  const table = dialect === "postgresql" ? "pgTable" : dialect === "sqlite" ? "sqliteTable" : "mysqlTable";
  const string = dialect === "mysql" ? (name: string, length: number) => `varchar(${JSON.stringify(name)}, { length: ${length} })` : (name: string) => `text(${JSON.stringify(name)})`;
  const integer = dialect === "mysql" ? "int" : "integer";
  const date = (name: string) => dialect === "postgresql" ? `timestamp(${JSON.stringify(name)}, { withTimezone: true })` : dialect === "sqlite" ? `integer(${JSON.stringify(name)}, { mode: "timestamp_ms" })` : `datetime(${JSON.stringify(name)}, { mode: "date" })`;
  return `\n\nexport const realtimeOutbox = ${table}("qiy_realtime_outbox", {\n  id: ${string("id", 36)}.primaryKey(),\n  channel: ${string("channel", 190)}.notNull(),\n  type: ${string("type", 80)}.notNull(),\n  payload: text("payload").notNull(),\n  attempts: ${integer}("attempts").notNull(),\n  availableAt: ${date("availableAt")}.notNull(),\n  deliveredAt: ${date("deliveredAt")},\n  deadLetteredAt: ${date("deadLetteredAt")},\n  lastError: text("lastError"),\n  leaseOwner: ${string("leaseOwner", 80)},\n  leaseUntil: ${date("leaseUntil")},\n  createdAt: ${date("createdAt")}.notNull(),\n}, (table) => [index("qiy_realtime_outbox_pending_idx").on(table.deliveredAt, table.deadLetteredAt, table.availableAt, table.leaseUntil, table.createdAt)]);\n`;
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
import type { Authenticator, Principal } from "./auth/guard";

export type QiyRealtimeEvent = "created" | "updated" | "deleted";
export const qiyRealtimeSubscriptions = ${subscriptions} as const;
export const qiyRealtimeEventSubscriptions = ${eventSubscriptions} as const;

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

export function realtimeCapabilities(principal: Principal): Record<string, string[]> {
  return Object.fromEntries([
    ...qiyRealtimeSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      .map((subscription): [string, string[]] => ["qiy:" + subscription.resource, ["subscribe"]]),
    ...qiyRealtimeEventSubscriptions
      .filter((subscription) => (subscription.roles as readonly string[]).includes(principal.role))
      .map((subscription): [string, string[]] => ["qiy:event:" + subscription.event, ["subscribe"]]),
  ]);
}

export async function publishRealtime(resource: string, type: QiyRealtimeEvent, payload: Record<string, unknown>, clientFactory: AblyClientFactory = createAblyClient): Promise<void> {
  if (Bun.env.QIY_REALTIME_DISABLED === "1") return;
  const subscription = qiyRealtimeSubscriptions.find((candidate) => candidate.resource === resource);
  if (!subscription || !(subscription.events as readonly string[]).includes(type)) return;
  await clientFactory().channels.get("qiy:" + resource).publish(type, payload);
}

const databaseOutboxStore: RealtimeOutboxStore = {
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

function renderDataflowRoutes(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, scopes: NonNullable<QiyProject["scopes"]> = [], qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false): string | undefined {
  if (!dataflows.length) return undefined;
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
    const singleRoute = `${generatedDocumentation(flow, "    ")}    .post(${JSON.stringify(`/${flow.name}`)}, async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!${JSON.stringify(flow.roles ?? ["admin", "operator"])}.includes(principal.role)) return status(403, { error: "Command execution is restricted" });
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
    const batchRoute = `
    .post(${JSON.stringify(`/${flow.name}/batch`)}, async ({ body: batch, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!${JSON.stringify(flow.roles ?? ["admin", "operator"])}.includes(principal.role)) return status(403, { error: "Command execution is restricted" });
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
${contextLoads}

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
  if (field.type === "Integer") return "1";
  if (field.type === "Decimal" || field.type === "Money") return "1";
  if (field.type === "DateTime") return "new Date(0)";
  return "null";
}

function renderSqliteDataflowTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, qiyActions: NonNullable<QiyProject["actions"]> = [], realtimeEnabled = false): string | undefined {
  if (database.dialect !== "sqlite" || !dataflows.length) return undefined;
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
    const deniedRoles = ["viewer", ...["admin", "operator"].filter((role) => !(flow.roles ?? ["admin", "operator"]).includes(role as "admin" | "operator"))];
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
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: ${JSON.stringify(flow.roles?.[0] ?? "admin")} })));
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
const app = new Elysia().use(createDataflowRoutes(async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: testRoles[new URL(request.url).pathname.split("/").at(-1)!] ?? "admin" })));
const graphqlApp = await createApp({} as Repositories, async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "GraphQL Dataflow Test", role: (request.headers.get("x-test-role") ?? "admin") as "admin" | "operator" }), false, false, undefined, true);

describe("generated dataflow routes", () => {
${tests}
});
`;
}

function sqliteTestIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function scenarioPrincipal(scenario: QiyTestScenario, flow: DataflowIR): string {
  if (scenario.identity?.kind === "anonymous") return "null";
  const identity = scenario.identity;
  const principal = identity ? {
    id: resolveQiyTestValue(scenario, identity.id), name: "Qiy Scenario", role: identity.role,
    claims: Object.fromEntries(Object.entries(identity.claims).map(([claim, value]) => [claim, resolveQiyTestValue(scenario, value)])),
  } : { id: "00000000-0000-4000-8000-000000000010", name: "Qiy Scenario", role: flow.roles?.[0] ?? "admin" };
  return JSON.stringify(principal);
}

function renderQiyScenarioTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, suite?: QiyTestSuite): string | undefined {
  if (!suite) return undefined;
  if (database.dialect === "postgresql" || database.dialect === "mysql") return renderServerQiyScenarioTest(database, dataflows, suite);
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
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow)})));
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

function renderServerQiyScenarioTest(database: DatabaseIR, dataflows: DataflowIR[], suite: QiyTestSuite): string {
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
    const app = new Elysia().use(createDataflowRoutes(async () => (${scenarioPrincipal(scenario, flow)})));
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

export function generateServer(database: DatabaseIR, options: Pick<QiyProject, "storageProvider" | "auth" | "scopes" | "corsOrigins" | "elysiaPlugins" | "workflows" | "dataflows" | "actions" | "realtime"> & { testSuite?: QiyTestSuite } = {}): Record<string, string> {
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
  const realtimeResources = new Set<string>();
  for (const subscription of options.realtime?.resources ?? []) {
    const entity = database.entities.find((candidate) => candidate.name === subscription.resource || candidate.tableName === subscription.resource);
    if (!entity) errors.push(`Realtime: unknown resource ${subscription.resource}`);
    else if (realtimeResources.has(entity.tableName)) errors.push(`Realtime: duplicate resource ${entity.tableName}`);
    else realtimeResources.add(entity.tableName);
    if (!subscription.events.length || new Set(subscription.events).size !== subscription.events.length) errors.push(`Realtime ${subscription.resource}: events must be unique and non-empty`);
    if (!subscription.roles.length || new Set(subscription.roles).size !== subscription.roles.length) errors.push(`Realtime ${subscription.resource}: roles must be unique and non-empty`);
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
  }
  if (auth) {
    const user = database.entities.find((entity) => entity.name === auth.userEntity);
    const subject = user?.fields.find((field) => field.name === auth.subjectField);
    const role = user?.fields.find((field) => field.name === auth.roleField);
    if (!user) errors.push(`Auth: unknown user entity ${auth.userEntity}`);
    if (auth.provider === "local" || auth.provider === "otp") {
      const username = user?.fields.find((field) => field.name === auth.usernameField);
      if (!username || username.type !== "Text" || username.nullable || !username.unique) errors.push("Auth: usernameField must be a required unique Text field");
      if (auth.provider === "local") {
        const password = user?.fields.find((field) => field.name === auth.passwordField);
        if (!password || !["Text"].includes(password.type) || !password.nullable) errors.push("Auth: passwordField must be a nullable Text field storing the password hash");
        if (username && password && username.name === password.name) errors.push("Auth: usernameField and passwordField must be different fields");
      }
    } else if (!subject || subject.type !== "Text" || subject.nullable || !subject.unique) {
      errors.push("Auth: subjectField must be a required unique Text field");
    }
    const roleValues = database.enums?.find((item) => item.name === role?.enumName)?.values.map((item) => item.name);
    if (!role || !roleValues || !["admin", "operator", "viewer"].every((value) => roleValues.includes(value)) || roleValues.some((value) => !["admin", "operator", "viewer"].includes(value))) errors.push("Auth: roleField must be an enum with admin, operator and viewer values");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  const scopedDatabase = { ...database, scopes: (options.scopes ?? []).map((scope) => ({ ...scope, resource: database.entities.find((entity) => entity.name === scope.resource || entity.tableName === scope.resource)!.name })) };
  const testClaims = JSON.stringify(Object.fromEntries((options.scopes ?? []).map((scope) => [scope.claim, database.entities.find((item) => item.name === scope.resource || item.tableName === scope.resource)?.fields.find((field) => field.name === scope.field)?.type === "UUID" ? "00000000-0000-4000-8000-000000000002" : "Example"])));

  const imports = database.entities.map((entity) => `import { ${modelName(entity)}Routes } from "./modules/${entity.name}/${entity.name}.routes";`).join("\n");
  const repositoryImports = database.entities.map((entity) => `import { ${modelName(entity)}Repository } from "./modules/${entity.name}/${entity.name}.repository";`).join("\n");
  const apps = database.entities.map((entity) => `    .use(${modelName(entity)}Routes(repositories.${entity.name}, authenticate))`).join("\n");
  const interfaces = database.entities.map((entity) => `  ${entity.name}: import("./modules/${entity.name}/${entity.name}.contract").${modelName(entity)}Repository;`).join("\n");
  const orderWorkflow = renderOrderWorkflow(database, options.scopes ?? [], options.workflows?.includes("orderInventory"));
  const dataflowRoutes = renderDataflowRoutes(database, options.dataflows ?? [], options.scopes ?? [], options.actions ?? [], options.realtime !== undefined);
  const protectedResources = JSON.stringify([
    ...database.entities.map((entity) => ({ path: entity.tableName, query: entity.name })),
    { path: "files", query: "files" },
    ...(dataflowRoutes ? [{ path: "commands", query: "commands", mutations: (options.dataflows ?? []).flatMap((flow) => {
      const operation = `run${dataflowGraphqlName(flow.name)}`;
      return (options.actions ?? []).some((action) => action.batch && action.target.kind === "dataflow" && action.target.dataflow === flow.name) ? [operation, `${operation}Batch`] : [operation];
    }) }] : []),
  ]);
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
    "api/src/db.ts": database.dialect === "postgresql" ? `import { SQL } from "bun";\nimport { drizzle } from "drizzle-orm/bun-sql";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = new SQL(url);\nexport const db = drizzle({ client, schema });\n` : database.dialect === "sqlite" ? `import { Database } from "bun:sqlite";\nimport { drizzle } from "drizzle-orm/bun-sqlite";\nimport * as schema from "./schema";\n\nconst filename = Bun.env.DATABASE_URL ?? "./qiy.sqlite";\nexport const client = new Database(filename);\nexport const db = drizzle(client, { schema });\n` : `import mysql from "mysql2/promise";\nimport { drizzle } from "drizzle-orm/mysql2";\nimport * as schema from "./schema";\n\nconst url = Bun.env.DATABASE_URL;\nif (!url) throw new Error("DATABASE_URL is required");\nexport const client = mysql.createPool({ uri: url, timezone: "Z" });\nexport const db = drizzle({ client, schema, mode: "default" });\n`,
    ...(database.dialect === "sqlite" ? {
      "api/src/migrate.ts": `import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { resolve } from "node:path";
import * as schema from "./schema";

const client = new Database(Bun.env.DATABASE_URL ?? "./qiy.sqlite");
try {
  migrate(drizzle(client, { schema }), { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
} finally {
  client.close();
}
`,
    } : {}),
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
   const guard = createAuthorizationGuard(authenticate, ${protectedResources});
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => authenticate(request))
 ${apps};
 ${orderWorkflow ? '   const workflow = includeWorkflows ? (await import("./workflows/order")).createOrderWorkflowRoutes(authenticate) : undefined;' : ''}
 ${dataflowRoutes ? '   const dataflows = includeDataflows ? (await import("./dataflows")).createDataflowRoutes(authenticate) : undefined;' : ''}
    ${options.realtime ? "const realtime = createRealtimeRoutes(authenticate);" : ""}
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
    ${auth?.provider === "local" ? 'const authRoutes = (await import("./auth/local")).createLocalAuthRoutes();' : auth?.provider === "otp" ? 'const authRoutes = (await import("./auth/otp")).createOtpAuthRoutes();' : ''}
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes)${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? '' : '.use(createGraphQLRoutes(repositories, authenticate))'};
    let composed = application;
    ${auth?.provider === "local" || auth?.provider === "otp" ? "composed = composed.use(authRoutes);" : ""}
    ${orderWorkflow ? "composed = workflow ? composed.use(workflow) : composed;" : ""}
    ${dataflowRoutes ? "composed = dataflows ? composed.use(dataflows) : composed;" : ""}
    ${options.realtime ? "composed = composed.use(realtime);" : ""}
    composed = storage ? composed.use(storage) : composed;
    ${auth ? 'composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticate));' : ""}
    return registerPlugins(composed, { repositories, authenticate });
}
`,
    "api/src/modules/index.ts": database.entities.map((entity) => `export { ${modelName(entity)}Routes } from "./${entity.name}/${entity.name}.routes";`).join("\n") + "\n",
    "api/src/graphql.ts": renderGraphQL(scopedDatabase, options.auth?.provider === "local" ? { [options.auth.userEntity]: [options.auth.passwordField!] } : {}, options.dataflows ?? [], options.actions ?? []),
    "api/src/graphql-adapter.ts": renderGraphQLAdapter(scopedDatabase, options.dataflows ?? [], options.actions ?? []),
    ...(options.realtime ? {
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
${auth ? `import { createProductionAuthenticator } from ${auth.provider === "local" ? '"./auth/local"' : auth.provider === "otp" ? '"./auth/otp"' : '"./auth/oidc"'};` : ''}
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
  const dataflowTest = renderSqliteDataflowTest(database, options.dataflows ?? [], options.actions ?? [], options.realtime !== undefined);
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
    files["api/tests/fixtures/dataflow-failure.ts"] = renderDataflowRoutes(database, failureFlows, options.scopes ?? [], [], options.realtime !== undefined)!
      .replaceAll('"../db"', '"../../src/db"').replaceAll('"../schema"', '"../../src/schema"').replaceAll('"../auth/guard"', '"../../src/auth/guard"').replaceAll('"./calls"', '"../../src/dataflows/calls"');
  }
  const scenarioTest = renderQiyScenarioTest(database, options.dataflows ?? [], options.testSuite);
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
  files["api/src/storage/routes.ts"] = files["api/src/storage/routes.ts"]!.replace("__QIY_UPLOAD_POLICIES__", JSON.stringify(Object.fromEntries(database.entities.flatMap((entity) => entity.fields.filter((field) => field.type === "File").map((field) => [`${entity.tableName}.${field.name}`, { mode: field.uploadMode ?? "binary", maxBytes: field.maxBytes ?? 25 * 1024 * 1024, mimeTypes: field.mimeTypes ?? ["*/*"], maxFiles: 1 }]))), null, 2));
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
  if (auth) {
    if (auth.provider !== "local" && auth.provider !== "otp") files["api/src/auth/oidc.ts"] = `import { createRemoteJWKSet } from "jose";
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
  return createOidcAuthenticator({ issuer, audience, keySet: createRemoteJWKSet(new URL(jwksUrl)), roleField: ${JSON.stringify(auth.roleField)},
    async findUser(externalSubject) {
      const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.${auth.subjectField}, externalSubject)).limit(2);
      return rows.length === 1 ? rows[0]! : null;
    },
  });
}
`;
    if (auth.provider === "local") {
      const usernameField = auth.usernameField!;
      const passwordField = auth.passwordField!;
      const userEntity = database.entities.find((entity) => entity.name === auth.userEntity)!;
      const bootstrapFields = userEntity.fields.filter((field) => !field.primaryKey && !field.nullable && ![usernameField, passwordField, auth.roleField].includes(field.name));
      const bootstrapHasDisplayName = bootstrapFields.some((field) => field.name === "displayName");
      const bootstrapValues = bootstrapFields.map((field) => {
        const value = field.name === "displayName" ? "displayName"
          : field.type === "Integer" ? `Number(await terminal.question(${JSON.stringify(field.name + ": ")}))`
            : field.type === "DateTime" ? `new Date(await terminal.question(${JSON.stringify(field.name + " (ISO date-time): ")}))`
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
  return { id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.${auth.roleField} };
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
      return { accessToken: token, tokenType: "Bearer", expiresIn: 43200, id: row.id, name: String(row.displayName ?? row.email ?? row.id), role: row.${auth.roleField} };
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
  const values = { ${JSON.stringify(usernameField)}: username, ${JSON.stringify(auth.roleField)}: "admin", ${JSON.stringify(passwordField)}: await hashPassword(password), ${bootstrapValues} };
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
async function findPrincipal(id: string): Promise<Principal | null> { const rows = await db.select().from(${auth.userEntity}).where(eq(${auth.userEntity}.id, id)).limit(1); const row = rows[0]; if (!row || typeof row.id !== "string" || !roles.has(String(row.${auth.roleField}))) return null; return { id: row.id, name: String(row.displayName ?? row.${usernameField} ?? row.id), role: row.${auth.roleField} as Principal["role"] }; }
async function deliver(identifier: string, code: string): Promise<void> { const endpoint = Bun.env.QIY_OTP_DELIVERY_URL; if (!endpoint) { if (Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE) return; throw new Error("QIY_OTP_DELIVERY_URL is required outside explicit development OTP mode"); } if (new URL(endpoint).protocol !== "https:") throw new Error("QIY_OTP_DELIVERY_URL must use HTTPS"); const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...(Bun.env.QIY_OTP_DELIVERY_TOKEN ? { Authorization: "Bearer " + Bun.env.QIY_OTP_DELIVERY_TOKEN } : {}) }, body: JSON.stringify({ recipient: identifier, code, expiresIn: 300 }) }); if (!response.ok) throw new Error("OTP delivery adapter rejected the request"); }
async function signAccessToken(user: { id: string; role: string }, key: string): Promise<string> { return new SignJWT({ role: user.role, typ: "qiy-otp" }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(key)); }

export function createProductionAuthenticator(): Authenticator { const key = secret(); return async (request) => { const match = /^Bearer ([^\\s]+)$/.exec(request.headers.get("authorization") ?? ""); if (!match) return null; try { const { payload } = await jwtVerify(match[1]!, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp" || typeof payload.sub !== "string" || !roles.has(String(payload.role))) return null; return await findPrincipal(payload.sub); } catch { return null; } }; }

export function createOtpAuthRoutes(lookup = findUser, send = deliver, resolvePrincipal = findPrincipal) { return new Elysia({ prefix: "/api/v1/auth/otp" })
  .post("/request", async ({ body, status }) => { const identifier = body.identifier.trim(); if (!identifier) return status(400, { error: "Login identifier is required" }); const key = secret(); const row = await lookup(identifier); const role = row && roles.has(String(row.${auth.roleField})) ? String(row.${auth.roleField}) : "viewer"; const code = Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? Bun.env.QIY_OTP_DEV_CODE : randomCode(); const valid = Boolean(row && typeof row.id === "string" && roles.has(role)); if (valid) await send(identifier, code); const challengeToken = await new SignJWT({ typ: "qiy-otp-challenge", identifier, otpHash: otpHash(identifier, code, key), role, valid }).setProtectedHeader({ alg: "HS256" }).setSubject(valid ? row!.id : "unknown").setIssuer(ISSUER).setAudience(ISSUER).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(key)); return { challengeToken, expiresIn: 300, ...(Bun.env.QIY_DEV_MODE === "1" && Bun.env.QIY_OTP_DEV_CODE ? { devCode: code } : {}) }; }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }) }) })
  .post("/verify", async ({ body, status }) => { const key = secret(); try { const { payload } = await jwtVerify(body.challengeToken, new TextEncoder().encode(key), { issuer: ISSUER, audience: ISSUER, algorithms: ["HS256"] }); if (payload.typ !== "qiy-otp-challenge" || payload.valid !== true || payload.identifier !== body.identifier || typeof payload.otpHash !== "string" || typeof payload.sub !== "string" || !roles.has(String(payload.role)) || !matchesHash(payload.otpHash, otpHash(body.identifier, body.code, key))) return status(401, { error: "Invalid or expired one-time password" }); const principal = await resolvePrincipal(payload.sub); if (!principal) return status(401, { error: "Invalid or expired one-time password" }); return { accessToken: await signAccessToken({ id: principal.id, role: principal.role }, key), tokenType: "Bearer", expiresIn: 43200, ...principal }; } catch { return status(401, { error: "Invalid or expired one-time password" }); } }, { body: t.Object({ identifier: t.String({ minLength: 1, maxLength: 190 }), challengeToken: t.String({ minLength: 1, maxLength: 4096 }), code: t.String({ minLength: 4, maxLength: 12 }) }) }); }
`;
      files["api/tests/otp-auth.test.ts"] = `import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createOtpAuthRoutes } from "../src/auth/otp";

test("issues and verifies a short-lived OTP challenge without exposing a production code", async () => { Bun.env.QIY_AUTH_SECRET = "qiy-otp-test-secret-value-at-least-32"; Bun.env.QIY_DEV_MODE = "1"; Bun.env.QIY_OTP_DEV_CODE = "246810"; const sent: Array<{ identifier: string; code: string }> = []; const user = { id: "user-1", ${JSON.stringify(usernameField)}: "admin@example.com", ${JSON.stringify(auth.roleField)}: "admin" } as any; const principal = { id: "user-1", name: "Admin", role: "admin" } as const; const app = new Elysia().use(createOtpAuthRoutes(async (identifier) => identifier === "admin@example.com" ? user : null, async (identifier, code) => { sent.push({ identifier, code }); }, async (id) => id === "user-1" ? principal : null)); const request = await app.handle(new Request("http://localhost/api/v1/auth/otp/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com" }) })); expect(request.status).toBe(200); const challenge = await request.json() as { challengeToken: string; devCode?: string }; expect(challenge.devCode).toBe("246810"); expect(sent).toEqual([{ identifier: "admin@example.com", code: "246810" }]); const verify = (code: string) => app.handle(new Request("http://localhost/api/v1/auth/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: "admin@example.com", challengeToken: challenge.challengeToken, code }) })); expect((await verify("wrong")).status).toBe(401); const success = await verify("246810"); expect(success.status).toBe(200); expect((await success.json() as { accessToken: string }).accessToken.length).toBeGreaterThan(40); });
`;
    }
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
    const hiddenFields = options.auth?.provider === "local" && entity.name === options.auth.userEntity ? [options.auth.passwordField!] : [];
    const publicEntity = hiddenFields.length ? { ...entity, fields: entity.fields.filter((field) => !hiddenFields.includes(field.name)) } : entity;
    files[`${moduleRoot}/${entity.name}.repository.ts`] = `import { and, asc, count, desc, eq, gt, gte, lt, lte, sql, ${database.dialect === "postgresql" ? "ilike" : "like"}, inArray, or } from "drizzle-orm";
import { db } from "../../db";
 import { ${entity.name}, auditEvents${realtimeSubscription ? ", realtimeOutbox" : ""} } from "../../schema";
import type { ${modelName(entity)}Repository as ${modelName(entity)}RepositoryContract } from "./${entity.name}.contract";

export const ${modelName(entity)}Repository: ${modelName(entity)}RepositoryContract = {
${renderRepositoryMethods(publicEntity, scopedDatabase, realtimeEvents)}
};
`;
    files[`${moduleRoot}/${entity.name}.contract.ts`] = `${generatedDocumentation(entity)}export interface ${modelName(entity)}Repository {
  distribution(field: string, scope?: { field: string; value: string }): Promise<Array<{ value: string | null; count: number }>>;
  trend(field: string, days: number, scope?: { field: string; value: string }): Promise<Array<{ day: string; count: number }>>;
  list(page: number, pageSize: number, options?: ListQuery): Promise<{ data: Array<Record<string, unknown>>; total: number }>;
  one(id: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  create(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown>>;
  update(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  delete(id: string, actorId?: string, scope?: { field: string; value: string }): Promise<Record<string, unknown> | undefined>;
  deleteMany(ids: string[], actorId?: string, scope?: { field: string; value: string }): Promise<Array<Record<string, unknown>>>;
}

export type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
export interface FilterClause { field: string; operator: FilterOperator; value: string; }

export interface ListQuery {
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  filters?: Record<string, string> | FilterClause[];
  scope?: { field: string; value: string };
}
`;
    files[`${moduleRoot}/${entity.name}.service.ts`] = `import type { ${modelName(entity)}Repository, ListQuery } from "./${entity.name}.contract";
 ${realtimeSubscription ? 'import { dispatchRealtimeOutbox } from "../../realtime";' : ""}
const dateFields = ${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
 ${realtimeSubscription ? `async function dispatchCommitted(): Promise<void> {
   try { await dispatchRealtimeOutbox(); }
   catch (error) { console.error("Realtime outbox dispatch failed after committed mutation", { resource: ${JSON.stringify(entity.tableName)}, error }); }
}` : ""}
${generatedDocumentation(entity)}export function create${modelName(entity)}Service(repository: ${modelName(entity)}Repository) {
  return {
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: ${realtimeEvents.has("created") ? `async (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.create(normalizeDates(values), actorId, scope); await dispatchCommitted(); return record; }` : `(values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.create(normalizeDates(values), actorId, scope)`},
    update: ${realtimeEvents.has("updated") ? `async (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.update(id, normalizeDates(values), actorId, scope); if (record) await dispatchCommitted(); return record; }` : `(id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.update(id, normalizeDates(values), actorId, scope)`},
    delete: ${realtimeEvents.has("deleted") ? `async (id: string, actorId?: string, scope?: { field: string; value: string }) => { const record = await repository.delete(id, actorId, scope); if (record) await dispatchCommitted(); return record; }` : `(id: string, actorId?: string, scope?: { field: string; value: string }) => repository.delete(id, actorId, scope)`},
    deleteMany: ${realtimeEvents.has("deleted") ? `async (ids: string[], actorId?: string, scope?: { field: string; value: string }) => { const records = await repository.deleteMany(ids, actorId, scope); if (records.length) await dispatchCommitted(); return records; }` : `(ids: string[], actorId?: string, scope?: { field: string; value: string }) => repository.deleteMany(ids, actorId, scope)`},
  };
}
`;
    files[`${moduleRoot}/${entity.name}.routes.ts`] = `import { Elysia, t } from "elysia";
import type { Authenticator } from "../../auth/guard";
import { create${modelName(entity)}Service } from "./${entity.name}.service";
import type { ${modelName(entity)}Repository as ${modelName(entity)}RepositoryPort } from "./${entity.name}.contract";

${renderRoutes(publicEntity, database, options.scopes, hiddenFields).replace(`repository: ${modelName(entity)}Repository`, `repository: ${modelName(entity)}RepositoryPort`).replace("  return new Elysia({", `  const service = create${modelName(entity)}Service(repository);\n  return new Elysia({`).replaceAll("repository.list(", "service.list(").replaceAll("repository.one(", "service.one(").replaceAll("repository.create(", "service.create(").replaceAll("repository.update(", "service.update(").replaceAll("repository.delete(", "service.delete(")}`;
    files[`api/src/routes/${entity.name}.ts`] = `export { ${modelName(entity)}Routes } from "../modules/${entity.name}/${entity.name}.routes";\nexport type { ${modelName(entity)}Repository } from "../modules/${entity.name}/${entity.name}.contract";\n`;
    files[`api/tests/${entity.name}.test.ts`] = renderRouteTest(publicEntity, database, options.scopes ?? [], hiddenFields);
  }
  files["api/tests/graphql.test.ts"] = renderGraphQLTest(scopedDatabase);
  files["api/tests/graphql-schema.test.ts"] = `import { expect, test } from "bun:test";
import { buildSchema, isObjectType, isInputObjectType, validateSchema } from "graphql";
import { graphqlTypeDefs } from "../src/graphql";

test("generated GraphQL schema satisfies the GraphQL type system", () => {
  expect(validateSchema(buildSchema(graphqlTypeDefs)).map((error) => error.message)).toEqual([]);
});
${database.entities.map((entity) => {
    const hidden = options.auth?.provider === "local" && options.auth.userEntity === entity.name ? [options.auth.passwordField!] : [];
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
                : field.type === "UUID" ? "00000000-0000-4000-8000-000000000002"
                  : field.type === "Vector" ? Array(field.dimension).fill(0)
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
    const values = entity.fields.filter((field) => !field.primaryKey && !field.nullable).map((field) => `${JSON.stringify(field.name)}: ${field.enumName ? JSON.stringify(database.enums?.find((item) => item.name === field.enumName)?.values[0]?.name) : field.type === "Integer" ? "1" : field.type === "Decimal" || field.type === "Money" ? '"1.00"' : field.type === "DateTime" ? 'new Date("2026-01-01T00:00:00.000Z")' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"' : '"Example"'}`).join(", ");
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
  const documentedFields = (entity: EntityIR) => entity.fields.filter((field) => !field.primaryKey && field.comment !== undefined && !(options.auth?.provider === "local" && entity.name === options.auth.userEntity && field.name === options.auth.passwordField));
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









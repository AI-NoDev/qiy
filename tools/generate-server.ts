import type { DatabaseIR, EntityIR, FieldIR, FilterMode } from "./database-ir";
import type { QiyProject } from "./qiy-project";
import { renderAppTemplate } from "./admin-template";
import { validateDatabaseIR } from "./database-ir";
import { generateDrizzlePostgres } from "./drizzle-pg";
import { generateDrizzleMysql } from "./drizzle-mysql";
import { generateDrizzleSqlite } from "./drizzle-sqlite";
import { generateAudit } from "./generate-audit";

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

function graphqlSchema(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}): string {
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
  const mutations = database.entities.flatMap((entity) => [
    `  create${modelName(entity)}(input: ${modelName(entity)}CreateInput!): ${modelName(entity)}!`,
    `  update${modelName(entity)}(id: ID!, input: ${modelName(entity)}UpdateInput!): ${modelName(entity)}`,
    `  delete${modelName(entity)}(id: ID!): ${modelName(entity)}`,
    `  delete${modelName(entity)}Many(ids: [ID!]!): [${modelName(entity)}!]!`,
  ]).join("\n");
  return `${enums ? `${enums}\n\n` : ""}input QiyFilterInput {\n  field: String!\n  operator: String = "eq"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\n${types}\n\ntype Query {\n${queries}\n}\n\ntype Mutation {\n${mutations}\n}`;
}

function graphqlResolver(entity: EntityIR): string {
  const name = modelName(entity);
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify(entity.fields.filter((field) => field.filterable !== false).map((field) => field.name));
  const filterModes = JSON.stringify(Object.fromEntries(entity.fields.filter((field) => field.filterable !== false).map((field) => [field.name, filterModesForField(field)])));
  return `  ${entity.name}Distribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (${JSON.stringify(entity.fields.filter((item) => item.enumName).map((item) => item.name))} as string[]).includes(field) ? services.${entity.name}.distribution(field, context.scopeFor("${entity.name}")) : Promise.reject(new Error("Unsupported distribution field")),\n  ${entity.name}Trend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (${JSON.stringify(entity.fields.filter((item) => item.type === "DateTime").map((item) => item.name))} as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.${entity.name}.trend(field, days, context.scopeFor("${entity.name}")) : Promise.reject(new Error("Invalid trend query")),\n` + `  ${entity.name}: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {\n    const sortableFields = ${sortableFields} as string[];\n    const filterableFields = ${filterableFields} as string[];\n    const filterModes = ${filterModes} as Record<string, FilterOperator[]>;\n    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");\n    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");\n    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");\n    const result = await services.${entity.name}.list(args.page ?? 1, args.pageSize ?? 20, {\n      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",\n      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("${entity.name}"),\n    });\n    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };\n  },\n  ${entity.name}ById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.one(id, context.scopeFor("${entity.name}")),\n  create${name}: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.create(input, context.actorId, context.scopeFor("${entity.name}")),\n  update${name}: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.update(id, input, context.actorId, context.scopeFor("${entity.name}")),\n  delete${name}: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.delete(id, context.actorId, context.scopeFor("${entity.name}")),\n  delete${name}Many: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.${entity.name}.deleteMany(ids, context.actorId, context.scopeFor("${entity.name}")),`;
}

function renderGraphQL(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}): string {
  const schema = JSON.stringify(graphqlSchema(database, hiddenFields));
  const serviceImports = database.entities.map((entity) => `import { create${modelName(entity)}Service } from "./modules/${entity.name}/${entity.name}.service";`).join("\n") + '\nimport { withPaginationLimit } from "./pagination";\n\ntype FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";';
  const services = database.entities.map((entity) => `  ${entity.name}: withPaginationLimit(create${modelName(entity)}Service(repositories.${entity.name})),`).join("\n");
  const resolvers = database.entities.map(graphqlResolver).join("\n");
  const scopeDefinitions = JSON.stringify((database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? []);
  return `import { Elysia, t } from "elysia";\nimport { buildSchema, graphql, parse, getOperationAST, Kind } from "graphql";\nimport type { Repositories } from "./app";\nimport type { Authenticator } from "./auth/guard";\n${serviceImports}\n\nexport const graphqlTypeDefs = ${schema};\nconst schema = buildSchema(graphqlTypeDefs);\nconst scopeDefinitions = ${scopeDefinitions} as Array<{ resource: string; field: string; claim: string }>;\n\nexport async function createGraphQLContext(authenticate: Authenticator, request: Request) {\n  const principal = await authenticate(request);\n  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));\n  return { actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } };\n}\n\nfunction requestedFields(query: string, operationName?: string): Set<string> {\n  const document = parse(query);\n  const fragments = new Map(document.definitions.filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION).map((fragment) => [fragment.name.value, fragment]));\n  const fields = new Set<string>();\n  const visit = (selections: readonly import("graphql").SelectionNode[], seen = new Set<string>()) => {\n    for (const selection of selections) {\n      if (selection.kind === Kind.FIELD) fields.add(selection.name.value);\n      else if (selection.kind === Kind.INLINE_FRAGMENT) visit(selection.selectionSet.selections, seen);\n      else {\n        if (seen.has(selection.name.value)) continue;\n        const fragment = fragments.get(selection.name.value);\n        if (fragment) visit(fragment.selectionSet.selections, new Set([...seen, selection.name.value]));\n      }\n    }\n  };\n  const operation = getOperationAST(document, operationName);\n  if (operation) visit(operation.selectionSet.selections);\n  return fields;\n}\n\ninterface GraphQLRequest { query: string; variables?: Record<string, unknown>; operationName?: string; }\n\nexport function createGraphQLRoutes(repositories: Repositories, authenticate: Authenticator = async () => null) {\n  const services = {\n${services}\n  };\n  return new Elysia({ prefix: "/graphql" })\n    .post("/", async ({ body, request, status }) => {\n      const operation = body as GraphQLRequest;\n      const principal = await authenticate(request);\n      const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));\n      let fields: Set<string>;\n      try { fields = requestedFields(operation.query, operation.operationName); } catch { fields = new Set(); }\n      if (scopeDefinitions.some(({ resource }) => [resource, resource + "ById", resource + "Distribution", resource + "Trend", "create" + resource[0]!.toUpperCase() + resource.slice(1), "update" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1) + "Many"].some((name) => fields.has(name)) && !scopes[resource]?.value)) return status(403, { error: "Missing required data scope claim" });\n      return graphql({ schema, rootValue: resolvers(services), contextValue: { actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });\n    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) });\n}\n\nfunction resolvers(services: {\n${database.entities.map((entity) => `  ${entity.name}: ReturnType<typeof create${modelName(entity)}Service>;`).join("\n")}\n}) {\n  return {\n${resolvers}\n  };\n}\n\nexport function createGraphQLResolvers(repositories: Repositories) {\n  const services = {\n${services}\n  };\n  return resolvers(services);\n}\n`;
}

function renderGraphQLAdapter(database: DatabaseIR): string {
  const adapterResolvers = `export function createGraphQLAdapterResolvers(repositories: Repositories, authenticate: Authenticator) {
  const root = createGraphQLResolvers(repositories);
  return {
    Query: {
${database.entities.flatMap((entity) => [entity.name, `${entity.name}ById`, `${entity.name}Distribution`, `${entity.name}Trend`].map((field) => `      ${field}: async (_parent: unknown, args: Parameters<typeof root.${field}>[0], context: { request: Request }) => root.${field}(args, await createGraphQLContext(authenticate, context.request)),`)).join("\n")}
    },
    Mutation: {
${database.entities.flatMap((entity) => [`create${modelName(entity)}`, `update${modelName(entity)}`, `delete${modelName(entity)}`, `delete${modelName(entity)}Many`].map((field) => `      ${field}: async (_parent: unknown, args: Parameters<typeof root.${field}>[0], context: { request: Request }) => root.${field}(args, await createGraphQLContext(authenticate, context.request)),`)).join("\n")}
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

function renderRepositoryMethods(entity: EntityIR, database: DatabaseIR): string {
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
  const auditedMutationMethods = database.dialect === "sqlite" ? `  async create(values, actorId, scope) {
    return db.transaction((tx) => {
      const record = tx.insert(${entity.name}).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning().get();
      if (!record) throw new Error("Insert returned no record");
      tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.update(${entity.name}).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(${entity.name}.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: JSON.stringify({ fields: Object.keys(values) }), createdAt: new Date() }).run();
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const record = tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).returning().get();
      if (record) tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: "{}", createdAt: new Date() }).run();
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction((tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition)).returning().all();
      if (deletedRows.length) tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: "{}", createdAt: new Date() }))).run();
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
      }
      return deletedRows;
    });
  },
` : `  async create(values, actorId, scope) {
    return db.transaction(async (tx) => {
      const [record] = await tx.insert(${entity.name}).values({ ...values, ...(scope ? { [scope.field]: scope.value } : {}), id: crypto.randomUUID() } as typeof ${entity.name}.$inferInsert).returning();
      if (!record) throw new Error("Insert returned no record");
      await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.created", resource: "${entity.tableName}", resourceId: record.id, metadata: { fields: Object.keys(values) } });
      return record;
    });
  },
  async update(id, values, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.update(${entity.name}).set({ ...values, ...(scope ? { [scope.field]: scope.value } : {}) }).where(and(eq(${entity.name}.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.updated", resource: "${entity.tableName}", resourceId: id, metadata: { fields: Object.keys(values) } });
      return record;
    });
  },
  async delete(id, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const [record] = await tx.delete(${entity.name}).where(and(eq(${entity.name}.id, id), scopeCondition)).returning();
      if (record) await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: id, metadata: {} });
      return record;
    });
  },
  async deleteMany(ids, actorId, scope) {
    return db.transaction(async (tx) => {
      const scopeColumns: Record<string, any> = { ${scopeColumns} };
      const scopeCondition = scope && scopeColumns[scope.field] ? eq(scopeColumns[scope.field], scope.value) : undefined;
      const deletedRows = await tx.delete(${entity.name}).where(and(inArray(${entity.name}.id, ids), scopeCondition)).returning();
      if (deletedRows.length) await tx.insert(auditEvents).values(deletedRows.map((record) => ({ id: crypto.randomUUID(), actorId: actorId ?? null, action: "${entity.tableName}.deleted", resource: "${entity.tableName}", resourceId: record.id, metadata: {} })));
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

function renderDataflowRoutes(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>, scopes: NonNullable<QiyProject["scopes"]> = []): string | undefined {
  if (!dataflows.length) return undefined;
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const scopeFor = (entity: EntityIR) => scopes.find((scope) => scope.resource === entity.name || scope.resource === entity.tableName);
  const synchronous = database.dialect === "sqlite";
  const selectOne = (query: string) => synchronous ? `${query}.get()` : `(await ${query})[0]`;
  const routeBlocks = dataflows.map((flow) => {
    const contextNames = new Map(flow.context.map((binding, index) => [binding.name, `context${index}`]));
    const inputSchema = flow.input.map((field) => {
      const enumeration = database.enums?.find((item) => item.name === field.type);
      if (enumeration) {
        const schema = `t.Union([${enumeration.values.map((value) => `t.Literal(${JSON.stringify(value.name)})`).join(", ")}], ${JSON.stringify(field.comment ? { description: field.comment } : {})})`;
        return `      ${JSON.stringify(field.name)}: ${field.required ? schema : `t.Optional(${schema})`},`;
      }
      const base = dataflowInputField(field.type);
      const described = field.comment ? (base.includes("({") ? base.replace("({", `({ description: ${JSON.stringify(field.comment)},`) : base.replace("()", `({ description: ${JSON.stringify(field.comment)} })`)) : base;
      return `      ${JSON.stringify(field.name)}: ${field.required ? described : `t.Optional(${described})`},`;
    }).join("\n");
    const contextLoads = flow.context.map((binding, index) => {
      const entity = entities.get(binding.entity);
      if (!entity) throw new Error(`Dataflow ${flow.name}: unknown entity ${binding.entity}`);
      const [key, source] = binding.id.split(":", 2);
      const inputName = source?.replace(/^input\./, "");
      if (!key || !inputName) throw new Error(`Dataflow ${flow.name}: invalid context source ${binding.id}`);
      const scope = scopeFor(entity);
      const scopeValue = scope ? `const scope${index} = principal?.claims?.[${JSON.stringify(scope.claim)}];\n        if (scope${index} === undefined || scope${index} === null || scope${index} === "") throw new DataflowFailure(403, "Missing required data scope claim: " + ${JSON.stringify(scope.claim)});\n        ` : "";
      const condition = scope
        ? `and(eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}]), eq(${entity.name}[${JSON.stringify(scope.field)}], String(scope${index})))`
        : `eq(${entity.name}[${JSON.stringify(key)}], body[${JSON.stringify(inputName)}])`;
      return `        ${scopeValue}let context${index} = ${selectOne(`tx.select().from(${entity.name}).where(${condition}).limit(1)${synchronous ? "" : '.for("update")'}`)};\n        if (!context${index}) throw new DataflowFailure(404, "Not found", ${JSON.stringify(entity.tableName)});`;
    }).join("\n\n");
    const actions = flow.steps.flatMap((step) => step.actions.map((action) => {
      if (action.kind === "require") {
        const [binding, field] = action.left.split(".", 2);
        const variable = binding === "input" ? "body" : contextNames.get(binding!);
        if (!variable || !field) throw new Error(`Dataflow ${flow.name}: invalid requirement ${action.left}`);
        return `        if (!(${variable}[${JSON.stringify(field)}] ${action.operator} ${JSON.stringify(action.right)})) throw new DataflowFailure(409, ${JSON.stringify(action.error)});`;
      }
      const entityName = flow.context.find((binding) => binding.name === action.context)?.entity;
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
    })).join("\n");
    const result = contextNames.get(flow.result);
    if (!result) throw new Error(`Dataflow ${flow.name}: missing result context ${flow.result}`);
    const needsIdempotency = flow.idempotency?.required === true;
    const requestSetup = needsIdempotency ? `      const requestKey = request.headers.get("idempotency-key");
      if (!requestKey || !/^[\\x21-\\x7E]{1,128}$/.test(requestKey)) return status(400, { error: "A valid Idempotency-Key header is required" });
      if (!principal?.id) return status(401, { error: "Authentication is required for idempotent commands" });
      const requestKeyHash = await hashDataflowValue(requestKey);
      const requestHash = await hashDataflowValue(JSON.stringify([${flow.input.map((field) => `body[${JSON.stringify(field.name)}]`).join(", ")} ]));
` : "";
    const transactionReplay = needsIdempotency ? `        const previous = ${selectOne(`tx.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1)`)};
        if (previous) return previous.requestHash === requestHash ? { kind: "replay" as const, value: JSON.parse(previous.response) } : { kind: "key-conflict" as const };
` : "";
    const auditWrite = flow.audit === undefined ? "" : `        await tx.insert(auditEvents).values({ id: crypto.randomUUID(), actorId: principal?.id ?? null, action: ${JSON.stringify(flow.audit)}, resource: ${JSON.stringify(entities.get(flow.context.find((binding) => binding.name === flow.result)!.entity)!.tableName)}, resourceId: String(value.id), metadata: ${database.dialect === "sqlite" ? 'JSON.stringify({ flow: ' + JSON.stringify(flow.name) + ' })' : '{ flow: ' + JSON.stringify(flow.name) + ' }'}, createdAt: ${database.dialect === "sqlite" || database.dialect === "postgresql" ? "new Date()" : "Date.now()"} });
`;
    const receiptWrite = needsIdempotency ? `        await tx.insert(dataflowIdempotency).values({ id: crypto.randomUUID(), actorId: principal!.id, flow: ${JSON.stringify(flow.name)}, requestKeyHash, requestHash, response: JSON.stringify(value) });
` : "";
    const catchReplay = needsIdempotency ? `      } catch (error) {
        if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}) });
        const previous = await db.select({ requestHash: dataflowIdempotency.requestHash, response: dataflowIdempotency.response }).from(dataflowIdempotency).where(and(eq(dataflowIdempotency.actorId, principal!.id), eq(dataflowIdempotency.flow, ${JSON.stringify(flow.name)}), eq(dataflowIdempotency.requestKeyHash, requestKeyHash))).limit(1);
        if (previous[0]) return previous[0].requestHash === requestHash ? JSON.parse(previous[0].response) : status(409, { error: "Idempotency key was already used with a different request" });
        throw error;
      }
` : "      } catch (error) { if (error instanceof DataflowFailure) return status(error.status, { error: error.message, ...(error.resource ? { resource: error.resource } : {}) }); throw error; }\n";
    return `    .post(${JSON.stringify(`/${flow.name}`)}, async ({ body, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      if (!${JSON.stringify(flow.roles ?? ["admin", "operator"])}.includes(principal.role)) return status(403, { error: "Command execution is restricted" });
${requestSetup}      let outcome;
      try {
      outcome = await db.transaction(${synchronous ? "" : "async "}(tx) => {
${contextLoads}
${transactionReplay}

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
    }, { additionalProperties: false }) })`;
  }).join("\n");
  const usesIdempotency = dataflows.some((flow) => flow.idempotency?.required);
  const usesAudit = dataflows.some((flow) => flow.audit !== undefined);
  return `import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { ${[...new Set([...dataflows.flatMap((flow) => flow.context.map((binding) => binding.entity)), ...(usesIdempotency ? ["dataflowIdempotency"] : []), ...(usesAudit ? ["auditEvents"] : [])])].join(", ")} } from "../schema";
import type { Authenticator } from "../auth/guard";

class DataflowFailure extends Error {
  constructor(public readonly status: 403 | 404 | 409, message: string, public readonly resource?: string) { super(message); }
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

function renderSqliteDataflowTest(database: DatabaseIR, dataflows: NonNullable<QiyProject["dataflows"]>): string | undefined {
  if (database.dialect !== "sqlite" || !dataflows.length) return undefined;
  const entities = new Map(database.entities.map((entity) => [entity.name, entity]));
  const usedEntities = [...new Set(dataflows.flatMap((flow) => flow.context.map((binding) => binding.entity)))].map((name) => entities.get(name)!);
  const imports = usedEntities.map((entity) => entity.name).join(", ");
  const schema = usedEntities.map((entity) => {
    const columns = entity.fields.map((field) => `${JSON.stringify(field.columnName ?? field.name)} ${sqliteColumnType(field)}${field.primaryKey ? " primary key" : field.nullable ? "" : " not null"}`).join(", ");
    return `client.exec(${JSON.stringify(`CREATE TABLE IF NOT EXISTS ${entity.tableName} (${columns})`)});`;
  }).join("\n");
  const auxiliarySchema = [
    `client.exec("CREATE TABLE IF NOT EXISTS audit_events (id text primary key, actorId text, action text not null, resource text not null, resourceId text, metadata text, createdAt integer not null)");`,
    ...(dataflows.some((flow) => flow.idempotency?.required) ? [`client.exec("CREATE TABLE IF NOT EXISTS dataflow_idempotency (id text primary key, actorId text not null, flow text not null, requestKeyHash text not null, requestHash text not null, response text not null, UNIQUE(actorId, flow, requestKeyHash))");`] : []),
  ].join("\n");
  const cleanup = [
    ...usedEntities.map((entity) => `client.exec(${JSON.stringify(`DELETE FROM ${entity.tableName}`)});`),
    "client.exec('DELETE FROM audit_events');",
    ...(dataflows.some((flow) => flow.idempotency?.required) ? ["client.exec('DELETE FROM dataflow_idempotency');"] : []),
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
    const expectedUpdates = flow.steps.flatMap((step) => step.actions).flatMap((action) => action.kind === "update" && action.context === flow.result ? action.values : []);
    const assertions = expectedUpdates.map((update) => `expect(result).toMatchObject({ ${JSON.stringify(update.field)}: ${JSON.stringify(update.source === "input" ? input[update.value] : update.value)} });`).join("\n    ");
    const headers = flow.idempotency?.required ? `{ "Content-Type": "application/json", "Idempotency-Key": "qiy-test-key" }` : `{ "Content-Type": "application/json" }`;
    const missingKeyCheck = flow.idempotency?.required ? `    const missingKey = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missingKey.status).toBe(400);` : "";
    const changedInput = flow.input.find((field) => field.type !== "UUID" && (database.enums?.find((item) => item.name === field.type)?.values.length ?? 2) > 1) ?? flow.input[0]!;
    const changedEnum = database.enums?.find((item) => item.name === changedInput.type);
    const changedValue = changedEnum ? changedEnum.values.find((value) => value.name !== input[changedInput.name])?.name : changedInput.type === "UUID" ? "00000000-0000-4000-8000-000000000099" : changedInput.type === "Boolean" ? false : changedInput.type === "Integer" ? 2 : changedInput.type === "Decimal" ? "2.00" : "different value";
    const replayCheck = flow.idempotency?.required ? `
    const replay = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);
    const changedPayload = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify({ ...${JSON.stringify(input)}, ${JSON.stringify(changedInput.name)}: ${JSON.stringify(changedValue)} }) }));
    expect(changedPayload.status).toBe(409);` : "";
    const auditCheck = flow.audit !== undefined ? `
    expect(client.query<{ total: number }, [string]>("select count(*) as total from audit_events where action = ?").get(${JSON.stringify(flow.audit)})?.total).toBe(1);` : "";
    const hasUpdates = flow.steps.some((step) => step.actions.some((action) => action.kind === "update"));
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
    const businessRollbackTest = hasUpdates ? `
  test(${JSON.stringify(`${flow.name} rolls back earlier writes when a later requirement fails`)}, async () => {
    ${seed}
    const before = ${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all());
    const failureApp = new Elysia().use(createFailureRoutes(async () => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: ${JSON.stringify(flow.roles?.[0] ?? "admin")} })));
    const failed = await failureApp.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ error: "qiy.test.lateFailure" });
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
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
    expect(${JSON.stringify(usedEntities.map((entity) => entity.tableName))}.map((table) => client.query("SELECT * FROM " + table).all())).toEqual(before);
    expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM audit_events").get()?.total).toBe(0);
    ${flow.idempotency?.required ? 'expect(client.query<{ total: number }, []>("SELECT COUNT(*) as total FROM dataflow_idempotency").get()?.total).toBe(0);' : ""}
    const retry = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(retry.status).toBe(200);
  });`];
    }).join("\n");
    return `test(${JSON.stringify(flow.idempotency?.required ? "replays a successful command without a second audit event" : `${flow.name} returns not-found and commits its supported update`)}, async () => {
${missingKeyCheck}
    const missing = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(missing.status).toBe(404);
    ${seed}
    const response = await app.handle(new Request(${JSON.stringify(`http://localhost/api/v1/commands/${flow.name}`)}, { method: "POST", headers: ${headers}, body: JSON.stringify(${JSON.stringify(input)}) }));
    expect(response.status).toBe(200);
    const result = await response.json();
    ${assertions || "expect(result).toHaveProperty(\"id\");"}
${replayCheck}${auditCheck}
  });${authorizationTest}${rollbackTests}${businessRollbackTest}${inputValidationTests}${numericGuardTests}`;
  }).join("\n\n");
  return `import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { client, db } from "../src/db";
import { ${imports} } from "../src/schema";
import { createDataflowRoutes } from "../src/dataflows";
import { createDataflowRoutes as createFailureRoutes } from "./fixtures/dataflow-failure";

beforeAll(() => {
${schema}
${auxiliarySchema}
});

afterEach(() => {
${cleanup}
});

const testRoles: Record<string, "admin" | "operator"> = ${JSON.stringify(Object.fromEntries(dataflows.map((flow) => [flow.name, flow.roles?.[0] ?? "admin"])))};
const app = new Elysia().use(createDataflowRoutes(async (request) => ({ id: "00000000-0000-4000-8000-000000000010", name: "Dataflow Test", role: testRoles[new URL(request.url).pathname.split("/").at(-1)!] ?? "admin" })));

describe("generated dataflow routes", () => {
${tests}
});
`;
}

export function generateServer(database: DatabaseIR, options: Pick<QiyProject, "storageProvider" | "auth" | "scopes" | "corsOrigins" | "elysiaPlugins" | "workflows" | "dataflows"> = {}): Record<string, string> {
  const errors = validateDatabaseIR(database);
  if (errors.length) throw new Error(errors.join("\n"));
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
  if (database.entities.some((entity) => entity.fields.some((field) => field.type === "Vector")) && database.dialect !== "postgresql") errors.push("Vector fields require PostgreSQL with pgvector");
  for (const entity of database.entities) {
    const keys = entity.fields.filter((field) => field.primaryKey);
    if (keys.length !== 1 || keys[0]?.name !== "id" || keys[0]?.type !== "UUID") {
      errors.push(`${entity.name}: V0 CRUD requires exactly one UUID primary key named id`);
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(entity.tableName)) errors.push(`${entity.name}: route path must be lowercase and URL-safe`);
  }
  const auth = options.auth;
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
  const dataflowRoutes = renderDataflowRoutes(database, options.dataflows ?? [], options.scopes ?? []);
  const protectedResources = JSON.stringify([
    ...database.entities.map((entity) => ({ path: entity.tableName, query: entity.name })),
    { path: "files", query: "files" },
    ...(dataflowRoutes ? [{ path: "commands", query: "commands" }] : []),
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
  const generatedSchema = baseSchema + (usesDataflowIdempotency ? renderDataflowIdempotencySchema(database.dialect) : "");
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
    "api/src/schema.ts": generatedSchema,
    "api/drizzle.config.ts": database.dialect === "postgresql" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "postgresql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://qiy:qiy@localhost:5432/qiy" } });\n` : database.dialect === "sqlite" ? `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "sqlite", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "./qiy.sqlite" } });\n` : `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "mysql", schema: "./src/schema.ts", out: "./drizzle", dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://qiy:qiy@localhost:3306/qiy" } });\n`,
    "api/src/app.ts": `import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
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
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
    ${auth?.provider === "local" ? 'const authRoutes = (await import("./auth/local")).createLocalAuthRoutes();' : auth?.provider === "otp" ? 'const authRoutes = (await import("./auth/otp")).createOtpAuthRoutes();' : ''}
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes)${options.elysiaPlugins?.graphqlAdapter && options.elysiaPlugins.graphqlAdapter !== "native" ? '' : '.use(createGraphQLRoutes(repositories, authenticate))'};
    let composed = application;
    ${auth?.provider === "local" || auth?.provider === "otp" ? "composed = composed.use(authRoutes);" : ""}
    ${orderWorkflow ? "composed = workflow ? composed.use(workflow) : composed;" : ""}
    ${dataflowRoutes ? "composed = dataflows ? composed.use(dataflows) : composed;" : ""}
    composed = storage ? composed.use(storage) : composed;
    ${auth ? 'composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticate));' : ""}
    return registerPlugins(composed, { repositories, authenticate });
}
`,
    "api/src/modules/index.ts": database.entities.map((entity) => `export { ${modelName(entity)}Routes } from "./${entity.name}/${entity.name}.routes";`).join("\n") + "\n",
    "api/src/graphql.ts": renderGraphQL(scopedDatabase, options.auth?.provider === "local" ? { [options.auth.userEntity]: [options.auth.passwordField!] } : {}),
    "api/src/graphql-adapter.ts": renderGraphQLAdapter(scopedDatabase),
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

test("protects file storage endpoints and rejects traversal", async () => {
  Bun.env.QIY_STORAGE_METADATA = "memory";
  Bun.env.QIY_STORAGE_PROVIDER = "local";
  Bun.env.QIY_STORAGE_ROOT = import.meta.dir + "/.qiy-test-storage";
  const repositories = Object.fromEntries(${JSON.stringify(database.entities.map((entity) => entity.name))}.map((name) => [name, repository])) as unknown as Repositories;
  const app = await createApp(repositories, async () => ({ id: "admin", name: "Admin", role: "admin", claims: ${testClaims} }));
  const key = "orders/" + crypto.randomUUID() + ".txt";
  const fileUrl = "http://localhost/api/v1/files?key=" + encodeURIComponent(key) + "&fileName=invoice.txt&resource=orders&resourceId=00000000-0000-4000-8000-000000000001";
  const metadataUrl = "http://localhost/api/v1/files/metadata?key=" + encodeURIComponent(key);
  const upload = await app.handle(new Request(fileUrl, { method: "POST", body: "invoice" }));
  expect(upload.status).toBe(200);
  const metadata = await app.handle(new Request(metadataUrl));
  expect(metadata.status).toBe(200);
  expect(await metadata.json() as { ownerId: string; size: number; storageKey: string; fileName: string; resource: string; resourceId: string }).toMatchObject({ ownerId: "admin", size: 7, storageKey: key, fileName: "invoice.txt", resource: "orders", resourceId: "00000000-0000-4000-8000-000000000001" });
  expect((await app.handle(new Request(fileUrl, { method: "POST", body: "overwritten" }))).status).toBe(409);
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
${options.elysiaPlugins?.graphqlAdapter === "yoga" ? `  { name: "graphql-yoga", setup: (app, context) => context ? app.use(yoga({ path: "/graphql", graphiql: false, landingPage: false, typeDefs: graphqlTypeDefs, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate), context: ({ request }) => ({ request }) })) : app },` : ""}
${options.elysiaPlugins?.graphqlAdapter === "apollo" ? `  { name: "graphql-apollo", setup: async (app, context) => context ? app.use(await apollo({ path: "/graphql", enablePlayground: false, typeDefs: graphqlTypeDefs, resolvers: createGraphQLAdapterResolvers(context.repositories, context.authenticate), context: async ({ request }) => ({ request }) })) : app },` : ""}
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
${repositoryImports}

${auth ? '' : 'if (Bun.env.QIY_DEV_MODE !== "1") {'}
${auth ? '' : '  throw new Error("Unauthenticated V0 admin API is disabled: set QIY_DEV_MODE=1 for local development only");'}
${auth ? '' : '}'}

if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ ${database.entities.map((entity) => `${entity.name}: ${modelName(entity)}Repository`).join(", ")} }, ${auth ? 'createProductionAuthenticator()' : 'async () => ({ id: "dev", name: "Local Admin", role: "admin" })'});
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
  const dataflowTest = renderSqliteDataflowTest(database, options.dataflows ?? []);
  if (dataflowTest) {
    files["api/tests/dataflow.test.ts"] = dataflowTest;
    const failureFlows = (options.dataflows ?? []).map((flow) => {
      const updates = flow.steps.flatMap((step) => step.actions).filter((action) => action.kind === "update");
      const last = updates.at(-1);
      if (!last) return flow;
      const value = last.values.at(-1)!;
      const binding = flow.context.find((context) => context.name === last.context)!;
      const input = value.source === "input" ? flow.input.find((field) => field.name === value.value) : undefined;
      const numericInput = input?.type === "Integer" || database.enums?.some((enumeration) => enumeration.name === input?.type);
      return { ...flow, steps: [...flow.steps, { name: "qiyTestLateFailure", order: Math.max(...flow.steps.map((step) => step.order)) + 1, actions: [{ kind: "require" as const, left: `${last.context}.${numericInput ? binding.id.split(":")[0] : value.field}`, operator: "!=" as const, right: numericInput ? "00000000-0000-4000-8000-000000000001" : value.source === "input" ? "Qiy fixture reason" : value.value, error: "qiy.test.lateFailure" }] }] };
    });
    files["api/tests/fixtures/dataflow-failure.ts"] = renderDataflowRoutes(database, failureFlows, options.scopes ?? [])!
      .replaceAll('"../db"', '"../../src/db"').replaceAll('"../schema"', '"../../src/schema"').replaceAll('"../auth/guard"', '"../../src/auth/guard"');
  }
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
    const hiddenFields = options.auth?.provider === "local" && entity.name === options.auth.userEntity ? [options.auth.passwordField!] : [];
    const publicEntity = hiddenFields.length ? { ...entity, fields: entity.fields.filter((field) => !hiddenFields.includes(field.name)) } : entity;
    files[`${moduleRoot}/${entity.name}.repository.ts`] = `import { and, asc, count, desc, eq, gt, gte, lt, lte, sql, ${database.dialect === "postgresql" ? "ilike" : "like"}, inArray, or } from "drizzle-orm";
import { db } from "../../db";
import { ${entity.name}, auditEvents } from "../../schema";
import type { ${modelName(entity)}Repository as ${modelName(entity)}RepositoryContract } from "./${entity.name}.contract";

export const ${modelName(entity)}Repository: ${modelName(entity)}RepositoryContract = {
${renderRepositoryMethods(publicEntity, scopedDatabase)}
};
`;
    files[`${moduleRoot}/${entity.name}.contract.ts`] = `export interface ${modelName(entity)}Repository {
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
const dateFields = ${JSON.stringify(entity.fields.filter((field) => field.type === "DateTime").map((field) => field.name))} as string[];
function normalizeDates(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [field, dateFields.includes(field) && typeof value === "string" ? new Date(value) : value]));
}
export function create${modelName(entity)}Service(repository: ${modelName(entity)}Repository) {
  return {
    distribution: (field: string, scope?: { field: string; value: string }) => repository.distribution(field, scope),
    trend: (field: string, days: number, scope?: { field: string; value: string }) => repository.trend(field, days, scope),
    list: (page: number, pageSize: number, options?: ListQuery) => repository.list(page, pageSize, options),
    one: (id: string, scope?: { field: string; value: string }) => repository.one(id, scope),
    create: (values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.create(normalizeDates(values), actorId, scope),
    update: (id: string, values: Record<string, unknown>, actorId?: string, scope?: { field: string; value: string }) => repository.update(id, normalizeDates(values), actorId, scope),
    delete: (id: string, actorId?: string, scope?: { field: string; value: string }) => repository.delete(id, actorId, scope),
    deleteMany: (ids: string[], actorId?: string, scope?: { field: string; value: string }) => repository.deleteMany(ids, actorId, scope),
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
  if (describedEntities.length) {
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









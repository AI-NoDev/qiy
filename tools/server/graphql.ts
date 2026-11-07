/**
 * Server renderers for the GraphQL schema, resolvers, Yoga adapter and tests.
 */
import { manyRelations, generatedFieldsOf, type DatabaseIR, type EntityIR, type FieldIR } from "../database-ir";
import type { QiyProject, DataflowIR, QiyResourceRestriction } from "../qiy-project";
import { ruleSample } from "../field-rules";
import { modelName, filterModesForField } from "./shared";

export function graphqlName(name: string): string {
  return name[0]!.toUpperCase() + name.slice(1);
}

export function graphqlType(field: FieldIR, required = true): string {
  if (field.type === "Array") {
    const item = field.itemType === "Integer" ? "Int" : "String";
    return required && !field.nullable ? `[${item}!]!` : `[${item}!]`;
  }
  const base = field.enumName ? graphqlName(field.enumName)
    : field.type === "UUID" ? "ID"
      : field.type === "Integer" ? "Int"
      : field.type === "JSON" ? "JSON"
        : field.type === "Boolean" ? "Boolean"
        : field.type === "Vector" ? "[Float!]"
          : field.type === "Files" ? "[String!]"
            : "String";
  return required && !field.nullable ? `${base}!` : base;
}

export function graphqlInputFields(entity: EntityIR, patch: boolean, hiddenFields: string[] = [], generatedFields: string[] = []): string {
  return entity.fields.filter((field) => field.computed === undefined && !field.primaryKey && !field.stateMachine && !hiddenFields.includes(field.name) && (patch || !field.version)).map((field) => {
    // Generated and @default fields are optional on create: the server or the column fills them.
    const required = !patch && !field.primaryKey && !field.nullable && !generatedFields.includes(field.name) && !field.defaultValue;
    return `${graphqlDescription(field.comment, "  ")}  ${field.name}: ${graphqlType(field, required)}`;
  }).join("\n");
}

export function graphqlDescription(comment: string | undefined, indentation = ""): string {
  return comment === undefined ? "" : `${indentation}${JSON.stringify(comment)}\n`;
}

export function dataflowGraphqlName(name: string): string {
  return name.split(/[-_]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

export function dataflowResultEntity(database: DatabaseIR, flow: DataflowIR): EntityIR {
  const contextEntity = flow.context.find((binding) => binding.name === flow.result)?.entity;
  const creation = flow.steps
    .flatMap((step) => step.actions)
    .find((action): action is Extract<DataflowIR["steps"][number]["actions"][number], { kind: "create" }> => action.kind === "create" && action.context === flow.result);
  const createdEntity = creation?.entity;
  const entity = database.entities.find((candidate) => candidate.name === (contextEntity ?? createdEntity));
  if (!entity) throw new Error(`Dataflow ${flow.name}: missing GraphQL result entity`);
  return entity;
}

export function graphqlDataflowInputType(database: DatabaseIR, type: string): string {
  if (database.enums?.some((enumeration) => enumeration.name === type)) return graphqlName(type);
  if (type === "UUID") return "ID";
  if (type === "Integer") return "Int";
  if (type === "Boolean") return "Boolean";
  return "String";
}

export function graphqlDataflowResultType(entity: EntityIR): string {
  const fieldType = (field: FieldIR) => {
    const base = field.type === "Integer" ? "number" : field.type === "Vector" ? "number[]" : "string";
    return field.nullable ? `${base} | null` : base;
  };
  return `{ ${entity.fields.map((field) => `${field.name}?: ${fieldType(field)}`).join("; ")} }`;
}

export function graphqlSchema(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = [], realtimeEntities: EntityIR[] = []): string {
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const enums = (database.enums ?? []).map((enumeration) => `enum ${graphqlName(enumeration.name)} {\n${enumeration.values.map((value) => `  ${value.name}`).join("\n")}\n}`).join("\n\n");
  const types = database.entities.map((entity) => {
    const hidden = hiddenFields[entity.name] ?? [];
    const publicFields = entity.fields.filter((field) => !hidden.includes(field.name));
    const generatedFields = generatedFieldsOf(entity, database.relations ?? []).map((generated) => generated.field.name);
    const links = manyRelations(database, entity.name);
    const linkLines = (type: string) => links.map((link) => `\n${graphqlDescription(link.relation.comment, "  ")}  ${link.field}: ${type}`).join("");
    return `${graphqlDescription(entity.comment)}type ${modelName(entity)} {\n${publicFields.map((field) => `${graphqlDescription(field.comment, "  ")}  ${field.name}: ${graphqlType(field)}`).join("\n")}${linkLines("[ID!]!")}\n}\n\ntype ${modelName(entity)}Page {\n  items: [${modelName(entity)}!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\n${graphqlDescription(entity.comment)}input ${modelName(entity)}CreateInput {\n${graphqlInputFields(entity, false, hidden, generatedFields)}${linkLines("[ID!]")}\n}\n\n${graphqlDescription(entity.comment)}input ${modelName(entity)}UpdateInput {\n${graphqlInputFields(entity, true, hidden)}${linkLines("[ID!]")}\n}`;
  }).join("\n\n");
  const views = database.views ?? [];
  const viewTypes = views.map((view) => {
    const source = database.entities.find((entity) => entity.name === view.from || entity.tableName === view.from)!;
    const fields = view.columns.map((name) => source.fields.find((field) => field.name === name)!).filter(Boolean);
    return `type ${view.name} {
${fields.map((field) => `  ${field.name}: ${graphqlType(field)}`).join("\n")}
}

type ${view.name}Page {
  items: [${view.name}!]!
  total: Int!
  page: Int!
  pageSize: Int!
}`;
  }).join("\n\n");
  const viewQueries = views.flatMap((view) => {
    const hasId = view.columns.includes("id");
    return [
      `  ${view.name}(page: Int = 1, pageSize: Int = 20): ${view.name}Page!`,
      ...(hasId ? [`  ${view.name}ById(id: ID!): ${view.name}`] : []),
    ];
  }).join("\n");
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
  return `${enums ? `${enums}\n\n` : ""}scalar JSON

input QiyFilterInput {\n  field: String!\n  operator: String = "eq"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\n${types}${viewTypes ? "\n\n" + viewTypes : ""}${realtimeEntities.length ? `\n\n${realtimeEntities.map((entity) => `type ${modelName(entity)}Event {\n  event: String!\n  record: ${modelName(entity)}!\n}`).join("\n\n")}` : ""}${dataflowInputs ? `\n\n${dataflowInputs}` : ""}\n\ntype Query {\n${queries}${viewQueries ? "\n" + viewQueries : ""}\n}\n\ntype Mutation {\n${mutations}${dataflowMutations ? `\n${dataflowMutations}` : ""}\n}${realtimeEntities.length ? `\n\ntype Subscription {\n${realtimeEntities.map((entity) => `  ${entity.name}Changed: ${modelName(entity)}Event!`).join("\n")}\n}` : ""}`;
}

export function graphqlResolver(entity: EntityIR, restricted = false, linkFields: string[] = []): string {
  const name = modelName(entity);
  const sortableFields = JSON.stringify(entity.fields.filter((field) => field.computed === undefined && field.sortable !== false).map((field) => field.name));
  const filterableFields = JSON.stringify([...entity.fields.filter((field) => field.computed === undefined && field.filterable !== false).map((field) => field.name), ...linkFields]);
  const filterModes = JSON.stringify(Object.fromEntries([...entity.fields.filter((field) => field.computed === undefined && field.filterable !== false).map((field) => [field.name, filterModesForField(field)]), ...linkFields.map((field) => [field, ["eq", "in"]])]));
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

export function renderGraphQL(database: DatabaseIR, hiddenFields: Record<string, string[]> = {}, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = [], realtimeEntities: EntityIR[] = []): string {
  const restrictions = (database as DatabaseIR & { restrictions?: QiyResourceRestriction[] }).restrictions ?? [];
  const restrictedResources = new Set(restrictions.map((restriction) => restriction.resource));
  const schema = JSON.stringify(graphqlSchema(database, hiddenFields, dataflows, actions, realtimeEntities));
  const batchFlows = new Set(actions.filter((action) => action.batch && action.target.kind === "dataflow").map((action) => action.target.kind === "dataflow" ? action.target.dataflow : ""));
  const serviceImports = database.entities.map((entity) => `import { create${modelName(entity)}Service } from "./modules/${entity.name}/${entity.name}.service";`).join("\n") + '\nimport { withPaginationLimit } from "./pagination";\n\ntype FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";';
  const services = database.entities.map((entity) => `  ${entity.name}: withPaginationLimit(create${modelName(entity)}Service(repositories.${entity.name})),`).join("\n");
  const resolvers = database.entities.map((entity) => graphqlResolver(entity, restrictedResources.has(entity.name), manyRelations(database, entity.name).map((link) => link.field))).join("\n");
  const views = database.views ?? [];
  const viewResolvers = views.map((view) => {
    const hasId = view.columns.includes("id");
    return `  ${view.name}: async ({ page = 1, pageSize = 20 }: { page?: number; pageSize?: number }, viewContext?: { principal?: Principal | null }) => { const access = await viewAccess.${view.name}(viewContext?.principal ?? null); const size = Math.min(100, Math.max(1, Math.floor(pageSize))); const current = Math.max(1, Math.floor(page)); const [data, totalRows] = await Promise.all([db.select().from(${view.name}).where(access.condition).limit(size).offset((current - 1) * size), db.select({ count: count() }).from(${view.name}).where(access.condition)]); return { items: data.map(access.mask), total: Number(totalRows[0]?.count ?? 0), page: current, pageSize: size }; },${hasId ? `\n  ${view.name}ById: async ({ id }: { id: string }, viewContext?: { principal?: Principal | null }) => { const access = await viewAccess.${view.name}(viewContext?.principal ?? null); const [row] = await db.select().from(${view.name}).where(and(eq(${view.name}.id, id), access.condition)).limit(1); return row ? access.mask(row) : null; },` : ""}`;
  }).join("\n");
  const viewImports = views.length
    ? `import { and, count, eq } from "drizzle-orm";\nimport { db } from "./db";\nimport { ${views.map((view) => view.name).join(", ")} } from "./schema";\nimport { viewAccess } from "./views-routes";\n`
    : "";
  // Subscription roots resolve through the in-process bus that the outbox dispatcher feeds.
  // Subscriptions stream over Server-Sent Events: one `data:` frame per GraphQL result.
  const policyImports = restrictions.length
    ? `import { QiyPolicyError, resolvePolicy, type QiyPolicy } from "./security/policy";\nimport { ${[...restrictedResources].join(", ")} } from "./schema";\n`
    : "";
  const policyColumnsLiteral = restrictions.length
    ? `\nconst policyColumns: Record<string, Record<string, unknown>> = {\n${restrictions.map((restriction) => {
      const entity = database.entities.find((candidate) => candidate.name === restriction.resource)!;
      return `  ${JSON.stringify(restriction.resource)}: { ${entity.fields.filter((field) => field.computed === undefined).map((field) => `${JSON.stringify(field.name)}: ${entity.name}.${field.name}`).join(", ")} },`;
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
        cancel() { void iterator.return?.(); },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }, { query: t.Object({ query: t.String({ minLength: 1, maxLength: 20000 }), variables: t.Optional(t.String({ maxLength: 20000 })), operationName: t.Optional(t.String({ maxLength: 200 })) }) })`
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
${policyImports}${viewImports}${commandImport}${serviceImports}${realtimeEntities.length ? '\nimport { realtimeChannelIterator } from "./realtime";\nimport { realtimeCapabilities } from "./realtime";\n' : ""}

export const graphqlTypeDefs = ${schema};
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = ${scopeDefinitions} as Array<{ resource: string; field: string; claim: string; tree?: { entity: string; parentField: string }; tenant?: boolean }>;${policyColumnsLiteral}

${commandHelpers}export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { request, principal, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }${policyContext} };
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
      return graphql({ schema, rootValue: resolvers(services${commandArgument}), contextValue: { request, principal, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }${policyContext} }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) })${subscriptionRoute};
}

function resolvers(services: {
${database.entities.map((entity) => `  ${entity.name}: ReturnType<typeof create${modelName(entity)}Service>;`).join("\n")}
}${commandParameter}, context?: { canSubscribe?: (channel: string) => boolean; channelFor?: (prefix: string) => string | undefined }) {
  return {
${subscriptionResolvers ? `${subscriptionResolvers}\n` : ""}${resolvers}${viewResolvers ? "\n" + viewResolvers : ""}${commandResolvers ? `\n${commandResolvers}` : ""}
  };}

export function createGraphQLResolvers(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
${services}
  };
${commandSetup}  return resolvers(services${commandArgument});
}
`;
}

export function renderGraphQLAdapter(database: DatabaseIR, dataflows: DataflowIR[] = [], actions: NonNullable<QiyProject["actions"]> = []): string {
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

export function renderGraphQLTest(database: DatabaseIR, hiddenFields: string[] = []): string {
  const entity = database.entities[0]!;
  const visibleFields = entity.fields.filter((field) => !hiddenFields.includes(field.name));
  const scopes = (database as DatabaseIR & { scopes?: Array<{ resource: string; field: string; claim: string }> }).scopes ?? [];
  const claims = JSON.stringify(Object.fromEntries(scopes.map((scope) => [scope.claim, "00000000-0000-4000-8000-000000000002"])));
  const name = modelName(entity);
  // Hidden fields (for example the local-auth password column) are absent from the
  // generated schema, so neither the selection set nor the input may reference them.
  const creatableFields = visibleFields.filter((field) => !generatedFieldsOf(entity, database.relations ?? []).some((generated) => generated.field.name === field.name));
  const values = visibleFields.filter((field) => field.computed === undefined && !field.primaryKey && !field.nullable && !field.version && creatableFields.includes(field)).map((field) => {
    const constrained = ruleSample(field);
    const example = constrained !== undefined ? JSON.stringify(constrained) : field.type === "Integer" ? "1" : field.type === "Boolean" ? "true" : field.type === "Array" ? (field.itemType === "Integer" ? "[1]" : '["Example"]') : field.type === "Decimal" || field.type === "Money" ? '"1.00"'
      : field.type === "Vector" ? `Array(${field.dimension}).fill(0)` : field.type === "Files" ? '["uploads/sample.pdf"]' : field.type === "DateTime" ? '"2026-01-01T00:00:00.000Z"' : field.type === "Date" ? '"2026-11-30"' : field.type === "Time" ? '"08:30:00"' : field.type === "UUID" ? '"00000000-0000-4000-8000-000000000002"'
        : field.enumName ? JSON.stringify(database.enums?.find((enumeration) => enumeration.name === field.enumName)?.values[0]?.name ?? "") : field.type === "Email" ? '"user@example.com"' : field.type === "URL" ? '"https://example.com"' : '"Example"';
    return `${JSON.stringify(field.name)}: ${example}`;
  }).join(", ");
  const fields = creatableFields.slice(0, 3).map((field) => field.name).join(" ");
  return `import { describe, expect, test } from "bun:test";\nimport { Elysia } from "elysia";\nimport { createGraphQLRoutes } from "../src/graphql";\nimport type { Repositories } from "../src/app";\nimport { QIY_ADMIN_ROLE } from "../src/auth/roles";\n\nconst records = new Map<string, Record<string, unknown>>();\nconst repository: Repositories["${entity.name}"] = {\n  async distribution(field) { const counts = new Map<string, number>(); for (const record of records.values()) { const value = String(record[field] ?? ""); counts.set(value, (counts.get(value) ?? 0) + 1); } return [...counts].map(([value, count]) => ({ value, count })); },\n  async trend(field, days) { const start = Date.now() - days * 86400000; const counts = new Map<string, number>(); for (const record of records.values()) { const date = new Date(String(record[field] ?? "")); if (date.getTime() >= start) { const day = date.toISOString().slice(0, 10); counts.set(day, (counts.get(day) ?? 0) + 1); } } return [...counts].map(([day, count]) => ({ day, count })); },\n  async list(page, pageSize, options = {}) {\n    const rows = [...records.values()];\n    const filtered = options.search ? rows.filter((record) => Object.values(record).some((value) => String(value ?? "").toLowerCase().includes(options.search!.toLowerCase()))) : rows;\n    return { data: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length };\n  },\n  async one(id) { return records.get(id); },\n  async create(values) { const record = { id: crypto.randomUUID(), ...values }; records.set(record.id, record); return record; },\n  async update(id, values) { const old = records.get(id); if (!old) return undefined; const record = { ...old, ...values }; records.set(id, record); return record; },\n  async delete(id) { const record = records.get(id); records.delete(id); return record; },\n  async deleteMany(ids) { return ids.flatMap((id) => { const record = records.get(id); records.delete(id); return record ? [record] : []; }); },\n};\nconst app = new Elysia().use(createGraphQLRoutes({ ${entity.name}: repository } as Repositories, async () => ({ id: "test-user", role: QIY_ADMIN_ROLE, name: "Test", claims: ${claims} })));\n\ndescribe("GraphQL API", () => {\n  test("supports create, list and delete mutations", async () => {\n    records.clear();\n    const create = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($input: ${name}CreateInput!) { create${name}(input: $input) { id } }", variables: { input: { ${values} } } }) }));\n    expect(create.status).toBe(200);\n    const created = await create.json() as { data: { create${name}: { id: string } } };\n    expect(created.data.create${name}.id).toBeTruthy();\n    const list = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "query { ${entity.name} { items { ${fields} } total } }" }) }));\n    expect((await list.json() as { data: { ${entity.name}: { total: number } } }).data.${entity.name}.total).toBe(1);\n    const deleted = await app.handle(new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($id: ID!) { delete${name}(id: $id) { id } }", variables: { id: created.data.create${name}.id } }) }));\n    expect((await deleted.json() as { data: { delete${name}: { id: string } } }).data.delete${name}.id).toBeTruthy();\n  });\n});\n`;
}

export function renderGraphQLListOptionsTest(database: DatabaseIR): string | undefined {
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
import { QIY_ADMIN_ROLE } from "../src/auth/roles";

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
const app = new Elysia().use(createGraphQLRoutes(repositories, async () => ({ id: "admin", role: QIY_ADMIN_ROLE, name: "Admin", claims: ${claims} })));
const request = (query: string, variables: Record<string, unknown>) => new Request("http://localhost/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });

${cases.join("\n\n")}
`;
}

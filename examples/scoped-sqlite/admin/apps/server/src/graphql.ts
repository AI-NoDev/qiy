import { Elysia, t } from "elysia";
import { buildSchema, graphql, parse, subscribe, getOperationAST, Kind, GraphQLError } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator, Principal } from "./auth/guard";
import { createRecordsService } from "./modules/records/records.service";
import { withPaginationLimit } from "./pagination";

type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";

export const graphqlTypeDefs = "scalar JSON\n\ninput QiyFilterInput {\n  field: String!\n  operator: String = \"eq\"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\ntype Records {\n  id: ID!\n  tenantId: String!\n  title: String!\n  createdAt: String\n}\n\ntype RecordsPage {\n  items: [Records!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput RecordsCreateInput {\n  tenantId: String!\n  title: String!\n  createdAt: String\n}\n\ninput RecordsUpdateInput {\n  tenantId: String\n  title: String\n  createdAt: String\n}\n\ntype Query {\n  records(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): RecordsPage!\n  recordsById(id: ID!): Records\n  recordsAggregate(field: String!, op: String!): Float\n  recordsDistribution(field: String!): [QiyDistribution!]!\n  recordsTrend(field: String!, days: Int!): [QiyTrend!]!\n}\n\ntype Mutation {\n  createRecords(input: RecordsCreateInput!): Records!\n  updateRecords(id: ID!, input: RecordsUpdateInput!): Records\n  deleteRecords(id: ID!): Records\n  deleteRecordsMany(ids: [ID!]!): [Records!]!\n}";
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = [{"resource":"records","field":"tenantId","claim":"tenant.id"}] as Array<{ resource: string; field: string; claim: string; tree?: { entity: string; parentField: string }; tenant?: boolean }>;

export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { request, principal, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } };
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
  records: withPaginationLimit(createRecordsService(repositories.records)),
  };
  return new Elysia({ prefix: "/graphql" })
    .post("/", async ({ body, request, status }) => {
      const operation = body as GraphQLRequest;
      const principal = await authenticate(request);
      const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
      let fields: Set<string>;
      try { fields = requestedFields(operation.query, operation.operationName); } catch { fields = new Set(); }
      if (scopeDefinitions.some(({ resource }) => [resource, resource + "ById", resource + "Distribution", resource + "Trend", "create" + resource[0]!.toUpperCase() + resource.slice(1), "update" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1) + "Many"].some((name) => fields.has(name)) && !scopes[resource]?.value)) return status(403, { error: "Missing required data scope claim" });
      return graphql({ schema, rootValue: resolvers(services), contextValue: { request, principal, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) });
}

function resolvers(services: {
  records: ReturnType<typeof createRecordsService>;
}, context?: { canSubscribe?: (channel: string) => boolean; channelFor?: (prefix: string) => string | undefined }) {
  return {
  recordsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.records.aggregate(field, op, context.scopeFor("records")).then((result) => result.value); },  recordsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.records.distribution(field, context.scopeFor("records")) : Promise.reject(new Error("Unsupported distribution field")),
  recordsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["createdAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.records.trend(field, days, context.scopeFor("records")) : Promise.reject(new Error("Invalid trend query")),
  records: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","tenantId","title","createdAt"] as string[];
    const filterableFields = ["id","tenantId","title","createdAt"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"tenantId":["contains","startsWith","endsWith","eq"],"title":["contains","startsWith","endsWith","eq"],"createdAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.records.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("records"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  recordsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.records.one(id, context.scopeFor("records")),
  createRecords: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.records.create(input, context.actorId, context.scopeFor("records")),
  updateRecords: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.records.update(id, input, context.actorId, context.scopeFor("records")),
  deleteRecords: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.records.delete(id, context.actorId, context.scopeFor("records")),
  deleteRecordsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.records.deleteMany(ids, context.actorId, context.scopeFor("records")),
  };}

export function createGraphQLResolvers(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
  records: withPaginationLimit(createRecordsService(repositories.records)),
  };
  return resolvers(services);
}

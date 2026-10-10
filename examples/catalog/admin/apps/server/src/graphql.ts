import { Elysia, t } from "elysia";
import { buildSchema, graphql, parse, getOperationAST, Kind } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator } from "./auth/guard";
import { createProductsService } from "./modules/products/products.service";
import { withPaginationLimit } from "./pagination";

const schema = buildSchema("input QiyFilterInput {\n  field: String!\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\ntype Products {\n  id: ID!\n  title: String!\n  price: String!\n  embedding: [Float!]\n}\n\ntype ProductsPage {\n  items: [Products!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput ProductsCreateInput {\n  title: String!\n  price: String!\n  embedding: [Float!]\n}\n\ninput ProductsUpdateInput {\n  title: String\n  price: String\n  embedding: [Float!]\n}\n\ntype Query {\n  products(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ProductsPage!\n  productsById(id: ID!): Products\n  productsDistribution(field: String!): [QiyDistribution!]!\n  productsTrend(field: String!, days: Int!): [QiyTrend!]!\n}\n\ntype Mutation {\n  createProducts(input: ProductsCreateInput!): Products!\n  updateProducts(id: ID!, input: ProductsUpdateInput!): Products\n  deleteProducts(id: ID!): Products\n  deleteProductsMany(ids: [ID!]!): [Products!]!\n}");
const scopeDefinitions = [] as Array<{ resource: string; field: string; claim: string }>;

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
  products: withPaginationLimit(createProductsService(repositories.products)),
  };
  return new Elysia({ prefix: "/graphql" })
    .post("/", async ({ body, request, status }) => {
      const operation = body as GraphQLRequest;
      const principal = await authenticate(request);
      const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
      let fields: Set<string>;
      try { fields = requestedFields(operation.query, operation.operationName); } catch { fields = new Set(); }
      if (scopeDefinitions.some(({ resource }) => [resource, resource + "ById", resource + "Distribution", resource + "Trend", "create" + resource[0]!.toUpperCase() + resource.slice(1), "update" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1) + "Many"].some((name) => fields.has(name)) && !scopes[resource]?.value)) return status(403, { error: "Missing required data scope claim" });
      return graphql({ schema, rootValue: resolvers(services), contextValue: { actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) });
}

function resolvers(services: {
  products: ReturnType<typeof createProductsService>;
}) {
  return {
  productsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.products.distribution(field, context.scopeFor("products")) : Promise.reject(new Error("Unsupported distribution field")),
  productsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.products.trend(field, days, context.scopeFor("products")) : Promise.reject(new Error("Invalid trend query")),
  products: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const result = await services.products.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("products"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  productsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.products.one(id, context.scopeFor("products")),
  createProducts: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.products.create(input, context.actorId, context.scopeFor("products")),
  updateProducts: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.products.update(id, input, context.actorId, context.scopeFor("products")),
  deleteProducts: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.products.delete(id, context.actorId, context.scopeFor("products")),
  deleteProductsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.products.deleteMany(ids, context.actorId, context.scopeFor("products")),
  };
}

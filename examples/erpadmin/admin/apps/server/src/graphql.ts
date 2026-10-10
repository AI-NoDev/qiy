import { Elysia, t } from "elysia";
import { buildSchema, graphql, parse, getOperationAST, Kind } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator } from "./auth/guard";
import { createUsersService } from "./modules/users/users.service";
import { createCustomersService } from "./modules/customers/customers.service";
import { createWarehousesService } from "./modules/warehouses/warehouses.service";
import { createProductsService } from "./modules/products/products.service";
import { createInventoryItemsService } from "./modules/inventoryItems/inventoryItems.service";
import { createOrdersService } from "./modules/orders/orders.service";
import { createOrderItemsService } from "./modules/orderItems/orderItems.service";
import { withPaginationLimit } from "./pagination";

export const graphqlTypeDefs = "enum UserRole {\n  admin\n  operator\n  viewer\n}\n\nenum OrderStatus {\n  draft\n  submitted\n  approved\n  shipped\n  cancelled\n}\n\ninput QiyFilterInput {\n  field: String!\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\ntype Users {\n  id: ID!\n  email: String!\n  displayName: String!\n  externalSubject: String\n  role: UserRole!\n}\n\ntype UsersPage {\n  items: [Users!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput UsersCreateInput {\n  email: String!\n  displayName: String!\n  externalSubject: String\n  role: UserRole!\n}\n\ninput UsersUpdateInput {\n  email: String\n  displayName: String\n  externalSubject: String\n  role: UserRole\n}\n\ntype Customers {\n  id: ID!\n  name: String!\n  email: String\n  creditLimit: String!\n}\n\ntype CustomersPage {\n  items: [Customers!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput CustomersCreateInput {\n  name: String!\n  email: String\n  creditLimit: String!\n}\n\ninput CustomersUpdateInput {\n  name: String\n  email: String\n  creditLimit: String\n}\n\ntype Warehouses {\n  id: ID!\n  code: String!\n  name: String!\n  capacity: Int!\n}\n\ntype WarehousesPage {\n  items: [Warehouses!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput WarehousesCreateInput {\n  code: String!\n  name: String!\n  capacity: Int!\n}\n\ninput WarehousesUpdateInput {\n  code: String\n  name: String\n  capacity: Int\n}\n\ntype Products {\n  id: ID!\n  sku: String!\n  name: String!\n  unitPrice: String!\n  reorderPoint: Int!\n  datasheet: String\n}\n\ntype ProductsPage {\n  items: [Products!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput ProductsCreateInput {\n  sku: String!\n  name: String!\n  unitPrice: String!\n  reorderPoint: Int!\n  datasheet: String\n}\n\ninput ProductsUpdateInput {\n  sku: String\n  name: String\n  unitPrice: String\n  reorderPoint: Int\n  datasheet: String\n}\n\ntype InventoryItems {\n  id: ID!\n  warehouseId: ID!\n  productId: ID!\n  quantity: Int!\n  reservedQuantity: Int!\n}\n\ntype InventoryItemsPage {\n  items: [InventoryItems!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput InventoryItemsCreateInput {\n  warehouseId: ID!\n  productId: ID!\n  quantity: Int!\n  reservedQuantity: Int!\n}\n\ninput InventoryItemsUpdateInput {\n  warehouseId: ID\n  productId: ID\n  quantity: Int\n  reservedQuantity: Int\n}\n\ntype Orders {\n  id: ID!\n  orderNumber: String!\n  customerId: ID!\n  status: OrderStatus!\n  totalAmount: String!\n  approvedBy: ID\n  createdAt: String\n}\n\ntype OrdersPage {\n  items: [Orders!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput OrdersCreateInput {\n  orderNumber: String!\n  customerId: ID!\n  status: OrderStatus!\n  totalAmount: String!\n  approvedBy: ID\n  createdAt: String\n}\n\ninput OrdersUpdateInput {\n  orderNumber: String\n  customerId: ID\n  status: OrderStatus\n  totalAmount: String\n  approvedBy: ID\n  createdAt: String\n}\n\ntype OrderItems {\n  id: ID!\n  orderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitPrice: String!\n}\n\ntype OrderItemsPage {\n  items: [OrderItems!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput OrderItemsCreateInput {\n  orderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitPrice: String!\n}\n\ninput OrderItemsUpdateInput {\n  orderId: ID\n  productId: ID\n  quantity: Int\n  unitPrice: String\n}\n\ntype Query {\n  users(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): UsersPage!\n  usersById(id: ID!): Users\n  usersDistribution(field: String!): [QiyDistribution!]!\n  usersTrend(field: String!, days: Int!): [QiyTrend!]!\n  customers(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): CustomersPage!\n  customersById(id: ID!): Customers\n  customersDistribution(field: String!): [QiyDistribution!]!\n  customersTrend(field: String!, days: Int!): [QiyTrend!]!\n  warehouses(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): WarehousesPage!\n  warehousesById(id: ID!): Warehouses\n  warehousesDistribution(field: String!): [QiyDistribution!]!\n  warehousesTrend(field: String!, days: Int!): [QiyTrend!]!\n  products(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ProductsPage!\n  productsById(id: ID!): Products\n  productsDistribution(field: String!): [QiyDistribution!]!\n  productsTrend(field: String!, days: Int!): [QiyTrend!]!\n  inventoryItems(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): InventoryItemsPage!\n  inventoryItemsById(id: ID!): InventoryItems\n  inventoryItemsDistribution(field: String!): [QiyDistribution!]!\n  inventoryItemsTrend(field: String!, days: Int!): [QiyTrend!]!\n  orders(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): OrdersPage!\n  ordersById(id: ID!): Orders\n  ordersDistribution(field: String!): [QiyDistribution!]!\n  ordersTrend(field: String!, days: Int!): [QiyTrend!]!\n  orderItems(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): OrderItemsPage!\n  orderItemsById(id: ID!): OrderItems\n  orderItemsDistribution(field: String!): [QiyDistribution!]!\n  orderItemsTrend(field: String!, days: Int!): [QiyTrend!]!\n}\n\ntype Mutation {\n  createUsers(input: UsersCreateInput!): Users!\n  updateUsers(id: ID!, input: UsersUpdateInput!): Users\n  deleteUsers(id: ID!): Users\n  deleteUsersMany(ids: [ID!]!): [Users!]!\n  createCustomers(input: CustomersCreateInput!): Customers!\n  updateCustomers(id: ID!, input: CustomersUpdateInput!): Customers\n  deleteCustomers(id: ID!): Customers\n  deleteCustomersMany(ids: [ID!]!): [Customers!]!\n  createWarehouses(input: WarehousesCreateInput!): Warehouses!\n  updateWarehouses(id: ID!, input: WarehousesUpdateInput!): Warehouses\n  deleteWarehouses(id: ID!): Warehouses\n  deleteWarehousesMany(ids: [ID!]!): [Warehouses!]!\n  createProducts(input: ProductsCreateInput!): Products!\n  updateProducts(id: ID!, input: ProductsUpdateInput!): Products\n  deleteProducts(id: ID!): Products\n  deleteProductsMany(ids: [ID!]!): [Products!]!\n  createInventoryItems(input: InventoryItemsCreateInput!): InventoryItems!\n  updateInventoryItems(id: ID!, input: InventoryItemsUpdateInput!): InventoryItems\n  deleteInventoryItems(id: ID!): InventoryItems\n  deleteInventoryItemsMany(ids: [ID!]!): [InventoryItems!]!\n  createOrders(input: OrdersCreateInput!): Orders!\n  updateOrders(id: ID!, input: OrdersUpdateInput!): Orders\n  deleteOrders(id: ID!): Orders\n  deleteOrdersMany(ids: [ID!]!): [Orders!]!\n  createOrderItems(input: OrderItemsCreateInput!): OrderItems!\n  updateOrderItems(id: ID!, input: OrderItemsUpdateInput!): OrderItems\n  deleteOrderItems(id: ID!): OrderItems\n  deleteOrderItemsMany(ids: [ID!]!): [OrderItems!]!\n}";
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = [{"resource":"orders","field":"customerId","claim":"tenant.customerId"}] as Array<{ resource: string; field: string; claim: string }>;

export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; } };
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
  users: withPaginationLimit(createUsersService(repositories.users)),
  customers: withPaginationLimit(createCustomersService(repositories.customers)),
  warehouses: withPaginationLimit(createWarehousesService(repositories.warehouses)),
  products: withPaginationLimit(createProductsService(repositories.products)),
  inventoryItems: withPaginationLimit(createInventoryItemsService(repositories.inventoryItems)),
  orders: withPaginationLimit(createOrdersService(repositories.orders)),
  orderItems: withPaginationLimit(createOrderItemsService(repositories.orderItems)),
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
  users: ReturnType<typeof createUsersService>;
  customers: ReturnType<typeof createCustomersService>;
  warehouses: ReturnType<typeof createWarehousesService>;
  products: ReturnType<typeof createProductsService>;
  inventoryItems: ReturnType<typeof createInventoryItemsService>;
  orders: ReturnType<typeof createOrdersService>;
  orderItems: ReturnType<typeof createOrderItemsService>;
}) {
  return {
  usersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["role"] as string[]).includes(field) ? services.users.distribution(field, context.scopeFor("users")) : Promise.reject(new Error("Unsupported distribution field")),
  usersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.users.trend(field, days, context.scopeFor("users")) : Promise.reject(new Error("Invalid trend query")),
  users: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","email","displayName","passwordHash","externalSubject","role"] as string[];
    const filterableFields = ["id","email","displayName","passwordHash","externalSubject","role"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.users.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("users"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  usersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.one(id, context.scopeFor("users")),
  createUsers: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.create(input, context.actorId, context.scopeFor("users")),
  updateUsers: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.update(id, input, context.actorId, context.scopeFor("users")),
  deleteUsers: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.delete(id, context.actorId, context.scopeFor("users")),
  deleteUsersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.deleteMany(ids, context.actorId, context.scopeFor("users")),
  customersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.customers.distribution(field, context.scopeFor("customers")) : Promise.reject(new Error("Unsupported distribution field")),
  customersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.customers.trend(field, days, context.scopeFor("customers")) : Promise.reject(new Error("Invalid trend query")),
  customers: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","name","email","creditLimit"] as string[];
    const filterableFields = ["id","name","email","creditLimit"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.customers.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("customers"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  customersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.one(id, context.scopeFor("customers")),
  createCustomers: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.create(input, context.actorId, context.scopeFor("customers")),
  updateCustomers: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.update(id, input, context.actorId, context.scopeFor("customers")),
  deleteCustomers: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.delete(id, context.actorId, context.scopeFor("customers")),
  deleteCustomersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.deleteMany(ids, context.actorId, context.scopeFor("customers")),
  warehousesDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.warehouses.distribution(field, context.scopeFor("warehouses")) : Promise.reject(new Error("Unsupported distribution field")),
  warehousesTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.warehouses.trend(field, days, context.scopeFor("warehouses")) : Promise.reject(new Error("Invalid trend query")),
  warehouses: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","code","name","capacity"] as string[];
    const filterableFields = ["id","code","name","capacity"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.warehouses.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("warehouses"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  warehousesById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.one(id, context.scopeFor("warehouses")),
  createWarehouses: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.create(input, context.actorId, context.scopeFor("warehouses")),
  updateWarehouses: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.update(id, input, context.actorId, context.scopeFor("warehouses")),
  deleteWarehouses: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.delete(id, context.actorId, context.scopeFor("warehouses")),
  deleteWarehousesMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.deleteMany(ids, context.actorId, context.scopeFor("warehouses")),
  productsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.products.distribution(field, context.scopeFor("products")) : Promise.reject(new Error("Unsupported distribution field")),
  productsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.products.trend(field, days, context.scopeFor("products")) : Promise.reject(new Error("Invalid trend query")),
  products: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","sku","name","unitPrice","reorderPoint","datasheet"] as string[];
    const filterableFields = ["id","sku","name","unitPrice","reorderPoint","datasheet"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
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
  inventoryItemsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.inventoryItems.distribution(field, context.scopeFor("inventoryItems")) : Promise.reject(new Error("Unsupported distribution field")),
  inventoryItemsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.inventoryItems.trend(field, days, context.scopeFor("inventoryItems")) : Promise.reject(new Error("Invalid trend query")),
  inventoryItems: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","warehouseId","productId","quantity","reservedQuantity"] as string[];
    const filterableFields = ["id","warehouseId","productId","quantity","reservedQuantity"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.inventoryItems.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("inventoryItems"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  inventoryItemsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventoryItems.one(id, context.scopeFor("inventoryItems")),
  createInventoryItems: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventoryItems.create(input, context.actorId, context.scopeFor("inventoryItems")),
  updateInventoryItems: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventoryItems.update(id, input, context.actorId, context.scopeFor("inventoryItems")),
  deleteInventoryItems: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventoryItems.delete(id, context.actorId, context.scopeFor("inventoryItems")),
  deleteInventoryItemsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventoryItems.deleteMany(ids, context.actorId, context.scopeFor("inventoryItems")),
  ordersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["status"] as string[]).includes(field) ? services.orders.distribution(field, context.scopeFor("orders")) : Promise.reject(new Error("Unsupported distribution field")),
  ordersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["createdAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.orders.trend(field, days, context.scopeFor("orders")) : Promise.reject(new Error("Invalid trend query")),
  orders: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","orderNumber","customerId","totalAmount","approvedBy","createdAt"] as string[];
    const filterableFields = ["id","orderNumber","customerId","status","totalAmount","createdAt"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.orders.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("orders"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  ordersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orders.one(id, context.scopeFor("orders")),
  createOrders: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orders.create(input, context.actorId, context.scopeFor("orders")),
  updateOrders: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orders.update(id, input, context.actorId, context.scopeFor("orders")),
  deleteOrders: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orders.delete(id, context.actorId, context.scopeFor("orders")),
  deleteOrdersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orders.deleteMany(ids, context.actorId, context.scopeFor("orders")),
  orderItemsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.orderItems.distribution(field, context.scopeFor("orderItems")) : Promise.reject(new Error("Unsupported distribution field")),
  orderItemsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.orderItems.trend(field, days, context.scopeFor("orderItems")) : Promise.reject(new Error("Invalid trend query")),
  orderItems: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","orderId","productId","quantity","unitPrice"] as string[];
    const filterableFields = ["id","orderId","productId","quantity","unitPrice"] as string[];
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    const result = await services.orderItems.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: Object.fromEntries((args.filters ?? []).map((filter) => [filter.field, filter.value])), scope: context.scopeFor("orderItems"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  orderItemsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orderItems.one(id, context.scopeFor("orderItems")),
  createOrderItems: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orderItems.create(input, context.actorId, context.scopeFor("orderItems")),
  updateOrderItems: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orderItems.update(id, input, context.actorId, context.scopeFor("orderItems")),
  deleteOrderItems: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orderItems.delete(id, context.actorId, context.scopeFor("orderItems")),
  deleteOrderItemsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orderItems.deleteMany(ids, context.actorId, context.scopeFor("orderItems")),
  };
}

export function createGraphQLResolvers(repositories: Repositories) {
  const services = {
  users: withPaginationLimit(createUsersService(repositories.users)),
  customers: withPaginationLimit(createCustomersService(repositories.customers)),
  warehouses: withPaginationLimit(createWarehousesService(repositories.warehouses)),
  products: withPaginationLimit(createProductsService(repositories.products)),
  inventoryItems: withPaginationLimit(createInventoryItemsService(repositories.inventoryItems)),
  orders: withPaginationLimit(createOrdersService(repositories.orders)),
  orderItems: withPaginationLimit(createOrderItemsService(repositories.orderItems)),
  };
  return resolvers(services);
}

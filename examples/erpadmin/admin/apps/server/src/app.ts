import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 import { UsersRoutes } from "./modules/users/users.routes";
import { CustomersRoutes } from "./modules/customers/customers.routes";
import { WarehousesRoutes } from "./modules/warehouses/warehouses.routes";
import { ProductsRoutes } from "./modules/products/products.routes";
import { InventoryItemsRoutes } from "./modules/inventoryItems/inventoryItems.routes";
import { OrdersRoutes } from "./modules/orders/orders.routes";
import { OrderItemsRoutes } from "./modules/orderItems/orderItems.routes";

export interface Repositories {
  users: import("./modules/users/users.contract").UsersRepository;
  customers: import("./modules/customers/customers.contract").CustomersRepository;
  warehouses: import("./modules/warehouses/warehouses.contract").WarehousesRepository;
  products: import("./modules/products/products.contract").ProductsRepository;
  inventoryItems: import("./modules/inventoryItems/inventoryItems.contract").InventoryItemsRepository;
  orders: import("./modules/orders/orders.contract").OrdersRepository;
  orderItems: import("./modules/orderItems/orderItems.contract").OrderItemsRepository;
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

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeWorkflows = true, includeStorage = true, corsOrigins?: string[]) {
   const configuredOrigins = [] as string[];
   const environmentOrigins = Bun.env.QIY_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
   const allowedOrigins = normalizeCorsOrigins(corsOrigins ?? (environmentOrigins.length > 0 ? environmentOrigins : configuredOrigins));
   const guard = createAuthorizationGuard(authenticate, [{"path":"users","query":"users"},{"path":"customers","query":"customers"},{"path":"warehouses","query":"warehouses"},{"path":"products","query":"products"},{"path":"inventory_items","query":"inventoryItems"},{"path":"orders","query":"orders"},{"path":"order_items","query":"orderItems"},{"path":"files","query":"files"}]);
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => authenticate(request))
     .use(UsersRoutes(repositories.users, authenticate))
    .use(CustomersRoutes(repositories.customers, authenticate))
    .use(WarehousesRoutes(repositories.warehouses, authenticate))
    .use(ProductsRoutes(repositories.products, authenticate))
    .use(InventoryItemsRoutes(repositories.inventoryItems, authenticate))
    .use(OrdersRoutes(repositories.orders, authenticate))
    .use(OrderItemsRoutes(repositories.orderItems, authenticate));
    const workflow = includeWorkflows ? (await import("./workflows/order")).createOrderWorkflowRoutes(authenticate) : undefined;
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
    const localAuth = (await import("./auth/local")).createLocalAuthRoutes();
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticate));
    let composed = application;
    composed = composed.use(localAuth);
    composed = workflow ? composed.use(workflow) : composed;
    composed = storage ? composed.use(storage) : composed;
    return registerPlugins(composed, { repositories, authenticate });
}

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

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeStorage = true, corsOrigins?: string[], includeDataflows = true) {
   // API-key requests are resolved after the configured session authenticator has
   // had a chance to accept the request, so key auth is additive and never weakens
   // the project's existing authentication.
   const authenticateRequest = authenticate;
   const configuredOrigins = [] as string[];
   const environmentOrigins = Bun.env.QIY_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
   const allowedOrigins = normalizeCorsOrigins(corsOrigins ?? (environmentOrigins.length > 0 ? environmentOrigins : configuredOrigins));
   const guard = createAuthorizationGuard(authenticateRequest, [{"path":"users","query":"users"},{"path":"customers","query":"customers"},{"path":"warehouses","query":"warehouses"},{"path":"products","query":"products"},{"path":"inventory_items","query":"inventoryItems"},{"path":"orders","query":"orders"},{"path":"order_items","query":"orderItems"},{"path":"files","query":"files"},{"path":"commands","query":"commands","mutations":["runOrderLifecycleSubmit","runOrderLifecycleApprove","runOrderLifecycleShip","runOrderLifecycleCancel"]}], {}, [], ["commands"]);
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => {
      const principal = await authenticateRequest(request);
      if (!principal) return null;
    })
     .use(UsersRoutes(repositories.users, authenticateRequest))
    .use(CustomersRoutes(repositories.customers, authenticateRequest))
    .use(WarehousesRoutes(repositories.warehouses, authenticateRequest))
    .use(ProductsRoutes(repositories.products, authenticateRequest))
    .use(InventoryItemsRoutes(repositories.inventoryItems, authenticateRequest))
    .use(OrdersRoutes(repositories.orders, authenticateRequest))
    .use(OrderItemsRoutes(repositories.orderItems, authenticateRequest));
    const dataflows = includeDataflows ? (await import("./dataflows")).createDataflowRoutes(authenticateRequest) : undefined;
    
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticateRequest) : undefined;
    
    const authRoutes = (await import("./auth/local")).createLocalAuthRoutes();
    const accountRoutes = (await import("./auth/account")).createAccountRoutes(authenticateRequest);
    
    
    
    
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticateRequest));
    let composed = application;
    composed = composed.use(authRoutes);
    composed = composed.use(accountRoutes);
    
    
    
    
    composed = dataflows ? composed.use(dataflows) : composed;
    
    composed = storage ? composed.use(storage) : composed;
    composed = composed.use((await import("./saved-views")).createSavedViewsRoutes(authenticateRequest));
    composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticateRequest));
    return registerPlugins(composed, { repositories, authenticate: authenticateRequest });
}

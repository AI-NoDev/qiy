import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 import { createRealtimeRoutes } from "./realtime";
 import { UsersRoutes } from "./modules/users/users.routes";
import { OrgsRoutes } from "./modules/orgs/orgs.routes";
import { SuppliersRoutes } from "./modules/suppliers/suppliers.routes";
import { CustomersRoutes } from "./modules/customers/customers.routes";
import { ProductsRoutes } from "./modules/products/products.routes";
import { BomsRoutes } from "./modules/boms/boms.routes";
import { WarehousesRoutes } from "./modules/warehouses/warehouses.routes";
import { BinsRoutes } from "./modules/bins/bins.routes";
import { InventoryRoutes } from "./modules/inventory/inventory.routes";
import { Stock_movementsRoutes } from "./modules/stock_movements/stock_movements.routes";
import { Purchase_ordersRoutes } from "./modules/purchase_orders/purchase_orders.routes";
import { Purchase_order_linesRoutes } from "./modules/purchase_order_lines/purchase_order_lines.routes";
import { ReceiptsRoutes } from "./modules/receipts/receipts.routes";
import { Sales_ordersRoutes } from "./modules/sales_orders/sales_orders.routes";
import { Sales_order_linesRoutes } from "./modules/sales_order_lines/sales_order_lines.routes";
import { ShipmentsRoutes } from "./modules/shipments/shipments.routes";
import { Work_ordersRoutes } from "./modules/work_orders/work_orders.routes";

export interface Repositories {
  users: import("./modules/users/users.contract").UsersRepository;
  orgs: import("./modules/orgs/orgs.contract").OrgsRepository;
  suppliers: import("./modules/suppliers/suppliers.contract").SuppliersRepository;
  customers: import("./modules/customers/customers.contract").CustomersRepository;
  products: import("./modules/products/products.contract").ProductsRepository;
  boms: import("./modules/boms/boms.contract").BomsRepository;
  warehouses: import("./modules/warehouses/warehouses.contract").WarehousesRepository;
  bins: import("./modules/bins/bins.contract").BinsRepository;
  inventory: import("./modules/inventory/inventory.contract").InventoryRepository;
  stock_movements: import("./modules/stock_movements/stock_movements.contract").Stock_movementsRepository;
  purchase_orders: import("./modules/purchase_orders/purchase_orders.contract").Purchase_ordersRepository;
  purchase_order_lines: import("./modules/purchase_order_lines/purchase_order_lines.contract").Purchase_order_linesRepository;
  receipts: import("./modules/receipts/receipts.contract").ReceiptsRepository;
  sales_orders: import("./modules/sales_orders/sales_orders.contract").Sales_ordersRepository;
  sales_order_lines: import("./modules/sales_order_lines/sales_order_lines.contract").Sales_order_linesRepository;
  shipments: import("./modules/shipments/shipments.contract").ShipmentsRepository;
  work_orders: import("./modules/work_orders/work_orders.contract").Work_ordersRepository;
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
   const configuredOrigins = [] as string[];
   const environmentOrigins = Bun.env.QIY_CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
   const allowedOrigins = normalizeCorsOrigins(corsOrigins ?? (environmentOrigins.length > 0 ? environmentOrigins : configuredOrigins));
   const guard = createAuthorizationGuard(authenticate, [{"path":"users","query":"users"},{"path":"orgs","query":"orgs"},{"path":"suppliers","query":"suppliers"},{"path":"customers","query":"customers"},{"path":"products","query":"products"},{"path":"boms","query":"boms"},{"path":"warehouses","query":"warehouses"},{"path":"bins","query":"bins"},{"path":"inventory","query":"inventory"},{"path":"stock_movements","query":"stock_movements"},{"path":"purchase_orders","query":"purchase_orders"},{"path":"purchase_order_lines","query":"purchase_order_lines"},{"path":"receipts","query":"receipts"},{"path":"sales_orders","query":"sales_orders"},{"path":"sales_order_lines","query":"sales_order_lines"},{"path":"shipments","query":"shipments"},{"path":"work_orders","query":"work_orders"},{"path":"files","query":"files"},{"path":"commands","query":"commands","mutations":["runReceiveInventory","runPutawayStock","runReserveStock","runAdjustStock","runShipSalesOrder","runTransferInventory","runCompleteWorkOrder"]}], {"inventory":{"list":["admin","operator"],"show":["admin","operator"],"create":["admin","operator"],"edit":["admin","operator"],"delete":["admin"]},"stock_movements":{"list":["admin","operator"],"show":["admin","operator"],"create":["admin","operator"],"edit":["admin"],"delete":["admin"]},"purchase_orders":{"list":["admin","operator"],"show":["admin","operator"],"create":["admin","operator"],"edit":["admin","operator"],"delete":["admin"]},"sales_orders":{"list":["admin","operator"],"show":["admin","operator"],"create":["admin","operator"],"edit":["admin","operator"],"delete":["admin"]}}, ["/api/v1/auth/providers"]);
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => authenticate(request))
     .use(UsersRoutes(repositories.users, authenticate))
    .use(OrgsRoutes(repositories.orgs, authenticate))
    .use(SuppliersRoutes(repositories.suppliers, authenticate))
    .use(CustomersRoutes(repositories.customers, authenticate))
    .use(ProductsRoutes(repositories.products, authenticate))
    .use(BomsRoutes(repositories.boms, authenticate))
    .use(WarehousesRoutes(repositories.warehouses, authenticate))
    .use(BinsRoutes(repositories.bins, authenticate))
    .use(InventoryRoutes(repositories.inventory, authenticate))
    .use(Stock_movementsRoutes(repositories.stock_movements, authenticate))
    .use(Purchase_ordersRoutes(repositories.purchase_orders, authenticate))
    .use(Purchase_order_linesRoutes(repositories.purchase_order_lines, authenticate))
    .use(ReceiptsRoutes(repositories.receipts, authenticate))
    .use(Sales_ordersRoutes(repositories.sales_orders, authenticate))
    .use(Sales_order_linesRoutes(repositories.sales_order_lines, authenticate))
    .use(ShipmentsRoutes(repositories.shipments, authenticate))
    .use(Work_ordersRoutes(repositories.work_orders, authenticate));
 
    const dataflows = includeDataflows ? (await import("./dataflows")).createDataflowRoutes(authenticate) : undefined;
    const realtime = createRealtimeRoutes(authenticate);
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
    
    const authProviderRoutes = (await import("./auth/oidc")).createAuthProviderRoutes();
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticate));
    let composed = application;
    
    composed = composed.use(authProviderRoutes);
    
    composed = dataflows ? composed.use(dataflows) : composed;
    composed = composed.use(realtime);
    composed = storage ? composed.use(storage) : composed;
    composed = composed.use((await import("./saved-views")).createSavedViewsRoutes(authenticate));
    composed = composed.use((await import("./audit/routes")).createAuditRoutes(authenticate));
    return registerPlugins(composed, { repositories, authenticate });
}

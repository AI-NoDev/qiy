import { Elysia } from "elysia";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 import { ProductsRoutes } from "./modules/products/products.routes";

export interface Repositories {
  products: import("./modules/products/products.contract").ProductsRepository;
}

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeWorkflows = true, includeStorage = true) {
   const guard = createAuthorizationGuard(authenticate, [{"path":"products","query":"products"},{"path":"files","query":"files"}]);
   const routes = (new Elysia({ prefix: "/api/v1" }) as any)
     .get("/health", () => ({ ok: true }))
     .get("/auth/me", async ({ request }: { request: Request }) => authenticate(request))
     .use(ProductsRoutes(repositories.products, authenticate));
 
   const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
   const application = new Elysia().onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticate));
   return registerPlugins(storage ? application.use(storage) : application);
}

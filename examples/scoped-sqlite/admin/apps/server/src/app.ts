import { Elysia } from "elysia";
 import { openapi } from "@elysiajs/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 import { RecordsRoutes } from "./modules/records/records.routes";

export interface Repositories {
  records: import("./modules/records/records.contract").RecordsRepository;
}

export async function createApp(repositories: Repositories, authenticate: Authenticator = async () => null, includeWorkflows = true, includeStorage = true) {
   const guard = createAuthorizationGuard(authenticate, [{"path":"records","query":"records"},{"path":"files","query":"files"}]);
   const routes = (new Elysia({ prefix: "/api/v1" }) as any)
     .get("/health", () => ({ ok: true }))
     .get("/auth/me", async ({ request }: { request: Request }) => authenticate(request))
     .use(RecordsRoutes(repositories.records, authenticate));
 
   const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticate) : undefined;
   const application = new Elysia().onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticate));
   return registerPlugins(storage ? application.use(storage) : application);
}

import { Elysia } from "elysia";
 import { cors } from "@elysia/cors";
 import { openapi } from "@elysia/openapi";
 import { registerPlugins } from "./plugins";
 import { createGraphQLRoutes } from "./graphql";
 import { createAuthorizationGuard, type Authenticator } from "./auth/guard";
 
 
 
 import { RecordsRoutes } from "./modules/records/records.routes";

export interface Repositories {
  records: import("./modules/records/records.contract").RecordsRepository;
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
   const guard = createAuthorizationGuard(authenticateRequest, [{"path":"records","query":"records"},{"path":"files","query":"files"}], {}, [], []);
  const routes = (new Elysia({ prefix: "/api/v1" }) as any)
    .get("/health", () => ({ ok: true }))
    .get("/auth/me", async ({ request }: { request: Request }) => {
      const principal = await authenticateRequest(request);
      if (!principal) return null;
    })
     .use(RecordsRoutes(repositories.records, authenticateRequest));
 
    
    const storage = includeStorage ? (await import("./storage/routes")).createStorageRoutes(authenticateRequest) : undefined;
    
    
    
    
    
    
    
    const application = new Elysia().use(allowedOrigins.length > 0 ? cors({ origin: allowedOrigins, credentials: false, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key"] }) : new Elysia()).onRequest(({ request }) => guard(request)).use(openapi({ path: "/api/v1/openapi", documentation: { info: { title: "Qiy Admin API", version: "1.0.0" } } })).use(routes).use(createGraphQLRoutes(repositories, authenticateRequest));
    let composed = application;
    
    
    
    
    
    
    
    
    composed = storage ? composed.use(storage) : composed;
    composed = composed.use((await import("./saved-views")).createSavedViewsRoutes(authenticateRequest));
    
    return registerPlugins(composed, { repositories, authenticate: authenticateRequest });
}

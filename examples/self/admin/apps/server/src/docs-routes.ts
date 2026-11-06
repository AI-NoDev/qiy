import { Elysia } from "elysia";
import type { Authenticator, Principal } from "./auth/guard";
import { buildDocsModel, buildOpenApiDocument, type DocsPrincipal, type DocsRole } from "./docs";
import { QIY_DEFAULT_ROLE, isQiyRole } from "./auth/roles";
import { loadPermissions } from "./auth/permissions";

function asRole(value: unknown): DocsRole { return isQiyRole(value) ? value : QIY_DEFAULT_ROLE; }

async function docsPrincipal(principal: Principal): Promise<DocsPrincipal> {
  const snapshot = await loadPermissions(principal);
  return { role: asRole(principal.role), permissions: snapshot.permissions };
}

export function createDocsRoutes(authenticate: Authenticator): Elysia {
  const routes = new Elysia({ prefix: "/api/v1" });
  // Each GET route refines the Elysia route generics; cast back to the base type
  // so the composed app can be mounted with other plugins without type conflicts.
  let mounted = routes as unknown as Elysia;
  mounted = mounted.get("/openapi.json", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildOpenApiDocument(await docsPrincipal(principal));
    }) as unknown as Elysia;
  mounted = mounted.get("/docs/model", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildDocsModel(await docsPrincipal(principal));
    }) as unknown as Elysia;
  return mounted;
}

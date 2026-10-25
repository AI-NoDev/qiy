import { Elysia } from "elysia";
import type { Authenticator, Principal } from "./auth/guard";
import { buildDocsModel, buildOpenApiDocument, type DocsPrincipal, type DocsRole } from "./docs";
import { loadPermissions } from "./auth/permissions";

const ROLES = ["admin", "operator", "viewer"] as const;
function asRole(value: unknown): DocsRole { return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? value as DocsRole : "viewer"; }

async function docsPrincipal(principal: Principal): Promise<DocsPrincipal> {
  const snapshot = await loadPermissions(principal);
  return { role: asRole(principal.role), permissions: snapshot.permissions };
}

export function createDocsRoutes(authenticate: Authenticator) {
  const routes = new Elysia({ prefix: "/api/v1" });
  let mounted: typeof routes = routes;
  mounted = mounted.get("/openapi.json", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildOpenApiDocument(await docsPrincipal(principal));
    });
  mounted = mounted.get("/docs/model", async ({ request, set }) => {
      const principal = await authenticate(request);
      if (!principal) { set.status = 401; return { error: "Authentication required" }; }
      set.headers["cache-control"] = "no-store";
      return buildDocsModel(await docsPrincipal(principal));
    });
  return mounted;
}

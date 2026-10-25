import { getOperationAST, parse, type DocumentNode, type FieldNode, type FragmentDefinitionNode, type SelectionSetNode } from "graphql";

export interface Principal {
  id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  /**
   * Verified id_token claims. Scalar claims keep their JSON type; string arrays
   * are preserved because identity providers commonly emit roles/groups as an
   * array (permission claim sources accept arrays and separated strings).
   */
  claims?: Record<string, string | number | boolean | null | string[]>;
}

export type Authenticator = (request: Request) => Promise<Principal | null>;
export interface ProtectedResource { path: string; query: string; mutations?: string[]; }
/** Page-level rules: resource -> action -> allowed roles. Absent actions are unrestricted. */
export type PageRules = Record<string, Record<string, Principal["role"][]>>;

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Maps a REST request onto the page action its rule guards. Segments exclude /api/v1. */
function restAction(method: string, segments: string[]): string {
  const tail = segments[segments.length - 1] ?? "";
  // Export reads follow list; import writes follow create, including their job endpoints.
  if (segments.includes("export")) return "list";
  if (segments.includes("import")) return method === "GET" ? "list" : "create";
  if (tail === "export") return "list";
  if (tail === "import") return "create";
  const hasId = segments.length >= 2;
  if (method === "GET") return hasId ? "show" : "list";
  if (method === "POST") return "create";
  if (method === "PATCH" || method === "PUT") return "edit";
  if (method === "DELETE") return "delete";
  return "";
}

/** Maps a GraphQL root field onto the page action its rule guards. */
function graphqlAction(field: string, resource: string): string {
  if (field === resource) return "list";
  if (field === resource + "ById") return "show";
  if (field === resource + "Aggregate" || field === resource + "Distribution" || field === resource + "Trend") return "list";
  if (field.startsWith("create")) return "create";
  if (field.startsWith("update")) return "edit";
  if (field.startsWith("delete")) return "delete";
  return "";
}

function rootFields(document: DocumentNode, selection: SelectionSetNode, seen = new Set<string>()): FieldNode[] {
  const fragments = new Map(document.definitions.filter((definition): definition is FragmentDefinitionNode => definition.kind === "FragmentDefinition").map((fragment) => [fragment.name.value, fragment]));
  const fields: FieldNode[] = [];
  for (const item of selection.selections) {
    if (item.kind === "Field") fields.push(item);
    else if (item.kind === "InlineFragment") fields.push(...rootFields(document, item.selectionSet, seen));
    else if (!seen.has(item.name.value)) {
      seen.add(item.name.value);
      const fragment = fragments.get(item.name.value);
      if (fragment) fields.push(...rootFields(document, fragment.selectionSet, seen));
    }
  }
  return fields;
}

function mayAccess(role: Principal["role"], resource: ProtectedResource, method: string): boolean {
  if (role === "admin") return true;
  if (resource.path === "users") return false;
  return role === "operator" || (role === "viewer" && method === "GET");
}

export function createAuthorizationGuard(authenticate: Authenticator, resources: ProtectedResource[], pages: PageRules = {}, publicPaths: string[] = [], roleGuardExemptPaths: string[] = []) {
  const byPath = new Map(resources.map((resource) => [resource.path, resource]));
  const mayUsePage = (role: Principal["role"], resource: string, action: string): boolean => {
    const rules = pages[resource];
    if (!rules || !action) return true;
    const roles = rules[action];
    return !roles || roles.includes(role);
  };
  const queryActions = new Map<string, { resource: ProtectedResource; method: string }>();
  for (const resource of resources) {
    const name = resource.query[0]!.toUpperCase() + resource.query.slice(1);
    for (const field of [resource.query, resource.query + "ById", resource.query + "Distribution", resource.query + "Trend", resource.query + "Aggregate"]) queryActions.set(field, { resource, method: "GET" });
    for (const action of ["create" + name, "update" + name, "delete" + name, "delete" + name + "Many"]) {
      queryActions.set(action, { resource, method: "POST" });
    }
    for (const action of resource.mutations ?? []) queryActions.set(action, { resource, method: "POST" });
  }

  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    // The Elysia OpenAPI plugin endpoints stay public; the Qiy-generated
    // permission-filtered /api/v1/openapi.json is authenticated explicitly.
    if (path === "/api/v1/health" || path === "/api/v1/openapi" || path.startsWith("/api/v1/openapi/")) return;
    if (publicPaths.some((publicPath) => path === publicPath || path.startsWith(publicPath + "/"))) return;
    if (path === "/api/v1/auth/login") return;
    if (!path.startsWith("/api/v1/") && path !== "/graphql" && path !== "/graphql/") return;
    let principal: Principal | null;
    try { principal = await authenticate(request); }
    catch { return error(401, "Invalid credentials"); }
    if (!principal) return error(401, "Authentication required");
    if (path === "/api/v1/auth/me") return;
    if (path === "/graphql" || path === "/graphql/") {
      if (request.method !== "POST") return error(405, "Method not allowed");
      try {
        const body = await request.clone().json() as { query?: string; operationName?: string };
        if (typeof body.query !== "string") return error(400, "Invalid GraphQL request");
        const document = parse(body.query);
        const operation = getOperationAST(document, body.operationName);
        if (!operation || operation.operation === "subscription") return error(400, "Unsupported GraphQL operation");
        for (const field of rootFields(document, operation.selectionSet)) {
          if (field.name.value.startsWith("__") && operation.operation === "query") continue;
          const action = queryActions.get(field.name.value);
          if (!action || (operation.operation === "mutation") !== (action.method === "POST")) return error(403, "GraphQL field is not authorized");
          // Command mutations enforce their own role/permission/verification rules
          // inside the command route, so the generic role guard must not pre-deny a
          // principal that holds the required permission.
          if (roleGuardExemptPaths.includes(action.resource.path)) continue;
          if (!mayAccess(principal.role, action.resource, action.method)) return error(403, "Permission denied");
          if (!mayUsePage(principal.role, action.resource.path, graphqlAction(field.name.value, action.resource.query))) return error(403, "Page access denied");
        }
      } catch { return error(400, "Invalid GraphQL request"); }
      return;
    }
    const resource = byPath.get(path.split("/")[3] ?? "");
    if (!resource) return;
    // Dataflow commands enforce their declared allow rules in the command route.
    if (roleGuardExemptPaths.includes(resource.path)) return;
    if (!mayAccess(principal.role, resource, request.method)) return error(403, "Permission denied");
    const segments = path.split("/").slice(3).filter(Boolean);
    if (!mayUsePage(principal.role, resource.path, restAction(request.method, segments))) return error(403, "Page access denied");
  };
}

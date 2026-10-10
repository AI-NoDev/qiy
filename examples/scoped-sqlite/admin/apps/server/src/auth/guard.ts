import { getOperationAST, parse, type DocumentNode, type FieldNode, type FragmentDefinitionNode, type SelectionSetNode } from "graphql";

export interface Principal {
  id: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  claims?: Record<string, string | number | boolean | null>;
}

export type Authenticator = (request: Request) => Promise<Principal | null>;
export interface ProtectedResource { path: string; query: string; }

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
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

export function createAuthorizationGuard(authenticate: Authenticator, resources: ProtectedResource[]) {
  const byPath = new Map(resources.map((resource) => [resource.path, resource]));
  const queryActions = new Map<string, { resource: ProtectedResource; method: string }>();
  for (const resource of resources) {
    const name = resource.query[0]!.toUpperCase() + resource.query.slice(1);
    for (const field of [resource.query, resource.query + "ById", resource.query + "Distribution", resource.query + "Trend"]) queryActions.set(field, { resource, method: "GET" });
    for (const action of ["create" + name, "update" + name, "delete" + name, "delete" + name + "Many"]) {
      queryActions.set(action, { resource, method: "POST" });
    }
  }

  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/health" || path.startsWith("/api/v1/openapi")) return;
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
          if (!mayAccess(principal.role, action.resource, action.method)) return error(403, "Permission denied");
        }
      } catch { return error(400, "Invalid GraphQL request"); }
      return;
    }
    const resource = byPath.get(path.split("/")[3] ?? "");
    if (!resource) return;
    if (!mayAccess(principal.role, resource, request.method)) return error(403, "Permission denied");
  };
}

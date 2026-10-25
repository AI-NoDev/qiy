import type { AccessControlProvider, AuthProvider } from "@refinedev/core";
import { beginProviderLogin, clearSession, fetchAuthProviders } from "./auth/oidc-multi";

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string; permissions?: string[]; groups?: string[] };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
/** With OIDC the stored expiry decides validity so an expired token never looks authenticated. */
const sessionUsable = () => typeof window === "undefined" ? false : Boolean(token());
/**
 * Identity lookups are shared for the lifetime of an access token. Refine calls
 * getIdentity and the access-control can hook many times per navigation; without
 * this cache every call issued another GET /api/v1/auth/me. Concurrent callers share
 * one in-flight request and the successful result is reused for a minute.
 */
const identityCacheTtlMs = 60_000;
let identityCache: { token: string; value: QiyIdentity | null; at: number } | undefined;
let identityInflight: { token: string; promise: Promise<QiyIdentity | null> } | undefined;
export function clearIdentityCache(): void { identityCache = undefined; identityInflight = undefined; }
async function loadIdentity(): Promise<QiyIdentity | null> {
  const accessToken = token();
  if (!accessToken) return null;
  if (identityCache && identityCache.token === accessToken && Date.now() - identityCache.at < identityCacheTtlMs) return identityCache.value;
  if (identityInflight && identityInflight.token === accessToken) return identityInflight.promise;
  const promise = (async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + accessToken } });
      if (!response.ok) return null;
      return await response.json() as QiyIdentity;
    } catch { return null; }
  })().then((value) => {
    identityCache = { token: accessToken, value, at: Date.now() };
    return value;
  }).finally(() => { if (identityInflight?.token === accessToken) identityInflight = undefined; });
  identityInflight = { token: accessToken, promise };
  return promise;
}
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, email, password, identifier, challengeToken, code, providerName }: { token?: string; username?: string; email?: string; password?: string; identifier?: string; challengeToken?: string; code?: string; providerName?: string }) => {
    const loginName = username ?? email;
    if (providerName) {
      const providers = await fetchAuthProviders();
      const selected = providers.find((candidate) => candidate.id === providerName);
      if (!selected) return { success: false, error: { name: "ProviderUnavailable", message: "That identity provider is not configured on the server" } };
      await beginProviderLogin(selected);
      return { success: true };
    }
    
    if (loginName && password) {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginName, password }) });
      if (!response.ok) return { success: false, error: { name: "LoginFailed", message: (await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Invalid username or password" } };
      const result = await response.json() as { accessToken?: string };
      if (!result.accessToken) return { success: false, error: { name: "LoginFailed", message: "Login response did not contain an access token" } };
      window.localStorage.setItem(tokenKey, result.accessToken);
      return { success: true, redirectTo: "/" };
    }
    
    void nextToken;
    return { success: false, error: { name: "CredentialsRequired", message: "Username and password are required" } };
  },
  logout: async () => { clearIdentityCache(); clearSession();  return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => loadIdentity(),
  getPermissions: async () => { const identity = await loadIdentity(); return identity?.role ?? null; },
  onError: async (error) => { clearIdentityCache(); return error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {}; },
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } }> = [{"resource":"inventory","action":"receiveInventory","roles":["admin","operator"],"permissions":["inventory:receive"]},{"resource":"inventory","action":"putawayStock","roles":["admin","operator"],"permissions":["inventory:putaway"]},{"resource":"inventory","action":"reserveStock","roles":["admin","operator"]},{"resource":"inventory","action":"adjustStock","roles":["admin","operator"],"permissions":["inventory:adjust"]},{"resource":"inventory","action":"transferInventory","roles":["admin","operator"],"permissions":["inventory:transfer"]},{"resource":"sales_orders","action":"shipSalesOrder","roles":["admin","operator"],"verification":{"name":"CanShipOrders","expression":{"kind":"or","children":[{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"admin"}},{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"operator"}}]}}},{"resource":"work_orders","action":"completeWorkOrder","roles":["admin","operator"],"permissions":["workorder:complete"]},{"resource":"purchase_orders","action":"approvePurchaseOrder","roles":["admin","operator"],"permissions":["purchasing:approve"]}];
const commandVerifications: Record<string, QiyPermissionExpression> = {"CanShipOrders":{"kind":"or","children":[{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"admin"}},{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"operator"}}]}};
type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };
type QiyCommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } };
function permissionOperandValues(operand: QiyPermissionOperand, identity: QiyIdentity): string[] {
  if (operand.kind === "self") {
    if (operand.set === "role") return [identity.role ?? ""];
    return [...(operand.set === "permissions" ? identity.permissions ?? [] : identity.groups ?? [])];
  }
  if (operand.kind === "literal") return [operand.value];
  return [];
}
function comparePermissionKeys(operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals", left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const difference = [...leftSet].filter((entry) => !rightSet.has(entry));
  if (operator === "all-in") return difference.length === 0;
  if (operator === "some-in") return [...leftSet].some((entry) => rightSet.has(entry));
  if (operator === "not-all-in") return difference.length > 0;
  if (operator === "not-some-in") return [...leftSet].every((entry) => !rightSet.has(entry));
  if (operator === "equals") return difference.length === 0 && rightSet.size === leftSet.size;
  return !(difference.length === 0 && rightSet.size === leftSet.size);
}
function evaluatePermissionExpression(expression: QiyPermissionExpression, identity: QiyIdentity): boolean {
  if (expression.kind === "comparison") return comparePermissionKeys(expression.operator, permissionOperandValues(expression.left, identity), permissionOperandValues(expression.right, identity));
  if (expression.kind === "not") return !evaluatePermissionExpression(expression.expression, identity);
  if (expression.kind === "and") return expression.children.every((child) => evaluatePermissionExpression(child, identity));
  return expression.children.some((child) => evaluatePermissionExpression(child, identity));
}
function evaluateCommandPermission(command: QiyCommandPolicy, identity: QiyIdentity): { can: boolean; reason: string } | undefined {
  if (command.verification) {
    const expression = commandVerifications[command.verification.name];
    if (expression) {
      const allowed = evaluatePermissionExpression(expression, identity);
      return allowed ? { can: true, reason: "Permission verification " + command.verification.name + " satisfied" } : { can: false, reason: "Permission verification " + command.verification.name + " denied this command" };
    }
  }
  if (command.permissions?.length) {
    if (!Array.isArray(identity.permissions)) return undefined;
    const missing = command.permissions.filter((permission) => !identity.permissions!.includes(permission));
    return missing.length ? { can: false, reason: "Missing permission: " + missing.join(", ") } : { can: true, reason: "Permission granted" };
  }
  return undefined;
}
const resourcePolicies: Array<{ resource: string; roles: string[] }> = [{"resource":"products","roles":["admin","operator"]}];
const pageRules: Array<{ resource: string; action: string; roles: string[] }> = [{"resource":"inventory","action":"list","roles":["admin","operator"]},{"resource":"inventory","action":"show","roles":["admin","operator"]},{"resource":"inventory","action":"create","roles":["admin","operator"]},{"resource":"inventory","action":"edit","roles":["admin","operator"]},{"resource":"inventory","action":"delete","roles":["admin"]},{"resource":"stock_movements","action":"list","roles":["admin","operator"]},{"resource":"stock_movements","action":"show","roles":["admin","operator"]},{"resource":"stock_movements","action":"create","roles":["admin","operator"]},{"resource":"stock_movements","action":"edit","roles":["admin"]},{"resource":"stock_movements","action":"delete","roles":["admin"]},{"resource":"purchase_orders","action":"list","roles":["admin","operator"]},{"resource":"purchase_orders","action":"show","roles":["admin","operator"]},{"resource":"purchase_orders","action":"create","roles":["admin","operator"]},{"resource":"purchase_orders","action":"edit","roles":["admin","operator"]},{"resource":"purchase_orders","action":"delete","roles":["admin"]},{"resource":"sales_orders","action":"list","roles":["admin","operator"]},{"resource":"sales_orders","action":"show","roles":["admin","operator"]},{"resource":"sales_orders","action":"create","roles":["admin","operator"]},{"resource":"sales_orders","action":"edit","roles":["admin","operator"]},{"resource":"sales_orders","action":"delete","roles":["admin"]}];
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; const resourcePolicy = resourcePolicies.find((policy) => policy.resource === resource); if (resourcePolicy && !resourcePolicy.roles.includes(identity.role ?? "")) return { can: false, reason: "Resource access is restricted" }; const pageRule = pageRules.find((rule) => rule.resource === resource && rule.action === action); if (pageRule) return pageRule.roles.includes(identity.role ?? "") ? { can: true, reason: "Page access is allowed" } : { can: false, reason: "Page access is restricted" }; const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) { const permissionVerdict = evaluateCommandPermission(command, identity); if (permissionVerdict) return permissionVerdict; return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; } if (action === "audit") return { can: identity.role === "admin" }; if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
/** Cached identity for non-hook callers (route modules must not use auth hooks). */
export async function fetchCurrentIdentity(): Promise<QiyIdentity | null> { return loadIdentity(); }

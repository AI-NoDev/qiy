import type { AccessControlProvider, AuthProvider } from "@refinedev/core";


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
  login: async ({ token: nextToken, username, email, password, identifier, challengeToken, code }: { token?: string; username?: string; email?: string; password?: string; identifier?: string; challengeToken?: string; code?: string }) => {
    const loginName = username ?? email;
    
    
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
  logout: async () => { clearIdentityCache(); window.localStorage.removeItem(tokenKey);  return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => loadIdentity(),
  getPermissions: async () => { const identity = await loadIdentity(); return identity?.role ?? null; },
  onError: async (error) => { clearIdentityCache(); return error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {}; },
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } }> = [{"resource":"orders","action":"orderLifecycleSubmit","roles":["admin","operator"]},{"resource":"orders","action":"orderLifecycleApprove","roles":["admin"]},{"resource":"orders","action":"orderLifecycleShip","roles":["admin","operator"]},{"resource":"orders","action":"orderLifecycleCancel","roles":["admin","operator"]}];
const commandVerifications: Record<string, QiyPermissionExpression> = {};
type QiyPermissionOperand = { kind: "self"; set: "permissions" | "groups" | "role" } | { kind: "input"; name: string } | { kind: "literal"; value: string };
type QiyPermissionExpression =
  | { kind: "comparison"; operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals"; left: QiyPermissionOperand; right: QiyPermissionOperand }
  | { kind: "and"; children: QiyPermissionExpression[] }
  | { kind: "or"; children: QiyPermissionExpression[] }
  | { kind: "not"; expression: QiyPermissionExpression };
type QiyCommandPolicy = { resource: string; action: string; roles: string[]; permissions?: string[]; verification?: { name: string; expression: QiyPermissionExpression } };
const roleAccess: Record<string, "full" | "write" | "read"> = {"admin":"full","operator":"write","viewer":"read"};
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; const access: string | undefined = roleAccess[identity.role ?? ""]; const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) { return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; } if (action === "audit") return { can: access === "full" }; if (access === "full") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = access === "write" || (access === "read" && (action === "list" || action === "show")); return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }
/** Cached identity for non-hook callers (route modules must not use auth hooks). */
export async function fetchCurrentIdentity(): Promise<QiyIdentity | null> { return loadIdentity(); }

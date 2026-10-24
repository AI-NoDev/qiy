import type { AccessControlProvider, AuthProvider } from "@refinedev/core";
import { beginProviderLogin, clearSession, fetchAuthProviders } from "./auth/oidc-multi";

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
/** With OIDC the stored expiry decides validity so an expired token never looks authenticated. */
const sessionUsable = () => typeof window === "undefined" ? false : Boolean(token());
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
  logout: async () => { clearSession();  return { success: true, redirectTo: "/auth/login" }; },
  check: async () => sessionUsable() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => { const accessToken = token(); if (!accessToken) return null; const response = await fetch("/api/v1/auth/me", { headers: { Authorization: "Bearer " + accessToken } }); if (!response.ok) return null; return await response.json() as QiyIdentity; },
  getPermissions: async () => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; return identity?.role ?? null; },
  onError: async (error) => error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {},
};
const commandPolicies: Array<{ resource: string; action: string; roles: string[] }> = [{"resource":"inventory","action":"receiveInventory","roles":["admin","operator"]},{"resource":"inventory","action":"putawayStock","roles":["admin","operator"]},{"resource":"inventory","action":"reserveStock","roles":["admin","operator"]},{"resource":"inventory","action":"adjustStock","roles":["admin","operator"]},{"resource":"inventory","action":"transferInventory","roles":["admin","operator"]},{"resource":"sales_orders","action":"shipSalesOrder","roles":["admin","operator"]},{"resource":"work_orders","action":"completeWorkOrder","roles":["admin","operator"]}];
const resourcePolicies: Array<{ resource: string; roles: string[] }> = [{"resource":"products","roles":["admin","operator"]}];
const pageRules: Array<{ resource: string; action: string; roles: string[] }> = [{"resource":"inventory","action":"list","roles":["admin","operator"]},{"resource":"inventory","action":"show","roles":["admin","operator"]},{"resource":"inventory","action":"create","roles":["admin","operator"]},{"resource":"inventory","action":"edit","roles":["admin","operator"]},{"resource":"inventory","action":"delete","roles":["admin"]},{"resource":"stock_movements","action":"list","roles":["admin","operator"]},{"resource":"stock_movements","action":"show","roles":["admin","operator"]},{"resource":"stock_movements","action":"create","roles":["admin","operator"]},{"resource":"stock_movements","action":"edit","roles":["admin"]},{"resource":"stock_movements","action":"delete","roles":["admin"]},{"resource":"purchase_orders","action":"list","roles":["admin","operator"]},{"resource":"purchase_orders","action":"show","roles":["admin","operator"]},{"resource":"purchase_orders","action":"create","roles":["admin","operator"]},{"resource":"purchase_orders","action":"edit","roles":["admin","operator"]},{"resource":"purchase_orders","action":"delete","roles":["admin"]},{"resource":"sales_orders","action":"list","roles":["admin","operator"]},{"resource":"sales_orders","action":"show","roles":["admin","operator"]},{"resource":"sales_orders","action":"create","roles":["admin","operator"]},{"resource":"sales_orders","action":"edit","roles":["admin","operator"]},{"resource":"sales_orders","action":"delete","roles":["admin"]}];
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; const resourcePolicy = resourcePolicies.find((policy) => policy.resource === resource); if (resourcePolicy && !resourcePolicy.roles.includes(identity.role ?? "")) return { can: false, reason: "Resource access is restricted" }; const pageRule = pageRules.find((rule) => rule.resource === resource && rule.action === action); if (pageRule) return pageRule.roles.includes(identity.role ?? "") ? { can: true, reason: "Page access is allowed" } : { can: false, reason: "Page access is restricted" }; const command = commandPolicies.find((policy) => policy.resource === resource && policy.action === action); if (command) return { can: command.roles.includes(identity.role ?? ""), reason: "Command execution is restricted" }; if (action === "audit") return { can: identity.role === "admin" }; if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }

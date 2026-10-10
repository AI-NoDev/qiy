import type { AccessControlProvider, AuthProvider } from "@refinedev/core";

const tokenKey = "qiy.access_token";
type QiyIdentity = { id?: string; name?: string; role?: string };
const token = () => typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey) ?? undefined;
export const qiyAuthProvider: AuthProvider = {
  login: async ({ token: nextToken, username, password }: { token?: string; username?: string; password?: string }) => {
    if (username && password) {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      if (!response.ok) return { success: false, error: { name: "LoginFailed", message: (await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Invalid username or password" } };
      const result = await response.json() as { accessToken?: string };
      if (!result.accessToken) return { success: false, error: { name: "LoginFailed", message: "Login response did not contain an access token" } };
      window.localStorage.setItem(tokenKey, result.accessToken);
      return { success: true, redirectTo: "/" };
    }
    
    return { success: false, error: { name: "CredentialsRequired", message: "Username and password are required" } };
  },
  logout: async () => { window.localStorage.removeItem(tokenKey); return { success: true, redirectTo: "/auth/login" }; },
  check: async () => token() ? { authenticated: true } : { authenticated: false, redirectTo: "/auth/login" },
  getIdentity: async () => { const response = await fetch("/api/v1/auth/me", { headers: token() ? { Authorization: "Bearer " + token() } : {} }); if (!response.ok) return null; return await response.json() as QiyIdentity; },
  getPermissions: async () => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; return identity?.role ?? null; },
  onError: async ({ error }) => error?.statusCode === 401 ? { logout: true, redirectTo: "/auth/login" } : {},
};
export const qiyAccessControlProvider: AccessControlProvider = { can: async ({ resource, action }) => { const identity = await qiyAuthProvider.getIdentity?.({}) as QiyIdentity | null | undefined; if (!identity) return { can: false, reason: "Authentication required" }; if (identity.role === "admin") return { can: true }; if (resource === "users") return { can: false, reason: "User administration is restricted" }; const can = identity.role === "operator" || action === "list" || action === "show"; return can ? { can: true } : { can: false, reason: "Role " + (identity.role ?? "unknown") + " cannot " + action + " " + resource }; }, options: { buttons: { enableAccessControl: true, hideIfUnauthorized: true }, queryOptions: { staleTime: 30_000 } } };
export function qiyAuthToken(): string | undefined { return token(); }

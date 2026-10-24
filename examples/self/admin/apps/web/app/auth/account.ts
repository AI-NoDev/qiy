export interface QiyIdentityProvider { id: string; label: string; bound: boolean; subject?: string; email?: string; name?: string }
export interface QiyIdentitiesUser { id: string; username: string; email: string; name: string; role: string }
export interface QiyIdentities { user: QiyIdentitiesUser; password: { set: boolean }; providers: QiyIdentityProvider[]; loginMethodCount: number }

const tokenKey = "qiy.access_token";
function bearer(): Record<string, string> {
  const token = typeof window === "undefined" ? undefined : window.localStorage.getItem(tokenKey);
  return token ? { Authorization: "Bearer " + token } : {};
}

/** Reads the signed-in account and every linked sign-in method from the API. */
export async function fetchIdentities(fetcher: typeof fetch = fetch): Promise<QiyIdentities> {
  const response = await fetcher("/api/v1/auth/identities", { headers: bearer() });
  const result = await response.json().catch(() => null) as (QiyIdentities & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "Could not load the account profile");
  return result;
}

/** Removes one linked provider. The server refuses to remove the last login method. */
export async function unbindProvider(provider: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/v1/auth/unbind", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ provider }) });
  const result = await response.json().catch(() => null) as { error?: string; ok?: boolean } | null;
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Could not unlink the identity provider");
}

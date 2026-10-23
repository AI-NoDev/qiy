export interface OidcClientConfig { authorizationUrl: string; tokenUrl: string; clientId: string; scope: string; redirectUri: string; logoutUrl?: string; }
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type EnvLike = Record<string, string | undefined>;
const accessTokenKey = "qiy.access_token";
const idTokenKey = "qiy.id_token";
const expiresAtKey = "qiy.expires_at";
const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const silentAttemptKey = "qiy.oidc.silent_attempt";
export const oidcProviderLabel = "OpenID Connect";
export const oidcSessionSkewMs = 60_000;

function envSource(): EnvLike { return import.meta.env as EnvLike; }
function required(env: EnvLike, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error("Missing frontend environment variable " + name); return value; }
export function readOidcClientConfig(env: EnvLike = envSource(), origin = window.location.origin): OidcClientConfig {
  return {
    authorizationUrl: required(env, "VITE_QIY_AUTHORIZATION_URL"),
    tokenUrl: required(env, "VITE_QIY_TOKEN_URL"),
    clientId: required(env, "VITE_QIY_CLIENT_ID"),
    scope: env.VITE_QIY_AUTH_SCOPE?.trim() || "openid profile email",
    redirectUri: env.VITE_QIY_REDIRECT_URI?.trim() || origin + "/auth/callback",
    ...(env.VITE_QIY_LOGOUT_URL?.trim() ? { logoutUrl: env.VITE_QIY_LOGOUT_URL.trim() } : {}),
  };
}
function randomValue(): string { const bytes = crypto.getRandomValues(new Uint8Array(32)); return base64Url(bytes); }
function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export async function createPkceChallenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))); }
export async function buildAuthorizationUrl(config: OidcClientConfig, verifier: string, state: string, prompt?: "none"): Promise<string> { const url = new URL(config.authorizationUrl); url.searchParams.set("response_type", "code"); url.searchParams.set("client_id", config.clientId); url.searchParams.set("redirect_uri", config.redirectUri); url.searchParams.set("scope", config.scope); url.searchParams.set("state", state); url.searchParams.set("code_challenge", await createPkceChallenge(verifier)); url.searchParams.set("code_challenge_method", "S256"); if (prompt) url.searchParams.set("prompt", prompt); return url.toString(); }
export async function beginOidcLogin(returnTo = window.location.pathname + window.location.search): Promise<void> { const config = readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.sessionStorage.removeItem(silentAttemptKey); window.location.assign(await buildAuthorizationUrl(config, verifier, state)); }
export interface OidcSession { token?: string; expiresAt?: number; expired: boolean; }
/**
 * Reads the stored session and reports whether the access token is no longer
 * usable. When the provider did not return expires_in the expiry is unknown and
 * the token is treated as usable, which keeps behaviour unchanged for such IdPs.
 */
export function oidcSession(options: { storage?: StorageLike; now?: number; skewMs?: number } = {}): OidcSession { const storage = options.storage ?? window.localStorage; const now = options.now ?? Date.now(); const skew = options.skewMs ?? 0; const token = storage.getItem(accessTokenKey) ?? undefined; const raw = storage.getItem(expiresAtKey); const expiresAt = raw === null ? undefined : Number(raw); const known = expiresAt !== undefined && Number.isFinite(expiresAt); return { ...(token ? { token } : {}), ...(known ? { expiresAt } : {}), expired: !token || (known && expiresAt - skew <= now) }; }
export function clearOidcSession(storage: StorageLike = window.localStorage, session: StorageLike = window.sessionStorage): void { storage.removeItem(accessTokenKey); storage.removeItem(idTokenKey); storage.removeItem(expiresAtKey); session.removeItem(silentAttemptKey); }
/** True once per redirect cycle, so a failed silent renewal cannot loop. */
export function consumeSilentAttempt(session: StorageLike = window.sessionStorage): boolean { if (session.getItem(silentAttemptKey) === "1") return false; session.setItem(silentAttemptKey, "1"); return true; }
/**
 * Renews the session through the identity provider without user interaction.
 * This relies on the provider session cookie, so no refresh token is kept in
 * browser storage; a refresh-token or refresh-cookie design belongs in a
 * backend-for-frontend.
 */
export async function beginOidcSilentRenew(returnTo = "/", config?: OidcClientConfig): Promise<void> { const effective = config ?? readOidcClientConfig(); const verifier = randomValue(); const state = randomValue(); window.sessionStorage.setItem(verifierKey, verifier); window.sessionStorage.setItem(stateKey, state); window.sessionStorage.setItem(returnToKey, returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"); window.location.assign(await buildAuthorizationUrl(effective, verifier, state, "none")); }
export function isSilentRenewFailure(message: string | undefined): boolean { return Boolean(message && /login_required|interaction_required|consent_required|account_selection_required/i.test(message)); }
export async function completeOidcLogin(callbackUrl: string, storage: StorageLike = window.sessionStorage, localStorage: StorageLike = window.localStorage, fetcher: typeof fetch = fetch, config = readOidcClientConfig()): Promise<string> { const url = new URL(callbackUrl); const providerError = url.searchParams.get("error"); if (providerError) throw new Error(url.searchParams.get("error_description") || providerError); const code = url.searchParams.get("code"); const state = url.searchParams.get("state"); const expectedState = storage.getItem(stateKey); const verifier = storage.getItem(verifierKey); if (!code || !state || !expectedState || state !== expectedState || !verifier) { storage.removeItem(verifierKey); storage.removeItem(stateKey); throw new Error("Invalid or expired OAuth state"); } const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, redirect_uri: config.redirectUri, code_verifier: verifier }); const response = await fetcher(config.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); const result = await response.json().catch(() => null) as { access_token?: string; id_token?: string; expires_in?: number; error?: string; error_description?: string } | null; if (!response.ok || !result?.access_token) throw new Error(result?.error_description || result?.error || "Identity provider did not return an access token"); localStorage.setItem(accessTokenKey, result.access_token); if (result.id_token) localStorage.setItem(idTokenKey, result.id_token); const expiresIn = Number(result.expires_in); if (Number.isFinite(expiresIn) && expiresIn > 0) localStorage.setItem(expiresAtKey, String(Date.now() + expiresIn * 1000)); else localStorage.removeItem(expiresAtKey); storage.removeItem(silentAttemptKey); const returnTo = storage.getItem(returnToKey) || "/"; storage.removeItem(verifierKey); storage.removeItem(stateKey); storage.removeItem(returnToKey); return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"; }
export function beginOidcLogout(config?: OidcClientConfig): void { const idToken = window.localStorage.getItem(idTokenKey); window.localStorage.removeItem(idTokenKey); window.sessionStorage.removeItem(verifierKey); window.sessionStorage.removeItem(stateKey); window.sessionStorage.removeItem(returnToKey); let effective = config; if (!effective) { try { effective = readOidcClientConfig(); } catch { return; } } if (!effective.logoutUrl) return; const url = new URL(effective.logoutUrl); url.searchParams.set("post_logout_redirect_uri", window.location.origin + "/auth/login"); if (idToken) url.searchParams.set("id_token_hint", idToken); window.location.assign(url.toString()); }

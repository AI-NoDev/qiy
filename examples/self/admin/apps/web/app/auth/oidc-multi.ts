export interface QiyAuthProviderPublic {
  id: string;
  label: string;
  authorizationUrl: string;
  tokenUrl?: string;
  clientId: string;
  scope: string;
  redirectUri?: string;
  logoutUrl?: string;
}

export interface QiyOnboardingProfile { sub: string; username?: string; email?: string; name?: string }
export interface QiyOnboardingClaims { provider: string; subject: string; username?: string; email?: string; name?: string }
export interface QiySignInUser { id: string; name: string; role: string }
export interface QiySignInResult {
  accessToken?: string;
  needsOnboarding?: boolean;
  onboardingToken?: string;
  provider?: { id: string; label: string };
  profile?: QiyOnboardingProfile;
  user?: QiySignInUser;
}
export interface QiyPendingOnboarding { token: string; profile: QiyOnboardingProfile; provider: { id: string; label: string } }

const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const providerKey = "qiy.oidc.provider";
const modeKey = "qiy.oidc.mode";
const accessTokenKey = "qiy.access_token";
const pendingOnboardingKey = "qiy.oauth.onboarding";

function serverSession(): Storage { return window.localStorage; }
function flowState(): Storage { return window.sessionStorage; }

export async function fetchAuthProviders(fetcher: typeof fetch = fetch): Promise<QiyAuthProviderPublic[]> {
  const response = await fetcher("/api/v1/auth/providers");
  if (!response.ok) throw new Error("Failed to load the configured identity providers");
  const payload = (await response.json()) as { providers?: QiyAuthProviderPublic[] };
  return payload.providers ?? [];
}

function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeReturnTo(value: string): string { return value.startsWith("/") && !value.startsWith("//") ? value : "/"; }
function defaultReturnTo(): string { return (window.location.pathname.startsWith("/auth/") || window.location.pathname.startsWith("/oauth/")) ? "/" : window.location.pathname + window.location.search; }

function clearPendingFlow(): void {
  for (const key of [verifierKey, stateKey, returnToKey, providerKey, modeKey]) flowState().removeItem(key);
}

/** Clears the Qiy session and any pending OAuth flow state. */
export function clearSession(): void {
  serverSession().removeItem(accessTokenKey);
  flowState().removeItem(pendingOnboardingKey);
  clearPendingFlow();
}

async function beginProviderRedirect(provider: QiyAuthProviderPublic, returnTo: string, mode: "login" | "bind"): Promise<void> {
  const verifier = randomValue();
  const state = randomValue();
  flowState().setItem(verifierKey, verifier);
  flowState().setItem(stateKey, state);
  flowState().setItem(returnToKey, safeReturnTo(returnTo));
  flowState().setItem(providerKey, JSON.stringify(provider));
  flowState().setItem(modeKey, mode);
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  const url = new URL(provider.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", provider.scope || "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}

/** Starts a password-less provider sign-in. */
export async function beginProviderLogin(provider: QiyAuthProviderPublic, returnTo = defaultReturnTo()): Promise<void> {
  await beginProviderRedirect(provider, returnTo, "login");
}

/** Starts linking an additional provider to the signed-in account. */
export async function beginProviderBind(providerId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const providers = await fetchAuthProviders(fetcher);
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error("That identity provider is not configured on the server");
  await beginProviderRedirect(provider, "/profile", "bind");
}

/**
 * Completes the provider callback. Login mode returns the path to continue to
 * (the app, or /auth/onboarding for a first-time identity); bind mode links the
 * provider to the current account and returns to the profile page.
 */
export async function completeProviderCallback(callbackUrl: URL, fetcher: typeof fetch = fetch): Promise<string> {
  const storedProvider = flowState().getItem(providerKey);
  const provider = storedProvider ? JSON.parse(storedProvider) as QiyAuthProviderPublic : null;
  const verifier = flowState().getItem(verifierKey);
  const expectedState = flowState().getItem(stateKey);
  const returnTo = flowState().getItem(returnToKey) ?? "/";
  const mode = flowState().getItem(modeKey) ?? "login";
  if (!provider || !verifier || !expectedState) {
    // A second StrictMode/hydration pass after a successful login should land on the app instead of showing an error.
    if (serverSession().getItem(accessTokenKey)) return "/";
    throw new Error("No pending sign-in for this provider");
  }
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) throw new Error(callbackUrl.searchParams.get("error_description") ?? providerError);
  if (callbackUrl.searchParams.get("state") !== expectedState) throw new Error("State mismatch in the provider callback");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("The provider callback did not contain an authorization code");
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  if (mode === "bind") {
    const accessToken = serverSession().getItem(accessTokenKey);
    const response = await fetcher("/api/v1/auth/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}) },
      body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error ?? "Linking the identity provider failed");
    clearPendingFlow();
    return "/profile?linked=" + encodeURIComponent(provider.id);
  }
  const response = await fetcher("/api/v1/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
  });
  const result = await response.json().catch(() => null) as (QiySignInResult & { error?: string }) | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "The provider token exchange failed");
  if (result.needsOnboarding && result.onboardingToken) {
    const pending: QiyPendingOnboarding = { token: result.onboardingToken, profile: result.profile ?? { sub: "" }, provider: result.provider ?? { id: provider.id, label: provider.label } };
    flowState().setItem(pendingOnboardingKey, JSON.stringify(pending));
    clearPendingFlow();
    return "/auth/onboarding?token=" + encodeURIComponent(result.onboardingToken);
  }
  if (!result.accessToken) throw new Error("The server did not return a session token");
  serverSession().setItem(accessTokenKey, result.accessToken);
  clearPendingFlow();
  return safeReturnTo(returnTo);
}

/** Reads the pending onboarding token left by the callback, if any. */
export function readPendingOnboarding(): QiyPendingOnboarding | null {
  const raw = flowState().getItem(pendingOnboardingKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; profile?: unknown; provider?: unknown };
    if (typeof parsed.token !== "string") return null;
    const profile = parsed.profile && typeof parsed.profile === "object" ? parsed.profile as QiyOnboardingProfile : { sub: "" };
    const provider = parsed.provider && typeof parsed.provider === "object" ? parsed.provider as { id: string; label: string } : { id: "oidc", label: "Identity provider" };
    return { token: parsed.token, profile, provider };
  } catch { return null; }
}

/** The onboarding token is signed and verified by the server; the browser only reads it for prefill. */
export function decodeOnboardingToken(token: string): QiyOnboardingClaims | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof payload.provider !== "string" || typeof payload.identitySubject !== "string") return null;
    return {
      provider: payload.provider,
      subject: payload.identitySubject,
      ...(typeof payload.username === "string" ? { username: payload.username } : {}),
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
    };
  } catch { return null; }
}

/** Creates the local account for a verified provider identity and stores the session. */
export async function registerOAuthUser(input: { onboardingToken: string; username: string; email?: string; password: string }, fetcher: typeof fetch = fetch): Promise<QiySignInResult> {
  const response = await fetcher("/api/v1/auth/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const result = await response.json().catch(() => null) as (QiySignInResult & { error?: string }) | null;
  if (!response.ok || !result?.accessToken) throw new Error(result?.error ?? "The account could not be created");
  serverSession().setItem(accessTokenKey, result.accessToken);
  flowState().removeItem(pendingOnboardingKey);
  return result;
}

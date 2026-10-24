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

const verifierKey = "qiy.oidc.verifier";
const stateKey = "qiy.oidc.state";
const returnToKey = "qiy.oidc.return_to";
const providerKey = "qiy.oidc.provider";
const accessTokenKey = "qiy.access_token";
const idTokenKey = "qiy.id_token";
const expiresAtKey = "qiy.expires_at";

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

/** Redirects to the selected provider; the user can choose any configured provider. */
export async function beginProviderLogin(provider: QiyAuthProviderPublic, returnTo = window.location.pathname + window.location.search): Promise<void> {
  const verifier = randomValue();
  const state = randomValue();
  sessionStorage.setItem(verifierKey, verifier);
  sessionStorage.setItem(stateKey, state);
  sessionStorage.setItem(returnToKey, returnTo);
  sessionStorage.setItem(providerKey, JSON.stringify(provider));
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

/** Completes the callback: validates state, exchanges the code and stores the session. */
export async function completeProviderLogin(callbackUrl: URL, fetcher: typeof fetch = fetch): Promise<string> {
  const provider = JSON.parse(sessionStorage.getItem(providerKey) ?? "null") as QiyAuthProviderPublic | null;
  const verifier = sessionStorage.getItem(verifierKey);
  const expectedState = sessionStorage.getItem(stateKey);
  const returnTo = sessionStorage.getItem(returnToKey) ?? "/";
  if (!provider || !verifier || !expectedState) {
    // A second StrictMode/hydration pass after a successful login should land on the app instead of showing an error.
    if (window.localStorage.getItem(accessTokenKey)) return "/";
    throw new Error("No pending login for this provider");
  }
  const error = callbackUrl.searchParams.get("error");
  if (error) throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
  if (callbackUrl.searchParams.get("state") !== expectedState) throw new Error("State mismatch in the provider callback");
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("The provider callback did not contain an authorization code");
  const redirectUri = provider.redirectUri ?? window.location.origin + "/auth/callback";
  // Exchange through the generated server so confidential clients (Google,
  // Auth0, Okta web apps) can use their client secret and browser CORS is not
  // required. The server keeps secrets out of the SPA bundle.
  const response = await fetcher("/api/v1/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: provider.id, code, codeVerifier: verifier, redirectUri }),
  });
  if (!response.ok) throw new Error("The provider token exchange failed");
  const tokens = (await response.json()) as { access_token?: string; id_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new Error("The provider token response did not include an access token");
  window.localStorage.setItem(accessTokenKey, tokens.access_token);
  if (tokens.id_token) window.localStorage.setItem(idTokenKey, tokens.id_token);
  if (typeof tokens.expires_in === "number") window.localStorage.setItem(expiresAtKey, String(Date.now() + tokens.expires_in * 1000));
  for (const key of [verifierKey, stateKey, providerKey, returnToKey]) sessionStorage.removeItem(key);
  return returnTo;
}

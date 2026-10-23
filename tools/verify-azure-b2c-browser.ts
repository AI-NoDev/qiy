import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Browser-assisted Azure AD B2C / Microsoft Entra External ID acceptance.
 *
 * Starts a local callback server, prints the authorization URL (PKCE), waits for
 * the user to sign in with a local account, exchanges the code for a real
 * id_token and then hands that token to verify-azure-b2c.ts for the generated
 * server's verification, identity mapping and role assertions.
 *
 * Env: QIY_AZURE_TENANT_DOMAIN, QIY_AZURE_TENANT_ID, QIY_AZURE_CLIENT_ID,
 *      QIY_AZURE_POLICY (user flow name, e.g. signupsignin1),
 *      QIY_AZURE_REDIRECT_URI (default http://localhost:3000/login),
 *      QIY_AZURE_AUDIENCE (default client id).
 */
const tenantDomain = Bun.env.QIY_AZURE_TENANT_DOMAIN ?? "";
const tenantIdOrDomain = Bun.env.QIY_AZURE_TENANT_ID ?? tenantDomain;
const clientId = Bun.env.QIY_AZURE_CLIENT_ID ?? "";
const policy = Bun.env.QIY_AZURE_POLICY;
const audience = Bun.env.QIY_AZURE_AUDIENCE ?? clientId;
const redirectUri = Bun.env.QIY_AZURE_REDIRECT_URI ?? "http://localhost:3000/login";
const timeoutMs = Number(Bun.env.QIY_AZURE_BROWSER_TIMEOUT_MS ?? 300_000);

if (!tenantDomain || !clientId) {
  console.error("QIY_AZURE_TENANT_DOMAIN and QIY_AZURE_CLIENT_ID are required.");
  process.exit(1);
}

const legacy = !tenantDomain.includes(".ciamlogin.com");
const discoveryCandidates = Bun.env.QIY_AZURE_DISCOVERY_URL
  ? [Bun.env.QIY_AZURE_DISCOVERY_URL]
  : legacy
    ? [`https://${tenantDomain}.b2clogin.com/${tenantIdOrDomain}/v2.0/.well-known/openid-configuration?p=${encodeURIComponent(policy ?? "B2C_1_signupsignin")}`]
    : [
      `https://${tenantDomain}/${tenantIdOrDomain}/v2.0/.well-known/openid-configuration`,
      `https://${tenantDomain}/${tenantDomain.replace(/\.ciamlogin\.com$/, ".onmicrosoft.com")}/v2.0/.well-known/openid-configuration`,
      `https://${tenantDomain}/v2.0/.well-known/openid-configuration`,
    ];

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}
let discovery: Discovery | undefined;
for (const candidate of discoveryCandidates) {
  const response = await fetch(candidate).catch(() => undefined);
  if (response?.ok) {
    discovery = (await response.json()) as Discovery;
    console.log("discovery: " + candidate);
    break;
  }
}
if (!discovery) {
  console.error("Could not fetch the OIDC discovery document for: " + discoveryCandidates.join(", "));
  process.exit(1);
}

// PKCE + state.
const codeVerifier = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
const codeChallenge = Buffer.from(digest).toString("base64url");
const state = crypto.randomUUID();

const authorize = new URL(discovery.authorization_endpoint);
authorize.searchParams.set("client_id", clientId);
authorize.searchParams.set("response_type", "code");
authorize.searchParams.set("redirect_uri", redirectUri);
authorize.searchParams.set("response_mode", "query");
authorize.searchParams.set("scope", "openid profile email");
authorize.searchParams.set("state", state);
authorize.searchParams.set("code_challenge", codeChallenge);
authorize.searchParams.set("code_challenge_method", "S256");
if (policy) authorize.searchParams.set("p", policy);

const redirect = new URL(redirectUri);
const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
const callbackPath = redirect.pathname;
type Callback = { code?: string; error?: string; description?: string };
let settle: (result: Callback) => void = () => undefined;
const callbackPromise = new Promise<Callback>((resolve) => { settle = resolve; });

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== callbackPath) return new Response("Not found", { status: 404 });
    const error = url.searchParams.get("error") ?? undefined;
    const description = url.searchParams.get("error_description") ?? undefined;
    const code = url.searchParams.get("code") ?? undefined;
    if (!error && url.searchParams.get("state") !== state) {
      return new Response("State mismatch", { status: 400 });
    }
    settle({ code, error, description });
    const heading = error ? "Sign-in failed" : "Sign-in succeeded";
    const detail = error ?? "You can close this tab and return to the terminal.";
    return new Response(`<!doctype html><meta charset="utf-8"><h2>${heading}</h2><p>${detail}</p>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log("\nOpen this URL in a browser and sign in with the external tenant test user:\n\n" + authorize.toString() + "\n");
console.log(`Waiting for the callback at ${redirectUri} (timeout ${Math.round(timeoutMs / 1000)}s)...`);
const timer = setTimeout(() => settle({ error: "timeout", description: "no browser callback within the timeout" }), timeoutMs);
const callback = await callbackPromise;
clearTimeout(timer);
server.stop(true);
if (callback.error || !callback.code) {
  console.error("Authorization failed: " + (callback.error ?? "no code") + " " + (callback.description ?? ""));
  process.exit(1);
}

const tokenUrl = legacy
  ? discovery.token_endpoint + (discovery.token_endpoint.includes("?") ? "&" : "?") + "p=" + encodeURIComponent(policy ?? "B2C_1_signupsignin")
  : discovery.token_endpoint;
const tokenResponse = await fetch(tokenUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: callback.code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: "openid profile email",
  }).toString(),
});
if (!tokenResponse.ok) {
  console.error("Token exchange failed: " + tokenResponse.status + " " + (await tokenResponse.text()));
  process.exit(1);
}
const tokens = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
const idToken = tokens.id_token;
if (!idToken) {
  console.error("Token response did not include an id_token: " + JSON.stringify(Object.keys(tokens)));
  process.exit(1);
}
const claims = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
console.log(`\nReceived a real id_token: iss=${String(claims.iss)} sub=${String(claims.sub)} aud=${JSON.stringify(claims.aud)}`);
if (claims.iss !== discovery.issuer) {
  console.error("Unexpected issuer " + String(claims.iss) + " (discovery says " + discovery.issuer + ")");
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), "qiy-azure-browser-"));
writeFileSync(join(root, "id-token.txt"), idToken);
const child = Bun.spawn([process.execPath, "run", "tools/verify-azure-b2c.ts"], {
  cwd: join(import.meta.dir, ".."),
  env: {
    ...process.env,
    QIY_AZURE_TENANT_DOMAIN: tenantDomain,
    QIY_AZURE_TENANT_ID: tenantIdOrDomain,
    QIY_AZURE_CLIENT_ID: clientId,
    QIY_AZURE_AUDIENCE: audience,
    QIY_AZURE_ID_TOKEN: idToken,
    ...(policy ? { QIY_AZURE_POLICY: policy } : {}),
  },
  stdout: "inherit",
  stderr: "inherit",
});
const code = await child.exited;
console.log(code === 0
  ? "\nAzure AD B2C browser acceptance passed (real id_token verified end to end)."
  : "\nAzure AD B2C browser acceptance FAILED in the generated-server phase.");
process.exit(code);

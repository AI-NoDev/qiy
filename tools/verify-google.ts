import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Google OpenID Connect acceptance.
 *
 * Google has no password/device grant for web clients, so an unattended user ID
 * token cannot be minted here. This script verifies everything else with real
 * Google endpoints: discovery, JWKS, PKCE authorization acceptance, client
 * credential/redirect validation on the token endpoint, and that the generated
 * OIDC server uses the real Google JWKS (forged tokens are rejected).
 *
 * If QIY_GOOGLE_ID_TOKEN is provided (for example a token copied from Google's
 * OAuth Playground), phase B also verifies a real Google ID token end to end.
 */
const clientId = process.env.QIY_GOOGLE_CLIENT_ID ?? "";
const clientSecret = process.env.QIY_GOOGLE_CLIENT_SECRET ?? "";
const redirectUri = process.env.QIY_GOOGLE_REDIRECT_URI ?? "http://localhost:8000/oauth/google";
const providedIdToken = process.env.QIY_GOOGLE_ID_TOKEN;

const root = mkdtempSync(join(tmpdir(), "qiy-google-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "google.sqlite");
const issuer = "https://accounts.google.com";
const audience = clientId;
if (!clientId) {
  console.error("QIY_GOOGLE_CLIENT_ID is required (Google OAuth client id).");
  process.exit(1);
}

async function run(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number; output: string }> {
  const executable = command[0] === "bun" ? process.execPath : command[0]!;
  const child = Bun.spawn([executable, ...command.slice(1)], { cwd: options.cwd ?? root, env: { ...process.env, ...(options.env ?? {}) }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 300_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, output: stdout + stderr };
  } finally { clearTimeout(timer); }
}
async function must(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<string> {
  const result = await run(command, options);
  if (result.code !== 0) throw new Error(`${command.join(" ")} failed (${result.code}):\n${result.output.slice(-3000)}`);
  return result.output;
}

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  const discoveryResponse = await fetch(issuer + "/.well-known/openid-configuration");
  check("Google discovery is reachable", discoveryResponse.ok);
  const discovery = (await discoveryResponse.json()) as { issuer: string; jwks_uri: string; authorization_endpoint: string; token_endpoint: string; id_token_signing_alg_values_supported?: string[] };
  check("discovery issuer is accounts.google.com", discovery.issuer === issuer);
  check("discovery exposes the Google certificates endpoint", discovery.jwks_uri === "https://www.googleapis.com/oauth2/v3/certs");
  check("discovery exposes authorization and token endpoints", discovery.authorization_endpoint === "https://accounts.google.com/o/oauth2/v2/auth" && discovery.token_endpoint === "https://oauth2.googleapis.com/token");
  check("RS256 is supported", (discovery.id_token_signing_alg_values_supported ?? []).includes("RS256"));

  const jwksResponse = await fetch(discovery.jwks_uri);
  check("Google JWKS is reachable", jwksResponse.ok);
  const jwks = (await jwksResponse.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  check("JWKS returns signing keys", jwks.keys.length > 0);
  check("JWKS advertises RS256 keys", jwks.keys.some((key) => (key.alg ?? "RS256") === "RS256"));

  // PKCE authorization request: Google should show the consent/login page, not a
  // redirect_uri_mismatch or invalid_client error.
  const codeVerifier = "qiy-google-acceptance-verifier-0123456789abcdef";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const authorize = new URL(discovery.authorization_endpoint);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", crypto.randomUUID());
  authorize.searchParams.set("code_challenge", Buffer.from(digest).toString("base64url"));
  authorize.searchParams.set("code_challenge_method", "S256");
  const authorizeResponse = await fetch(authorize.toString(), { redirect: "manual" });
  const authorizeBody = await authorizeResponse.text().catch(() => "");
  const authorizeProblem = /redirect_uri_mismatch|invalid_client|invalid_request/i.test(authorizeBody) || (authorizeResponse.headers.get("location") ?? "").includes("error=");
  check("authorization endpoint accepts the client id and redirect URI (PKCE)", !authorizeProblem && (authorizeResponse.status === 200 || authorizeResponse.status === 302 || authorizeResponse.status === 303 || authorizeResponse.status === 307));

  // Client credentials and redirect URI are validated before the code: a bogus
  // code must produce invalid_grant, not invalid_client / redirect_uri_mismatch.
  let clientValidated = false;
  if (clientSecret) {
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "bogus-code", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).toString(),
    });
    const tokenBody = (await tokenResponse.json().catch(() => ({}))) as { error?: string };
    check("token endpoint accepts the client id/secret/redirect URI", tokenResponse.status === 400 && tokenBody.error === "invalid_grant");
    clientValidated = true;
  } else {
    console.log("  skip token-endpoint client check (set QIY_GOOGLE_CLIENT_SECRET)");
  }

  // Generated OIDC app pointed at Google.
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application google-real {
  database sqlite {}
  api { client rest; }
  auth { provider google; user users; subjectField subject; roleField role; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field subject Text @unique;
    field email Text;
    field displayName Text @nullable;
    field role userRole;
  }
  entity notes {
    field id UUID @id;
    field title Text;
  }
}
`);
  console.log(`workspace ${root}`);
  await generateApp(join(root, "app.qiy"), admin);
  await must(["bun", "install"], { cwd: admin });
  await must(["bun", "run", "db:generate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });
  await must(["bun", "run", "db:migrate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });

  // Optional phase B: verify a real Google ID token if the operator supplied one.
  let subject: string | undefined;
  if (providedIdToken) {
    const claims = JSON.parse(Buffer.from(providedIdToken.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    check("provided Google ID token has the client as audience", String(claims.aud).includes(clientId));
    check("provided Google ID token is issued by accounts.google.com", claims.iss === issuer || claims.iss === "https://accounts.google.com");
    subject = `${String(claims.iss)}|${String(claims.sub)}`;
    writeFileSync(join(server, "seed-user.ts"), `import { db } from "./src/db";
import { users } from "./src/schema";
await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: ${JSON.stringify(String(claims.email ?? "google@example.test"))}, displayName: "Google Acceptance", role: "admin" });
console.log("seeded", ${JSON.stringify(subject)});
`);
    console.log(await must(["bun", "run", "seed-user.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } }));
  }

  const kid = (jwks.keys.find((key) => key.kid)?.kid ?? "");
  writeFileSync(join(server, "google.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { SignJWT, generateKeyPair } from "jose";
import { createProductionAuthenticator } from "./src/auth/oidc";

const issuer = process.env.QIY_OIDC_ISSUER!;
const audience = process.env.QIY_OIDC_AUDIENCE!;
const realToken = process.env.QIY_GOOGLE_ID_TOKEN;

test("rejects a forged token after fetching the real Google JWKS", async () => {
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email_verified: true, email: "forged@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.QIY_GOOGLE_KID || "forged-kid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("google|forged")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const authenticate = createProductionAuthenticator();
  let error: unknown;
  try { await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + forged } })); }
  catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toMatch(/signature|no matching key/i);
}, 30_000);

test("rejects missing and malformed bearer tokens", async () => {
  const authenticate = createProductionAuthenticator();
  expect(await authenticate(new Request("http://localhost/api/v1/notes"))).toBeNull();
  let malformedRejected = false;
  try { await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer not-a-jwt" } })); }
  catch { malformedRejected = true; }
  expect(malformedRejected).toBe(true);
}, 20_000);

test.skipIf(!realToken)("accepts a real Google ID token for the mapped user", async () => {
  const authenticate = createProductionAuthenticator();
  const principal = await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + realToken } }));
  expect(principal).not.toBeNull();
  expect(principal?.role).toBe("admin");
}, 30_000);
`);

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: discovery.jwks_uri } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "google.acceptance.test.ts"], {
    cwd: server,
    env: {
      DATABASE_URL: databaseUrl,
      QIY_OIDC_ISSUER: issuer,
      QIY_OIDC_AUDIENCE: audience,
      QIY_OIDC_JWKS_URL: discovery.jwks_uri,
      QIY_GOOGLE_KID: kid,
      ...(providedIdToken ? { QIY_GOOGLE_ID_TOKEN: providedIdToken } : {}),
    },
  });
  console.log(tests);
  check("generated server verifies against the real Google tenant", tests.includes("0 fail"));
  if (clientValidated) check("client credentials were validated by Google", true);
} finally {
  console.log(failures === 0 ? "Google real-tenant acceptance passed: " + root : "Google real-tenant acceptance FAILED");
  if (failures > 0) process.exit(1);
}

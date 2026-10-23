import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Kinde acceptance.
 *
 * Kinde only supports authorization_code / client_credentials / device_code (no
 * password grant), so an unattended user token cannot be minted with a public
 * client id. This script verifies everything that does not need a browser login:
 * the real discovery document, the real JWKS, that the provided client id is
 * accepted by the authorization endpoint (PKCE), and that the generated OIDC
 * server verifies against the real Kinde JWKS by rejecting forged tokens.
 */
const domain = (Bun.env.QIY_KINDE_DOMAIN ?? "https://windshage.kinde.com").replace(/\/$/, "");
const issuer = domain;
const clientId = Bun.env.QIY_KINDE_CLIENT_ID ?? "84551a42d0e04c5aabcbfb04f00aa7c6";
const redirectUrl = Bun.env.QIY_KINDE_REDIRECT_URL ?? "http://localhost:3000";
const jwksOverride = Bun.env.QIY_KINDE_JWKS_URL;

const root = mkdtempSync(join(tmpdir(), "qiy-kinde-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "kinde.sqlite");

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
  check("Kinde discovery is reachable", discoveryResponse.ok);
  const discovery = (await discoveryResponse.json()) as { issuer: string; jwks_uri: string; authorization_endpoint: string; token_endpoint: string; id_token_signing_alg_values_supported?: string[]; grant_types_supported?: string[] };
  check("discovery issuer matches the tenant", discovery.issuer === issuer);
  check("discovery exposes the JWKS endpoint", discovery.jwks_uri === issuer + "/.well-known/jwks");
  check("discovery exposes authorization and token endpoints", discovery.authorization_endpoint === issuer + "/oauth2/auth" && discovery.token_endpoint === issuer + "/oauth2/token");
  check("RS256 is an advertised signing algorithm", (discovery.id_token_signing_alg_values_supported ?? []).includes("RS256"));
  check("password grant is not advertised (browser login required)", !(discovery.grant_types_supported ?? []).includes("password"));

  const jwksResponse = await fetch(jwksOverride ?? discovery.jwks_uri);
  check("Kinde JWKS is reachable", jwksResponse.ok);
  const jwks = (await jwksResponse.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  check("JWKS returns signing keys", jwks.keys.length > 0);
  check("JWKS advertises RS256 keys", jwks.keys.some((key) => (key.alg ?? "RS256") === "RS256"));

  // The provided public client id must be accepted by the authorization endpoint (PKCE).
  const codeVerifier = "qiy-kinde-acceptance-verifier-0123456789abcdef";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = Buffer.from(digest).toString("base64url");
  const authorize = new URL(discovery.authorization_endpoint);
  // Kinde rejects weak state values (at least 8 characters of entropy).
  authorize.searchParams.set("state", crypto.randomUUID());
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUrl);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  const authorizeResponse = await fetch(authorize.toString(), { redirect: "manual" });
  check("authorization endpoint accepts the client id (PKCE redirect)", authorizeResponse.status === 302 || authorizeResponse.status === 303 || authorizeResponse.status === 200 || authorizeResponse.status === 307);
  const bogus = new URL(discovery.authorization_endpoint);
  bogus.searchParams.set("state", crypto.randomUUID());
  bogus.searchParams.set("client_id", "00000000000000000000000000000000");
  bogus.searchParams.set("redirect_uri", redirectUrl);
  bogus.searchParams.set("response_type", "code");
  bogus.searchParams.set("scope", "openid");
  const bogusResponse = await fetch(bogus.toString(), { redirect: "manual" });
  check("authorization endpoint rejects an unknown client id", bogusResponse.status >= 400 || (bogusResponse.headers.get("location") ?? "").includes("error"));

  // Generated OIDC app pointed at the real tenant.
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application kinde-real {
  database sqlite {}
  api { client rest; }
  auth { provider kinde; user users; subjectField subject; roleField role; }
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

  const kid = (jwks.keys.find((key) => key.kid)?.kid ?? "");
  writeFileSync(join(server, "kinde.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { SignJWT, generateKeyPair } from "jose";
import { createProductionAuthenticator } from "./src/auth/oidc";

const issuer = process.env.QIY_OIDC_ISSUER!;
const audience = process.env.QIY_OIDC_AUDIENCE!;

test("rejects a forged token after fetching the real Kinde JWKS", async () => {
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ scope: "openid" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.QIY_KINDE_KID || "forged-kid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("kinde|forged")
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
`);

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: clientId, QIY_OIDC_JWKS_URL: jwksOverride ?? discovery.jwks_uri } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "kinde.acceptance.test.ts"], {
    cwd: server,
    env: {
      DATABASE_URL: databaseUrl,
      QIY_OIDC_ISSUER: issuer,
      QIY_OIDC_AUDIENCE: clientId,
      QIY_OIDC_JWKS_URL: jwksOverride ?? discovery.jwks_uri,
      QIY_KINDE_KID: kid,
    },
  });
  console.log(tests);
  check("generated server verifies against the real Kinde tenant", tests.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Kinde real-tenant acceptance passed: " + root : "Kinde real-tenant acceptance FAILED");
  if (failures > 0) process.exit(1);
}

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Azure AD B2C acceptance.
 *
 * Azure AD B2C publishes OIDC metadata per user flow/policy, and a local-account
 * user flow named "Resource Owner Password" can mint tokens without a browser.
 * This script verifies:
 *  - the per-policy discovery document and the signing keys (JWKS),
 *  - that the generated `provider azure-ad-b2c` server uses the real JWKS
 *    (forged tokens are rejected by signature verification),
 *  - optionally a real ROPC token for a local B2C user (identity mapping, role).
 *
 * Env:
 *   QIY_AZURE_TENANT_DOMAIN   contoso.onmicrosoft.com (or the ciamlogin tenant id)
 *   QIY_AZURE_POLICY          B2C_1_signupsignin / B2C_1_ropc (user flow name)
 *   QIY_AZURE_CLIENT_ID       application (client) id
 *   QIY_AZURE_CLIENT_SECRET   client secret (optional for public clients)
 *   QIY_AZURE_AUDIENCE        expected audience (defaults to the client id)
 *   QIY_AZURE_USERNAME / QIY_AZURE_PASSWORD   local account for phase B
 *   QIY_AZURE_ISSUER / QIY_AZURE_JWKS_URL     overrides (External ID / custom)
 */
const tenantDomain = Bun.env.QIY_AZURE_TENANT_DOMAIN ?? "";
const tenantIdOrDomain = Bun.env.QIY_AZURE_TENANT_ID ?? tenantDomain;
const policy = Bun.env.QIY_AZURE_POLICY ?? "B2C_1_signupsignin";
const clientId = Bun.env.QIY_AZURE_CLIENT_ID ?? "";
const clientSecret = Bun.env.QIY_AZURE_CLIENT_SECRET;
const audience = Bun.env.QIY_AZURE_AUDIENCE ?? clientId;
const username = Bun.env.QIY_AZURE_USERNAME;
const password = Bun.env.QIY_AZURE_PASSWORD;
const phaseB = Boolean(clientId && username && password);

if (!tenantDomain) {
  console.error("QIY_AZURE_TENANT_DOMAIN is required (for example contoso.onmicrosoft.com).");
  process.exit(1);
}

// Azure AD B2C (legacy) uses b2clogin.com with one discovery document per policy;
// Microsoft Entra External ID tenants use ciamlogin.com with a single document.
const legacy = !tenantDomain.includes(".ciamlogin.com");
const explicitDiscovery = Bun.env.QIY_AZURE_DISCOVERY_URL;
const discoveryCandidates = explicitDiscovery
  ? [explicitDiscovery]
  : legacy
    ? [`https://${tenantDomain}.b2clogin.com/${tenantIdOrDomain}/v2.0/.well-known/openid-configuration?p=${encodeURIComponent(policy)}`]
    : [
      // Microsoft Entra External ID: <tenant>.ciamlogin.com/<tenant-id>/v2.0/
      `https://${tenantDomain}/${tenantIdOrDomain}/v2.0/.well-known/openid-configuration`,
      // ... or the onmicrosoft domain segment ...
      `https://${tenantDomain}/${tenantDomain.replace(/\.ciamlogin\.com$/, ".onmicrosoft.com")}/v2.0/.well-known/openid-configuration`,
      // ... or no extra segment (legacy ciamlogin layout).
      `https://${tenantDomain}/v2.0/.well-known/openid-configuration`,
    ];

const root = mkdtempSync(join(tmpdir(), "qiy-azure-b2c-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "azure-b2c.sqlite");

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
  let discoveryResponse: Response | undefined;
  for (const candidate of discoveryCandidates) {
    const response = await fetch(candidate).catch(() => undefined);
    if (response?.ok) { discoveryResponse = response; console.log("  info discovery: " + candidate); break; }
  }
  check("Azure AD B2C / External ID discovery is reachable", Boolean(discoveryResponse));
  if (!discoveryResponse) throw new Error("discovery failed for all candidates: " + discoveryCandidates.join(", "));
  const discovery = (await discoveryResponse.json()) as { issuer: string; jwks_uri: string; authorization_endpoint: string; token_endpoint: string; id_token_signing_alg_values_supported?: string[] };
  check("discovery exposes an issuer", Boolean(discovery.issuer));
  check("discovery exposes the signing keys endpoint", Boolean(discovery.jwks_uri));
  const jwksUrl = Bun.env.QIY_AZURE_JWKS_URL ?? discovery.jwks_uri;
  const jwksResponse = await fetch(jwksUrl);
  check("B2C JWKS is reachable", jwksResponse.ok);
  const jwks = (await jwksResponse.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  check("JWKS returns signing keys", jwks.keys.length > 0);
  check("RS256 is supported", (discovery.id_token_signing_alg_values_supported ?? ["RS256"]).includes("RS256"));

  const issuer = Bun.env.QIY_AZURE_ISSUER ?? discovery.issuer;

  // Phase B: ROPC user flow token (local account), no browser needed.
  let realToken: string | undefined = Bun.env.QIY_AZURE_ID_TOKEN;
  let realClaims: Record<string, unknown> | undefined;
  if (realToken) {
    realClaims = JSON.parse(Buffer.from(realToken.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    check("provided External ID token has an issuer", typeof realClaims.iss === "string");
    check("provided External ID token has a subject", typeof realClaims.sub === "string");
  } else if (phaseB) {
    const tokenUrl = new URL(discovery.token_endpoint);
    if (legacy) tokenUrl.searchParams.set("p", policy);
    const scope = legacy ? `openid offline_access ${clientId}` : `openid offline_access ${audience}`;
    const tokenResponse = await fetch(tokenUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}), username: username!, password: password!, scope, response_type: "id_token" }).toString(),
    });
    if (!tokenResponse.ok) {
      throw new Error("B2C ROPC token failed: " + tokenResponse.status + " " + (await tokenResponse.text()) + "\n(ensure the user flow " + policy + " is a Resource Owner Password flow and the app allows local accounts)");
    }
    const body = (await tokenResponse.json()) as { id_token?: string; access_token?: string };
    const jwt = body.id_token ?? body.access_token;
    if (!jwt) throw new Error("B2C ROPC response has no id_token/access_token");
    realToken = jwt;
    realClaims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    check("B2C ROPC minted a real token", true);
  } else {
    console.log("  skip real-token verification (External ID has no ROPC): set QIY_AZURE_ID_TOKEN from a browser login, or use a legacy B2C Resource Owner Password flow via QIY_AZURE_USERNAME/PASSWORD.");
  }

  writeFileSync(join(root, "app.qiy"), `qiy v0;
application azure-b2c-real {
  database sqlite {}
  api { client rest; }
  auth { provider azure-ad-b2c; user users; subjectField subject; roleField role; }
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

  if (phaseB && realToken && realClaims) {
    const subject = `${String(realClaims.iss)}|${String(realClaims.sub)}`;
    writeFileSync(join(server, "seed-user.ts"), `import { db } from "./src/db";
import { users } from "./src/schema";
await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: ${JSON.stringify(String(realClaims.email ?? "b2c@example.test"))}, displayName: "B2C Acceptance", role: "admin" });
console.log("seeded", ${JSON.stringify(subject)});
`);
    console.log(await must(["bun", "run", "seed-user.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } }));
  }

  const kid = (jwks.keys.find((key) => key.kid)?.kid ?? "");
  writeFileSync(join(server, "azure-b2c.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { SignJWT, generateKeyPair } from "jose";
import { createProductionAuthenticator } from "./src/auth/oidc";

const issuer = process.env.QIY_OIDC_ISSUER!;
const audience = process.env.QIY_OIDC_AUDIENCE!;
const realToken = process.env.QIY_AZURE_REAL_TOKEN;

test("rejects a forged token after fetching the real B2C JWKS", async () => {
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: "forged@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.QIY_AZURE_KID || "forged-kid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("b2c|forged")
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

test.skipIf(!realToken)("accepts a real B2C ROPC token for the mapped user", async () => {
  const authenticate = createProductionAuthenticator();
  const principal = await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + realToken } }));
  expect(principal).not.toBeNull();
  expect(principal?.role).toBe("admin");
}, 30_000);
`);

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: jwksUrl } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "azure-b2c.acceptance.test.ts"], {
    cwd: server,
    env: {
      DATABASE_URL: databaseUrl,
      QIY_OIDC_ISSUER: issuer,
      QIY_OIDC_AUDIENCE: audience,
      QIY_OIDC_JWKS_URL: jwksUrl,
      QIY_AZURE_KID: kid,
      ...(realToken ? { QIY_AZURE_REAL_TOKEN: realToken } : {}),
    },
  });
  console.log(tests);
  check("generated server verifies against the real Azure AD B2C tenant", tests.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Azure AD B2C real-tenant acceptance passed: " + root : "Azure AD B2C real-tenant acceptance FAILED");
  if (failures > 0) process.exit(1);
}

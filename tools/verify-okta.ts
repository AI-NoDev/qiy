import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Okta acceptance.
 *
 * Phase A needs only the org domain: it checks the default authorization
 * server's discovery document and JWKS, then proves the generated OIDC server
 * uses that JWKS (forged tokens are rejected by signature verification).
 *
 * Phase B (real user token via Resource Owner Password grant) additionally needs
 * an Okta OIDC Web Application with the password grant enabled, its audience and
 * an assigned test user.
 */
const domain = (Bun.env.QIY_OKTA_DOMAIN ?? "https://trial-6051350.okta.com/").replace(/\/$/, "");
const issuer = Bun.env.QIY_OKTA_ISSUER ?? `${domain}/oauth2/default`;
const audience = Bun.env.QIY_OKTA_AUDIENCE ?? "api://default";
const clientId = Bun.env.QIY_OKTA_CLIENT_ID;
const clientSecret = Bun.env.QIY_OKTA_CLIENT_SECRET;
const username = Bun.env.QIY_OKTA_USERNAME;
const password = Bun.env.QIY_OKTA_PASSWORD;
const phaseB = Boolean(clientId && clientSecret && username && password);

const root = mkdtempSync(join(tmpdir(), "qiy-okta-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "okta.sqlite");

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
  // Phase A: default authorization server discovery + JWKS.
  const discoveryResponse = await fetch(`${issuer}/.well-known/openid-configuration`);
  check("Okta default authorization server discovery is reachable", discoveryResponse.ok);
  const discovery = (await discoveryResponse.json()) as { issuer: string; jwks_uri: string; authorization_endpoint: string; token_endpoint: string; id_token_signing_alg_values_supported?: string[] };
  check("discovery issuer matches the default authorization server", discovery.issuer === issuer);
  check("discovery exposes the JWKS endpoint", discovery.jwks_uri === `${issuer}/v1/keys`);
  check("discovery exposes authorization and token endpoints", discovery.authorization_endpoint === `${issuer}/v1/authorize` && discovery.token_endpoint === `${issuer}/v1/token`);
  check("RS256 is supported", (discovery.id_token_signing_alg_values_supported ?? []).includes("RS256"));

  const jwksResponse = await fetch(discovery.jwks_uri);
  check("Okta JWKS is reachable", jwksResponse.ok);
  const jwks = (await jwksResponse.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  check("JWKS returns signing keys", jwks.keys.length > 0);
  check("JWKS advertises RS256 keys", jwks.keys.some((key) => (key.alg ?? "RS256") === "RS256"));

  // The org authorization server is also published; report whether it is enabled.
  const orgDiscovery = await fetch(`${domain}/.well-known/openid-configuration`);
  check("Okta org authorization server discovery is reachable (informational)", true);
  console.log(`  info org authorization server: ${orgDiscovery.ok ? "enabled" : "disabled/limited"} (${orgDiscovery.status})`);

  // Generate the OIDC app pointed at the real Okta authorization server.
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application okta-real {
  database sqlite {}
  api { client rest; }
  auth { provider okta; user users; subjectField subject; roleField role; }
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

  // Phase B: mint a real token through the password grant when configured.
  let realToken: string | undefined;
  let realClaims: Record<string, unknown> | undefined;
  if (phaseB) {
    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "password", client_id: clientId!, client_secret: clientSecret!, username: username!, password: password!, scope: "openid profile email" }).toString(),
    });
    if (!tokenResponse.ok) throw new Error("Okta token endpoint failed: " + tokenResponse.status + " " + (await tokenResponse.text()));
    const body = (await tokenResponse.json()) as { access_token: string; id_token?: string };
    const jwt = [body.access_token, body.id_token].find((value) => value && value.split(".").length === 3) ?? body.access_token;
    realToken = jwt;
    realClaims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    check("Okta minted a real token with the API audience", String(realClaims.aud).includes(audience));
  } else {
    console.log("  skip Okta password login (set QIY_OKTA_CLIENT_ID/CLIENT_SECRET/USERNAME/PASSWORD; the app needs the Resource Owner Password grant and the user must be assigned).");
  }

  const kid = (jwks.keys.find((key) => key.kid)?.kid ?? "");
  writeFileSync(join(server, "okta.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { SignJWT, generateKeyPair } from "jose";
import { createProductionAuthenticator } from "./src/auth/oidc";

const issuer = process.env.QIY_OIDC_ISSUER!;
const audience = process.env.QIY_OIDC_AUDIENCE!;
const realToken = process.env.QIY_OKTA_REAL_TOKEN;

test("rejects a forged token after fetching the real Okta JWKS", async () => {
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: "forged@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.QIY_OKTA_KID || "forged-kid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("okta|forged")
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

test.skipIf(!realToken)("accepts a real Okta token for the mapped user", async () => {
  const authenticate = createProductionAuthenticator();
  const principal = await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + realToken } }));
  expect(principal).not.toBeNull();
  expect(principal?.role).toBe("admin");
}, 30_000);
`);

  if (phaseB && realToken && realClaims) {
    const subject = `${String(realClaims.iss)}|${String(realClaims.sub)}`;
    writeFileSync(join(server, "seed-user.ts"), `import { db } from "./src/db";
import { users } from "./src/schema";
await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: ${JSON.stringify(String(realClaims.email ?? "okta@example.test"))}, displayName: "Okta Acceptance", role: "admin" });
console.log("seeded", ${JSON.stringify(subject)});
`);
    console.log(await must(["bun", "run", "seed-user.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } }));
  }

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: discovery.jwks_uri } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "okta.acceptance.test.ts"], {
    cwd: server,
    env: {
      DATABASE_URL: databaseUrl,
      QIY_OIDC_ISSUER: issuer,
      QIY_OIDC_AUDIENCE: audience,
      QIY_OIDC_JWKS_URL: discovery.jwks_uri,
      QIY_OKTA_KID: kid,
      ...(realToken ? { QIY_OKTA_REAL_TOKEN: realToken } : {}),
    },
  });
  console.log(tests);
  check("generated server verifies against the real Okta tenant", tests.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Okta real-tenant acceptance passed: " + root : "Okta real-tenant acceptance FAILED");
  if (failures > 0) process.exit(1);
}

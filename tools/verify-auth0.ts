import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real Auth0 acceptance.
 *
 * Phase A needs only the tenant domain: fetches the real discovery document and
 * JWKS, then makes the generated OIDC server verify against that JWKS (a forged
 * token must be rejected by signature verification, which proves the real keys
 * were fetched).
 *
 * Phase B additionally mints a real token (password grant) when client/user
 * credentials are provided and asserts the generated server accepts it.
 */
const domain = (Bun.env.QIY_AUTH0_DOMAIN ?? "dev-3c3eq3j5rm4meg4p.us.auth0.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const issuer = `https://${domain}/`;
const expectedKids = (Bun.env.QIY_AUTH0_EXPECTED_KIDS ?? "0FJCjD5IW4jOsvAUyuqYq,hLvPykYxvTS831IEJ1qaJ").split(",").map((kid) => kid.trim()).filter(Boolean);
const clientId = Bun.env.QIY_AUTH0_CLIENT_ID;
const clientSecret = Bun.env.QIY_AUTH0_CLIENT_SECRET;
const audience = Bun.env.QIY_AUTH0_AUDIENCE ?? "https://qiy-api";
const username = Bun.env.QIY_AUTH0_USERNAME;
const password = Bun.env.QIY_AUTH0_PASSWORD;
const phaseB = Boolean(clientId && username && password);

const root = mkdtempSync(join(tmpdir(), "qiy-auth0-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "auth0.sqlite");

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
  // Phase A: real discovery + JWKS.
  const discoveryResponse = await fetch(issuer + ".well-known/openid-configuration");
  check("Auth0 discovery is reachable", discoveryResponse.ok);
  const discovery = (await discoveryResponse.json()) as { issuer: string; jwks_uri: string; token_endpoint: string; id_token_signing_alg_values_supported?: string[] };
  check("discovery issuer matches the tenant", discovery.issuer === issuer);
  check("discovery exposes the JWKS endpoint", discovery.jwks_uri === issuer + ".well-known/jwks.json");
  check("discovery exposes the token endpoint", discovery.token_endpoint === issuer + "oauth/token");
  check("RS256 is an advertised signing algorithm", (discovery.id_token_signing_alg_values_supported ?? []).includes("RS256"));

  const jwksResponse = await fetch(discovery.jwks_uri);
  check("Auth0 JWKS is reachable", jwksResponse.ok);
  const jwks = (await jwksResponse.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  const kids = jwks.keys.map((key) => key.kid ?? "");
  check("JWKS returns signing keys", jwks.keys.length > 0);
  for (const kid of expectedKids) check(`JWKS contains key ${kid} (rotation queue)`, kids.includes(kid));

  // Generate the OIDC app and point it at the real tenant.
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application auth0-real {
  database sqlite {}
  api { client rest; }
  auth { provider auth0; user users; subjectField subject; roleField role; }
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

  // Phase B (optional): mint a real token through Auth0's token endpoint.
  let realToken: string | undefined;
  let realClaims: Record<string, unknown> | undefined;
  if (phaseB) {
    const tokenResponse = await fetch(issuer + "oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password", client_id: clientId, client_secret: clientSecret, username, password, audience, scope: "openid email profile" }),
    });
    if (!tokenResponse.ok) throw new Error("Auth0 token endpoint failed: " + tokenResponse.status + " " + (await tokenResponse.text()));
    const body = (await tokenResponse.json()) as { access_token: string };
    realToken = body.access_token;
    realClaims = JSON.parse(Buffer.from(realToken.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    check("Auth0 minted a real token with the requested audience", String(realClaims.aud).includes(audience));
    // A token minted without the API audience only carries the client id as audience.
    const wrongResponse = await fetch(issuer + "oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password", client_id: clientId, client_secret: clientSecret, username, password, scope: "openid" }),
    });
    if (wrongResponse.ok) {
      const wrong = (await wrongResponse.json()) as { access_token?: string; id_token?: string };
      const wrongToken = wrong.access_token ?? wrong.id_token;
      writeFileSync(join(root, "wrong-audience.txt"), wrongToken ?? "");
    }
    writeFileSync(join(root, "real-token.txt"), realToken);
  } else {
    console.log(`  skip Auth0 password login (set QIY_AUTH0_CLIENT_ID, QIY_AUTH0_USERNAME, QIY_AUTH0_PASSWORD 鈥?and QIY_AUTH0_CLIENT_SECRET for confidential clients 鈥?to verify a real token).`);
  }

  writeFileSync(join(server, "auth0.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { SignJWT, importPKCS8, generateKeyPair } from "jose";
import { createProductionAuthenticator } from "./src/auth/oidc";

const issuer = process.env.QIY_OIDC_ISSUER!;
const audience = process.env.QIY_OIDC_AUDIENCE!;
const realToken = process.env.QIY_AUTH0_REAL_TOKEN;
const wrongToken = process.env.QIY_AUTH0_WRONG_TOKEN;

test("rejects a forged token even though the real JWKS is reachable", async () => {
  // A random RSA key produces a token with the right iss/aud but an unknown signature,
  // so jose must fetch the real Auth0 JWKS and then fail signature verification.
  const { privateKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({ scope: "openid" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.QIY_AUTH0_KID ?? "forged-kid" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("auth0|forged")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const authenticate = createProductionAuthenticator();
  const request = new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + forged } });
  let error: unknown;
  try { await authenticate(request); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  expect(String(error)).toMatch(/signature|no matching key/i);
}, 30_000);

test("rejects malformed and missing bearer tokens", async () => {
  const authenticate = createProductionAuthenticator();
  expect(await authenticate(new Request("http://localhost/api/v1/notes"))).toBeNull();
  let malformedRejected = false;
  try { await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer not-a-jwt" } })); }
  catch { malformedRejected = true; }
  expect(malformedRejected).toBe(true);
}, 20_000);

test.skipIf(!realToken)("accepts a real Auth0 token and rejects the wrong audience", async () => {
  const authenticate = createProductionAuthenticator();
  const principal = await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + realToken } }));
  expect(principal).not.toBeNull();
  expect(principal?.role).toBe("admin");
  if (wrongToken) {
    let rejected = false;
    try { const wrong = await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + wrongToken } })); rejected = wrong === null; }
    catch { rejected = true; }
    expect(rejected).toBe(true);
  }
  expect(await authenticate(new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + realToken?.slice(0, -3) + "xxx" } }))).toBeNull();
}, 30_000);
`);

  // The DB row uses the real iss|sub mapping for phase B.
  if (phaseB && realToken && realClaims) {
    const subject = `${String(realClaims.iss)}|${String(realClaims.sub)}`;
    writeFileSync(join(server, "seed-user.ts"), `import { db } from "./src/db";
import { users } from "./src/schema";
await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: ${JSON.stringify(String(realClaims.email ?? "auth0@example.test"))}, displayName: "Auth0 Acceptance", role: "admin" });
console.log("seeded", ${JSON.stringify(subject)});
`);
    console.log(await must(["bun", "run", "src/../seed-user.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } }).catch(async () => must(["bun", "run", "seed-user.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } })));
  }

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: discovery.jwks_uri } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "auth0.acceptance.test.ts"], {
    cwd: server,
    env: {
      DATABASE_URL: databaseUrl,
      QIY_OIDC_ISSUER: issuer,
      QIY_OIDC_AUDIENCE: audience,
      QIY_OIDC_JWKS_URL: discovery.jwks_uri,
      ...(expectedKids[0] ? { QIY_AUTH0_KID: expectedKids[0] } : {}),
      ...(realToken ? { QIY_AUTH0_REAL_TOKEN: realToken } : {}),
      ...(Bun.file(join(root, "wrong-audience.txt")).size ? { QIY_AUTH0_WRONG_TOKEN: (await Bun.file(join(root, "wrong-audience.txt")).text()).trim() } : {}),
    },
  });
  console.log(tests);
  check("generated server verifies against the real Auth0 tenant", tests.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Auth0 real-tenant acceptance passed: " + root : "Auth0 real-tenant acceptance FAILED");
  if (failures > 0) process.exit(1);
}

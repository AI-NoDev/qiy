import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for remote JWKS handling in the generated OIDC authenticator.
 * A local HTTPS identity provider rotates its signing keys while the generated
 * server keeps the same authenticator instance, proving that a new key is picked
 * up without a restart, that a retired key stops being accepted, that cached keys
 * are not refetched per request, and that the JWKS fetch stays bounded.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-oidc-rotation-"));
const admin = join(root, "admin");
const idpPort = 19443;

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application oidc-rotation {
  database sqlite {}
  auth { provider oidc; user users; subjectField subject; roleField role; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field subject Text @unique;
    field role userRole;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);
const server = join(admin, "apps/server");

await run(["docker", "run", "--rm", "--mount", `type=bind,source=${resolve(root)},target=/certs`, "alpine:3", "sh", "-c", "apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:2048 -nodes -keyout /certs/key.pem -out /certs/cert.pem -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 >/dev/null 2>&1"], root);

writeFileSync(join(server, "tests/oidc-rotation.acceptance.test.ts"), acceptance());
await run(["bun", "install"], admin);
console.log(await run(["bun", "test", "--preload", "./tests/setup.ts", "tests/oidc-rotation.acceptance.test.ts"], server, {
  DATABASE_URL: ":memory:",
  NODE_EXTRA_CA_CERTS: join(root, "cert.pem"),
  QIY_TEST_TLS_CERT: join(root, "cert.pem"),
  QIY_TEST_TLS_KEY: join(root, "key.pem"),
  QIY_OIDC_ISSUER: `https://localhost:${idpPort}`,
  QIY_OIDC_AUDIENCE: "qiy-rotation",
  QIY_OIDC_JWKS_URL: `https://localhost:${idpPort}/.well-known/jwks.json`,
  QIY_OIDC_JWKS_TIMEOUT_MS: "400",
  QIY_OIDC_JWKS_COOLDOWN_MS: "0",
  QIY_OIDC_JWKS_CACHE_MAX_AGE_MS: "1200",
}));
console.log(await run(["bun", "run", "typecheck"], server, { DATABASE_URL: ":memory:" }));
console.log(`OIDC JWKS rotation acceptance passed: ${root}`);

function acceptance(): string {
  return `import { afterAll, beforeAll, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { db, client } from "../src/db";
import { users } from "../src/schema";
import { createApp, type Repositories } from "../src/app";
import { createProductionAuthenticator } from "../src/auth/oidc";

const issuer = Bun.env.QIY_OIDC_ISSUER!;
const audience = Bun.env.QIY_OIDC_AUDIENCE!;
const subject = "rotation-user";
const userId = "00000000-0000-4000-8000-0000000000b1";
const port = Number(new URL(issuer).port);

// The identity provider publishes the active key set on demand so the test can
// rotate keys while the generated server keeps running.
let published: Array<Record<string, unknown>> = [];
let jwksFetches = 0;
let jwksHangs = false;
let server: ReturnType<typeof Bun.serve>;
const keys: Record<string, { privateKey: CryptoKey; jwk: Record<string, unknown> }> = {};

async function mint(kid: string, key: CryptoKey = keys[kid]!.privateKey, options: { issuer?: string; audience?: string } = {}): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

beforeAll(async () => {
  for (const kid of ["key-1", "key-2"]) {
    const pair = await generateKeyPair("RS256", { extractable: true });
    keys[kid] = { privateKey: pair.privateKey, jwk: { ...await exportJWK(pair.publicKey), kid, alg: "RS256", use: "sig" } };
  }
  published = [keys["key-1"]!.jwk];
  server = Bun.serve({
    port,
    tls: { cert: Bun.file(Bun.env.QIY_TEST_TLS_CERT!), key: Bun.file(Bun.env.QIY_TEST_TLS_KEY!) },
    async fetch(request) {
      if (new URL(request.url).pathname !== "/.well-known/jwks.json") return new Response(null, { status: 404 });
      jwksFetches++;
      if (jwksHangs) await new Promise((resolve) => setTimeout(resolve, 4000));
      return Response.json({ keys: published });
    },
  });
  client.exec("CREATE TABLE users (id text primary key, subject text unique not null, role text not null)");
  await db.insert(users).values({ id: userId, subject: issuer + "|" + subject, role: "admin" });
});

afterAll(() => { server.stop(true); client.close(); });

// One authenticator for the whole file: key rotation must not require a restart.
const authenticate = createProductionAuthenticator();
const app = await createApp({} as Repositories, authenticate, false, false, [], false);
const http = Bun.serve({ port: 0, fetch: (request) => app.handle(request) });
const me = (token: string) => fetch(new URL("/api/v1/auth/me", http.url), { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(15_000) });

test("rotates signing keys without restarting the authenticator", async () => {
  const first = await mint("key-1");
  expect((await me(first)).status).toBe(200);
  // A key the provider has not published yet must not be accepted.
  expect((await me(await mint("key-2"))).status).toBe(401);

  // Grace period: the provider publishes the successor before signing with it.
  published = [keys["key-1"]!.jwk, keys["key-2"]!.jwk];
  const second = await mint("key-2");
  expect((await me(second)).status).toBe(200);
  expect(jwksFetches).toBeGreaterThan(1);

  // Cached keys must not be refetched for every request.
  const before = jwksFetches;
  for (let index = 0; index < 5; index++) expect((await me(second)).status).toBe(200);
  expect(jwksFetches).toBe(before);
});

test("bounds revoked key acceptance by the configured JWKS cache age", async () => {
  const first = await mint("key-1");
  const second = await mint("key-2");
  // Retirement: only the successor remains published. While the cache is still
  // fresh the retired key keeps working, which is why cache age is the revocation
  // latency bound and why it is configurable per identity provider.
  published = [keys["key-2"]!.jwk];
  expect((await me(second)).status).toBe(200);
  expect((await me(first)).status).toBe(200);

  // Once the cached set ages out (QIY_OIDC_JWKS_CACHE_MAX_AGE_MS is 1200ms here)
  // the next verification refetches and the retired key is refused.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  expect((await me(first)).status).toBe(401);
  expect((await me(second)).status).toBe(200);
});

test("rejects unsigned tokens, algorithm confusion, foreign keys and wrong claims", async () => {
  const token = await mint("key-2");
  const [header, payload] = token.split(".");
  expect((await me(header + "." + payload + ".")).status).toBe(401);

  // Classic RS256 to HS256 confusion: the public JWK material is used as the HMAC secret.
  const confused = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256", kid: "key-2" })
    .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode(JSON.stringify(keys["key-2"]!.jwk)));
  expect((await me(confused)).status).toBe(401);

  const stranger = await generateKeyPair("RS256", { extractable: true });
  expect((await me(await mint("key-2", stranger.privateKey))).status).toBe(401);
  expect((await me(await mint("key-2", keys["key-2"]!.privateKey, { issuer: issuer + "/wrong" }))).status).toBe(401);
  expect((await me(await mint("key-2", keys["key-2"]!.privateKey, { audience: audience + "-wrong" }))).status).toBe(401);
});

test("bounds the JWKS request instead of hanging the login path", async () => {
  jwksHangs = true;
  const stranger = await generateKeyPair("RS256", { extractable: true });
  const started = Date.now();
  const response = await me(await mint("key-unknown", stranger.privateKey));
  const elapsed = Date.now() - started;
  jwksHangs = false;
  // QIY_OIDC_JWKS_TIMEOUT_MS is 400ms here; a hanging JWKS must not hold the request open.
  expect(elapsed).toBeLessThan(3000);
  expect(response.status).toBe(401);
});

test("fails closed on invalid JWKS tuning values", () => {
  const original = { timeout: Bun.env.QIY_OIDC_JWKS_TIMEOUT_MS, cooldown: Bun.env.QIY_OIDC_JWKS_COOLDOWN_MS, cache: Bun.env.QIY_OIDC_JWKS_CACHE_MAX_AGE_MS };
  try {
    Bun.env.QIY_OIDC_JWKS_TIMEOUT_MS = "not-a-number";
    expect(() => createProductionAuthenticator()).toThrow("QIY_OIDC_JWKS_TIMEOUT_MS must be an integer of at least 1");
    Bun.env.QIY_OIDC_JWKS_TIMEOUT_MS = "0";
    expect(() => createProductionAuthenticator()).toThrow("QIY_OIDC_JWKS_TIMEOUT_MS must be an integer of at least 1");
    Bun.env.QIY_OIDC_JWKS_TIMEOUT_MS = "400";
    Bun.env.QIY_OIDC_JWKS_COOLDOWN_MS = "-1";
    expect(() => createProductionAuthenticator()).toThrow("QIY_OIDC_JWKS_COOLDOWN_MS must be an integer of at least 0");
    Bun.env.QIY_OIDC_JWKS_COOLDOWN_MS = "0";
    Bun.env.QIY_OIDC_JWKS_CACHE_MAX_AGE_MS = "0";
    expect(() => createProductionAuthenticator()).toThrow("QIY_OIDC_JWKS_CACHE_MAX_AGE_MS must be an integer of at least 1");
    Bun.env.QIY_OIDC_JWKS_CACHE_MAX_AGE_MS = "600000";
    expect(createProductionAuthenticator()).toBeFunction();
  } finally {
    Bun.env.QIY_OIDC_JWKS_TIMEOUT_MS = original.timeout;
    Bun.env.QIY_OIDC_JWKS_COOLDOWN_MS = original.cooldown;
    Bun.env.QIY_OIDC_JWKS_CACHE_MAX_AGE_MS = original.cache;
  }
});
`;
}

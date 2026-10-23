import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Offline acceptance for multi-provider authentication.
 *
 * Generates an app with several configured OIDC providers (one of them using a
 * dedicated identity column and a non-sub claim such as `openid`), serves the
 * JWKS documents from a local HTTP server, and verifies that the generated
 * server routes each token to the right provider, maps per-provider user
 * columns, exposes the public provider list for the multi-select login page and
 * rejects forged or unknown-issuer tokens.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-multi-provider-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "multi.sqlite");

async function run(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number; output: string }> {
  const executable = command[0] === "bun" ? process.execPath : command[0]!;
  const child = Bun.spawn([executable, ...command.slice(1)], { cwd: options.cwd ?? root, env: { ...process.env, ...(options.env ?? {}) }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 600_000);
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
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application multi-provider-acceptance {
  database sqlite {}
  api { client rest; }
  auth {
    providers google, oidc, okta;
    user users;
    subjectField subject;
    roleField role;
    provider google { subjectField googleSubject; }
    provider oidc { subjectField openidField; claim openid; }
  }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field subject Text @unique;
    field googleSubject Text @nullable;
    field openidField Text @nullable;
    field email Text;
    field role userRole;
  }
  entity notes { field id UUID @id; field title Text; }
}
`);
  console.log(`workspace ${root}`);
  await generateApp(join(root, "app.qiy"), admin);
  await must(["bun", "install"], { cwd: admin });
  await must(["bun", "run", "db:generate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });
  await must(["bun", "run", "db:migrate"], { cwd: server, env: { DATABASE_URL: databaseUrl } });

  writeFileSync(join(server, "multi.acceptance.test.ts"), `import { afterAll, beforeAll, expect, test } from "bun:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { db } from "./src/db";
import { users } from "./src/schema";
import { createProductionAuthenticator, publicAuthProviders } from "./src/auth/oidc";

const issuers = { google: "https://provider-google.example", oidc: "https://provider-oidc.example" };
const jwksServer = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/google" || path === "/oidc") {
    const { jwks } = keys[path.slice(1)];
    return Response.json(jwks);
  }
  return new Response("not found", { status: 404 });
} });
const keys: Record<string, { privateKey: CryptoKey; jwks: { keys: unknown[] } }> = {} as never;

beforeAll(async () => {
  for (const provider of ["google", "oidc"] as const) {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    keys[provider] = { privateKey, jwks: { keys: [{ ...jwk, kid: "kid-" + provider, alg: "RS256", use: "sig" }] } };
  }
  await db.insert(users).values([
    { id: "00000000-0000-4000-8000-000000000001", subject: issuers.google + "|google-user", email: "g@example.test", role: "admin" },
    { id: "00000000-0000-4000-8000-000000000002", subject: "unused", googleSubject: "google-user", email: "g2@example.test", role: "operator" },
    { id: "00000000-0000-4000-8000-000000000003", subject: "unused-2", openidField: "openid-user", email: "o@example.test", role: "viewer" },
  ] as never);
});
afterAll(() => jwksServer.stop(true));

function providerEnv(provider: string, issuer: string, audience: string): void {
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_ISSUER"] = issuer;
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_AUDIENCE"] = audience;
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_JWKS_URL"] = "http://127.0.0.1:" + jwksServer.port + "/" + provider;
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_AUTHORIZATION_URL"] = "https://auth.example/" + provider;
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_TOKEN_URL"] = "https://token.example/" + provider;
  Bun.env["QIY_OIDC_" + provider.toUpperCase() + "_CLIENT_ID"] = "client-" + provider;
}

const request = (token: string) => new Request("http://localhost/api/v1/notes", { headers: { Authorization: "Bearer " + token } });

test("routes a Google token to its own JWKS and maps the default subject", async () => {
  providerEnv("google", issuers.google, "aud-google");
  const token = await new SignJWT({ email: "g@example.test" }).setProtectedHeader({ alg: "RS256", kid: "kid-google" })
    .setIssuer(issuers.google).setAudience("aud-google").setSubject("google-user").setIssuedAt().setExpirationTime("5m").sign(keys.google.privateKey);
  const principal = await createProductionAuthenticator()(request(token));
  expect(principal?.role).toBe("operator");
  expect(principal?.id).toBe("00000000-0000-4000-8000-000000000002");
}, 30_000);

test("maps a non-sub identity claim into the provider-specific user column", async () => {
  providerEnv("oidc", issuers.oidc, "aud-oidc");
  const token = await new SignJWT({ openid: "openid-user", email: "o@example.test" }).setProtectedHeader({ alg: "RS256", kid: "kid-oidc" })
    .setIssuer(issuers.oidc).setAudience("aud-oidc").setSubject("ignored-subject").setIssuedAt().setExpirationTime("5m").sign(keys.oidc.privateKey);
  const principal = await createProductionAuthenticator()(request(token));
  expect(principal?.role).toBe("viewer");
  expect(principal?.id).toBe("00000000-0000-4000-8000-000000000003");
}, 30_000);

test("rejects a token whose issuer is not configured or whose signature is forged", async () => {
  providerEnv("google", issuers.google, "aud-google");
  providerEnv("oidc", issuers.oidc, "aud-oidc");
  const authenticate = createProductionAuthenticator();
  const unknown = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "kid-google" })
    .setIssuer("https://unknown.example").setAudience("aud-google").setSubject("x").setIssuedAt().setExpirationTime("5m").sign(keys.google.privateKey);
  expect(await authenticate(request(unknown))).toBeNull();
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "kid-google" })
    .setIssuer(issuers.google).setAudience("aud-google").setSubject("google-user").setIssuedAt().setExpirationTime("5m").sign(otherKey);
  let rejected = false;
  try { await authenticate(request(forged)); } catch { rejected = true; }
  expect(rejected).toBe(true);
}, 30_000);

test("public provider list drives the multi-select login page", () => {
  providerEnv("google", issuers.google, "aud-google");
  providerEnv("oidc", issuers.oidc, "aud-oidc");
  Bun.env.QIY_OIDC_OKTA_ISSUER = "";
  const providers = publicAuthProviders();
  expect(providers.map((provider) => provider.id)).toEqual(["google", "oidc"]);
  expect(providers.every((provider) => provider.authorizationUrl && provider.clientId && provider.scope)).toBe(true);
  expect(providers.some((provider) => provider.id === "okta")).toBe(false);
}, 20_000);
`);

  const output = await must(["bun", "test", "--preload", "./tests/setup.ts", "multi.acceptance.test.ts"], { cwd: server, env: { DATABASE_URL: databaseUrl } });
  console.log(output);
  check("generated multi-provider server passed the offline acceptance", output.includes("0 fail"));
} finally {
  console.log(failures === 0 ? "Multi-provider acceptance passed: " + root : "Multi-provider acceptance FAILED");
  if (failures > 0) process.exit(1);
}

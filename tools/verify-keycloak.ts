import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real vendor-grade IdP acceptance: run Keycloak in Docker (HTTPS, realm import),
 * mint tokens through its token endpoint and verify the generated OIDC server
 * accepts them, maps identities and rejects the wrong audience.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-keycloak-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "keycloak.sqlite");
const container = "qiy-keycloak";
const port = 8543;
const issuer = `https://localhost:${port}/realms/qiy`;
const audience = "qiy-api";
const jwksUrl = `${issuer}/protocol/openid-connect/certs`;
const tokenUrl = `${issuer}/protocol/openid-connect/token`;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

async function run(command: string[], options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number; output: string }> {
  // Resolve the runtime by path: child processes may not inherit the `bun` PATH entry on Windows.
  const executable = command[0] === "bun" ? process.execPath : command[0]!;
  const child = Bun.spawn([executable, ...command.slice(1)], { cwd: options.cwd ?? root, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0", ...(options.env ?? {}) }, stdout: "pipe", stderr: "pipe" });
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

// 1) TLS certificate for Keycloak (the generated OIDC authenticator requires HTTPS).
//    openssl comes from the local .NET SDK image (no apk network needed) and the
//    key is world-readable because Keycloak runs as a non-root user.
await must(["docker", "run", "--rm", "-v", `${root}:/certs`, "mcr.microsoft.com/dotnet/sdk:8.0", "sh", "-c",
  "openssl req -x509 -newkey rsa:2048 -nodes -keyout /certs/key.pem -out /certs/cert.pem -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 && chmod 644 /certs/key.pem /certs/cert.pem"]);

// 2) Realm with a client that mints qiy-api audience tokens and one that does not.
writeFileSync(join(root, "realm.json"), JSON.stringify({
  realm: "qiy",
  enabled: true,
  sslRequired: "none",
  registrationAllowed: false,
  accessTokenLifespan: 600,
  clients: [
    {
      clientId: "qiy-acceptance",
      enabled: true,
      publicClient: true,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: false,
      protocol: "openid-connect",
      protocolMappers: [
        { name: "qiy-audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", config: { "included.custom.audience": audience, "access.token.claim": "true", "id.token.claim": "false" } },
        { name: "tenant-claim", protocol: "openid-connect", protocolMapper: "oidc-hardcoded-claim-mapper", config: { "claim.name": "tenantCustomerId", "claim.value": "customer-1", "jsonType.label": "String", "access.token.claim": "true", "id.token.claim": "false" } },
      ],
    },
    {
      clientId: "qiy-other",
      enabled: true,
      publicClient: true,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: false,
      protocol: "openid-connect",
    },
  ],
  users: [
    {
      username: "acceptance",
      enabled: true,
      email: "acceptance@example.test",
      emailVerified: true,
      firstName: "Acceptance",
      lastName: "Tester",
      attributes: { tenantId: ["customer-1"] },
      credentials: [{ type: "password", value: "acceptance-password", temporary: false }],
    },
    {
      username: "unmapped",
      enabled: true,
      email: "unmapped@example.test",
      emailVerified: true,
      firstName: "Unmapped",
      lastName: "Tester",
      credentials: [{ type: "password", value: "acceptance-password", temporary: false }],
    },
  ],
}, null, 2));

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  await must(["docker", "rm", "-f", container]);
  await must(["docker", "run", "-d", "--name", container, "-p", `${port}:8443`,
    "-e", "KC_BOOTSTRAP_ADMIN_USERNAME=admin",
    "-e", "KC_BOOTSTRAP_ADMIN_PASSWORD=admin",
    "-v", `${join(root, "realm.json")}:/opt/keycloak/data/import/realm.json:ro`,
    "-v", `${join(root, "cert.pem")}:/opt/keycloak/conf/tls.crt:ro`,
    "-v", `${join(root, "key.pem")}:/opt/keycloak/conf/tls.key:ro`,
    "keycloak/keycloak:26.0.5",
    "start-dev", "--import-realm", "--https-port=8443",
    "--https-certificate-file=/opt/keycloak/conf/tls.crt",
    "--https-certificate-key-file=/opt/keycloak/conf/tls.key",
    "--http-enabled=true",
    `--hostname=https://localhost:${port}`,
    "--hostname-strict=false",
  ], { timeoutMs: 600_000 });

  let discovery: Response | undefined;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (response.ok) { discovery = response; break; }
    } catch { /* still booting */ }
    await Bun.sleep(2000);
  }
  check("Keycloak serves HTTPS discovery", Boolean(discovery));
  if (!discovery) throw new Error("Keycloak did not become ready: " + (await run(["docker", "logs", container])).output.slice(-2000));

  const token = async (clientId: string, username: string): Promise<{ token: string; claims: Record<string, unknown> }> => {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", client_id: clientId, username, password: "acceptance-password", scope: "openid" }).toString(),
    });
    if (!response.ok) throw new Error("token endpoint failed: " + response.status + " " + (await response.text()));
    const body = (await response.json()) as { access_token: string };
    const claims = JSON.parse(Buffer.from(body.access_token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    return { token: body.access_token, claims };
  };
  const accepted = await token("qiy-acceptance", "acceptance");
  console.log("token claims: " + Object.keys(accepted.claims).join(", "));
  check("Keycloak mints a token with the qiy-api audience", String(accepted.claims.aud).includes(audience));
  check("Keycloak carries a flat tenant claim", accepted.claims.tenantCustomerId === "customer-1");

  // 3) Generated server with the real issuer/JWKS.
  writeFileSync(join(root, "app.qiy"), `qiy v0;
application keycloak-real {
  database sqlite {}
  api { client rest; }
  auth { provider oidc; user users; subjectField subject; roleField role; }
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

  const subject = `${String(accepted.claims.iss)}|${String(accepted.claims.sub)}`;
  const unmapped = await token("qiy-acceptance", "unmapped");
  const other = await token("qiy-other", "acceptance");
  writeFileSync(join(server, "keycloak.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "./src/db";
import { users } from "./src/schema";
import { createApp } from "./src/app";
import { NotesRepository } from "./src/modules/notes/notes.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { createProductionAuthenticator } from "./src/auth/oidc";

const tokens = {
  accepted: ${JSON.stringify(accepted.token)},
  other: ${JSON.stringify(other.token)},
  unmapped: ${JSON.stringify(unmapped.token)},
};
const app = () => createApp({ users: UsersRepository, notes: NotesRepository }, createProductionAuthenticator() as never);
const request = async (path: string, token?: string) => (await app()).handle(new Request("http://localhost" + path, { headers: token ? { Authorization: "Bearer " + token } : {} }));

test("verifies real Keycloak tokens and maps the database identity", async () => {
  const client = (await import("./src/db")).client;
  await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: "acceptance@example.test", displayName: "Acceptance", role: "admin" });
  // A matching token is accepted and keeps the identity, role and tenant claim.
  const me = await request("/api/v1/auth/me", tokens.accepted);
  expect(me.status).toBe(200);
  const principal = await me.json() as { role: string; claims?: Record<string, unknown> };
  expect(principal.role).toBe("admin");
  expect(principal.claims?.tenantCustomerId).toBe("customer-1");
  const notes = await request("/api/v1/notes", tokens.accepted);
  expect(notes.status).toBe(200);
  // Tokens without the required audience are rejected by the generated authenticator.
  expect((await request("/api/v1/notes", tokens.other)).status).toBe(401);
  // Tokens whose subject has no user row are rejected too.
  expect((await request("/api/v1/notes", tokens.unmapped)).status).toBe(401);
  // Anonymous requests are rejected.
  expect((await request("/api/v1/notes")).status).toBe(401);
  client.close();
});
`);

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: jwksUrl } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "keycloak.acceptance.test.ts"], {
    cwd: server,
    env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: jwksUrl, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  });
  console.log(tests);
  check("generated server verifies Keycloak tokens", tests.includes("0 fail"));
} finally {
  await run(["docker", "rm", "-f", container]);
  console.log(failures === 0 ? "Keycloak real-IdP acceptance passed: " + root : "Keycloak real-IdP acceptance FAILED");
  if (failures > 0) process.exit(1);
}

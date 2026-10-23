import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real OIDC provider acceptance: run Dex (CNCF identity provider) in Docker with
 * HTTPS, mint tokens through its token endpoint and verify the generated OIDC
 * server accepts them, maps identities and rejects the wrong audience.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-dex-"));
const admin = join(root, "admin");
const server = join(admin, "apps/server");
const databaseUrl = join(root, "dex.sqlite");
const container = "qiy-dex";
const port = 8543;
const issuer = `https://localhost:${port}/dex`;
const audience = "qiy-acceptance";
const jwksUrl = `${issuer}/keys`;
const tokenUrl = `${issuer}/token`;
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

// TLS certificate: the generated authenticator requires an HTTPS issuer.
await must(["docker", "run", "--rm", "-v", `${root}:/certs`, "mcr.microsoft.com/dotnet/sdk:8.0", "sh", "-c",
  "openssl req -x509 -newkey rsa:2048 -nodes -keyout /certs/tls.key -out /certs/tls.crt -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 && chmod 644 /certs/tls.key /certs/tls.crt"]);

// Dex static users need bcrypt hashes; Bun can produce them.
const passwordHash = await Bun.password.hash("acceptance-password", { algorithm: "bcrypt" });
writeFileSync(join(root, "dex.yaml"), `issuer: ${issuer}
storage:
  type: memory
web:
  https: 0.0.0.0:${port}
  tlsCert: /etc/dex/tls.crt
  tlsKey: /etc/dex/tls.key
oauth2:
  skipApprovalScreen: true
  passwordConnector: local
enablePasswordDB: true
staticClients:
  - id: ${audience}
    name: Qiy Acceptance
    public: true
    redirectURIs:
      - "http://localhost:5173/login"
  - id: qiy-other
    name: Qiy Wrong Audience
    public: true
    redirectURIs:
      - "http://localhost:5173/login"
staticPasswords:
  - email: acceptance@example.test
    hash: ${passwordHash}
    username: acceptance
    userID: "00000000-0000-4000-8000-0000000000aa"
  - email: unmapped@example.test
    hash: ${passwordHash}
    username: unmapped
    userID: "00000000-0000-4000-8000-0000000000bb"
`);

let failures = 0;
const check = (label: string, condition: boolean) => {
  if (condition) console.log("  ok   " + label);
  else { failures += 1; console.log("  FAIL " + label); }
};

try {
  await must(["docker", "rm", "-f", container]);
  await must(["docker", "run", "-d", "--name", container, "-p", `${port}:${port}`,
    "-v", `${join(root, "dex.yaml")}:/etc/dex/config.yaml:ro`,
    "-v", `${join(root, "tls.crt")}:/etc/dex/tls.crt:ro`,
    "-v", `${join(root, "tls.key")}:/etc/dex/tls.key:ro`,
    "ghcr.io/dexidp/dex:v2.41.1",
    "dex", "serve", "/etc/dex/config.yaml",
  ], { timeoutMs: 600_000 });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (response.ok) { ready = true; break; }
    } catch { /* still booting */ }
    await Bun.sleep(1000);
  }
  check("Dex serves HTTPS discovery", ready);
  if (!ready) throw new Error("Dex did not become ready: " + (await run(["docker", "logs", container])).output.slice(-2000));

  const mint = async (clientId: string, username: string): Promise<{ token: string; claims: Record<string, unknown> }> => {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "password", username, password: "acceptance-password", client_id: clientId, scope: "openid email groups" }).toString(),
    });
    if (!response.ok) throw new Error("token endpoint failed: " + response.status + " " + (await response.text()));
    const body = (await response.json()) as { access_token: string; id_token?: string };
    const jwt = [body.access_token, body.id_token].find((value) => value && value.split(".").length === 3) ?? body.access_token;
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    return { token: jwt, claims };
  };
  const accepted = await mint(audience, "acceptance@example.test");
  check("Dex mints a JWT with the expected audience", String(accepted.claims.aud).includes(audience));
  check("Dex carries the user email claim", typeof accepted.claims.email === "string");

  writeFileSync(join(root, "app.qiy"), `qiy v0;
application dex-real {
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

  const untracked = await mint(audience, "unmapped@example.test");
  const wrongAudience = await mint("qiy-other", "acceptance@example.test");
  const subject = `${String(accepted.claims.iss)}|${String(accepted.claims.sub)}`;
  writeFileSync(join(server, "dex.acceptance.test.ts"), `import { expect, test } from "bun:test";
import { db } from "./src/db";
import { users } from "./src/schema";
import { createApp } from "./src/app";
import { NotesRepository } from "./src/modules/notes/notes.repository";
import { UsersRepository } from "./src/modules/users/users.repository";
import { createProductionAuthenticator } from "./src/auth/oidc";

const tokens = {
  accepted: ${JSON.stringify(accepted.token)},
  wrongAudience: ${JSON.stringify(wrongAudience.token)},
  untracked: ${JSON.stringify(untracked.token)},
};
const app = () => createApp({ users: UsersRepository, notes: NotesRepository }, createProductionAuthenticator() as never);
const request = async (path: string, token?: string) => (await app()).handle(new Request("http://localhost" + path, { headers: token ? { Authorization: "Bearer " + token } : {} }));

test("verifies real Dex tokens and maps the database identity", async () => {
  const client = (await import("./src/db")).client;
  await db.insert(users).values({ id: "00000000-0000-4000-8000-000000000001", subject: ${JSON.stringify(subject)}, email: "acceptance@example.test", displayName: "Acceptance", role: "admin" });
  const me = await request("/api/v1/auth/me", tokens.accepted);
  expect(me.status).toBe(200);
  const principal = await me.json() as { role: string; claims?: Record<string, unknown> };
  expect(principal.role).toBe("admin");
  expect(principal.claims?.email).toBe("acceptance@example.test");
  expect((await request("/api/v1/notes", tokens.accepted)).status).toBe(200);
  // A token minted for another client carries the wrong audience.
  expect((await request("/api/v1/notes", tokens.wrongAudience)).status).toBe(401);
  // A valid token whose subject has no users row is rejected.
  expect((await request("/api/v1/notes", tokens.untracked)).status).toBe(401);
  expect((await request("/api/v1/notes")).status).toBe(401);
  client.close();
});
`);

  await must(["bun", "run", "typecheck"], { cwd: server, env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: jwksUrl } });
  const tests = await must(["bun", "test", "--preload", "./tests/setup.ts", "dex.acceptance.test.ts"], {
    cwd: server,
    env: { DATABASE_URL: databaseUrl, QIY_OIDC_ISSUER: issuer, QIY_OIDC_AUDIENCE: audience, QIY_OIDC_JWKS_URL: jwksUrl, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
  });
  console.log(tests);
  check("generated server verifies Dex tokens", tests.includes("0 fail"));
} finally {
  await run(["docker", "rm", "-f", container]);
  console.log(failures === 0 ? "Dex real-IdP acceptance passed: " + root : "Dex real-IdP acceptance FAILED");
  if (failures > 0) process.exit(1);
}

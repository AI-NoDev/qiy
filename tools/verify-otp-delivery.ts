import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateApp } from "./commands/generate-app";

/**
 * Real acceptance for the OTP delivery boundary. It generates an OTP admin,
 * mints a local TLS certificate, then runs a test process that talks to a real
 * HTTPS delivery provider and exercises the generated route end to end: payload
 * shape, bearer credential, provider rejection, provider timeout, non-TLS
 * configuration, development-only dev code and identifier enumeration.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-otp-delivery-"));
const admin = join(root, "admin");

async function run(command: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

writeFileSync(join(root, "app.qiy"), `qiy v0;
application otp-acceptance {
  database sqlite {}
  auth { provider otp; user users; usernameField email; roleField role; }
  enum userRole { value admin; value operator; value viewer; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field role userRole;
  }
}
`);

console.log(`workspace ${root}`);
await generateApp(join(root, "app.qiy"), admin);
const server = join(admin, "apps/server");

await run(["docker", "run", "--rm", "--mount", `type=bind,source=${resolve(root)},target=/certs`, "alpine:3", "sh", "-c", "apk add --no-cache openssl >/dev/null && openssl req -x509 -newkey rsa:2048 -nodes -keyout /certs/key.pem -out /certs/cert.pem -days 2 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 >/dev/null 2>&1"], root);

writeFileSync(join(server, "tests/otp-delivery.acceptance.test.ts"), acceptance());
await run(["bun", "install"], admin);
console.log(await run(["bun", "test", "--preload", "./tests/setup.ts", "tests/otp-delivery.acceptance.test.ts"], server, {
  DATABASE_URL: ":memory:",
  NODE_EXTRA_CA_CERTS: join(root, "cert.pem"),
  QIY_TEST_TLS_CERT: join(root, "cert.pem"),
  QIY_TEST_TLS_KEY: join(root, "key.pem"),
}));
console.log(await run(["bun", "run", "typecheck"], server, { DATABASE_URL: ":memory:" }));
console.log(`OTP delivery acceptance passed: ${root}`);

function acceptance(): string {
  return `import { afterAll, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createOtpAuthRoutes } from "../src/auth/otp";

const deliveries: Array<{ recipient: string; code: string; expiresIn: number; authorization: string | null }> = [];
let mode: "ok" | "reject" | "hang" = "ok";
let server: ReturnType<typeof Bun.serve>;

server = Bun.serve({
  port: 0,
  tls: { cert: Bun.file(Bun.env.QIY_TEST_TLS_CERT!), key: Bun.file(Bun.env.QIY_TEST_TLS_KEY!) },
  async fetch(request) {
    if (mode === "hang") { await new Promise((resolve) => setTimeout(resolve, 5000)); return Response.json({ ok: true }); }
    const body = await request.json() as { recipient: string; code: string; expiresIn: number };
    deliveries.push({ ...body, authorization: request.headers.get("authorization") });
    if (mode === "reject") return new Response("provider down", { status: 500 });
    return Response.json({ ok: true });
  },
});

const providerUrl = () => "https://localhost:" + server.port + "/otp";
const user = { id: "00000000-0000-4000-8000-0000000000a1", email: "admin@example.com", role: "admin" };
const principal = { id: user.id, name: "Admin", role: "admin" } as const;
const app = new Elysia().use(createOtpAuthRoutes(async (identifier: string) => identifier === user.email ? user : null, undefined, async (id: string) => id === user.id ? principal : null));
const post = (path: string, body: unknown) => app.handle(new Request("http://localhost/api/v1/auth/otp/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

function configure(overrides: Record<string, string | undefined>): void {
  Bun.env.QIY_AUTH_SECRET = "qiy-otp-acceptance-secret-value-32ch";
  Bun.env.QIY_DEV_MODE = "0";
  Bun.env.QIY_OTP_DELIVERY_URL = providerUrl();
  Bun.env.QIY_OTP_DELIVERY_TOKEN = "provider-token";
  Bun.env.QIY_OTP_DELIVERY_TIMEOUT_MS = "2000";
  delete Bun.env.QIY_OTP_DEV_CODE;
  for (const [key, value] of Object.entries(overrides)) { if (value === undefined) delete Bun.env[key]; else Bun.env[key] = value; }
}

afterAll(() => { server.stop(true); });

test("delivers a six digit code to a real HTTPS provider and verifies it", async () => {
  configure({});
  mode = "ok";
  deliveries.length = 0;
  const response = await post("request", { identifier: user.email });
  expect(response.status).toBe(200);
  const challenge = await response.json() as { challengeToken: string; expiresIn: number; devCode?: string };
  expect(challenge.expiresIn).toBe(300);
  expect(challenge.challengeToken.length).toBeGreaterThan(40);
  expect(challenge.devCode).toBeUndefined();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]!.recipient).toBe(user.email);
  expect(deliveries[0]!.code).toMatch(/^[0-9]{6}$/);
  expect(deliveries[0]!.expiresIn).toBe(300);
  expect(deliveries[0]!.authorization).toBe("Bearer provider-token");
  // The production response must never carry the delivered code.
  expect(JSON.stringify(challenge)).not.toContain(deliveries[0]!.code);
  const verified = await post("verify", { identifier: user.email, challengeToken: challenge.challengeToken, code: deliveries[0]!.code });
  expect(verified.status).toBe(200);
  const session = await verified.json() as { accessToken: string; id: string; role: string };
  expect(session.id).toBe(user.id);
  expect(session.role).toBe("admin");
  expect(session.accessToken.length).toBeGreaterThan(40);
  expect((await post("verify", { identifier: user.email, challengeToken: challenge.challengeToken, code: "000000" })).status).toBe(401);
  const tampered = challenge.challengeToken.slice(0, -2) + (challenge.challengeToken.endsWith("aa") ? "bb" : "aa");
  expect((await post("verify", { identifier: user.email, challengeToken: tampered, code: deliveries[0]!.code })).status).toBe(401);
});

test("unknown identifiers stay indistinguishable and never reach the provider", async () => {
  configure({});
  mode = "ok";
  deliveries.length = 0;
  const response = await post("request", { identifier: "nobody@example.com" });
  expect(response.status).toBe(200);
  const challenge = await response.json() as { challengeToken: string; devCode?: string };
  expect(challenge.challengeToken.length).toBeGreaterThan(40);
  expect(challenge.devCode).toBeUndefined();
  expect(deliveries).toHaveLength(0);
  expect((await post("verify", { identifier: "nobody@example.com", challengeToken: challenge.challengeToken, code: "123456" })).status).toBe(401);
});

test("provider rejection, timeout and non-TLS configuration fail closed", async () => {
  configure({});
  mode = "reject";
  deliveries.length = 0;
  const rejected = await post("request", { identifier: user.email });
  expect(rejected.status).toBe(502);
  const rejectedBody = await rejected.json() as { errorKey?: string; challengeToken?: string };
  expect(rejectedBody.errorKey).toBe("auth.otpDeliveryFailed");
  expect(rejectedBody.challengeToken).toBeUndefined();

  mode = "hang";
  configure({ QIY_OTP_DELIVERY_TIMEOUT_MS: "300" });
  const started = Date.now();
  const timedOut = await post("request", { identifier: user.email });
  const elapsed = Date.now() - started;
  expect(timedOut.status).toBe(502);
  expect(((await timedOut.json()) as { errorKey?: string }).errorKey).toBe("auth.otpDeliveryFailed");
  expect(elapsed).toBeLessThan(4000);

  mode = "ok";
  configure({ QIY_OTP_DELIVERY_URL: "http://localhost:" + server.port + "/otp" });
  const insecure = await post("request", { identifier: user.email });
  expect(insecure.status).toBe(502);
  expect(((await insecure.json()) as { errorKey?: string }).errorKey).toBe("auth.otpDeliveryFailed");

  configure({ QIY_OTP_DELIVERY_TIMEOUT_MS: "not-a-number" });
  const invalid = await post("request", { identifier: user.email });
  expect(invalid.status).toBe(502);

  configure({ QIY_OTP_DELIVERY_URL: undefined });
  const missing = await post("request", { identifier: user.email });
  expect(missing.status).toBe(502);
  expect(((await missing.json()) as { errorKey?: string }).errorKey).toBe("auth.otpDeliveryFailed");
});

test("development mode stays explicit and never calls the provider", async () => {
  configure({ QIY_DEV_MODE: "1", QIY_OTP_DELIVERY_URL: undefined, QIY_OTP_DEV_CODE: "246810" });
  mode = "ok";
  deliveries.length = 0;
  const response = await post("request", { identifier: user.email });
  expect(response.status).toBe(200);
  const challenge = await response.json() as { challengeToken: string; devCode?: string };
  expect(challenge.devCode).toBe("246810");
  expect(deliveries).toHaveLength(0);
  expect((await post("verify", { identifier: user.email, challengeToken: challenge.challengeToken, code: "246810" })).status).toBe(200);

  configure({ QIY_DEV_MODE: "1", QIY_OTP_DELIVERY_URL: undefined, QIY_OTP_DEV_CODE: undefined });
  const unsent = await post("request", { identifier: user.email });
  expect(unsent.status).toBe(502);
  // Development mode still fails closed and only adds provider detail to the message.
  expect(((await unsent.json()) as { error?: string }).error).toBe("QIY_OTP_DELIVERY_URL is required outside explicit development OTP mode");
});
`;
}

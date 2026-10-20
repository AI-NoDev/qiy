import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "node:tls";
import { X509Certificate } from "node:crypto";
import { generateApp } from "./commands/generate-app";

const container = Bun.argv[2] ?? "qiy-oidc";
const acceptanceContainer = "qiy-oidc-check-" + crypto.randomUUID();
const isolated = Bun.argv.includes("--isolated");
const fixtureContainer = "qiy-idp-" + crypto.randomUUID();
const fixtureNetwork = fixtureContainer + "-net";
const root = mkdtempSync(join(tmpdir(), "qiy-oidc-acceptance-"));
async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 600_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`OIDC acceptance command failed (${code}): ${command[0]}\n${stdout}\n${stderr}`);
    return stdout + stderr;
  } finally { clearTimeout(timer); }
}

try {
  let issuer: string;
  let audience: string;
  let network: string;
  let image: string;
  if (isolated) {
    issuer = `https://${fixtureContainer}:8443`;
    audience = "qiy-acceptance";
    network = fixtureNetwork;
    image = "oven/bun:1.3.13";
    await run(["docker", "network", "create", network]);
    writeFileSync(join(root, "certificate.sh"), `set -eu\napk add --no-cache openssl\nopenssl req -x509 -newkey rsa:2048 -nodes -keyout /acceptance/key.pem -out /acceptance/cert.pem -days 2 -subj /CN=${fixtureContainer} -addext subjectAltName=DNS:${fixtureContainer} -addext basicConstraints=critical,CA:TRUE\n`);
    await run(["docker", "run", "--rm", "--name", acceptanceContainer, "--mount", `type=bind,source=${resolve(root)},target=/acceptance`, "alpine:3", "sh", "/acceptance/certificate.sh"]);
    copyFileSync(join(root, "cert.pem"), join(root, "fixture-ca.pem"));
  } else {
  const inspected = JSON.parse(await run(["docker", "inspect", container]))[0];
  if (!inspected.State.Running) throw new Error("OIDC fixture container must be running");
  const environment = Object.fromEntries((inspected.Config.Env as string[]).map((item) => { const index = item.indexOf("="); return [item.slice(0, index), item.slice(index + 1)]; }));
  issuer = environment.QIY_TEST_ISSUER ?? "";
  audience = environment.QIY_TEST_AUDIENCE ?? "";
  network = Object.keys(inspected.NetworkSettings.Networks)[0]!;
  image = inspected.Config.Image;
  if (!issuer || !audience || !network) throw new Error("Fixture issuer, audience and Docker network are required");
  if (new URL(issuer).protocol !== "https:") throw new Error("Fixture must use HTTPS");
  const port = inspected.NetworkSettings.Ports["8443/tcp"]?.[0]?.HostPort;
  if (!port) throw new Error("Fixture must expose its test HTTPS port");
  const publicCertificate = await new Promise<Buffer>((accept, reject) => {
    const socket = connect({ host: "127.0.0.1", port: Number(port), rejectUnauthorized: false }, () => {
      const raw = socket.getPeerCertificate().raw;
      socket.end();
      if (raw) accept(raw); else reject(new Error("Fixture public certificate missing"));
    });
    socket.setTimeout(10_000, () => socket.destroy(new Error("Fixture certificate probe timed out")));
    socket.on("error", reject);
  });
  const validity = new X509Certificate(publicCertificate);
  if (Date.parse(validity.validTo) <= Date.now() || Date.parse(validity.validFrom) > Date.now()) throw new Error("OIDC fixture TLS certificate is expired or not yet valid; renew the fixture certificate before acceptance");
  writeFileSync(join(root, "fixture-ca.pem"), "-----BEGIN CERTIFICATE-----\n" + publicCertificate.toString("base64").match(/.{1,64}/g)!.join("\n") + "\n-----END CERTIFICATE-----\n");
  }
  const source = join(root, "app.qiy");
  writeFileSync(source, 'qiy v0; application oidc-acceptance { database sqlite {} auth { provider oidc; user users; subjectField subject; roleField role; } enum userRole { value admin; value operator; value viewer; } entity users { field id UUID @id; field subject Text @unique; field role userRole; } }');
  await generateApp(source, join(root, "admin"));
  const server = join(root, "admin/apps/server");
  writeFileSync(join(server, "tests/oidc-http.acceptance.test.ts"), acceptance());
  const docker = ["docker", "run", "--rm", "--name", acceptanceContainer, "--network", network, "--mount", `type=bind,source=${resolve(root)},target=/acceptance`, "-w", "/acceptance/admin", "-e", "NODE_EXTRA_CA_CERTS=/acceptance/fixture-ca.pem", "-e", `QIY_TEST_ISOLATED=${isolated ? "1" : "0"}`, "-e", `QIY_OIDC_ISSUER=${issuer}`, "-e", `QIY_OIDC_AUDIENCE=${audience}`, "-e", `QIY_OIDC_JWKS_URL=${issuer}/.well-known/jwks.json`, "-e", "DATABASE_URL=:memory:", image];
  await run([...docker, "bun", "install"]);
  if (isolated) {
    writeFileSync(join(server, "fixture.ts"), fixture());
    await run(["docker", "run", "-d", "--name", fixtureContainer, "--network", network, "--mount", `type=bind,source=${resolve(root)},target=/acceptance`, "-w", "/acceptance/admin/apps/server", "-e", `QIY_OIDC_ISSUER=${issuer}`, "-e", `QIY_OIDC_AUDIENCE=${audience}`, image, "bun", "fixture.ts"]);
  }
  console.log(await run([...docker, "bun", "test", "./apps/server/tests/oidc-http.acceptance.test.ts"]));
  console.log(await run([...docker, "bun", "run", "--cwd", "apps/server", "typecheck"]));
  console.log("Generated OIDC HTTPS/JWKS, SQLite user mapping and HTTP authorization acceptance passed");
} finally {
  const cleanup = Bun.spawn(["docker", "rm", "-f", acceptanceContainer], { stdout: "ignore", stderr: "ignore" });
  await cleanup.exited;
  if (isolated) {
    await Bun.spawn(["docker", "rm", "-f", fixtureContainer], { stdout: "ignore", stderr: "ignore" }).exited;
    await Bun.spawn(["docker", "network", "rm", fixtureNetwork], { stdout: "ignore", stderr: "ignore" }).exited;
  }
  rmSync(root, { recursive: true, force: true });
}

function fixture(): string { return `import { createPublicKey } from "node:crypto";
import { exportJWK, importPKCS8, SignJWT } from "jose";
const pem = await Bun.file("/acceptance/key.pem").text();
const key = await importPKCS8(pem, "RS256");
const jwk = { ...await exportJWK(createPublicKey(pem)), kid: "acceptance", alg: "RS256", use: "sig" };
const issuer = Bun.env.QIY_OIDC_ISSUER!;
const audience = Bun.env.QIY_OIDC_AUDIENCE!;
Bun.serve({ port: 8443, hostname: "0.0.0.0", tls: { cert: Bun.file("/acceptance/cert.pem"), key: Bun.file("/acceptance/key.pem") }, async fetch(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/.well-known/openid-configuration") return Response.json({ issuer, jwks_uri: issuer + "/.well-known/jwks.json" });
  if (path === "/.well-known/jwks.json") return Response.json({ keys: [jwk] });
  if (path === "/token") {
    const variant = url.searchParams.get("variant");
    return Response.json({ access_token: await new SignJWT({ role: "admin", "tenant.customerId": "customer-1" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer(variant === "issuer" ? issuer + "/wrong" : issuer).setAudience(variant === "audience" ? audience + "-wrong" : audience).setSubject("acceptance-user").setIssuedAt().setExpirationTime(variant === "expired" ? Math.floor(Date.now() / 1000) - 60 : "5m").sign(key) });
  }
  return new Response(null, { status: 404 });
} });
`; }

function acceptance(): string { return `import { expect, test } from "bun:test";
import { createRemoteJWKSet } from "jose";
import { db, client } from "../src/db";
import { users } from "../src/schema";
import { createApp, type Repositories } from "../src/app";
import { createProductionAuthenticator } from "../src/auth/oidc";
import { createOidcAuthenticator } from "../src/auth/verify";
import { eq } from "drizzle-orm";

test("generated HTTP API verifies HTTPS JWKS and database identity", async () => {
  const issuer = Bun.env.QIY_OIDC_ISSUER!;
  const audience = Bun.env.QIY_OIDC_AUDIENCE!;
  const discovery = await fetch(issuer + "/.well-known/openid-configuration");
  expect(discovery.status).toBe(200);
  expect(await discovery.json()).toMatchObject({ issuer, jwks_uri: Bun.env.QIY_OIDC_JWKS_URL });
  const issued = await fetch(issuer + "/token");
  expect(issued.status).toBe(200);
  const token = (await issued.json() as { access_token: string }).access_token;
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as { sub: string };
  const subject = issuer + "|" + payload.sub;
  client.exec('CREATE TABLE users (id text primary key, subject text unique not null, role text not null)');
  const id = "00000000-0000-4000-8000-000000000001";
  await db.insert(users).values({ id, subject, role: "admin" });
  const app = await createApp({} as Repositories, createProductionAuthenticator(), false, false, [], false);
  const server = Bun.serve({ port: 0, fetch: (request) => app.handle(request) });
  const request = (path: string, bearer?: string) => fetch(new URL(path, server.url), { headers: bearer ? { Authorization: "Bearer " + bearer } : {}, signal: AbortSignal.timeout(10_000) });
  try {
    expect((await request("/api/v1/auth/me")).status).toBe(401);
    expect((await request("/api/v1/auth/me", "invalid")).status).toBe(401);
    const identity = await request("/api/v1/auth/me", token);
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({ id, role: "admin" });
    if (Bun.env.QIY_TEST_ISOLATED === "1") {
      for (const variant of ["expired", "issuer", "audience"]) {
        const response = await fetch(issuer + "/token?variant=" + variant);
        const invalid = (await response.json() as { access_token: string }).access_token;
        expect((await request("/api/v1/auth/me", invalid)).status).toBe(401);
      }
    }
    const parts = token.split(".");
    const signature = Buffer.from(parts[2]!, "base64url");
    signature[0] = signature[0]! ^ 1;
    expect((await request("/api/v1/auth/me", parts[0] + "." + parts[1] + "." + signature.toString("base64url"))).status).toBe(401);
    await db.update(users).set({ role: "viewer" }).where(eq(users.id, id));
    expect((await request("/api/v1/users", token)).status).toBe(403);
    await db.delete(users).where(eq(users.id, id));
    expect((await request("/api/v1/auth/me", token)).status).toBe(401);
    const keySet = createRemoteJWKSet(new URL(Bun.env.QIY_OIDC_JWKS_URL!));
    for (const options of [{ issuer: issuer + "/wrong", audience }, { issuer, audience: audience + "-wrong" }]) {
      const authenticate = createOidcAuthenticator({ ...options, keySet, roleField: "role", findUser: async () => ({ id, role: "admin" }) });
      await expect(authenticate(new Request("https://app.example/api/v1/auth/me", { headers: { Authorization: "Bearer " + token } }))).rejects.toThrow();
    }
  } finally { server.stop(true); client.close(); }
});
`; }

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const executable = process.argv[2];
const expectedVersion = process.argv[3];
if (!executable || !expectedVersion) throw new Error("Usage: bun tools/verify-release-integration.ts <executable> <version>");
const binary = resolve(executable);
const root = mkdtempSync(join(tmpdir(), "qiy-release-integration-"));
async function run(command: string[], cwd = root): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return stdout.trim();
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
assert(await run([binary, "--version"]) === expectedVersion, "Executable version mismatch");
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "release-host", private: true, packageManager: `bun@${Bun.version}`, scripts: { "host:check": "bun --version" } }, null, 2));
writeFileSync(join(root, "AGENTS.md"), "Host instructions\n");
mkdirSync(join(root, "openwiki"));
writeFileSync(join(root, "openwiki/quickstart.md"), "Host documentation\n");
writeFileSync(join(root, ".env"), "HOST_VALUE=preserve\n");
writeFileSync(join(root, "admin.qiy"), `qiy v0;
application release-admin {
  database sqlite {}
  mode integration;
  integration { apiBase "/api/v2"; auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; }; }
  workspace {
    name ops;
    aliases { web ops-console; }
    packages { web "@release/ops-console"; }
  }
  entity products { field id UUID @id; field title Text; }
}
`);
await run([binary, "skill", "install"]);
assert(existsSync(join(root, ".agent/skills/qiy/examples/warehouse-admin/app.qiy")), "Offline skill example missing");
await run([binary, "init", "-f", "admin.qiy"]);
const webRoot = join(root, "apps/ops-console");
const manifest = JSON.parse(readFileSync(join(root, ".qiy-ops.generated.json"), "utf8"));
assert(manifest.qiyVersion === expectedVersion && manifest.mode === "integration", "Integration provenance mismatch");
assert(!manifest.files.some((path: string) => /apps\/.*server|Dockerfile|docker-compose|drizzle/.test(path)), "Integration generated backend artifacts");
assert(existsSync(join(webRoot, "AGENTS.md")) && existsSync(join(root, "openwiki/qiy-ops/quickstart.md")), "Scoped AI documentation missing");
const adapter = join(webRoot, "app/host/data-provider.ts");
const customAdapter = `${readFileSync(adapter, "utf8")}\nexport const releaseSmokeMarker = "preserved";\n`;
writeFileSync(adapter, customAdapter);
const transportTest = join(webRoot, "app/host/release-auth.test.ts");
writeFileSync(transportTest, `import { expect, test } from "bun:test";
import { qiyIntegrationFetch, qiyIntegrationAuthProvider } from "./auth";
test("cookie transport sends credentials and configured CSRF header", async () => {
  const originalFetch = globalThis.fetch;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: { input: unknown; init?: RequestInit }[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "XSRF-TOKEN=csrf%20value" } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => { calls.push({ input, init }); return new Response("{}"); }) as typeof fetch;
  try {
    await qiyIntegrationFetch("products", { method: "POST" });
    await qiyIntegrationFetch("products");
    expect(String(calls[0]?.input)).toBe("http://localhost/api/v2/products");
    expect(calls[0]?.init?.credentials).toBe("include");
    expect(new Headers(calls[0]?.init?.headers).get("X-XSRF-TOKEN")).toBe("csrf value");
    expect(new Headers(calls[1]?.init?.headers).has("X-XSRF-TOKEN")).toBe(false);
    expect(calls[0]?.init?.redirect).toBe("error");
    await expect(qiyIntegrationFetch("https://other.example/api/v2/products")).rejects.toThrow("outside");
    await expect(qiyIntegrationFetch(new URL("http://localhost/api/v2evil"))).rejects.toThrow("outside");
    await expect(qiyIntegrationFetch("../outside")).rejects.toThrow("outside");
    expect(calls).toHaveLength(2);
    expect(await qiyIntegrationAuthProvider.check()).toEqual({ authenticated: false, redirectTo: "/auth/login" });
  } finally {
    globalThis.fetch = originalFetch;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
`);
await run([binary, "init", "-f", "admin.qiy", "--sync"]);
assert(readFileSync(adapter, "utf8") === customAdapter, "Sync overwrote host adapter");
assert(existsSync(transportTest), "Sync removed handwritten host tests");
assert(readFileSync(join(root, "AGENTS.md"), "utf8") === "Host instructions\n", "Host agent overwritten");
assert(readFileSync(join(root, "openwiki/quickstart.md"), "utf8") === "Host documentation\n", "Host wiki overwritten");
assert(readFileSync(join(root, ".env"), "utf8") === "HOST_VALUE=preserve\n", "Host environment overwritten");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert(pkg.scripts["host:check"] === "bun --version" && !pkg.devDependencies?.turbo, "Host scripts or tooling changed");
assert(JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8")).name === "@release/ops-console", "Package alias mismatch");
await run([process.execPath, "install"]);
for (const command of ["typecheck", "test", "build"]) await run([process.execPath, "run", command], webRoot);
console.log(`Released Qiy ${expectedVersion}: integration init/sync, offline skill, typecheck/test/build passed in ${root}`);

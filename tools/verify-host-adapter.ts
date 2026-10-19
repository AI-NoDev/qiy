import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initApp } from "./commands/init";

/**
 * Source-based acceptance for the declarative host API contract. It mounts the
 * integration admin into a host project, then installs it, typechecks it against
 * the real Refine types, drives the generated adapter against a live HTTP host
 * API that uses a custom envelope, offset pagination and a required tenant
 * header, and finally builds the production SPA.
 */
const root = mkdtempSync(join(tmpdir(), "qiy-host-adapter-"));
writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "host", private: true, packageManager: `bun@${Bun.version}` }, null, 2)}\n`);
writeFileSync(join(root, "catalog.qiy"), `qiy v0;
application host-catalog {
  database sqlite {}
  mode integration;
  integration {
    apiBase "/api/v2";
    auth bearer;
    response { data "items"; total "meta.count"; error "message"; };
    pagination offset;
    tenant { header "X-Tenant-Id"; identity "tenantId"; };
  }
  workspace {
    name catalog;
    aliases { web host-admin; }
    packages { web "@host/admin"; }
  }
  entity products {
    field id UUID @id;
    field title Text;
  }
}
`);

await initApp({ root, source: "catalog.qiy" });
const webRoot = join(root, "apps/host-admin");

async function run(command: string[], cwd: string): Promise<string> {
  const [executable = "bun", ...args] = command;
  const child = Bun.spawn([executable === "bun" ? process.execPath : executable, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed (${code}) in ${cwd}:\n${stdout}\n${stderr}`);
  return stdout + stderr;
}

writeFileSync(join(webRoot, "app/host/host-contract.acceptance.test.ts"), `import { afterAll, beforeAll, expect, test } from "bun:test";
import { dataProvider, paginationStyle, responseContract } from "./data-provider";
import { qiyIntegrationFetch } from "./auth";

interface Seen { url: string; method: string; tenant: string | null; authorization: string | null }
const seen: Seen[] = [];
let tenant = "tenant-9";
let server: ReturnType<typeof Bun.serve>;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch(request) {
    const url = new URL(request.url);
    seen.push({ url: request.url, method: request.method, tenant: request.headers.get("x-tenant-id"), authorization: request.headers.get("authorization") });
    if (request.headers.get("x-tenant-id") !== "tenant-9") return Response.json({ message: "Tenant mismatch" }, { status: 403 });
    if (request.headers.get("authorization") !== "Bearer host-token") return Response.json({ message: "Missing bearer" }, { status: 401 });
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    if (url.pathname === "/api/v2/products" && request.method === "GET") return Response.json({ items: [{ id: "p" + offset, title: "Item " + offset }], meta: { count: 7 } });
    if (url.pathname === "/api/v2/products" && request.method === "POST") return Response.json({ id: "p-new" });
    if (url.pathname === "/api/v2/products/p1" && request.method === "GET") return Response.json({ id: "p1", title: "One" });
    if (url.pathname === "/api/v2/products/p1" && request.method === "PATCH") return Response.json({ id: "p1", title: "Patched" });
    if (url.pathname === "/api/v2/products/p1" && request.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ message: "Not found" }, { status: 404 });
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { origin: server.url.origin },
    qiyHostAuth: { getAccessToken: async () => "host-token", getIdentity: async () => ({ tenantId: tenant }) },
  } });
});

afterAll(() => {
  server.stop(true);
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

test("declared envelope, offset pagination and tenant header drive a live host API", async () => {
  expect(responseContract).toEqual({ data: "items", total: "meta.count", error: "message" });
  expect(paginationStyle).toBe("offset");
  const page = await dataProvider.getList({ resource: "products", pagination: { currentPage: 3, pageSize: 2 } });
  expect(page.data).toEqual([{ id: "p4", title: "Item 4" }]);
  expect(page.total).toBe(7);
  expect(seen[0]!.url).toBe(server.url.origin + "/api/v2/products?offset=4&limit=2");
  expect(seen[0]!.tenant).toBe("tenant-9");
  expect(seen[0]!.authorization).toBe("Bearer host-token");
  expect((await dataProvider.getOne({ resource: "products", id: "p1" })).data).toEqual({ id: "p1", title: "One" });
  expect((await dataProvider.create({ resource: "products", variables: { title: "New" } })).data).toEqual({ id: "p-new" });
  expect((await dataProvider.update({ resource: "products", id: "p1", variables: { title: "Patched" } })).data.title).toBe("Patched");
  expect((await dataProvider.deleteOne({ resource: "products", id: "p1" })).data).toEqual({ id: "p1" });
  expect(seen.at(-1)!.method).toBe("DELETE");
});

test("host errors keep their status and the transport stays inside the configured API", async () => {
  tenant = "tenant-other";
  let failure: unknown;
  try { await dataProvider.getList({ resource: "products" }); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ message: "Tenant mismatch", statusCode: 403 });
  tenant = "tenant-9";
  await expect(qiyIntegrationFetch("https://outside.example/api/v2/products")).rejects.toThrow("outside");
  await expect(qiyIntegrationFetch("../private")).rejects.toThrow("outside");
  const before = seen.length;
  expect((await dataProvider.getList({ resource: "products" })).total).toBe(7);
  expect(seen.length).toBe(before + 1);
});
`);

console.log(`workspace ${root}`);
await run(["bun", "install"], root);
console.log(await run(["bun", "test", "app/host/host-contract.acceptance.test.ts"], webRoot));
console.log(await run(["bun", "run", "typecheck"], webRoot));
console.log(await run(["bun", "run", "build"], webRoot));
console.log(`host adapter acceptance passed: ${root}`);

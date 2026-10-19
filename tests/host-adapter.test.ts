import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initApp } from "../tools/commands/init";
import { parseQiyProject, serializeQiyProject, type QiyIntegrationConfig } from "../tools/qiy-project";

const contractSource = `qiy v0;
application host-catalog {
  database sqlite {}
  mode integration;
  integration {
    apiBase "https://api.example.com/api/v2";
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
}`;

const expected: QiyIntegrationConfig = {
  apiBase: "https://api.example.com/api/v2",
  authTransport: "bearer",
  response: { data: "items", total: "meta.count", error: "message" },
  pagination: "offset",
  tenant: { header: "X-Tenant-Id", identity: "tenantId" },
};

type HostProvider = {
  dataProvider: {
    getApiUrl: () => string;
    getList: (params: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>>; total: number }>;
    getOne: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
    create: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
    update: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
    deleteOne: (params: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
  };
  responseContract: { data: string; total: string | null; error: string };
  paginationStyle: string;
  readPath: (payload: unknown, path: string) => unknown;
  hostRecords: (payload: unknown) => Array<Record<string, unknown>>;
  hostTotal: (payload: unknown, fallback: number) => number;
};

test("parses, rejects and round-trips the host API contract", () => {
  const project = parseQiyProject(contractSource);
  expect(project.integration).toEqual(expected);
  expect(parseQiyProject(serializeQiyProject(project)).integration).toEqual(expected);

  const responseBlock = 'response { data "items"; total "meta.count"; error "message"; };';
  const tenantBlock = 'tenant { header "X-Tenant-Id"; identity "tenantId"; };';
  const base = (extra: string): string => contractSource.replace("    auth bearer;", `    auth bearer;\n${extra}`);
  expect(() => parseQiyProject(contractSource.replace(responseBlock, 'response { data "items"; data "rows"; };'))).toThrow("Duplicate integration response setting data");
  expect(() => parseQiyProject(contractSource.replace('data "items"', 'rows "items"'))).toThrow("Unsupported integration response setting rows");
  expect(() => parseQiyProject(contractSource.replace('data "items"', 'data "$.items"'))).toThrow("dotted JSON path");
  expect(() => parseQiyProject(contractSource.replace(responseBlock, "response { };"))).toThrow("at least one of data, total or error");
  expect(() => parseQiyProject(base('    response { data "items"; };'))).toThrow("Duplicate integration setting response");
  expect(() => parseQiyProject(contractSource.replace("pagination offset", "pagination cursor"))).toThrow("Unsupported integration pagination style cursor");
  expect(() => parseQiyProject(contractSource.replace(tenantBlock, 'tenant { header "X-Tenant-Id"; };'))).toThrow("tenant requires header and identity");
  expect(() => parseQiyProject(contractSource.replace('header "X-Tenant-Id"', 'header "bad header"'))).toThrow("simple HTTP header name");
  expect(() => parseQiyProject(contractSource.replace('identity "tenantId"', 'identity "bad-key"'))).toThrow("simple identity key");
  expect(() => parseQiyProject(contractSource.replace(tenantBlock, 'tenant { header "X-Tenant-Id"; identity "tenantId"; identity "other"; };'))).toThrow("Duplicate integration tenant setting identity");
  expect(() => parseQiyProject(base('    tenant { header "X-Tenant-Id"; identity "tenantId"; };'))).toThrow("Duplicate integration setting tenant");
});

test("generates a working host data provider instead of CRUD stubs", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-host-contract-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }));
  writeFileSync(join(root, "catalog.qiy"), contractSource);
  await initApp({ root, source: "catalog.qiy" });

  const dataProvider = readFileSync(join(root, "apps/host-admin/app/host/data-provider.ts"), "utf8");
  expect(dataProvider).not.toContain("unsupported");
  expect(dataProvider).toContain('"data":"items","total":"meta.count","error":"message"');
  expect(dataProvider).toContain('paginationStyle = "offset"');
  expect(dataProvider).toContain('params.set("offset"');
  expect(dataProvider).toContain("readPath");
  const auth = readFileSync(join(root, "apps/host-admin/app/host/auth.ts"), "utf8");
  expect(auth).toContain('const tenantHeaderName = "X-Tenant-Id"');
  expect(auth).toContain('const tenantIdentityKey = "tenantId"');
  expect(auth).toContain("Host tenant identity is missing");
  const guide = readFileSync(join(root, "apps/host-admin/QIY_INTEGRATION.md"), "utf8");
  expect(guide).toContain("baseline getList/getOne/create/update/deleteOne");

  const provider = await import(pathToFileURL(join(root, "apps/host-admin/app/host/data-provider.ts")).href) as unknown as HostProvider;
  expect(provider.responseContract).toEqual({ data: "items", total: "meta.count", error: "message" });
  expect(provider.paginationStyle).toBe("offset");
  expect(provider.readPath({ meta: { count: 4 } }, "meta.count")).toBe(4);
  expect(provider.readPath({ meta: { count: 4 } }, "meta.missing")).toBeUndefined();
  expect(provider.hostTotal({ meta: { count: "4" } }, 0)).toBe(4);
  expect(provider.hostTotal({}, 3)).toBe(3);
  expect(provider.hostRecords([{ id: "bare" }])).toEqual([{ id: "bare" }]);
  expect(provider.hostRecords({})).toEqual([]);
});

test("the generated adapter drives a host API with a custom envelope, offset paging and a tenant header", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-host-runtime-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }));
  writeFileSync(join(root, "catalog.qiy"), contractSource);
  await initApp({ root, source: "catalog.qiy" });

  const calls: { url: string; init: RequestInit }[] = [];
  let identity: Record<string, unknown> = { tenantId: "tenant-7" };
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://console.example.com" }, qiyHostAuth: { getAccessToken: async () => "host-token", getIdentity: async () => identity } },
  });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const path = new URL(url).pathname + new URL(url).search;
    if (path === "/api/v2/products?offset=0&limit=2") return Response.json({ items: [{ id: "p1", title: "A" }], meta: { count: 5 } });
    if (path === "/api/v2/products?offset=2&limit=2") return Response.json({ message: "Tenant mismatch" }, { status: 403 });
    if (path === "/api/v2/products?offset=0&limit=20") return Response.json({}, { status: 500 });
    if (path === "/api/v2/products/p1" && init?.method === "PATCH") return Response.json({ id: "p1", title: "B" });
    if (path === "/api/v2/products/p1" && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (path === "/api/v2/products/p1") return Response.json({ id: "p1", title: "A" });
    if (path === "/api/v2/products" && init?.method === "POST") return Response.json({ id: "p2", title: "New" });
    return Response.json({ message: "Not found" }, { status: 404 });
  }) as typeof fetch;

  try {
    const provider = await import(pathToFileURL(join(root, "apps/host-admin/app/host/data-provider.ts")).href) as unknown as HostProvider;
    calls.length = 0;

    const listed = await provider.dataProvider.getList({ resource: "products", pagination: { currentPage: 1, pageSize: 2 } });
    expect(listed.data).toEqual([{ id: "p1", title: "A" }]);
    expect(listed.total).toBe(5);
    expect(calls[0]!.url).toBe("https://api.example.com/api/v2/products?offset=0&limit=2");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer host-token");
    expect(new Headers(calls[0]!.init.headers).get("X-Tenant-Id")).toBe("tenant-7");

    let failure: unknown;
    try { await provider.dataProvider.getList({ resource: "products", pagination: { currentPage: 2, pageSize: 2 } }); } catch (error) { failure = error; }
    expect(calls[1]!.url).toBe("https://api.example.com/api/v2/products?offset=2&limit=2");
    expect((failure as Error).message).toBe("Tenant mismatch");
    expect((failure as { statusCode: number }).statusCode).toBe(403);

    expect((await provider.dataProvider.getOne({ resource: "/products", id: "p1" })).data).toEqual({ id: "p1", title: "A" });
    expect(calls.at(-1)!.url).toBe("https://api.example.com/api/v2/products/p1");
    const created = await provider.dataProvider.create({ resource: "products", variables: { title: "New" } });
    expect(created.data).toEqual({ id: "p2", title: "New" });
    expect(calls.at(-1)!.init.method).toBe("POST");
    expect(calls.at(-1)!.init.body).toBe(JSON.stringify({ title: "New" }));
    expect((await provider.dataProvider.update({ resource: "products", id: "p1", variables: { title: "B" } })).data.title).toBe("B");
    expect(calls.at(-1)!.init.method).toBe("PATCH");
    expect((await provider.dataProvider.deleteOne({ resource: "products", id: "p1" })).data).toEqual({ id: "p1" });

    identity = {};
    calls.length = 0;
    await expect(provider.dataProvider.getList({ resource: "products" })).rejects.toThrow("Host tenant identity is missing");
    expect(calls).toHaveLength(0);

    identity = { tenantId: "tenant-7" };
    calls.length = 0;
    // The declared error path wins; the generic message is the fallback when the host body has no such field.
    await expect(provider.dataProvider.getList({ resource: "products" })).rejects.toThrow("Host API error 500");
  } finally {
    globalThis.fetch = originalFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

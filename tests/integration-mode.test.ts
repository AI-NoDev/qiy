import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { initApp } from "../tools/commands/init";
import { generateApp } from "../tools/commands/generate-app";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = `qiy v0;
application host-catalog {
  database sqlite {}
  mode integration;
  integration { apiBase "https://api.example.com/api/v2"; auth cookie; }
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

const cookieSource = source.replace('auth cookie;', 'auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; };');

test("parses the web-only integration mode and rejects generated server settings", () => {
  const project = parseQiyProject(source);
  expect(project.mode).toBe("integration");
  expect(project.integration).toEqual({ apiBase: "https://api.example.com/api/v2", authTransport: "cookie" });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} mode integration; entity items { field id UUID @id; field title Text; } }`)).toThrow("requires an integration block");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} integration { apiBase "/api"; auth none; } entity items { field id UUID @id; field title Text; } }`)).toThrow("requires application mode integration");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} mode integration; integration { apiBase "/api"; auth none; } auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; } entity users { field id UUID @id; field email Text; field passwordHash Text; field role Text; } }`)).toThrow("cannot configure generated server features");
});

test("round-trips explicit integration auth profiles and CSRF settings", () => {
  const cookie = parseQiyProject(cookieSource);
  expect(cookie.integration).toEqual({ apiBase: "https://api.example.com/api/v2", authTransport: "cookie", csrfCookie: "XSRF-TOKEN", csrfHeader: "X-XSRF-TOKEN" });
  expect(parseQiyProject(serializeQiyProject(cookie)).integration).toEqual(cookie.integration);
  expect(parseQiyProject(source.replace("auth cookie", "auth bearer")).integration?.authTransport).toBe("bearer");
  expect(parseQiyProject(source.replace("auth cookie", "auth portal")).integration?.authTransport).toBe("portal");
  expect(() => parseQiyProject(source.replace("auth cookie", 'auth bearer { csrfCookie "X"; };'))).toThrow("only supported for cookie");
  expect(() => parseQiyProject(source.replace("auth cookie", 'auth cookie { csrfHeader "bad header"; };'))).toThrow("simple HTTP header");
});

test("mounts a web-only integration admin and preserves host adapters on sync", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-integration-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }, null, 2));
  writeFileSync(join(root, "catalog.qiy"), source);

  await initApp({ root, source: "catalog.qiy" });
  expect(existsSync(join(root, "apps/host-admin"))).toBe(true);
  expect(existsSync(join(root, "apps/catalog-server"))).toBe(false);
  expect(existsSync(join(root, "apps/host-admin/app/routes/create.tsx"))).toBe(false);
  expect(existsSync(join(root, "apps/host-admin/app/routes/edit.tsx"))).toBe(false);
  const routeConfig = readFileSync(join(root, "apps/host-admin/app/routes.ts"), "utf8");
  expect(routeConfig).not.toContain("routes/create");
  expect(routeConfig).not.toContain("routes/edit");
  const listPage = readFileSync(join(root, "apps/host-admin/app/routes/list.tsx"), "utf8");
  expect(listPage).not.toContain("useDelete");
  expect(listPage).not.toContain('action="create"');
  expect(listPage).not.toContain('action="edit"');
  expect(listPage).not.toContain('action="delete"');
  expect(listPage).not.toContain("DeleteOutlined");
  expect(readFileSync(join(root, "apps/host-admin/app/data-provider.ts"), "utf8")).toContain('"./host/data-provider"');
  const hostProvider = readFileSync(join(root, "apps/host-admin/app/host/data-provider.ts"), "utf8");
  expect(hostProvider).toContain('https://api.example.com/api/v2');
  expect(hostProvider).toContain('"cookie"');
  expect(hostProvider).toContain("qiyIntegrationFetch(path, init)");
  expect(hostProvider).not.toContain("qiyIntegrationFetch(qiyIntegrationUrl(path)");
  const auth = readFileSync(join(root, "apps/host-admin/app/host/auth.ts"), "utf8");
  expect(auth).toContain("qiyIntegrationFetch");
  expect(auth).toContain("qiyIntegrationUrl(String(input))");
  expect(auth).toContain('credentials: authTransport === "cookie" ? "include"');
  const webEntry = readFileSync(join(root, "apps/host-admin/app/root.tsx"), "utf8");
  expect(webEntry).toContain("<Authenticated");
  expect(webEntry).toContain("accessControlProvider={qiyIntegrationAccessControlProvider}");
  expect(JSON.parse(readFileSync(join(root, "apps/host-admin/package.json"), "utf8")).name).toBe("@host/admin");
  const hostPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  expect(hostPackage.scripts["qiy:catalog:dev:web"]).toBe("bun run --cwd apps/host-admin --bun dev");
  expect(hostPackage.scripts["qiy:catalog:build"]).toBe("bun run --cwd apps/host-admin build");
  expect(hostPackage.scripts["qiy:catalog:dev:server"]).toBeUndefined();
  const manifest = JSON.parse(readFileSync(join(root, ".qiy-catalog.generated.json"), "utf8")) as { files: string[] };
  expect(manifest.files.some((path) => path.includes("/app/host/"))).toBe(false);

  const hostAdapter = join(root, "apps/host-admin/app/host/data-provider.ts");
  writeFileSync(hostAdapter, "export const dataProvider = {} as never;\n");
  await initApp({ root, source: "catalog.qiy", sync: true });
  expect(readFileSync(hostAdapter, "utf8")).toContain("as never");
});

test("host authorization denies missing, malformed and failed decisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-host-permissions-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }));
  writeFileSync(join(root, "catalog.qiy"), source);
  await initApp({ root, source: "catalog.qiy" });
  const adapterPath = join(root, "apps/host-admin/app/host/access-control.ts");
  const adapter = await import(pathToFileURL(adapterPath).href);
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const request = { resource: "products", action: "review", params: { id: "product-1" } };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    expect((await adapter.qiyIntegrationAccessControlProvider.can(request)).can).toBe(false);
    for (const decision of [null, {}, { can: "true" }, { can: false }]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { qiyHostAuth: { can: async () => decision } } });
      expect((await adapter.qiyIntegrationAccessControlProvider.can(request)).can).toBe(false);
    }
    Object.defineProperty(globalThis, "window", { configurable: true, value: { qiyHostAuth: { can: async () => { throw new Error("IdP unavailable"); } } } });
    expect((await adapter.qiyIntegrationAccessControlProvider.can(request)).can).toBe(false);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { qiyHostAuth: { can: async (received: unknown) => { expect(received).toEqual(request); return { can: true }; } } } });
    expect((await adapter.qiyIntegrationAccessControlProvider.can(request)).can).toBe(true);
    writeFileSync(adapterPath, "export const customPermissionAdapter = true;\n");
    await initApp({ root, source: "catalog.qiy", sync: true });
    expect(readFileSync(adapterPath, "utf8")).toContain("customPermissionAdapter");
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("requires integration mode to use qiy init rather than standalone create", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-integration-create-"));
  const model = join(root, "catalog.qiy");
  writeFileSync(model, source);
  await expect(generateApp(model, join(root, "out"))).rejects.toThrow("must be mounted with qiy init");
});

test("host API errors preserve HTTP status and reach the host auth handler", async () => {
  const root = mkdtempSync(join(tmpdir(), "qiy-host-errors-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }));
  writeFileSync(join(root, "catalog.qiy"), source.replace("https://api.example.com/api/v2", "/api/v2"));
  await initApp({ root, source: "catalog.qiy" });
  const transport = await import(pathToFileURL(join(root, "apps/host-admin/app/host/auth.ts")).href);
  const provider = await import(pathToFileURL(join(root, "apps/host-admin/app/host/data-provider.ts")).href);
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requests = 0;
  const hostWindow: { location: { origin: string }; qiyHostAuth?: { onError: (error: unknown) => Promise<{ redirectTo: string }> } } = { location: { origin: "https://console.example.com" } };
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: hostWindow });
    for (const status of [401, 403, 500]) {
      globalThis.fetch = (async () => { requests++; return Response.json({ error: "Host denied" }, { status }); }) as unknown as typeof fetch;
      let failure: unknown;
      try { await provider.hostRequest("products"); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Host denied");
      expect((failure as { statusCode: number }).statusCode).toBe(status);
      expect(await transport.qiyIntegrationAuthProvider.onError(failure)).toEqual(status === 401 ? { logout: false, redirectTo: "/auth/login" } : {});
      let received: unknown;
      hostWindow.qiyHostAuth = { onError: async (error: unknown) => { received = error; return { redirectTo: "/host/sign-in" }; } };
      expect(await transport.qiyIntegrationAuthProvider.onError(failure)).toEqual({ redirectTo: "/host/sign-in" });
      expect(received).toBe(failure);
      delete hostWindow.qiyHostAuth;
    }
    expect(requests).toBe(3);
    globalThis.fetch = (async () => new Response("not JSON", { status: 502 })) as unknown as typeof fetch;
    await expect(provider.hostRequest("products")).rejects.toMatchObject({ message: "Host API error 502", statusCode: 502 });
  } finally {
    globalThis.fetch = originalFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("generated host transport confines tokens and CSRF to the configured API", async () => {
  const originalFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const calls: { input: unknown; init?: RequestInit }[] = [];
  let tokenReads = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://console.example.com" }, qiyHostAuth: { getAccessToken: async () => { tokenReads++; return "host-token"; } } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "XSRF-TOKEN=host%20csrf" } });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => { calls.push({ input, init }); return new Response("{}"); }) as typeof fetch;
  try {
    for (const profile of ["bearer", "portal", "cookie", "none"]) {
      const root = mkdtempSync(join(tmpdir(), "qiy-transport-"));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "host", private: true, packageManager: "bun@1.3.13" }));
      const transportSource = cookieSource.replace('auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; };', profile === "cookie" ? 'auth cookie { csrfCookie "XSRF-TOKEN"; csrfHeader "X-XSRF-TOKEN"; };' : `auth ${profile};`).replace("https://api.example.com/api/v2", "/api/v2");
      writeFileSync(join(root, "catalog.qiy"), transportSource);
      await initApp({ root, source: "catalog.qiy" });
      const transport = await import(pathToFileURL(join(root, "apps/host-admin/app/host/auth.ts")).href);
      calls.length = 0;
      const previousReads = tokenReads;
      await expect(transport.qiyIntegrationFetch("https://untrusted.example/api/v2/products")).rejects.toThrow("outside");
      await expect(transport.qiyIntegrationFetch(new URL("https://console.example.com/api/v2-other"))).rejects.toThrow("outside");
      await expect(transport.qiyIntegrationFetch("../private")).rejects.toThrow("outside");
      expect(calls).toHaveLength(0);
      expect(tokenReads).toBe(previousReads);
      await transport.qiyIntegrationFetch("products", { method: "POST", redirect: "follow" });
      const request = calls[0]!;
      expect(String(request.input)).toBe("https://console.example.com/api/v2/products");
      expect(request.init?.redirect).toBe("error");
      expect(new Headers(request.init?.headers).get("Authorization")).toBe(profile === "bearer" || profile === "portal" ? "Bearer host-token" : null);
      expect(new Headers(request.init?.headers).get("X-XSRF-TOKEN")).toBe(profile === "cookie" ? "host csrf" : null);
      expect(request.init?.credentials).toBe(profile === "cookie" ? "include" : "same-origin");
      if (profile === "cookie") {
        Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
        await expect(transport.qiyIntegrationFetch("products", { method: "DELETE" })).rejects.toThrow("CSRF cookie");
        expect(calls).toHaveLength(1);
        Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "XSRF-TOKEN=host%20csrf" } });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

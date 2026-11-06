import { afterAll, beforeAll, expect, test } from "bun:test";
import { clearIdentityCache, qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
let identityPermissions: string[] | undefined;
let identityGroups: string[] | undefined;
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "http://localhost", pathname: "/", search: "", assign: () => {} } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role, ...(Array.isArray(identityPermissions) ? { permissions: identityPermissions } : {}), ...(Array.isArray(identityGroups) ? { groups: identityGroups } : {}) }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using username and password", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches the server role policy for every declared role", async () => {
  role = "viewer"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(false);
  role = "operator"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(true);
  role = "admin"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(true);
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
test("decides every resource page action, so route guards cannot be bypassed by URL", async () => {
  tokens.set("qiy.access_token", "page-guard-token");
  role = "viewer"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(false);
  role = "operator"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(true);
  role = "admin"; clearIdentityCache();
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(true);
  tokens.clear();
  role = "viewer";
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "list" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "show" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "customers", action: "delete" })).can).toBe(false);
  tokens.set("qiy.access_token", "page-guard-token");
});


test("fetches the identity once per access token, even for concurrent guards", async () => {
  tokens.set("qiy.access_token", "identity-cache-token");
  let calls = 0;
  const originalFetchImpl = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/auth/me")) calls += 1;
    return originalFetchImpl(input, init);
  }) as typeof fetch;
  try {
    await Promise.all([
      qiyAuthProvider.getIdentity?.({}),
      qiyAuthProvider.getIdentity?.({}),
      qiyAccessControlProvider.can({ resource: "users", action: "list" }),
      qiyAccessControlProvider.can({ resource: "users", action: "create" }),
    ]);
    expect(calls).toBe(1);
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(1);
    tokens.set("qiy.access_token", "identity-cache-token-2");
    await qiyAuthProvider.getIdentity?.({});
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = originalFetchImpl;
    tokens.clear();
  }
});

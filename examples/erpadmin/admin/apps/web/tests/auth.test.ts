import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } } } });
  globalThis.fetch = (async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith("/auth/login") ? { accessToken: "local-test-token" } : { id: "test-user", role }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
});
afterAll(() => { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); globalThis.fetch = originalFetch; });

test("authenticates using username and password", async () => {
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
  expect((await qiyAuthProvider.login({ username: "admin", password: "correct-password" })).success).toBe(true); expect(tokens.get("qiy.access_token")).toBe("local-test-token");
  expect((await qiyAuthProvider.check({})).authenticated).toBe(true);
});

test("matches server admin, operator and viewer role policy", async () => {
  role = "viewer";
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "delete" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "list" })).can).toBe(false);
  role = "operator";
  expect((await qiyAccessControlProvider.can({ resource: "orders", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "show" })).can).toBe(false);
  role = "admin";
  expect((await qiyAccessControlProvider.can({ resource: "users", action: "delete" })).can).toBe(true);
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});

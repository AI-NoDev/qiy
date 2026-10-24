import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const tokens = new Map<string, string>();
let role = "viewer";
beforeAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => tokens.get(key) ?? null, setItem: (key: string, value: string) => { tokens.set(key, value); }, removeItem: (key: string) => { tokens.delete(key); } }, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: "http://localhost", pathname: "/", search: "", assign: () => {} } } });
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
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(false);
  role = "operator";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(true);
  role = "admin";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(true);
  await qiyAuthProvider.logout({});
  expect((await qiyAuthProvider.check({})).authenticated).toBe(false);
});
test("decides every resource page action, so route guards cannot be bypassed by URL", async () => {
  tokens.set("qiy.access_token", "page-guard-token");
  role = "viewer";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(false);
  role = "operator";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(true);
  role = "admin";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(true);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(true);
  tokens.clear();
  role = "viewer";
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "list" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "show" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "create" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "edit" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "products", action: "delete" })).can).toBe(false);
  tokens.set("qiy.access_token", "page-guard-token");
});

test("matches each action role allowlist without an admin bypass", async () => {
  tokens.set("qiy.access_token", "policy-test-token");
  for (const policy of [{"resource":"inventory","action":"receiveInventory","roles":["admin","operator"]},{"resource":"inventory","action":"putawayStock","roles":["admin","operator"]},{"resource":"inventory","action":"reserveStock","roles":["admin","operator"]},{"resource":"inventory","action":"adjustStock","roles":["admin","operator"]},{"resource":"inventory","action":"transferInventory","roles":["admin","operator"]},{"resource":"sales_orders","action":"shipSalesOrder","roles":["admin","operator"]},{"resource":"work_orders","action":"completeWorkOrder","roles":["admin","operator"]}]) {
    for (const candidate of ["admin", "operator", "viewer"]) {
      role = candidate;
      expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes(candidate));
    }
  }
  tokens.clear();
  expect((await qiyAccessControlProvider.can({ resource: "inventory", action: "receiveInventory" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "inventory", action: "putawayStock" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "inventory", action: "reserveStock" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "inventory", action: "adjustStock" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "inventory", action: "transferInventory" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "sales_orders", action: "shipSalesOrder" })).can).toBe(false);
  expect((await qiyAccessControlProvider.can({ resource: "work_orders", action: "completeWorkOrder" })).can).toBe(false);
});


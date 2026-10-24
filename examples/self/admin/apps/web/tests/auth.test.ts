import { afterAll, beforeAll, expect, test } from "bun:test";
import { qiyAccessControlProvider, qiyAuthProvider } from "../app/auth";

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
  for (const policy of [{"resource":"inventory","action":"receiveInventory","roles":["admin","operator"],"permissions":["inventory:receive"]},{"resource":"inventory","action":"putawayStock","roles":["admin","operator"],"permissions":["inventory:putaway"]},{"resource":"inventory","action":"reserveStock","roles":["admin","operator"]},{"resource":"inventory","action":"adjustStock","roles":["admin","operator"],"permissions":["inventory:adjust"]},{"resource":"inventory","action":"transferInventory","roles":["admin","operator"],"permissions":["inventory:transfer"]},{"resource":"sales_orders","action":"shipSalesOrder","roles":["admin","operator"],"verification":{"name":"CanShipOrders","expression":{"kind":"or","children":[{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"admin"}},{"kind":"comparison","operator":"equals","left":{"kind":"self","set":"role"},"right":{"kind":"literal","value":"operator"}}]}}},{"resource":"work_orders","action":"completeWorkOrder","roles":["admin","operator"],"permissions":["workorder:complete"]},{"resource":"purchase_orders","action":"approvePurchaseOrder","roles":["admin","operator"],"permissions":["purchasing:approve"]}]) {
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
  expect((await qiyAccessControlProvider.can({ resource: "purchase_orders", action: "approvePurchaseOrder" })).can).toBe(false);
});

const permissionCases = [{"policy":{"resource":"inventory","action":"receiveInventory"},"variant":{"role":"viewer","permissions":["inventory:receive"],"groups":[],"expected":true}},{"policy":{"resource":"inventory","action":"receiveInventory"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"inventory","action":"putawayStock"},"variant":{"role":"viewer","permissions":["inventory:putaway"],"groups":[],"expected":true}},{"policy":{"resource":"inventory","action":"putawayStock"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"inventory","action":"adjustStock"},"variant":{"role":"viewer","permissions":["inventory:adjust"],"groups":[],"expected":true}},{"policy":{"resource":"inventory","action":"adjustStock"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"inventory","action":"transferInventory"},"variant":{"role":"viewer","permissions":["inventory:transfer"],"groups":[],"expected":true}},{"policy":{"resource":"inventory","action":"transferInventory"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"sales_orders","action":"shipSalesOrder"},"variant":{"role":"admin","permissions":["api:deleteUser","api:getUser","api:putUser","inventory:adjust","inventory:putaway","inventory:receive","inventory:reserve","inventory:transfer","purchasing:approve","report:read","sales:ship","workorder:complete"],"groups":["UserApiPermissionGroup","ManagerRole","SuperAdminManager","admin","operator","viewer"],"expected":true}},{"policy":{"resource":"sales_orders","action":"shipSalesOrder"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"work_orders","action":"completeWorkOrder"},"variant":{"role":"viewer","permissions":["workorder:complete"],"groups":[],"expected":true}},{"policy":{"resource":"work_orders","action":"completeWorkOrder"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}},{"policy":{"resource":"purchase_orders","action":"approvePurchaseOrder"},"variant":{"role":"viewer","permissions":["purchasing:approve"],"groups":[],"expected":true}},{"policy":{"resource":"purchase_orders","action":"approvePurchaseOrder"},"variant":{"role":"viewer","permissions":[],"groups":[],"expected":false}}];
test("permission-guarded commands follow effective permissions from /auth/me", async () => {
  tokens.set("qiy.access_token", "permission-test-token");
  for (const item of permissionCases) {
    role = item.variant.role;
    identityPermissions = item.variant.permissions;
    identityGroups = item.variant.groups;
    expect({ policy: item.policy, allowed: (await qiyAccessControlProvider.can({ resource: item.policy.resource, action: item.policy.action })).can }).toEqual({ policy: item.policy, allowed: item.variant.expected });
  }
  // Without permission metadata the generated provider keeps the legacy role allow list.
  identityPermissions = undefined;
  identityGroups = undefined;
  role = "viewer";
  for (const policy of [{"resource":"inventory","action":"receiveInventory","roles":["admin","operator"]},{"resource":"inventory","action":"putawayStock","roles":["admin","operator"]},{"resource":"inventory","action":"adjustStock","roles":["admin","operator"]},{"resource":"inventory","action":"transferInventory","roles":["admin","operator"]},{"resource":"sales_orders","action":"shipSalesOrder","roles":["admin","operator"]},{"resource":"work_orders","action":"completeWorkOrder","roles":["admin","operator"]},{"resource":"purchase_orders","action":"approvePurchaseOrder","roles":["admin","operator"]}]) {
    expect((await qiyAccessControlProvider.can({ resource: policy.resource, action: policy.action })).can).toBe(policy.roles.includes("viewer"));
  }
  tokens.clear();
});


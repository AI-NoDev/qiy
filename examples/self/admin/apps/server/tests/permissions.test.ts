import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { createApp, type Repositories } from "../src/app";
import { createPermissionRoutes } from "../src/auth/permission-routes";
import {
  evaluatePermissionVerification,
  loadPermissions,
  normalizeClaimPermissionValues,
  normalizeDatabasePermissionColumn,
  permissionVerificationNames,
  resolvePermissionSnapshot,
} from "../src/auth/permissions";

interface PermissionSnapshot { permissions: string[]; groups: string[] }
interface PermissionCase { role: string; verification: string; input: Record<string, unknown>; expected: { found: true; allowed: boolean; missing: string[] } }
const dataset = {
  "snapshots": {
    "admin": {
      "permissions": [
        "api:deleteUser",
        "api:getUser",
        "api:putUser",
        "inventory:adjust",
        "inventory:putaway",
        "inventory:receive",
        "inventory:reserve",
        "inventory:transfer",
        "purchasing:approve",
        "report:read",
        "sales:ship",
        "workorder:complete"
      ],
      "groups": [
        "ManagerRole",
        "SuperAdminManager",
        "UserApiPermissionGroup",
        "admin"
      ]
    },
    "operator": {
      "permissions": [
        "inventory:adjust",
        "inventory:putaway",
        "inventory:receive",
        "inventory:reserve",
        "inventory:transfer",
        "report:read",
        "sales:ship",
        "workorder:complete"
      ],
      "groups": [
        "operator"
      ]
    },
    "viewer": {
      "permissions": [
        "report:read"
      ],
      "groups": [
        "viewer"
      ]
    }
  },
  "cases": [
    {
      "role": "admin",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "admin",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "admin",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "operator",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:putUser"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanAccessUserApi",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:putUser"
        ]
      }
    },
    {
      "role": "admin",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "admin",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "admin",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "operator",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:putUser"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:getUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "qiy:unknown-permission"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanManageUsers",
      "input": {
        "permission": [
          "api:putUser"
        ]
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:putUser"
        ]
      }
    },
    {
      "role": "admin",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "admin",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "operator",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "operator",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "viewer",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "admin",
          "operator",
          "viewer"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanShipOrders",
      "input": {},
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "admin",
          "operator",
          "viewer"
        ]
      }
    },
    {
      "role": "admin",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "api:getUser"
      },
      "expected": {
        "found": true,
        "allowed": true,
        "missing": []
      }
    },
    {
      "role": "admin",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "qiy:unknown-permission"
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "api:getUser"
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "operator",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "qiy:unknown-permission"
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "api:getUser"
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "api:getUser"
        ]
      }
    },
    {
      "role": "viewer",
      "verification": "CanAdjustStock",
      "input": {
        "permission": "qiy:unknown-permission"
      },
      "expected": {
        "found": true,
        "allowed": false,
        "missing": [
          "qiy:unknown-permission"
        ]
      }
    }
  ],
  "positiveValue": "api:getUser",
  "firstVerification": "CanAccessUserApi",
  "hasDatabaseSource": true
} as {
  snapshots: Record<string, PermissionSnapshot>;
  cases: PermissionCase[];
  positiveValue: string;
  firstVerification: string;
  textInputVerification?: string;
  arrayInputVerification?: string;
  hasDatabaseSource: boolean;
};

const principal = (role: string) => ({ id: "00000000-0000-4000-8000-000000000010", name: role, role: role as "admin" | "operator" | "viewer" });
const authenticate = async (request: Request) => {
  const role = request.headers.get("x-test-role");
  return role ? principal(role) : null;
};
const app = new Elysia().use(createPermissionRoutes(authenticate));
const request = (path: string, role: string | undefined, init: RequestInit = {}) => app.handle(new Request("http://localhost" + path, { ...init, headers: { ...(role ? { "x-test-role": role } : {}), ...(init.headers ?? {}) } }));

describe("generated permission provider", () => {
  test("resolves role-group permissions without any claims or database rows", () => {
    expect(resolvePermissionSnapshot({ role: "admin" })).toEqual({"permissions":["api:deleteUser","api:getUser","api:putUser","inventory:adjust","inventory:putaway","inventory:receive","inventory:reserve","inventory:transfer","purchasing:approve","report:read","sales:ship","workorder:complete"],"groups":["ManagerRole","SuperAdminManager","UserApiPermissionGroup","admin"]});
    expect(resolvePermissionSnapshot({ role: "operator" })).toEqual({"permissions":["inventory:adjust","inventory:putaway","inventory:receive","inventory:reserve","inventory:transfer","report:read","sales:ship","workorder:complete"],"groups":["operator"]});
    expect(resolvePermissionSnapshot({ role: "viewer" })).toEqual({"permissions":["report:read"],"groups":["viewer"]});
  });

  test("claim values accept arrays, comma-separated text and space-separated text", () => {
    expect(normalizeClaimPermissionValues(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a,b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues("a b")).toEqual(["a", "b"]);
    expect(normalizeClaimPermissionValues(7)).toEqual([]);
    expect(normalizeClaimPermissionValues([1, true, "a"])).toEqual(["a"]);
  });

  test("the database permission column accepts JSON arrays and separated text, failing closed on garbage", () => {
    expect(normalizeDatabasePermissionColumn('["GroupOne","api:getUser"]')).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("GroupOne, api:getUser")).toEqual(["GroupOne", "api:getUser"]);
    expect(normalizeDatabasePermissionColumn("  ")).toEqual([]);
    expect(normalizeDatabasePermissionColumn("[not-json")).toEqual([]);
    expect(normalizeDatabasePermissionColumn(null)).toEqual([]);
  });
  test("verified claim sources are only trusted when the claim is present", () => {
    expect(resolvePermissionSnapshot({ role: "viewer", claims: { "roles": dataset.positiveValue } }).permissions).toContain(dataset.positiveValue);
    expect(resolvePermissionSnapshot({ role: "viewer", claims: { "groups": dataset.positiveValue } }).permissions).toContain(dataset.positiveValue);
    expect(resolvePermissionSnapshot({ role: "viewer", claims: { "roles": dataset.positiveValue } }).permissions).toContain(dataset.positiveValue);
    expect(resolvePermissionSnapshot({ role: "viewer", claims: { "qiy-unrelated": "x" } })).toEqual(resolvePermissionSnapshot({ role: "viewer" }));
  });  test("database permission entries are unioned with the role group", () => {
    const expected = resolvePermissionSnapshot({ role: "viewer", databasePermissions: [dataset.positiveValue, "qiy-unknown-group"] });
    expect(expected).toEqual(resolvePermissionSnapshot({ role: "viewer", databasePermissions: [dataset.positiveValue] }));
    expect(expected.groups).not.toContain("qiy-unknown-group");
  });
  test("verification truth table matches the declared expressions", () => {
    for (const testCase of dataset.cases) {
      const self = { ...dataset.snapshots[testCase.role]!, role: testCase.role };
      expect({ verification: testCase.verification, input: testCase.input, verdict: evaluatePermissionVerification(testCase.verification, self, testCase.input) }).toEqual({ verification: testCase.verification, input: testCase.input, verdict: testCase.expected });
    }
  });

  test("unknown verification names are rejected", () => {
    expect(evaluatePermissionVerification("QiyUnknownVerification", { permissions: [], groups: [], role: "viewer" }, {})).toEqual({ found: false });
  });
});

describe("generated permission HTTP routes", () => {
  test("GET /api/v1/auth/permissions returns the effective snapshot for the bearer", async () => {
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await request("/api/v1/auth/permissions", role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(dataset.snapshots[role]!);
    }
    expect((await request("/api/v1/auth/permissions", undefined)).status).toBe(401);
  });
  test("POST /api/v1/auth/verify-permission answers the same verdicts as the provider", async () => {
    for (const testCase of dataset.cases) {
      const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: testCase.input }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
    }
  });

  test("POST /api/v1/auth/verify-permission rejects unknown verifications and malformed input", async () => {
    const post = (body: unknown, role = "admin") => request("/api/v1/auth/verify-permission", role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ verification: "QiyUnknownVerification", input: {} })).status).toBe(400);
    expect((await post({ verification: "CanAdjustStock", input: {} })).status).toBe(400);
    expect((await post({ verification: "CanAdjustStock", input: {"permission":7} })).status).toBe(400);
    expect((await post({ verification: "CanAccessUserApi", input: {"permission":"not-an-array"} })).status).toBe(400);
    expect((await request("/api/v1/auth/verify-permission", undefined, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: "QiyUnknownVerification" }) })).status).toBe(401);
  });

  test("extra verification input fields are ignored", async () => {
    const testCase = dataset.cases[0]!;
    const response = await request("/api/v1/auth/verify-permission", testCase.role, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verification: testCase.verification, input: { ...testCase.input, qiyExtra: "ignored" } }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(testCase.expected.allowed ? { allowed: true } : { allowed: false, missing: testCase.expected.missing });
  });
});

describe("generated /auth/me permission metadata", () => {
  test("includes effective permissions and groups without removing the principal fields", async () => {
    const repository = { distribution: async () => [], trend: async () => [], list: async () => ({ data: [], total: 0 }), one: async () => undefined, create: async () => ({}), update: async () => undefined, delete: async () => undefined, deleteMany: async () => [] };
    const repositories = Object.fromEntries(["users","orgs","suppliers","customers","products","boms","purchase_orders","purchase_order_lines","receipts","sales_orders","sales_order_lines","shipments","warehouses","bins","inventory","stock_movements","work_orders"].map((name) => [name, repository])) as unknown as Repositories;
    const application = await createApp(repositories, authenticate, false, false);
    for (const role of Object.keys(dataset.snapshots)) {
      const response = await application.handle(new Request("http://localhost/api/v1/auth/me", { headers: { "x-test-role": role } }));
      expect(response.status).toBe(200);
      const payload = await response.json() as { id: string; name: string; role: string; permissions: string[]; groups: string[] };
      expect(payload.id).toBe("00000000-0000-4000-8000-000000000010");
      expect(payload.role).toBe(role);
      expect({ permissions: payload.permissions, groups: payload.groups }).toEqual(dataset.snapshots[role]!);
    }
  });

  test("exposes the declared verification names", async () => {
    expect(permissionVerificationNames).toEqual(["CanAccessUserApi","CanAdjustStock","CanManageUsers","CanShipOrders"]);
    expect(await loadPermissions(principal("admin"))).toBeTruthy();
  });
});

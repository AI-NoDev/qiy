import { describe, expect, test } from "bun:test";
import {
  comparePermissionSets,
  declaredPermissionValues,
  evaluatePermissionExpression,
  evaluatePermissionVerification,
  expandPermissionNames,
  formatPermissionExpression,
  normalizeClaimPermissionValues,
  normalizeDatabasePermissionColumn,
  normalizeVerificationInputValue,
  requiredPermissionValues,
  resolvePermissionSnapshot,
  validatePermissionModel,
  type QiyPermissionExpressionIR,
  type QiyPermissionModel,
  type QiyPermissionOperandIR,
} from "../tools/permissions";
import { generateProject } from "../tools/generate-project";
import { generateServer } from "../tools/generate-server";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const model = (): QiyPermissionModel => ({
  fields: [
    { name: "ApiGetUserPermission", value: "api:getUser" },
    { name: "ApiPutUserPermission", value: "api:putUser" },
    { name: "ApiDeleteUserPermission", value: "api:deleteUser" },
    { name: "ReportReadPermission", value: "report:read" },
  ],
  groups: [
    { name: "UserApiPermissionGroup", members: ["ApiGetUserPermission", "ApiPutUserPermission"], form: "list" },
    { name: "ManagerRole", members: ["ApiPutUserPermission", "ApiDeleteUserPermission"], form: "list" },
    { name: "SuperAdminManager", members: ["UserApiPermissionGroup", "ManagerRole"], form: "union" },
    { name: "admin", members: ["SuperAdminManager", "ReportReadPermission"], form: "list" },
    { name: "viewer", members: ["ReportReadPermission"], form: "list" },
  ],
  claims: [{ provider: "azure-ad-b2c", claim: "roles" }],
  database: { entity: "users", field: "permissions" },
  verifications: [
    {
      name: "CanAccessUserApi",
      inputs: [{ name: "permission", type: "Array<String>" }],
      expression: { kind: "comparison", operator: "all-in", left: { kind: "input", name: "permission" }, right: { kind: "self", set: "permissions" } },
    },
  ],
});

const permissionProject = `qiy v0;
application permission-fixture {
  database sqlite {}
  auth {
    providers local, azure-ad-b2c, google;
    user users;
    subjectField subject;
    roleField role;
    usernameField email;
    passwordField passwordHash;
    provider azure-ad-b2c { subjectField azureSubject; }
    provider google { subjectField googleSubject; }
  }
  messages {
    default "en-US";
    locale "en-US" { "label.userApi" "User API"; }
  }
  permission field ApiGetUserPermission "api:getUser" @label(t("label.userApi"));
  permission field ApiPutUserPermission "api:putUser";
  permission field ApiDeleteUserPermission "api:deleteUser";
  permission group UserApiPermissionGroup { ApiGetUserPermission, ApiPutUserPermission }
  permission group ManagerRole { ApiPutUserPermission, ApiDeleteUserPermission }
  permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;
  permission group admin { SuperAdminManager }
  permission from database field users.permissions;
  permission from claim azure-ad-b2c "roles";
  permission verification CanAccessUserApi {
    input { field permission Array<String>; }
    return input.permission all included in self.permissions;
  }
  permission verification CanShipOrders {
    return self.role = "admin" || self.role = "operator";
  }
  enum roleEnum { value admin; value operator; value viewer; }
  entity users @display("{$.email}") {
    field id UUID @id;
    field subject Text @unique;
    field azureSubject Text @nullable @unique;
    field googleSubject Text @nullable @unique;
    field email Text @unique;
    field role roleEnum;
    field passwordHash Text @nullable;
    field permissions Text @nullable;
  }
  dataflow shipOrder @label("Ship") {
    allow verification CanShipOrders;
    input { field orderId UUID @required; }
    context { order = entity users by id input.orderId @required; }
    step run { update order { email = "shipped@example.com"; } }
    result { return order; }
  }
  dataflow deleteUser @label("Delete user") {
    allow permission ManagerRole;
    input { field userId UUID @required; }
    context { user = entity users by id input.userId @required; }
    step run { delete user; }
    result { return user; }
  }
  dataflow legacySetPassword @label("Legacy command") {
    allow roles admin, operator;
    input { field userId UUID @required; }
    context { user = entity users by id input.userId @required; }
    step run { update user { email = "legacy@example.com"; } }
    result { return user; }
  }
  action approveUser {
    resource users;
    dataflow deleteUser;
    placement list;
    label "Delete user";
  }
  action shipUserOrder {
    resource users;
    dataflow shipOrder;
    placement list;
    label "Ship user order";
  }
}`;

const parse = () => parseQiyProject(permissionProject);

describe("permission DSL parsing", () => {
  test("parses fields, groups, union groups, provider sources and verifications", () => {
    const project = parse();
    const permissions = project.permissions!;
    expect(permissions.fields.map((field) => [field.name, field.value, field.label])).toEqual([
      ["ApiGetUserPermission", "api:getUser", "User API"],
      ["ApiPutUserPermission", "api:putUser", undefined],
      ["ApiDeleteUserPermission", "api:deleteUser", undefined],
    ]);
    expect(permissions.groups).toEqual([
      { name: "UserApiPermissionGroup", members: ["ApiGetUserPermission", "ApiPutUserPermission"], form: "list" },
      { name: "ManagerRole", members: ["ApiPutUserPermission", "ApiDeleteUserPermission"], form: "list" },
      { name: "SuperAdminManager", members: ["UserApiPermissionGroup", "ManagerRole"], form: "union" },
      { name: "admin", members: ["SuperAdminManager"], form: "list" },
    ]);
    expect(permissions.claims).toEqual([{ provider: "azure-ad-b2c", claim: "roles" }]);
    expect(permissions.database).toEqual({ entity: "users", field: "permissions" });
    expect(permissions.verifications.map((verification) => verification.name)).toEqual(["CanAccessUserApi", "CanShipOrders"]);
    expect(permissions.verifications[0]!.inputs).toEqual([{ name: "permission", type: "Array<String>" }]);
  });

  test("parses every dataflow allow form and keeps them disjoint", () => {
    const project = parse();
    const flows = new Map(project.dataflows!.map((flow) => [flow.name, flow]));
    expect(flows.get("deleteUser")?.permission).toEqual(["ManagerRole"]);
    expect(flows.get("shipOrder")?.verification).toBe("CanShipOrders");
    expect(flows.get("legacySetPassword")?.roles).toEqual(["admin", "operator"]);
    expect(flows.get("deleteUser")?.roles).toBeUndefined();
  });

  test("accepts the short and canonical verification operators", () => {
    const source = (expression: string) => `qiy v0;
application ops {
  database sqlite {}
  auth { user users; provider local; usernameField email; passwordField passwordHash; roleField role; }
  permission field ApiGetUserPermission "api:getUser";
  permission verification V {
    input { field permission Array<String>; }
    return ${expression};
  }
  entity users {
    field id UUID @id;
    field email Text;
    field role Text;
    field passwordHash Text;
    field permissions Text @nullable;
  }
}`;
    const operators: Array<[string, string]> = [
      ["all included in", "all-in"],
      ["all in", "all-in"],
      ["some included in", "some-in"],
      ["some in", "some-in"],
      ["not some included in", "not-some-in"],
      ["not some in", "not-some-in"],
      ["not all included in", "not-all-in"],
      ["not all in", "not-all-in"],
    ];
    for (const [text, operator] of operators) {
      const project = parseQiyProject(source(`input.permission ${text} self.permissions`));
      expect((project.permissions!.verifications[0]!.expression as { operator: string }).operator).toBe(operator);
    }
    expect((parseQiyProject(source('input.permission = self.permissions')).permissions!.verifications[0]!.expression as { operator: string }).operator).toBe("equals");
    expect((parseQiyProject(source('input.permission != self.permissions')).permissions!.verifications[0]!.expression as { operator: string }).operator).toBe("not-equals");
  });

  test("round-trips the permission model through serializeQiyProject", () => {
    const project = parse();
    const text = serializeQiyProject(project);
    expect(text).toContain('permission group SuperAdminManager = UserApiPermissionGroup & ManagerRole;');
    expect(text).toContain('permission from claim azure-ad-b2c roles;');
    expect(text).toContain("permission from database field users.permissions;");
    expect(text).toContain("allow permission ManagerRole;");
    expect(text).toContain("allow verification CanShipOrders;");
    expect(text).toContain("allow roles admin, operator;");
    const reparsed = parseQiyProject(text);
    expect(reparsed.permissions).toEqual(project.permissions);
  });
});

describe("permission DSL validation", () => {
  const parseError = (source: string): string => {
    try {
      parseQiyProject(source);
      throw new Error("expected a parse error");
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const withPermissions = (block: string): string => `qiy v0;
application bad-permissions {
  database sqlite {}
  auth { providers local, google; user users; subjectField subject; roleField role; usernameField email; passwordField passwordHash; }
  ${block}
  entity users {
    field id UUID @id;
    field subject Text;
    field email Text;
    field role Text;
    field passwordHash Text;
    field permissions Text @nullable;
  }
}`;

  test("rejects unknown group members, duplicates, self references and cycles", () => {
    expect(parseError(withPermissions('permission field A "a"; permission group G { Missing }'))).toContain("unknown member Missing");
    expect(parseError(withPermissions('permission field A "a"; permission group G { A, A }'))).toContain("duplicate member A");
    expect(parseError(withPermissions('permission field A "a"; permission group G { G }'))).toContain("cannot reference itself");
    expect(parseError(withPermissions('permission field A "a"; permission group G1 { G2 } permission group G2 { G1 }'))).toContain("cyclic group reference");
    expect(parseError(withPermissions('permission field A "a"; permission field A "b";'))).toContain("duplicate declaration");
    expect(parseError(withPermissions('permission field A "a"; permission field B "a";'))).toContain("duplicate value a");
  });

  test("rejects unknown inputs, unknown self sets and malformed expressions", () => {
    expect(parseError(withPermissions(`permission field A "a"; permission verification V { return input.missing all included in self.permissions; }`))).toContain("unknown input missing");
    expect(parseError(withPermissions(`permission field A "a"; permission verification V { return self.unknown all included in self.permissions; }`))).toContain("unsupported self set");
    expect(parseError(withPermissions(`permission field A "a"; permission verification V { return self.permissions sideways in self.groups; }`))).toContain("expected");
    expect(parseError(withPermissions(`permission field A "a"; permission verification V { return ( self.permissions = self.groups; }`))).toContain("Expected )");
    expect(parseError(withPermissions(`permission field A "a"; permission verification V { input { field x Array<Text>; } return input.x = self.groups; }`))).toContain("Array requires String");
  });

  test("rejects claim sources that are not configured OAuth providers", () => {
    expect(parseError(withPermissions(`permission field A "a"; permission from claim local "roles";`))).toContain("not a configured OAuth");
    expect(parseError(withPermissions(`permission field A "a"; permission from claim auth0 "groups";`))).toContain("not a configured OAuth");
  });

  test("rejects database sources that are not a Text column on the auth user entity", () => {
    expect(parseError(withPermissions('permission field A "a"; permission from database field users.id;'))).toContain("must be a Text column");
    expect(parseError(withPermissions('permission field A "a"; permission from database field missing.permissions;'))).toContain("unknown entity");
  });

  test("rejects unknown dataflow permission/verification rules", () => {
    const orderProject = (allow: string) => `qiy v0;
application bad-command {
  database sqlite {}
  auth { user users; provider local; usernameField email; passwordField passwordHash; roleField role; }
  permission field A "a";
  permission verification V { return self.role = "admin"; }
  entity users { field id UUID @id; field email Text; field role Text; field passwordHash Text; field permissions Text @nullable; }
  dataflow d @label("d") {
    allow ${allow};
    input { field id UUID @required; }
    context { row = entity users by id input.id @required; }
    step s { update row { email = "x@example.com"; } }
    result { return row; }
  }
}`;
    expect(parseError(orderProject("permission Missing"))).toContain("unknown permission field or group Missing");
    expect(parseError(orderProject("verification Missing"))).toContain("unknown permission verification Missing");
  });

  test("rejects permission declarations without generated authentication", () => {
    expect(parseError(`qiy v0;
application no-auth {
  database sqlite {}
  permission field A "a";
  entity users { field id UUID @id; field name Text; }
}`)).toContain("require a generated auth block");
  });
});

describe("permission group expansion and provider resolution", () => {
  test("expands permission values and group names through nested groups", () => {
    const expanded = expandPermissionNames(model(), ["SuperAdminManager"]);
    expect(expanded.permissions).toEqual(["api:deleteUser", "api:getUser", "api:putUser"]);
    expect(expanded.groups).toEqual(["ManagerRole", "SuperAdminManager", "UserApiPermissionGroup"]);
  });

  test("`allow permission` expands group references to required permission values", () => {
    expect(requiredPermissionValues(model(), ["ManagerRole"])).toEqual(["api:deleteUser", "api:putUser"]);
    expect(requiredPermissionValues(model(), ["UserApiPermissionGroup", "ReportReadPermission"])).toEqual(["api:getUser", "api:putUser", "report:read"]);
    expect(requiredPermissionValues(model(), ["MissingGroup"])).toEqual([]);
  });

  test("role groups provide the local password baseline", () => {
    const admin = resolvePermissionSnapshot(model(), { role: "admin" });
    expect(admin.permissions).toEqual(["api:deleteUser", "api:getUser", "api:putUser", "report:read"]);
    expect(admin.groups).toEqual(["ManagerRole", "SuperAdminManager", "UserApiPermissionGroup", "admin"]);
    expect(resolvePermissionSnapshot(model(), { role: "viewer" })).toEqual({ permissions: ["report:read"], groups: ["viewer"] });
    expect(resolvePermissionSnapshot(model(), { role: "unknown-role" })).toEqual({ permissions: [], groups: [] });
  });

  test("database permission entries accept values and group names, unknown entries are ignored", () => {
    const snapshot = resolvePermissionSnapshot(model(), { role: "viewer", databasePermissions: ["api:getUser", "ManagerRole", "qiy:unknown"] });
    expect(snapshot.permissions).toEqual(["api:deleteUser", "api:getUser", "api:putUser", "report:read"]);
    expect(snapshot.groups).toEqual(["ManagerRole", "viewer"]);
  });

  test("verified claim values accept arrays, comma and space separated strings", () => {
    const fromArray = resolvePermissionSnapshot(model(), { role: "viewer", claims: { roles: ["ManagerRole"] } });
    expect(fromArray.permissions).toEqual(["api:deleteUser", "api:putUser", "report:read"]);
    expect(resolvePermissionSnapshot(model(), { role: "viewer", claims: { roles: "api:putUser,ManagerRole" } })).toEqual(fromArray);
    expect(resolvePermissionSnapshot(model(), { role: "viewer", claims: { roles: "api:putUser ManagerRole" } })).toEqual(fromArray);
    expect(resolvePermissionSnapshot(model(), { role: "viewer", claims: { roles: 7 } })).toEqual(resolvePermissionSnapshot(model(), { role: "viewer" }));
    expect(normalizeClaimPermissionValues([1, "api:getUser", true])).toEqual(["api:getUser"]);
  });

  test("sources are additive: role group, database and claims union without subtraction", () => {
    const snapshot = resolvePermissionSnapshot(model(), { role: "viewer", databasePermissions: ["api:getUser"], claims: { roles: ["api:putUser"] } });
    expect(snapshot.permissions).toEqual(["api:getUser", "api:putUser", "report:read"]);
    expect(snapshot.groups).toEqual(["viewer"]);
  });

  test("database column parsing follows the documented JSON contract and fails closed", () => {
    expect(normalizeDatabasePermissionColumn('["A","B"]')).toEqual(["A", "B"]);
    expect(normalizeDatabasePermissionColumn("A, B")).toEqual(["A", "B"]);
    expect(normalizeDatabasePermissionColumn("A B")).toEqual(["A", "B"]);
    expect(normalizeDatabasePermissionColumn("")).toEqual([]);
    expect(normalizeDatabasePermissionColumn("[not-json")).toEqual([]);
    expect(normalizeDatabasePermissionColumn(null)).toEqual([]);
    expect(declaredPermissionValues(model())).toEqual(["api:getUser", "api:putUser", "api:deleteUser", "report:read"]);
  });
});

describe("permission verification semantics", () => {
  const expression = (
    left: QiyPermissionOperandIR,
    operator: "all-in" | "some-in" | "not-all-in" | "not-some-in" | "equals" | "not-equals",
    right: QiyPermissionOperandIR,
  ): QiyPermissionExpressionIR => ({ kind: "comparison", operator, left, right });
  const input = (name: string): QiyPermissionOperandIR => ({ kind: "input", name });
  const self = (set: "permissions" | "groups" | "role"): QiyPermissionOperandIR => ({ kind: "self", set });
  const evaluate = (node: QiyPermissionExpressionIR, permissions: string[], groups: string[], role = "operator", values: Record<string, string | string[]> = {}) =>
    evaluatePermissionExpression(node, { self: { permissions, groups, role }, input: values });

  test("subset and intersection operators match the truth table", () => {
    const subset = expression(input("x"), "all-in", self("permissions"));
    expect(evaluate(subset, ["a", "b"], [], "operator", { x: ["a"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(subset, ["a"], [], "operator", { x: ["a", "b"] })).toEqual({ allowed: false, missing: ["b"] });

    const some = expression(input("x"), "some-in", self("permissions"));
    expect(evaluate(some, ["a"], [], "operator", { x: ["a", "z"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(some, ["a"], [], "operator", { x: ["z"] })).toEqual({ allowed: false, missing: ["z"] });

    const notSome = expression(input("x"), "not-some-in", self("permissions"));
    expect(evaluate(notSome, ["a"], [], "operator", { x: ["z"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(notSome, ["a", "b"], [], "operator", { x: ["a", "z"] })).toEqual({ allowed: false, missing: ["a"] });

    const notAll = expression(input("x"), "not-all-in", self("permissions"));
    expect(evaluate(notAll, ["a"], [], "operator", { x: ["a", "b"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(notAll, ["a", "b"], [], "operator", { x: ["a"] })).toEqual({ allowed: false, missing: [] });
  });

  test("set equality and inequality normalize both sides", () => {
    const equals = expression(input("x"), "equals", self("permissions"));
    expect(evaluate(equals, ["a", "b"], [], "operator", { x: ["b", "a", "a"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(equals, ["a"], [], "operator", { x: ["a", "b"] })).toEqual({ allowed: false, missing: ["b"] });
    expect(evaluate(equals, ["a", "b"], [], "operator", { x: ["a"] })).toEqual({ allowed: false, missing: ["b"] });
    const notEquals = expression(input("x"), "not-equals", self("permissions"));
    expect(evaluate(notEquals, ["a"], [], "operator", { x: ["a"] })).toEqual({ allowed: false, missing: [] });
    expect(evaluate(notEquals, ["a"], [], "operator", { x: ["b"] })).toEqual({ allowed: true, missing: [] });
  });

  test("self sets, role comparisons and literals work on either side", () => {
    expect(evaluate(expression(self("permissions"), "some-in", self("permissions")), ["a"], [], "operator", {}).allowed).toBe(true);
    expect(evaluate(expression(self("role"), "equals", { kind: "literal", value: "admin" }), [], [], "admin")).toEqual({ allowed: true, missing: [] });
    expect(evaluate(expression({ kind: "literal", value: "x" }, "some-in", input("x")), [], [], "operator", { x: ["x"] })).toEqual({ allowed: true, missing: [] });
    expect(evaluate(expression(self("groups"), "equals", input("x")), [], ["admin", "ops"], "admin", { x: ["admin", "ops"] })).toEqual({ allowed: true, missing: [] });
  });

  test("boolean combinators and parentheses follow standard precedence", () => {
    const a = expression(input("x"), "all-in", self("permissions"));
    const b = expression(self("role"), "equals", { kind: "literal", value: "admin" });
    const c = expression(input("x"), "some-in", self("groups"));
    const permissions = ["a"];
    const groups = ["ops"];
    expect(evaluate({ kind: "and", children: [a, b] }, permissions, groups, "admin", { x: ["a"] }).allowed).toBe(true);
    expect(evaluate({ kind: "and", children: [a, b] }, permissions, groups, "operator", { x: ["a"] }).allowed).toBe(false);
    expect(evaluate({ kind: "or", children: [{ kind: "not", expression: a }, b] }, permissions, groups, "operator", { x: ["a"] }).allowed).toBe(false);
    expect(evaluate({ kind: "or", children: [{ kind: "not", expression: a }, b] }, permissions, groups, "operator", { x: ["z"] }).allowed).toBe(true);
    expect(evaluate({ kind: "not", expression: { kind: "and", children: [a, c] } }, permissions, groups, "operator", { x: ["a"] }).allowed).toBe(true);
  });

  test("parse keeps operator precedence: and binds tighter than or", () => {
    const project = parseQiyProject(`qiy v0;
application precedence {
  database sqlite {}
  auth { user users; provider local; usernameField email; passwordField passwordHash; roleField role; }
  permission field A "a";
  permission verification V {
    input { field x Array<String>; }
    return input.x = self.permissions && self.role != "viewer" || self.groups some in input.x;
  }
  entity users { field id UUID @id; field email Text; field role Text; field passwordHash Text; field permissions Text @nullable; }
}`);
    const expression = project.permissions!.verifications[0]!.expression;
    expect(expression.kind).toBe("or");
    const or = expression as { kind: "or"; children: QiyPermissionExpressionIR[] };
    expect(or.children[0]!.kind).toBe("and");
  });

  test("evaluatePermissionVerification validates declared inputs and ignores extra ones", () => {
    const permissions = model();
    const result = evaluatePermissionVerification(permissions, "CanAccessUserApi", { permissions: ["api:getUser"], groups: [], role: "admin" }, { permission: ["api:getUser"], extra: "ignored" });
    expect(result).toEqual({ found: true, allowed: true, missing: [] });
    expect(evaluatePermissionVerification(permissions, "CanAccessUserApi", { permissions: [], groups: [], role: "admin" }, {})).toEqual({ found: true, error: "Verification CanAccessUserApi requires input field permission" });
    expect(evaluatePermissionVerification(permissions, "CanAccessUserApi", { permissions: [], groups: [], role: "admin" }, { permission: "api:getUser" })).toEqual({ found: true, error: "Verification CanAccessUserApi input field permission must be an array of strings" });
    expect(evaluatePermissionVerification(permissions, "CanAccessUserApi", { permissions: [], groups: [], role: "admin" }, { permission: [1] })).toEqual({ found: true, error: "Verification CanAccessUserApi input field permission must be an array of strings" });
    expect(evaluatePermissionVerification(permissions, "Unknown", { permissions: [], groups: [], role: "admin" }, {})).toEqual({ found: false });
    expect(normalizeVerificationInputValue("Text", "x")).toEqual(["x"]);
    expect(normalizeVerificationInputValue("Text", 7)).toBeUndefined();
    expect(normalizeVerificationInputValue("Array<String>", ["x"])).toEqual(["x"]);
    expect(normalizeVerificationInputValue("Array<String>", "x")).toBeUndefined();
    // The generated expression text re-parses to the same truth value.
    const modelVerification = permissions.verifications[0]!;
    expect(evaluatePermissionExpression(modelVerification.expression, { self: { permissions: ["api:getUser"], groups: [], role: "admin" }, input: { permission: ["api:getUser"] } }).allowed).toBe(true);
    expect(formatPermissionExpression(modelVerification.expression)).toBe("input.permission all included in self.permissions");
  });

  test("comparePermissionSets is exported for the generated runtime parity tests", () => {
    expect(comparePermissionSets("all-in", ["a"], ["a", "b"]).allowed).toBe(true);
    expect(comparePermissionSets("not-equals", ["a"], ["a", "b"]).allowed).toBe(true);
  });
});

describe("permission generation", () => {
  test("generates the provider module, HTTP routes and /auth/me metadata", () => {
    const project = parse();
    const files = generateServer(project.database, { ...project });
    const provider = files["api/src/auth/permissions.ts"]!;
    expect(provider).toContain("export async function loadPermissions");
    expect(provider).toContain("export function resolvePermissionSnapshot");
    expect(provider).toContain("export function evaluatePermissionVerification");
    expect(provider).toContain('"SuperAdminManager":["UserApiPermissionGroup","ManagerRole"]');
    expect(provider).toContain("users.permissions");
    expect(provider).toContain('"azure-ad-b2c"');
    const routes = files["api/src/auth/permission-routes.ts"]!;
    expect(routes).toContain('prefix: "/api/v1/auth"');
    expect(routes).toContain('.get("/permissions"');
    expect(routes).toContain('.post("/verify-permission"');
    expect(routes).toContain("Unknown permission verification");
    expect(files["api/src/app.ts"]).toContain("loadPermissions(principal)");
    expect(files["api/src/app.ts"]).toContain("permissionRoutes");
    expect(files["api/src/dataflows/index.ts"]).toContain("requiredPermissions");
    expect(files["api/src/dataflows/index.ts"]).toContain("evaluatePermissionVerification");
    expect(files["api/src/dataflows/index.ts"]).toContain('["admin","operator"].includes(principal.role)');
    expect(files["api/tests/permissions.test.ts"]).toContain("verification truth table");
  });

  test("generated web command policies expose expanded permissions and permission-aware access control", () => {
    const project = parse();
    const web = generateWeb(project.database, { ...project });
    const auth = web["web/app/auth.ts"]!;
    expect(auth).toContain('"permissions":["api:deleteUser","api:putUser"]');
    expect(auth).toContain("evaluateCommandPermission");
    expect(auth).toContain("identity.permissions");
    expect(auth).toContain("CanShipOrders");
    expect(web["web/tests/auth.test.ts"]).toContain("permission-guarded commands follow effective permissions");
  });

  test("generates without permission declarations when the model has none", () => {
    const project = parseQiyProject(`qiy v0;
application plain {
  database sqlite {}
  auth { user users; provider local; usernameField email; passwordField passwordHash; roleField role; }
  enum roleEnum { value admin; value operator; value viewer; }
  entity users { field id UUID @id; field email Text @unique; field role roleEnum; field passwordHash Text @nullable; }
}`);
    const files = generateServer(project.database, { ...project });
    expect(files["api/src/auth/permissions.ts"]).toBeUndefined();
    expect(files["api/src/app.ts"]).not.toContain("loadPermissions");
    expect(generateWeb(project.database, { ...project })["web/app/auth.ts"]).not.toContain("evaluateCommandPermission");
  });

  test("generateProject wires the model without throwing", () => {
    const project = parse();
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/server/src/auth/permissions.ts"]).toBeTruthy();
    expect(files["apps/web/app/auth.ts"]).toContain("qiyAccessControlProvider");
  });

  test("validates group references and reports unknown members", () => {
    expect(validatePermissionModel({ fields: [{ name: "A", value: "a" }], groups: [{ name: "G", members: ["Missing"], form: "list" }], verifications: [] }, { oauthProviders: [], entities: [], hasAuth: true })).toContain("Permission group G: unknown member Missing");
  });
});

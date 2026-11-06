import { describe, expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import { leastPrivilegedRole, primaryAdminRole, renderRolesModule, roleContext, withDefaultCommandRoles } from "../tools/roles";

const model = (roles: string, values: string[], extra = "") => `qiy v0; application desk {
  database sqlite {}
  auth {
    providers local;
    user users;
    roleField role;
    usernameField email;
    passwordField passwordHash;
${roles}
  }
  enum role {
${values.map((value) => `    value ${value};`).join("\n")}
  }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field passwordHash Text @nullable;
    field role role;
  }
  entity tickets {
    field id UUID @id;
    field title Text;
  }
${extra}
}`;

const custom = `    roles {
      owner full;
      agent write;
      auditor read;
    }`;
const customValues = ["owner", "agent", "auditor"];
const retitle = (allow = "") => `  dataflow retitle {
${allow}
    idempotency required;
    input {
      field ticketId UUID @required;
      field title Text @required;
    }
    context { ticket = entity tickets by id input.ticketId @required; }
    step change { update ticket { title = input.title; } }
    result { return ticket; }
  }`;

const build = (source: string) => {
  const project = parseQiyProject(source);
  return generateProject(project.database, project.name, { auth: project.auth, dataflows: project.dataflows, restrictions: project.restrictions, pages: project.pages });
};

describe("custom roles", () => {
  test("parses, round-trips and defaults to admin/operator/viewer", () => {
    const project = parseQiyProject(model(custom, customValues));
    expect(project.auth?.roles).toEqual([{ name: "owner", access: "full" }, { name: "agent", access: "write" }, { name: "auditor", access: "read" }]);
    expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
    const defaults = parseQiyProject(model("", ["admin", "operator", "viewer"]));
    expect(defaults.auth?.roles).toBeUndefined();
    expect(roleContext(defaults.auth)).toMatchObject({ names: ["admin", "operator", "viewer"], admin: "admin", writers: ["admin", "operator"], reader: "viewer", least: "viewer" });
  });

  test("derives the bootstrap admin, onboarding default and command writers", () => {
    const auth = { roles: [{ name: "agent", access: "write" as const }, { name: "boss", access: "full" as const }, { name: "guest", access: "read" as const }, { name: "intern", access: "read" as const }] };
    expect(primaryAdminRole(auth)).toBe("boss");
    expect(leastPrivilegedRole(auth)).toBe("guest");
    expect(leastPrivilegedRole({ roles: [{ name: "root", access: "full" }, { name: "staff", access: "write" }] })).toBe("staff");
    const flows = withDefaultCommandRoles([{ name: "a" }, { name: "b", roles: ["boss"] }, { name: "c", permission: ["X"] }], auth);
    expect(flows.map((flow) => flow.roles)).toEqual([["agent", "boss"], ["boss"], undefined]);
  });

  test("rejects invalid declarations and references", () => {
    expect(() => parseQiyProject(model(`    roles { owner write; }`, ["owner"]))).toThrow("at least one role needs full access");
    expect(() => parseQiyProject(model(`    roles { owner full; owner read; }`, ["owner"]))).toThrow("duplicate role owner");
    expect(() => parseQiyProject(model(`    roles { owner admin; }`, ["owner"]))).toThrow("unsupported access admin");
    expect(() => parseQiyProject(model(`    roles { Owner full; }`, ["Owner"]))).toThrow("must start with a lowercase letter");
    expect(() => parseQiyProject(model(custom, customValues, "  restrict tickets { allow roles admin; }"))).toThrow("unknown role admin; declared roles are owner, agent, auditor");
    expect(() => parseQiyProject(model(custom, customValues, retitle("    allow roles auditor;")))).toThrow("role auditor has read access and cannot run commands");
    expect(() => build(model(custom, ["owner", "agent"]))).toThrow("roleField must be an enum whose values are exactly the declared roles (owner, agent, auditor)");
    expect(() => build(model("", ["admin", "operator"]))).toThrow("exactly the declared roles (admin, operator, viewer)");
  });

  test("generates a roles module that every server check reads", () => {
    const files = build(model(custom, customValues, retitle()));
    const roles = files["apps/server/src/auth/roles.ts"]!;
    expect(roles).toContain('const roles = {"owner":"full","agent":"write","auditor":"read"} as const');
    expect(roles).toContain('export const QIY_ADMIN_ROLE: QiyRole = "owner";');
    expect(roles).toContain('export const QIY_DEFAULT_ROLE: QiyRole = "auditor";');
    expect(roles).toBe(renderRolesModule({ roles: [{ name: "owner", access: "full" }, { name: "agent", access: "write" }, { name: "auditor", access: "read" }] }));
    expect(files["apps/server/src/auth/guard.ts"]).toContain("if (hasFullAccess(role)) return true;");
    expect(files["apps/server/src/auth/password.ts"]).toContain("export const isRole = isQiyRole;");
    expect(files["apps/server/src/auth/bootstrap-admin.ts"]).toContain('"role": "owner"');
    expect(files["apps/server/src/auth/bootstrap-admin.ts"]).toContain('inArray(users.role, ["owner"])');
    const commands = Object.entries(files).find(([path, text]) => path.startsWith("apps/server/src/dataflows") && text.includes("Command execution is restricted"))?.[1];
    expect(commands).toContain('if (!["owner","agent"].includes(principal.role))');
    const generatedSources = Object.entries(files).filter(([path]) => path.startsWith("apps/server/src/")).map(([, text]) => text).join("\n");
    expect(generatedSources).not.toMatch(/role [!=]== "(admin|operator|viewer)"/);
  });

  test("the web access control provider reads the declared access table", () => {
    const files = build(model(custom, customValues));
    const auth = files["apps/web/app/auth.ts"]!;
    expect(auth).toContain('const roleAccess: Record<string, "full" | "write" | "read"> = {"owner":"full","agent":"write","auditor":"read"};');
    expect(auth).toContain('if (access === "full") return { can: true };');
    expect(auth).not.toContain('"operator"');
    expect(files["apps/web/tests/auth.test.ts"]).toContain('role = "auditor"');
  });
});

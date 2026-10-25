import { describe, expect, test } from "bun:test";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const realtimeModel = `qiy v0;
application serializer-roundtrip {
  database sqlite {}
  mode standalone;
  realtime {
    mode auto;
    resource sessions {
      events created, updated;
      roles admin;
      when tenantId claim tenant.id;
    }
  }
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; }
  enum sessionState { value active; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field role userRole;
    field passwordHash Text @nullable;
  }
  entity sessions {
    field id UUID @id;
    field tenantId Text;
    field state sessionState;
  }
}`;

describe("Qiy serializer round-trips", () => {
  test("keeps explicit standalone mode and dotted realtime claims", () => {
    const project = parseQiyProject(realtimeModel);
    expect(project.mode).toBe("standalone");
    const serialized = serializeQiyProject(project);
    expect(serialized).toContain("mode standalone;");
    expect(serialized).toContain("claim tenant.id;");
    expect(serializeQiyProject(parseQiyProject(serialized))).toBe(serialized);
  });

  test("does not invent a mode line for projects that never set one", () => {
    const project = parseQiyProject(`qiy v0; application serializer-default {
  database sqlite {}
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum userRole { value admin; }
  entity users {
    field id UUID @id;
    field email Text @unique;
    field role userRole;
    field passwordHash Text @nullable;
  }
}`);
    expect(project.mode).toBeUndefined();
    expect(serializeQiyProject(project)).not.toContain("mode standalone;");
  });
});

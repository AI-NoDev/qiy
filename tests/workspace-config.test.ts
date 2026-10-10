import { expect, test } from "bun:test";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

test("parses and serializes existing Bun workspace aliases in the Qiy model", () => {
  const source = `qiy v0;
application catalog {
  database sqlite {}
  workspace {
    name admin;
    aliases { server ops-api; web ops-console; deploy ops-admin; }
    packages { server "@example/ops-api"; web "@example/ops-console"; }
  }
  entity products { field id UUID @id; field title Text; }
}`;
  const project = parseQiyProject(source);
  expect(project.workspace).toEqual({
    name: "admin",
    aliases: { server: "ops-api", web: "ops-console", deploy: "ops-admin" },
    packages: { server: "@example/ops-api", web: "@example/ops-console" },
  });
  expect(parseQiyProject(serializeQiyProject(project)).workspace).toEqual(project.workspace);
});

test("rejects unsupported or duplicate workspace settings", () => {
  const prefix = "qiy v0; application catalog { database sqlite {} ";
  expect(() => parseQiyProject(`${prefix}workspace { aliases { api api; } } }`)).toThrow("Unsupported workspace alias api");
  expect(() => parseQiyProject(`${prefix}workspace { aliases { server one; server two; } } }`)).toThrow("Duplicate workspace aliases.server");
});

import { expect, test } from "bun:test";
import { canSeeField, getResource, resources } from "../app/resources";

const fieldRules: Array<{ resource: string; field: string; roles: string[] }> = [];

test("page field layout follows the declared roles", () => {
  for (const rule of fieldRules) {
    const resource = getResource(rule.resource);
    expect(resource).toBeDefined();
    const field = resource?.fields.find((candidate) => candidate.name === rule.field);
    expect(field).toBeDefined();
    expect(field?.roles).toEqual(rule.roles);
    // Every role outside the rule must not see the field, inside must see it.
    for (const role of ["admin", "operator", "viewer"]) {
      expect(canSeeField(field!, role)).toBe(rule.roles.includes(role));
    }
    expect(canSeeField(field!, undefined)).toBe(false);
  }
});

test("fields without layout rules stay visible to every role", () => {
  for (const resource of resources) {
    for (const field of resource.fields) {
      if (field.roles) continue;
      for (const role of ["admin", "operator", "viewer"]) expect(canSeeField(field, role)).toBe(true);
    }
  }
});

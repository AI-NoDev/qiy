import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject } from "../tools/qiy-project";

/** Minimal model so the dialect under test does not inherit MySQL/PostgreSQL-only features. */
function setupFor(dialect: "sqlite" | "postgresql" | "mysql"): string {
  const project = parseQiyProject(`qiy v0;

application qiy-test-isolation {
  database ${dialect} {
  }

  entity products {
    field id UUID @id;
    field title Text;
  }
}
`);
  return generateProject(project.database, project.name, project)["apps/server/tests/setup.ts"]!;
}

test("SQLite server tests always run on a fresh in-memory database", () => {
  const setup = setupFor("sqlite");
  expect(setup).toContain('Bun.env.DATABASE_URL = Bun.env.QIY_TEST_DATABASE_URL ?? ":memory:";');
  expect(setup).not.toContain("Bun.env.DATABASE_URL ??=");
});

test("server tests point non-SQLite dialects at a disposable test database", () => {
  for (const dialect of ["postgresql", "mysql"] as const) {
    const setup = setupFor(dialect);
    expect(setup).toContain("QIY_TEST_DATABASE_URL");
    expect(setup).toContain("qiy_test");
    expect(setup).not.toContain("Bun.env.DATABASE_URL ??=");
  }
});

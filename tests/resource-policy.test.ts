import { expect, test } from "bun:test";
import { generateProject } from "../tools/generate-project";
import { generateServer } from "../tools/generate-server";
import { generateWeb } from "../tools/generate-web";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

function model(dialect = "sqlite", extra = ""): string {
  return `qiy v0;
application policy-demo {
  database ${dialect} {}
  enum recordStatus { value draft; value pending; value closed; }
  entity records {
    field id UUID @id;
    field ownerId UUID;
    field status recordStatus;
    field salary Decimal(10,2) @nullable;
    field note Text;
    field score Integer;
  }
  scope records ownerId claim tenant.ownerId;
  restrict records {
    allow roles admin, operator;
    when ownerId claim user.id;
    when status in "draft", "pending";
    when score notIn "0";
    mask salary roles operator mode redact replacement "***";
    mask note claim absent compliance.level mode omit;
  }
  ${extra}
}`;
}

test("parses, rejects and round-trips record and field policy", () => {
  const project = parseQiyProject(model());
  expect(project.restrictions).toEqual([{
    resource: "records",
    roles: ["admin", "operator"],
    rows: [
      { field: "ownerId", source: "claim", operator: "==", claim: "user.id", missing: "deny" },
      { field: "status", source: "values", operator: "in", values: ["draft", "pending"], missing: "hide" },
      { field: "score", source: "values", operator: "notIn", values: ["0"], missing: "hide" },
    ],
    masks: [
      { field: "salary", roles: ["operator"], mode: "redact", replacement: "***" },
      { field: "note", claim: "compliance.level", claimState: "absent", mode: "omit" },
    ],
  }]);
  expect(parseQiyProject(serializeQiyProject(project)).restrictions).toEqual(project.restrictions);
  expect(() => parseQiyProject(model().replace("restrict records", "restrict missing"))).toThrow("unknown resource");
  expect(() => parseQiyProject(model().trimEnd().replace(/\}\s*$/, "  restrict records { allow roles viewer; }\n}"))).toThrow("duplicate resource restriction");
  expect(() => parseQiyProject(model().replace("when score", "when status"))).toThrow("duplicate row condition");
  expect(() => parseQiyProject(model().replace("when ownerId", "when id"))).toThrow("primary key");
  expect(() => parseQiyProject(model().replace("field salary Decimal(10,2) @nullable;", "field salary Decimal(10,2) @nullable;\n    field secret Vector(3) @nullable;").replace("mask note", "mask secret roles viewer mode omit;\n    mask note"))).toThrow("Vector field");
  expect(() => parseQiyProject(model().replace('mode redact replacement "***"', "mode redact"))).toThrow("requires a replacement");
  expect(() => parseQiyProject(model().replace("allow roles admin, operator", "allow roles owner"))).toThrow("unsupported role");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} mode integration; integration { apiBase "/api"; auth none; } entity items { field id UUID @id; field title Text; } restrict items { when title claim user.id; } }`)).toThrow("cannot configure generated server features");
});

test("pushes row policy and masks into every database dialect without changing unrestricted output", () => {
  for (const dialect of ["postgresql", "sqlite", "mysql"] as const) {
    const project = parseQiyProject(model(dialect));
    const files = generateServer(project.database, project);
    const policy = files["api/src/security/policy.ts"]!;
    const repository = files["api/src/modules/records/records.repository.ts"]!;
    const routes = files["api/src/modules/records/records.routes.ts"]!;
    const graphql = files["api/src/graphql.ts"]!;
    expect(policy).toContain('"missing":"deny"');
    expect(policy).toContain("policy.missingClaim");
    expect(policy).toContain("notInArray");
    expect(policy).toContain('"numericFields":["score"]');
    expect(repository).toContain("policyCondition");
    expect(repository).toContain("scopeCondition, policyCondition");
    expect(routes).toContain("resolvePolicy");
    expect(routes).toContain("policy.mask(record)");
    expect(routes).toContain("Masked fields cannot be written");
    expect(graphql).toContain("policyFor");
    expect(graphql).toContain("policy.maskedFields.includes(field)");
    expect(graphql).toContain(`policyColumns[resource]`);
  }
  const plain = generateServer(parseQiyProject(model().replace(/restrict records \{[\s\S]*?\n  \}/, "")).database);
  expect(plain["api/src/security/policy.ts"]).toBeUndefined();
  expect(plain["api/src/modules/records/records.repository.ts"]).not.toContain("policyCondition");
  expect(plain["api/src/graphql.ts"]).not.toContain("policyFor");
});

test("widens a claim scope to the subtree of a self-referencing entity", () => {
  const treeModel = (dialect = "sqlite", scope = "scope records ownerId claim tenant.org tree organizations parentId;") => `qiy v0;
application org-scope {
  database ${dialect} {}
  entity organizations {
    field id UUID @id;
    field name Text;
    field parentId UUID @nullable;
  }
  entity records {
    field id UUID @id;
    field ownerId UUID;
    field title Text;
  }
  ${scope}
}`;
  for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
    const project = parseQiyProject(treeModel(dialect));
    expect(project.scopes).toEqual([{ resource: "records", field: "ownerId", claim: "tenant.org", tree: { entity: "organizations", parentField: "parentId" } }]);
    expect(parseQiyProject(serializeQiyProject(project)).scopes).toEqual(project.scopes);
    expect(serializeQiyProject(project)).toContain("scope records ownerId claim tenant.org tree organizations parentId;");
    const repository = generateServer(project.database, project)["api/src/modules/records/records.repository.ts"]!;
    // Every read path (list and by-id/aggregate) must use the recursive CTE.
    expect(repository.match(/qiyScopeSubtree\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(repository).toContain("WITH RECURSIVE qiy_scope");
    expect(repository).toContain("qiy_scope.depth < 64");
    // The tree table is imported from the shared schema so the CTE can join it.
    expect(repository).toContain("organizations");
    expect(repository).toContain(dialect === "mysql" ? '"CHAR"' : '"TEXT"');
    // The plain scope keeps the equality predicate and no CTE.
    const plain = generateServer(parseQiyProject(treeModel(dialect, "scope records ownerId claim tenant.org;")).database, parseQiyProject(treeModel(dialect, "scope records ownerId claim tenant.org;")));
    const plainRepository = plain["api/src/modules/records/records.repository.ts"]!;
    expect(plainRepository).not.toContain("WITH RECURSIVE");
    expect(plainRepository).toContain("eq(scopeColumns[scope.field], scope.value)");
  }
  const unknownTree = parseQiyProject(treeModel().replace("tree organizations parentId", "tree missing parentId"));
  expect(() => generateServer(unknownTree.database, unknownTree)).toThrow("unknown tree entity missing");
  const unknownParent = parseQiyProject(treeModel().replace("tree organizations parentId", "tree organizations missing"));
  expect(() => generateServer(unknownParent.database, unknownParent)).toThrow("has no field missing");
  // The scoped column and the tree id must be the same type, otherwise the CTE compares mismatched values.
  const wrongType = parseQiyProject(treeModel().replace("field ownerId UUID;", "field ownerId Text;"));
  expect(() => generateServer(wrongType.database, wrongType)).toThrow("must match tree id organizations.id");
});

test("composes row policy with disjunctive groups", () => {
  const grouped = (dialect = "sqlite", block = 'when ( note in "x", "y" or salary != "1" );') => model(dialect).replace("  restrict records {", `  restrict records {\n    ${block}`);
  const project = parseQiyProject(grouped());
  expect(project.restrictions![0]!.groups).toEqual([[
    { field: "note", source: "values", operator: "in", values: ["x", "y"], missing: "hide" },
    { field: "salary", source: "values", operator: "!=", values: ["1"], missing: "hide" },
  ]]);
  // AND rows and OR groups both round-trip.
  expect(parseQiyProject(serializeQiyProject(project)).restrictions).toEqual(project.restrictions);
  expect(serializeQiyProject(project)).toContain('when ( note in "x", "y" or salary != "1" );');
  for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
    const files = generateProject(parseQiyProject(grouped(dialect)).database, parseQiyProject(grouped(dialect)).name, parseQiyProject(grouped(dialect)));
    const policy = files["apps/server/src/security/policy.ts"]!;
    expect(policy).toContain('"groups":[[');
    expect(policy).toContain("or(...");
    // The mask-write hook is global in Elysia, so it must stay scoped to its own resource.
    const routes = files["apps/server/src/modules/records/records.routes.ts"]!;
    expect(routes).toContain('if (!new URL(request.url).pathname.startsWith("/api/v1" + "/records")) return;');
  }
  // A parenthesized single predicate is just a predicate (it becomes an AND row).
  expect(parseQiyProject(grouped("sqlite", 'when ( note in "x" );')).restrictions![0]!.rows).toContainEqual({ field: "note", source: "values", operator: "in", values: ["x"], missing: "hide" });
  // A group cannot duplicate an AND row's field.
  expect(() => parseQiyProject(grouped("sqlite", 'when ( id claim user.id or note in "x" );'))).toThrow("primary key");
  expect(() => parseQiyProject(grouped("sqlite", 'when ( missing claim user.id or note in "x" );'))).toThrow("unknown row condition field");
  expect(() => parseQiyProject(grouped("sqlite", 'when ( salary claim user.id or note in "x" );'))).toThrow("nullable field");
});

test("parses nested expressions with NOT and cross-field comparison", () => {
  const source = model().replace(/restrict records \{[\s\S]*?\n  \}/, `restrict records {
    when not status in "closed";
    when ( ownerId claim user.id or ( score > field score and note in "x" ) );
  }`);
  const project = parseQiyProject(source);
  const restriction = project.restrictions![0]!;
  expect(restriction.expressions).toEqual([
    { kind: "not", expression: { kind: "predicate", predicate: { field: "status", source: "values", operator: "in", values: ["closed"], missing: "hide" } } },
    { kind: "or", children: [
      { kind: "predicate", predicate: { field: "ownerId", source: "claim", operator: "==", claim: "user.id", missing: "deny" } },
      { kind: "and", children: [
        { kind: "cross", field: "score", operator: ">", otherField: "score" },
        { kind: "predicate", predicate: { field: "note", source: "values", operator: "in", values: ["x"], missing: "hide" } },
      ] },
    ] },
  ]);
  // Precedence survives the round trip: `a or ( b and c )` stays grouped.
  expect(parseQiyProject(serializeQiyProject(project)).restrictions).toEqual(project.restrictions);
  expect(serializeQiyProject(project)).toContain('when not status in "closed";');
  const files = generateServer(project.database, project);
  const policy = files["api/src/security/policy.ts"]!;
  expect(policy).toContain('"kind":"not"');
  expect(policy).toContain("const buildExpression = (node: QiyPolicyExpression)");
  expect(policy).toContain("not(inner as never)");
  expect(policy).toContain("if (node.operator === \">\") return gt(left as never, right as never);");
  // Comparisons with literals, incomparable types and unknown cross fields fail closed.
  expect(() => parseQiyProject(source.replace("score > field score", 'score > "5"'))).toThrow("must compare two fields");
  expect(() => parseQiyProject(source.replace("score > field score", "score > field note"))).toThrow("not comparable");
  expect(() => parseQiyProject(source.replace("score > field score", "score > field missing"))).toThrow("unknown cross-field missing");
});

test("parses page-level rules and enforces them in both transports", () => {
  const withPages = model().replace(/restrict records \{[\s\S]*?\n  \}/, `pages records {
    list roles admin, operator;
    show roles admin, operator, viewer;
    create roles admin;
  }`);
  const project = parseQiyProject(withPages);
  expect(project.pages).toEqual([{ resource: "records", actions: [
    { action: "list", roles: ["admin", "operator"] },
    { action: "show", roles: ["admin", "operator", "viewer"] },
    { action: "create", roles: ["admin"] },
  ] }]);
  expect(parseQiyProject(serializeQiyProject(project)).pages).toEqual(project.pages);
  expect(serializeQiyProject(project)).toContain("  pages records {");
  const files = generateServer(project.database, project);
  const app = files["api/src/app.ts"]!;
  // The guard receives the same table the UI uses, so a hidden button is also a denied request.
  expect(app).toContain('"records":{"list":["admin","operator"],"show":["admin","operator","viewer"],"create":["admin"]}');
  expect(files["api/src/auth/guard.ts"]).toContain("Page access denied");
  // The web access-control provider mirrors the table when the app has auth (see
  // tools/verify-page-rules.ts for the compiled acceptance).
  expect(() => parseQiyProject(withPages.replace("list roles", "publish roles"))).toThrow("unsupported page action");
  expect(() => parseQiyProject(withPages.replace("pages records", "pages missing"))).toThrow("Pages missing: unknown resource");
  expect(() => parseQiyProject(withPages)).not.toThrow();
});

test("fails closed when a command path cannot apply the row policy", () => {
  const withFlow = parseQiyProject(`qiy v0;
application policy-demo {
  database sqlite {}
  entity records { field id UUID @id; field ownerId UUID; field title Text; }
  restrict records { when ownerId claim user.id; }
  dataflow rename { allow roles admin; input { field id UUID @required; field title Text @required; } context { record = entity records by id input.id @required; } step apply { update record { title = input.title; } } result { return record; } }
}`);
  expect(() => generateServer(withFlow.database, withFlow)).toThrow("dataflow rename cannot use a restricted resource");
});

test("threads restrictions through project generation and authenticated navigation", () => {
  const source = `qiy v0;
application policy-demo {
  database sqlite {}
  auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
  enum role { value admin; value operator; value viewer; }
  entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role role; }
  entity records { field id UUID @id; field note Text; }
  restrict records { allow roles operator; mask note roles operator mode null; }
}`;
  const project = parseQiyProject(source);
  const files = generateProject(project.database, project.name, project);
  expect(files["apps/server/src/security/policy.ts"]).toContain("mayUseResource");  const web = generateWeb(project.database, project)["web/app/auth.ts"]!;
  expect(web).toContain('"resource":"records"');
  expect(web).toContain("Resource access is restricted");
  const unrestricted = parseQiyProject(source.replace(/restrict records \{[\s\S]*?\n  \}/, ""));
  expect(generateWeb(unrestricted.database, { auth: unrestricted.auth })["web/app/auth.ts"]).not.toContain("resourcePolicies");
});

import { expect, test } from "bun:test";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import { generateProject } from "../tools/generate-project";
import { generateApp } from "../tools/commands/generate-app";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const source = `qiy v0;
application flow-test {
  database sqlite {}
  entity connectors {
    field id UUID @id;
    field status Text;
    field revokedReason Text @nullable;
  }
  dataflow revokeConnector @label("Revoke connector") @confirm("Continue with revocation?") @comment("Revokes an active connector") {
    idempotency required;
    audit "connector.revoked";
    input {
      field connectorId UUID @required;
      field reason Text @required @comment("Operator-provided revocation reason");
    }
    context {
      connector = entity connectors by id input.connectorId @required @comment("Load the target connector");
    }
    step revoke @order(20) @comment("Record the revocation") {
      update connector { status = "revoked"; revokedReason = "policy violation"; }
    }
    step validate @order(10) {
      require connector.status != "revoked" @error("errors.connector.alreadyRevoked");
    }
    result { return connector; }
  }
}`;

test("localized business errors preserve keys and translate with safe fallbacks", async () => {
  const text = readFileSync(new URL("../examples/dataflow/localized-errors.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(text);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  expect(() => parseQiyProject(text.replace('@error(t("inventory.quantityTooLow"))', '@error(t("missing"))'))).toThrow("Missing default locale message for error: missing");
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows, messages: project.messages });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('undefined, "inventory.quantityTooLow"');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"errorKey":"inventory.quantityTooLow"');
  expect(files["apps/web/app/data-provider.ts"]).toContain("qiyApiError(data, response.status)");
  const directory = mkdtempSync(join(tmpdir(), "qiy-localized-errors-"));
  try {
    writeFileSync(join(directory, "messages.ts"), files["apps/web/app/messages.ts"]!);
    writeFileSync(join(directory, "api-error.ts"), files["apps/web/app/api-error.ts"]!);
    const { qiyApiError } = await import(pathToFileURL(join(directory, "api-error.ts")).href);
    const payload = { error: "Quantity must be at least 100", errorKey: "inventory.quantityTooLow" };
    expect(qiyApiError(payload, 409, "zh-CN")).toMatchObject({ message: "数量不能少于 100", statusCode: 409, errorKey: payload.errorKey });
    expect(qiyApiError(payload, 409, "fr-FR").message).toBe(payload.error);
    expect(qiyApiError({ error: "fallback", errorKey: "unknown" }, 409, "zh-CN").message).toBe("fallback");
    expect(qiyApiError({ error: "literal" }, 403, "zh-CN")).toMatchObject({ message: "literal", statusCode: 403 });
    expect(qiyApiError({ error: "safe", errorKey: "__proto__" }, 409, "zh-CN").message).toBe("safe");
    expect(qiyApiError(null, 500, "zh-CN").message).toBe("API error 500");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("parses a typed, ordered dataflow and round-trips it through Qiy source", () => {
  const project = parseQiyProject(source);
  expect(project.dataflows).toEqual([{
    name: "revokeConnector",
    label: "Revoke connector",
    confirm: "Continue with revocation?",
    comment: "Revokes an active connector",
    idempotency: { required: true },
    audit: "connector.revoked",
    input: [
      { name: "connectorId", type: "UUID", required: true },
      { name: "reason", type: "Text", required: true, comment: "Operator-provided revocation reason" },
    ],
    context: [{ name: "connector", entity: "connectors", id: "id:input.connectorId", required: true, comment: "Load the target connector" }],
    steps: [
      { name: "validate", order: 10, actions: [{ kind: "require", left: "connector.status", operator: "!=", right: "revoked", error: "errors.connector.alreadyRevoked" }] },
      { name: "revoke", order: 20, comment: "Record the revocation", actions: [{ kind: "update", context: "connector", values: [{ field: "status", value: "revoked" }, { field: "revokedReason", value: "policy violation" }] }] },
    ],
    result: "connector",
  }]);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  const routes = files["apps/server/src/dataflows/index.ts"]!;
  const schema = files["apps/server/src/schema.ts"]!;
  expect(routes).toContain('new Elysia({ prefix: "/api/v1/commands" })');
  expect(routes).toContain('.post("/revokeConnector"');
  expect(routes).toContain('summary: "Revoke connector"');
  expect(routes).toContain('description: "Revokes an active connector"');
  expect(routes).toContain(" * Revokes an active connector");
  expect(routes).toContain("db.transaction");
  expect(routes).toContain('request.headers.get("idempotency-key")');
  expect(routes).toContain('action: "connector.revoked"');
  expect(routes).toContain("requestHash");
  expect(routes).toContain('if (!(context0["status"] != "revoked"))');
  expect(routes).toContain('throw new DataflowFailure(409,');
  expect(schema).toContain('"dataflow_idempotency"');
  expect(schema).toContain('"requestKeyHash"');
  expect(files["apps/server/src/app.ts"]).toContain('import("./dataflows")');
  expect(files["apps/server/src/app.ts"]).toContain('"path":"commands"');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain("generated dataflow routes");
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain("replays a successful command without a second audit event");
  expect(files["apps/web/app/data-provider.ts"]).toContain('"/api/v1/commands/revokeConnector"');
  expect(files["apps/server/src/graphql.ts"]).toContain('Revokes an active connector');
});

test("rejects invalid dataflow references, writes, and ambiguous step order", () => {
  expect(() => parseQiyProject(source.replace("connectors by id input.connectorId", "missing by id input.connectorId"))).toThrow("unknown entity missing");
  expect(() => parseQiyProject(source.replace('status = "revoked"', 'id = "revoked"'))).toThrow("cannot update primary key");
  expect(() => parseQiyProject(source.replace("@order(20)", "@order(10)"))).toThrow("unique positive integer");
  expect(() => parseQiyProject(source.replace("connector.status", "connector.unknown"))).toThrow("unknown field reference");
  expect(() => parseQiyProject(source.replace("field connectorId UUID @required", "field connectorId UUID"))).toThrow("requires input.connectorId to be @required");
  expect(() => parseQiyProject(source.replace("idempotency required;", "idempotency optional;"))).toThrow("idempotency must be required");
  expect(() => parseQiyProject(source.replace('audit "connector.revoked";', 'audit "";'))).toThrow("audit action cannot be empty");
  expect(() => parseQiyProject(source.replace('@label("Revoke connector")', '@label("Revoke connector") @label("Again")'))).toThrow("duplicate @label");
});

test("supports both // and # Qiy line comments", () => {
  const withComments = source.replace("application flow-test {", "// slash comment\n# hash comment\napplication flow-test {");
  expect(parseQiyProject(withComments).name).toBe("flow-test");
});

test("writes Integer inputs with portable bounds and generates a late rollback fixture", () => {
  const text = readFileSync(new URL("../examples/dataflow/typed-inputs.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(text);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"quantity": body["quantity"]');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain("minimum: -2147483648, maximum: 2147483647");
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"quantity": 7');
  expect(files["apps/server/tests/fixtures/dataflow-failure.ts"]).toContain('["id"] != "00000000-0000-4000-8000-000000000001"');
  expect(() => parseQiyProject(text.replace("field quantity Integer @required", "field quantity Text @required"))).toThrow("matching Text or Integer fields");
  expect(() => parseQiyProject(text.replace("quantity = input.quantity", 'quantity = "7"'))).toThrow("literal updates");
});

test("blocks scope and password hash writes through both literals and inputs", () => {
  const scoped = source.replace("field revokedReason Text", "field tenantId Text; field revokedReason Text")
    .replace("  dataflow revokeConnector", "  scope connectors tenantId claim tenant.id;\n  dataflow revokeConnector");
  for (const value of ['"other-tenant"', "input.reason"]) {
    expect(() => parseQiyProject(scoped.replace('revokedReason = "policy violation"', `tenantId = ${value}`))).toThrow("cannot update scope field");
  }
  const local = readFileSync(new URL("../examples/dataflow/roles.qiy", import.meta.url), "utf8");
  for (const value of ['"new-hash"', "input.reason"]) {
    const unsafe = local.replaceAll("connector = entity connectors", "connector = entity users")
      .replaceAll('status = "revoked";', "").replaceAll('status = "reviewed";', "")
      .replaceAll("revokedReason = input.reason", `passwordHash = ${value}`)
      .replace('require connector.status != "revoked" @error("errors.connector.alreadyRevoked");', "");
    expect(() => parseQiyProject(unsafe)).toThrow("cannot update password field");
  }
});

test("accepts only matching declared enum inputs and validates all enum literals", () => {
  const source = readFileSync(new URL("../examples/dataflow/enum-inputs.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(source);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows, actions: project.actions });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('t.Union([t.Literal("pending"), t.Literal("approved"), t.Literal("rejected")]');
  expect(files["apps/web/app/actions.ts"]).toContain('"value": "approved"');
  expect(files["apps/web/app/components/business-actions.tsx"]).toContain('<Select options={field.options} />');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"status": "pending"');
  expect(() => parseQiyProject(source.replace("field decision reviewState", "field decision Text"))).toThrow("same declared enum");
  expect(() => parseQiyProject(source.replace("field decision reviewState", "field decision UnknownState"))).toThrow("unsupported input type");
  expect(() => parseQiyProject(source.replace('status = input.decision', 'status = "missing"'))).toThrow("unknown enum value");
  expect(() => parseQiyProject(source.replace('status == "pending"', 'status == "missing"'))).toThrow("unknown enum value");
});

test("writes required Text inputs and preserves their reference through serialization", () => {
  const project = parseQiyProject(source.replace('revokedReason = "policy violation"', 'revokedReason = input.reason'));
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"revokedReason": body["reason"]');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"revokedReason": "Qiy fixture reason"');
  expect(files["apps/server/tests/fixtures/dataflow-failure.ts"]).toContain('!= "Qiy fixture reason"');
});

test("rejects unknown, optional, incompatible and executable input update values", () => {
  const reference = source.replace('revokedReason = "policy violation"', 'revokedReason = input.reason');
  expect(() => parseQiyProject(reference.replace('input.reason;', 'input.missing;'))).toThrow("unknown input field");
  expect(() => parseQiyProject(reference.replace('field reason Text @required', 'field reason Text'))).toThrow("update requires input.reason to be @required");
  expect(() => parseQiyProject(reference.replace('field reason Text', 'field reason Integer'))).toThrow("matching Text or Integer fields");
  expect(() => parseQiyProject(reference.replace('input.reason;', 'input.reason.nested;'))).toThrow();
  expect(() => parseQiyProject(reference.replace('input.reason;', 'input.reason();'))).toThrow();
  expect(() => parseQiyProject(reference.replace('input.reason;', 'input.reason + "unsafe";'))).toThrow();
});

test("declares command role allowlists and checks them before transactions and replay", () => {
  const project = parseQiyProject(source.replace('idempotency required;', 'allow roles operator; idempotency required;'));
  expect(project.dataflows?.[0]?.roles).toEqual(["operator"]);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  const routes = files["apps/server/src/dataflows/index.ts"]!;
  expect(routes).toContain('if (!["operator"].includes(principal.role))');
  expect(routes.indexOf('.includes(principal.role)')).toBeLessThan(routes.indexOf('db.transaction'));
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('rejects unauthenticated and disallowed roles before writing');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"revokeConnector":"operator"');
  for (const declaration of ['allow roles viewer;', 'allow roles admin, admin;', 'allow roles ;', 'allow roles admin; allow roles operator;', 'allow permission "connector:revoke";']) {
    expect(() => parseQiyProject(source.replace('idempotency required;', declaration))).toThrow();
  }
});

test("supports bounded numeric requirements on input and transactional context", () => {
  const text = readFileSync(new URL("../examples/dataflow/guarded-inputs.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(text);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('body["quantity"] >= 100');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('context0["quantity"] >= 100');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"quantity":100');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain('"quantity": 1');
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain("without writes or receipts");
  for (const condition of ['input.quantity >= "100"', 'input.inventoryId > 0', 'input.missing >= 0', 'input.quantity >= 2147483648', 'input.quantity < -2147483649']) {
    expect(() => parseQiyProject(text.replace("input.quantity >= 100", condition))).toThrow();
  }
  expect(() => parseQiyProject(text.replace("field quantity Integer @required", "field quantity Integer"))).toThrow("require input must be @required");
  expect(() => parseQiyProject(text.replace("field quantity Integer;", "field quantity Integer @nullable;"))).toThrow("nullable Integer require");
  expect(() => parseQiyProject(text.replace("item = entity", "input = entity"))).toThrow("reserved context name");
  for (const condition of ['input.quantity > -2147483648', 'input.quantity < 2147483647', 'input.quantity == 100', 'input.quantity != 101']) {
    const parsed = parseQiyProject(text.replace("input.quantity >= 100", condition));
    expect(parseQiyProject(serializeQiyProject(parsed)).dataflows).toEqual(parsed.dataflows);
  }
  for (const bound of [-2147483648, 2147483647]) {
    const boundary = text.replace("input.quantity >= 100", `input.quantity == ${bound}`).replace('require input.quantity <= 200 @error("inventory.quantityTooHigh");', "");
    const parsed = parseQiyProject(boundary);
    const generated = generateProject(parsed.database, parsed.name, { dataflows: parsed.dataflows });
    expect(generated["apps/server/tests/dataflow.test.ts"]).toContain(`"quantity":${bound}`);
  }
  const impossible = parseQiyProject(text.replace("input.quantity <= 200", "input.quantity < 100"));
  expect(() => generateProject(impossible.database, impossible.name, { dataflows: impossible.dataflows })).toThrow("contradictory requirements");
});

test("creates and deletes records as transactional dataflow contexts", () => {
  const text = readFileSync(new URL("../examples/dataflow/create-delete.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(text);
  expect(parseQiyProject(serializeQiyProject(project)).dataflows).toEqual(project.dataflows);
  expect(project.dataflows?.[0]?.steps[0]?.actions).toEqual([{
    kind: "create",
    context: "review",
    entity: "reviews",
    values: [
      { field: "userId", value: "userId", source: "input" },
      { field: "note", value: "note", source: "input" },
      { field: "status", value: "pending" },
    ],
  }]);
  expect(project.dataflows?.[1]?.steps[0]?.actions).toEqual([{ kind: "delete", context: "review" }]);

  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  const routes = files["apps/server/src/dataflows/index.ts"]!;
  expect(routes).toContain("tx.insert(reviews)");
  expect(routes).toContain("tx.delete(reviews)");
  expect(routes).toContain('action: "review.created"');
  expect(routes).toContain('action: "review.deleted"');
  const deleteRoute = routes.slice(routes.indexOf('.post("/deleteReview"'));
  expect(deleteRoute.indexOf("const previous")).toBeLessThan(deleteRoute.indexOf("let context0"));
  const generatedTests = files["apps/server/tests/dataflow.test.ts"]!;
  expect(generatedTests).toContain("SELECT * FROM reviews WHERE id = ?");
  expect(generatedTests).toContain("toBeTruthy()");
  expect(generatedTests).toContain("toBeNull()");
  expect(generatedTests).toContain("rolls back when audit_events insertion fails and allows retry");
  expect(generatedTests).toContain("createReview rolls back earlier writes when a later requirement fails");
  expect(generatedTests).toContain("deleteReview rolls back earlier writes when a later requirement fails");
  expect(generatedTests).toContain("transientUser rolls back earlier writes when a later requirement fails");
  const noContextTests = generatedTests.slice(generatedTests.indexOf("createUser rejects"));
  expect(noContextTests).not.toContain("expect(missing.status).toBe(404)");
  expect(files["apps/server/tests/fixtures/dataflow-failure.ts"]).toContain('"qiy.test.lateFailure"');
});

test("rejects unsafe create and delete declarations", () => {
  const text = readFileSync(new URL("../examples/dataflow/create-delete.qiy", import.meta.url), "utf8");
  expect(() => parseQiyProject(text.replace("create review = entity reviews", "create user = entity reviews"))).toThrow("duplicate or reserved created context");
  expect(() => parseQiyProject(text.replace("status = \"pending\";", ""))).toThrow("create requires value for reviews.status");
  expect(() => parseQiyProject(text.replace("status = \"pending\";", "id = input.userId; status = \"pending\";"))).toThrow("primary key");
  expect(() => parseQiyProject(text.replace("note = input.note;", "note = input.userId;"))).toThrow("matching UUID, Text, Integer, Decimal or declared enum");
  expect(() => parseQiyProject(text.replace("delete review;", "delete missing;"))).toThrow("unknown context binding missing");
  expect(() => parseQiyProject(text.replace("delete review;", "delete review; delete review;"))).toThrow("already deleted");
  expect(() => parseQiyProject(text.replace("delete review;", 'delete review; update review { status = "deleted"; }'))).toThrow("cannot update deleted context");
});

test("derives created scope fields from the principal and fingerprints replay scope", () => {
  const text = readFileSync(new URL("../examples/dataflow/create-delete.qiy", import.meta.url), "utf8")
    .replace("field status Text;", "field status Text;\n    field tenantId Text;")
    .replace("  dataflow createReview", "  scope reviews tenantId claim tenant.id;\n\n  dataflow createReview");
  const project = parseQiyProject(text);
  const routes = generateProject(project.database, project.name, { dataflows: project.dataflows, scopes: project.scopes })["apps/server/src/dataflows/index.ts"]!;
  expect(routes).toContain('principal?.claims?.["tenant.id"]');
  expect(routes).toContain('"tenantId": String(dataScope0)');
  expect(routes).toContain('JSON.stringify([body["userId"], body["note"], dataScope0 ])');
  expect(routes.indexOf("Missing required data scope claim")).toBeLessThan(routes.indexOf("db.transaction"));
  expect(() => parseQiyProject(text.replace('status = "pending";', 'status = "pending"; tenantId = input.note;'))).toThrow("derived from the authenticated principal");
});

test("parses emit actions and generates a transactional outbox", () => {
  const project = parseQiyProject(`qiy v0; application emit-demo {
    database sqlite {}
    entity orders { field id UUID @id; field status Text; }
    dataflow approve {
      input { field orderId UUID @required; }
      context { order = entity orders by id input.orderId @required; }
      step validate { require order.status == "pending" @error("Order is not pending"); }
      step publish { update order { status = "approved"; } emit "order.approved" { orderId = order.id; status = order.status; requestedBy = input.orderId; source = "dashboard"; priority = 2; } }
      result { return order; }
    }
  }`);
  expect(project.dataflows?.[0]?.steps[1]?.actions[1]).toEqual({ kind: "emit", event: "order.approved", payload: [
    { name: "orderId", source: "context", context: "order", value: "id" },
    { name: "status", source: "context", context: "order", value: "status" },
    { name: "requestedBy", source: "input", value: "orderId" },
    { name: "source", source: "literal", value: "dashboard" },
    { name: "priority", source: "literal", value: 2 },
  ] });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  expect(files["apps/server/src/schema.ts"]).toContain('dataflow_outbox');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('event: "order.approved"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"status": context0["status"]');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"requestedBy": body["orderId"]');
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} entity orders { field id UUID @id; } dataflow x { input {} context { order = entity orders by id input.id; } step one { emit ""; } result { return order; } } }`)).toThrow("emitted event cannot be empty");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} entity orders { field id UUID @id; } dataflow x { input { field id UUID @required; } context { order = entity orders by id input.id @required; } step one { emit "x" { id = input.missing; } } result { return order; } } }`)).toThrow("unknown emit input");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} entity orders { field id UUID @id; } dataflow x { input { field id UUID @required; field note Text; } context { order = entity orders by id input.id @required; } step one { emit "x" { note = input.note; } } result { return order; } } }`)).toThrow("emit input must be @required");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} entity orders { field id UUID @id; } dataflow x { input { field id UUID @required; } context { order = entity orders by id input.id @required; } step one { emit "x" { first = order.id; first = order.id; } } result { return order; } } }`)).toThrow("duplicate emit payload field");
  expect(() => parseQiyProject(`qiy v0; application bad { database sqlite {} entity orders { field id UUID @id; } dataflow x { input { field id UUID @required; } context { order = entity orders by id input.id @required; } step one { emit "x" { unsafe = 999999999999999999999; } } result { return order; } } }`)).toThrow("safe integer");
  expect(() => parseQiyProject(`qiy v0; application bad {
    database sqlite {}
    auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
    enum userRole { value admin; value operator; value viewer; }
    entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role userRole; }
    dataflow exposeSecret { input { field userId UUID @required; } context { user = entity users by id input.userId @required; } step one { emit "user.changed" { password = user.passwordHash; } } result { return user; } }
  }`)).toThrow("cannot emit password field");
});

test("generates fail-closed transactional call adapters and preserves implementations", async () => {
  const text = readFileSync(new URL("../examples/dataflow/call.qiy", import.meta.url), "utf8");
  const project = parseQiyProject(text);
  expect(project.dataflows?.[0]?.steps[0]?.actions[1]).toEqual({ kind: "call", adapter: "reviewPolicy", payload: [
    { name: "reviewId", source: "context", context: "review", value: "id" },
    { name: "status", source: "context", context: "review", value: "status" },
    { name: "reason", source: "input", value: "reason" },
    { name: "source", source: "literal", value: "qiy-dashboard" },
    { name: "priority", source: "literal", value: 1 },
  ] });
  expect(parseQiyProject(serializeQiyProject(project))).toEqual(project);
  const files = generateProject(project.database, project.name, { dataflows: project.dataflows });
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('invokeDataflowCall("reviewPolicy"');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"status": context0["status"]');
  expect(files["apps/server/src/dataflows/index.ts"]).toContain('"reason": body["reason"]');
  expect(files["apps/server/src/dataflows/calls.ts"]).toContain("DataflowCallHandlers = Record<DataflowCallName");
  expect(files["apps/server/src/dataflows/calls.ts"]).not.toContain("Promise<DataflowCallResult>");
  expect(files["apps/server/src/extensions/dataflow-calls.ts"]).toContain("Implement dataflow call adapter reviewPolicy");
  expect(files["apps/server/tests/dataflow.test.ts"]).toContain("rolls back when call adapter reviewPolicy rejects");
  expect(files["apps/server/tests/fixtures/dataflow-failure.ts"]).toContain('from "../../src/dataflows/calls"');

  const directory = mkdtempSync(join(tmpdir(), "qiy-dataflow-call-"));
  const model = join(directory, "app.qiy");
  const output = join(directory, "admin");
  try {
    writeFileSync(model, text);
    await generateApp(model, output);
    const extension = join(output, "apps/server/src/extensions/dataflow-calls.ts");
    const customized = `${readFileSync(extension, "utf8")}\nexport const localMarker = "preserved";\n`;
    writeFileSync(extension, customized);
    await generateApp(model, output, { sync: true });
    expect(readFileSync(extension, "utf8")).toBe(customized);
    expect(readFileSync(join(output, ".qiy-generated.json"), "utf8")).not.toContain("src/extensions/dataflow-calls.ts");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unsafe or ambiguous dataflow call payloads", () => {
  const text = readFileSync(new URL("../examples/dataflow/call.qiy", import.meta.url), "utf8");
  expect(() => parseQiyProject(text.replace("field reason Text @required", "field reason Text"))).toThrow("call input must be @required");
  expect(() => parseQiyProject(text.replace("reason = input.reason;", "reason = input.missing;"))).toThrow("unknown call input");
  expect(() => parseQiyProject(text.replace("reason = input.reason;", "reason = missing.id;"))).toThrow("unknown call field");
  expect(() => parseQiyProject(text.replace("reason = input.reason;", "reason = review.id; reason = review.status;"))).toThrow("duplicate call payload field");
  expect(() => parseQiyProject(text.replace("priority = 1;", "priority = 999999999999999999999;"))).toThrow("safe integer");
  const many = Array.from({ length: 33 }, (_, index) => `field${index} = review.id;`).join("\n        ");
  expect(() => parseQiyProject(text.replace("reviewId = review.id;", many))).toThrow("at most 32 fields");
  expect(() => parseQiyProject(text.replace("update review { status = \"approved\"; }", "delete review;").replace("status = review.status;", "status = review.status;"))).toThrow("deleted or unknown context");
  expect(() => parseQiyProject(`qiy v0; application secret-call {
    database sqlite {}
    auth { provider local; user users; roleField role; usernameField email; passwordField passwordHash; }
    enum userRole { value admin; value operator; value viewer; }
    entity users { field id UUID @id; field email Text @unique; field passwordHash Text @nullable; field role userRole; }
    dataflow check { input { field userId UUID @required; } context { user = entity users by id input.userId @required; } step one { call policy { password = user.passwordHash; } } result { return user; } }
  }`)).toThrow("cannot pass password field to call");
});

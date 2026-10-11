import { expect, test } from "bun:test";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import { generateProject } from "../tools/generate-project";
import { readFileSync } from "node:fs";

const source = `qiy v0;
application flow-test {
  database sqlite {}
  entity connectors {
    field id UUID @id;
    field status Text;
    field revokedReason Text @nullable;
  }
  dataflow revokeConnector {
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

test("parses a typed, ordered dataflow and round-trips it through Qiy source", () => {
  const project = parseQiyProject(source);
  expect(project.dataflows).toEqual([{
    name: "revokeConnector",
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
});

test("rejects invalid dataflow references, writes, and ambiguous step order", () => {
  expect(() => parseQiyProject(source.replace("connectors by id input.connectorId", "missing by id input.connectorId"))).toThrow("unknown entity missing");
  expect(() => parseQiyProject(source.replace('status = "revoked"', 'id = "revoked"'))).toThrow("cannot update primary key");
  expect(() => parseQiyProject(source.replace("@order(20)", "@order(10)"))).toThrow("unique positive integer");
  expect(() => parseQiyProject(source.replace("connector.status", "connector.unknown"))).toThrow("unknown field reference");
  expect(() => parseQiyProject(source.replace("field connectorId UUID @required", "field connectorId UUID"))).toThrow("requires input.connectorId to be @required");
  expect(() => parseQiyProject(source.replace("idempotency required;", "idempotency optional;"))).toThrow("idempotency must be required");
  expect(() => parseQiyProject(source.replace('audit "connector.revoked";', 'audit "";'))).toThrow("audit action cannot be empty");
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

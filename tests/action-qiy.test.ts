import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateApp } from "../tools/commands/generate-app";
import { generateProject } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";

const source = `qiy v0;
application action-demo {
  database sqlite {}
  entity connectors { field id UUID @id; field status Text; }
  dataflow revokeConnector {
    input { field connectorId UUID @required; field reason Text @required; }
    context { connector = entity connectors by id input.connectorId @required; }
    step revoke { update connector { status = "revoked"; } }
    result { return connector; }
  }
  action revokeConnector { resource connectors; dataflow revokeConnector; placement list, show; label "Revoke"; when status == "active"; confirm "Continue?"; }
  action reviewConnector { resource connectors; navigate "/connectors/:id/review"; placement list, show; label "Review"; page manual @comment("Implement the review workflow here"); }
}`;

describe("Qiy action DSL", () => {
  test("parses and round-trips command and manual-page actions", () => {
    const project = parseQiyProject(source);
    expect(project.actions).toEqual([
      { name: "revokeConnector", resource: "connectors", placements: ["list", "show"], label: "Revoke", condition: { field: "status", operator: "==", value: "active" }, target: { kind: "dataflow", dataflow: "revokeConnector", confirm: "Continue?" } },
      { name: "reviewConnector", resource: "connectors", placements: ["list", "show"], label: "Review", target: { kind: "navigate", path: "/connectors/:id/review", page: "manual", comment: "Implement the review workflow here" } },
    ]);
    expect(parseQiyProject(serializeQiyProject(project)).actions).toEqual(project.actions);
  });

  test("rejects unsafe or ambiguous declarations", () => {
    const app = (body: string) => `qiy v0; application bad { database sqlite {} entity items { field id UUID @id; } ${body} }`;
    expect(() => parseQiyProject(app('action bad { resource missing; navigate "/missing/:id"; placement list; label "Bad"; page manual @comment("x"); }'))).toThrow("unknown resource");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id"; dataflow missing; placement list; label "Bad"; page manual @comment("x"); }'))).toThrow("exactly one");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "https://bad/:id"; placement list; label "Bad"; page manual @comment("x"); }'))).toThrow("safe application route");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/review"; placement list; label "Bad"; page manual @comment("x"); }'))).toThrow("include :id");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id/review"; placement list, list; label "Bad"; page manual @comment("x"); }'))).toThrow("duplicate placement");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id/review"; placement list; label "Bad"; }'))).toThrow("page manual");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id/review"; placement list; label "Bad"; when missing == "x"; page manual @comment("x"); }'))).toThrow("unknown condition field");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id/review"; placement list; label "Bad"; when id > "x"; page manual @comment("x"); }'))).toThrow("when operator");
    expect(() => parseQiyProject(app('action bad { resource items; navigate "/items/:id/review"; placement list; label "Bad"; when id == "x"; when id != "y"; page manual @comment("x"); }'))).toThrow("duplicate when");
  });

  test("generates Refine actions, safe command transport and manual extension routes", () => {
    const project = parseQiyProject(source);
    const files = generateProject(project.database, project.name, { dataflows: project.dataflows, actions: project.actions });
    expect(files["apps/web/app/routes/list.tsx"]).toContain('<BusinessActions resource={resource.name} placement="list" record={record}');
    expect(files["apps/web/app/routes/show.tsx"]).toContain('<BusinessActions resource={resource.name} placement="show" record={result}');
    expect(files["apps/web/app/routes.ts"]).toContain('route("connectors/:id/review", "./routes/actions/reviewConnector.tsx")');
    expect(files["apps/web/app/routes/actions/reviewConnector.tsx"]).toContain("extensions/reviewConnector");
    expect(files["apps/web/app/routes/actions/reviewConnector.tsx"]).toContain('<CanAccess resource="connectors" action="reviewConnector"');
    expect(files["apps/web/app/extensions/reviewConnector.tsx"]).toContain("Implement the review workflow here");
    expect(files["apps/web/app/actions.ts"]).toContain('"idInput": "connectorId"');
    expect(files["apps/web/app/actions.ts"]).toContain('"operator": "=="');
    expect(files["apps/web/app/actions.ts"]).toContain("actionMatchesRecord");
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("useCustomMutation");
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("useQueryClient");
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("invalidateQueries");
    expect(files["apps/web/app/components/business-actions.tsx"]).not.toContain("validateFields().then(run)");
    expect(files["apps/web/app/components/business-actions.tsx"]!.match(/onOk=\{\(\) => form.submit\(\)\}/g)).toHaveLength(2);
    expect(files["apps/web/app/components/business-actions.tsx"]!.match(/onFinish=\{\(values\) => void run\(values\)\}/g)).toHaveLength(2);
    expect(files["apps/web/app/data-provider.ts"]).toContain('body: JSON.stringify(payload ?? {})');
    expect(files["apps/web/tests/actions.test.ts"]).toContain("rejects undeclared commands");
  });

  test("generates atomic idempotent batch actions instead of client request loops", () => {
    const model = `qiy v0; application batch-actions {
      database sqlite {}
      entity reviews { field id UUID @id; field status Text; }
      dataflow archiveReview @label("Archive selected") @confirm("Archive all selected reviews?") {
        input { field reviewId UUID @required; }
        context { review = entity reviews by id input.reviewId @required; }
        step archive { require review.status != "locked" @error("Locked review"); update review { status = "archived"; } }
        idempotency required;
        result { return review; }
      }
      action archiveSelected { resource reviews; dataflow archiveReview; placement list; batch true; }
    }`;
    const project = parseQiyProject(model);
    expect(project.actions?.[0]).toMatchObject({ name: "archiveSelected", resource: "reviews", placements: ["list"], batch: true, label: "Archive selected" });
    expect(parseQiyProject(serializeQiyProject(project)).actions).toEqual(project.actions);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/server/src/dataflows/index.ts"]).toContain('.post("/archiveReview/batch"');
    expect(files["apps/server/src/dataflows/index.ts"]).toContain("Batch item identifiers must be unique");
    expect(files["apps/server/src/dataflows/index.ts"]).toContain('flow: "archiveReview:batch"');
    expect(files["apps/server/src/dataflows/index.ts"]).toContain("new BatchDataflowFailure");
    expect(files["apps/server/src/graphql.ts"]).toContain("runArchiveReviewBatch(items: [ArchiveReviewCommandInput!]!, idempotencyKey: String!): [Reviews!]!");
    expect(files["apps/server/src/graphql.ts"]).toContain('"archiveReview/batch"');
    expect(files["apps/server/src/graphql-adapter.ts"]).toContain("runArchiveReviewBatch:");
    expect(files["apps/server/src/app.ts"]).toContain('"runArchiveReviewBatch"');
    for (const adapter of ["yoga", "apollo"] as const) {
      const adapterFiles = generateProject(project.database, project.name, { ...project, elysiaPlugins: { graphqlAdapter: adapter } });
      expect(adapterFiles["apps/server/src/graphql-adapter.ts"]).toContain("runArchiveReviewBatch:");
      expect(adapterFiles["apps/server/src/plugins/index.ts"]).toContain("createGraphQLAdapterResolvers(context.repositories, context.authenticate) as any");
    }
    expect(files["apps/web/app/actions.ts"]).toContain('"batch": true');
    expect(files["apps/web/app/actions.ts"]).toContain('"url": "/api/v1/commands/archiveReview/batch"');
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("const body = { items }");
    expect(files["apps/web/app/routes/list.tsx"]).toContain("<BatchBusinessActions");
    expect(files["apps/web/app/data-provider.ts"]).toContain('/api/v1/commands/archiveReview/batch');
    expect(() => parseQiyProject(model.replace("idempotency required;", ""))).toThrow("require dataflow archiveReview to declare idempotency required");
    expect(() => parseQiyProject(model.replace("placement list;", "placement list, show;"))).toThrow("placement list only");
    expect(() => parseQiyProject(model.replace("batch true;", 'batch true; when status == "pending";'))).toThrow("do not support record when conditions");
    expect(() => parseQiyProject(model.replace("dataflow archiveReview;", 'navigate "/reviews/:id/archive"; page manual @comment("x");'))).toThrow("batch is only valid for dataflow actions");
  });

  test("preserves manual business pages during standalone sync", async () => {
    const root = mkdtempSync(join(tmpdir(), "qiy-actions-"));
    const model = join(root, "app.qiy");
    const output = join(root, "admin");
    writeFileSync(model, source);
    await generateApp(model, output);
    const extension = join(output, "apps/web/app/extensions/reviewConnector.tsx");
    writeFileSync(extension, "// custom review implementation\n");
    await generateApp(model, output, { sync: true });
    expect(readFileSync(extension, "utf8")).toBe("// custom review implementation\n");
    expect(readFileSync(join(output, ".qiy-generated.json"), "utf8")).not.toContain("app/extensions/reviewConnector.tsx");
  });

  test("propagates dataflow roles to actions and Refine authorization", () => {
    const project = parseQiyProject(readFileSync(join(import.meta.dir, "../examples/dataflow/roles.qiy"), "utf8"));
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/actions.ts"]).toContain('"roles": [\n        "operator"');
    const auth = files["apps/web/app/auth.ts"]!;
    expect(auth).toContain('"action":"revokeConnector","roles":["admin"]');
    expect(auth).toContain('"action":"recordReview","roles":["operator"]');
    expect(auth).toContain('"action":"reviewPage","roles":["operator","viewer"]');
    expect(auth.indexOf('if (command)')).toBeLessThan(auth.indexOf('if (identity.role === "admin")'));
    expect(files["apps/web/tests/auth.test.ts"]).toContain('without an admin bypass');
  });

  test("round-trips navigation roles and rejects ambiguous authorization", () => {
    const rolesSource = readFileSync(join(import.meta.dir, "../examples/dataflow/roles.qiy"), "utf8");
    const project = parseQiyProject(rolesSource);
    expect(project.actions?.find((action) => action.name === "reviewPage")?.roles).toEqual(["operator", "viewer"]);
    expect(parseQiyProject(serializeQiyProject(project)).actions).toEqual(project.actions);
    expect(() => parseQiyProject(rolesSource.replace("allow roles operator, viewer;", "allow roles owner;"))).toThrow("role");
    expect(() => parseQiyProject(rolesSource.replace("allow roles operator, viewer;", "allow roles operator, operator;"))).toThrow("duplicate");
    expect(() => parseQiyProject(rolesSource.replace("allow roles operator, viewer;", "allow roles operator; allow roles viewer;"))).toThrow("duplicate");
    expect(() => parseQiyProject(source.replace("navigate \"/connectors/:id/review\";", "allow roles viewer; navigate \"/connectors/:id/review\";"))).toThrow("requires generated authentication");
    expect(() => parseQiyProject(rolesSource.replace("dataflow recordReview;", "allow roles admin; dataflow recordReview;"))).toThrow("declare roles on the dataflow");
  });

  test("generates policy tests for navigation-only authenticated applications", () => {
    const project = parseQiyProject(readFileSync(join(import.meta.dir, "../examples/dataflow/roles.qiy"), "utf8"));
    project.actions = project.actions?.filter((action) => action.target.kind === "navigate");
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/tests/auth.test.ts"]).toContain('"action":"reviewPage","roles":["operator","viewer"]');
    expect(files["apps/web/app/routes/actions/reviewPage.tsx"]).toContain('<CanAccess resource="connectors" action="reviewPage"');
    expect(files["apps/web/app/routes/actions/reviewPage.tsx"]).toContain('status="403"');
    expect(files["apps/web/app/routes/actions/reviewPage.tsx"]).toContain('params={{ id }}');
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain('params={{ id: recordId }}');
    expect(files["apps/web/app/components/business-actions.tsx"]).toContain("actionsFor(resource, placement, record)");
  });

  test("validates enum action conditions", () => {
    const model = `qiy v0; application conditional { database sqlite {} enum Status { value active; value disabled; } entity items { field id UUID @id; field status Status; } action disable { resource items; navigate "/items/:id/disable"; placement list; label "Disable"; when status != "disabled"; page manual @comment("Disable item"); } }`;
    const project = parseQiyProject(model);
    expect(project.actions?.[0]?.condition).toEqual({ field: "status", operator: "!=", value: "disabled" });
    expect(parseQiyProject(serializeQiyProject(project)).actions).toEqual(project.actions);
    expect(() => parseQiyProject(model.replace('"disabled"; page', '"missing"; page'))).toThrow("unknown enum value");
  });

  test("inherits localized labels and confirmations from dataflows", () => {
    const project = parseQiyProject(readFileSync(join(import.meta.dir, "../examples/dataflow/documented-inputs.qiy"), "utf8"));
    expect(project.actions?.find((action) => action.name === "explainReview")).toMatchObject({ label: "Explain review", labelKey: "review.action", target: { confirm: "Apply this explanation?", confirmKey: "review.confirm" } });
    expect(parseQiyProject(serializeQiyProject(project)).actions).toEqual(project.actions);
    expect(() => parseQiyProject(source.replace('label "Revoke";', ""))).toThrow("label is required when dataflow");
  });

  test("integrated manual pages use host authorization instead of generated roles", () => {
    const model = `qiy v0; application host { database sqlite {} mode integration; integration { apiBase "/api"; auth cookie; } entity connectors { field id UUID @id; } action review { resource connectors; navigate "/connectors/:id/review"; placement list, show; label "Review"; page manual @comment("Host review UI"); } }`;
    const project = parseQiyProject(model);
    const files = generateProject(project.database, project.name, project);
    expect(files["apps/web/app/root.tsx"]).toContain("accessControlProvider={qiyIntegrationAccessControlProvider}");
    expect(files["apps/web/app/routes/actions/review.tsx"]).toContain('<CanAccess resource="connectors" action="review" params={{ id }}');
    expect(files["apps/web/app/host/access-control.ts"]).toContain('if (!host?.can) return { can: false');
    expect(() => parseQiyProject(model.replace('action review {', 'action review { allow roles viewer;'))).toThrow("host access-control adapter");
  });
});

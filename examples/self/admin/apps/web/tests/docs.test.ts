import { expect, test } from "bun:test";
import {
  buildDataflowDiagram,
  buildDataflowDiagrams,
  buildEntityDiagram,
  describeDataflow,
  docsTabLabelKey,
  docsTabs,
  escapeMermaidLabel,
  mermaidId,
  type DocsModel,
} from "../app/docs";

const model: DocsModel = {
  app: { name: "Test app" },
  features: { overview: true, apiDocs: true, apiKeys: true },
  principal: { role: "operator", permissions: ["inventory:receive"] },
  entities: [
    { name: "users", tableName: "users", label: "Users", labelKey: "qiy.resources.users.label", singular: "User", plural: "Users", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.users.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "role", label: "Role", labelKey: "qiy.resources.users.fields.role.label", type: "userRole", nullable: false, enumName: "userRole", enumValues: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }], annotations: [] }], relations: [] },
    { name: "orders", tableName: "orders", label: "Orders", labelKey: "qiy.resources.orders.label", singular: "Order", plural: "Orders", fields: [{ name: "id", label: "Id", labelKey: "qiy.resources.orders.fields.id.label", type: "UUID", nullable: false, primaryKey: true, annotations: ["primaryKey"] }, { name: "userId", label: "User", labelKey: "qiy.resources.orders.fields.userId.label", type: "UUID", nullable: false, annotations: ["relation:users"], relation: { table: "users", field: "id" } }], relations: [{ field: "userId", toTable: "users", toField: "id" }] },
  ],
  relations: [{ fromTable: "orders", field: "userId", toTable: "users", toField: "id" }],
  enums: [{ name: "userRole", values: [{ name: "admin", label: "Admin", labelKey: "qiy.enums.userRole.values.admin" }] }],
  dataflows: [{ name: "receiveStock", label: "Receive stock", labelKey: "qiy.dataflows.receiveStock.label", allowRoles: ["admin", "operator"], allowPermissions: [], verification: null, inputs: [{ name: "quantity", type: "Integer", required: true, label: "quantity", labelKey: "" }], contexts: [{ name: "inventory", entity: "inventory" }], steps: [{ name: "load", actions: [{ kind: "update", summary: "update inventory" }] }], result: "inventory" }],
  permissions: { fields: [{ name: "InventoryReceivePermission", value: "inventory:receive", label: "Receive", labelKey: "" }], groups: [{ name: "operator", members: ["InventoryReceivePermission"], label: "operator", labelKey: "" }], verifications: [] },
};

test("builds an escaped UML entity diagram", () => {
  const diagram = buildEntityDiagram(model);
  expect(diagram.startsWith("classDiagram")).toBe(true);
  expect(diagram).toContain('class e_users["Users"]');
  expect(diagram).toContain('class e_orders["Orders"]');
  expect(diagram).toContain("+id UUID");
  expect(diagram).toContain("+role userRole");
  expect(diagram).toContain("e_orders --> e_users : userId");
  expect(buildEntityDiagram(model)).toBe(diagram);
  expect(escapeMermaidLabel('a "b" {c};\nd')).toBe("a 'b' (c), d");
  expect(mermaidId("orders-line")).toBe("orders_line");
  expect(mermaidId("1bad")).toBe("qiy_1bad");
});

test("builds a flowchart per dataflow with inputs, steps and result", () => {
  const flow = model.dataflows[0]!;
  const diagram = buildDataflowDiagram(flow);
  expect(diagram.startsWith("flowchart LR")).toBe(true);
  expect(diagram).toContain("d_receiveStock_input");
  expect(diagram).toContain("d_receiveStock_step_0");
  expect(diagram).toContain("d_receiveStock_result");
  expect(diagram).toContain("update inventory");
  expect(buildDataflowDiagrams(model)).toHaveLength(1);
  expect(describeDataflow(flow).inputs).toEqual(["quantity: Integer (required)"]);
  expect(describeDataflow(flow).allowRoles).toEqual(["admin", "operator"]);
});

test("the overview only exposes entities, dataflows and permissions tabs", () => {
  expect(docsTabs({ overview: true })).toEqual(["entities", "dataflows", "permissions"]);
  expect(docsTabs({ overview: false })).toEqual([]);
  expect(docsTabLabelKey("entities")).toBe("qiy.docs.tabEntities");
  expect(docsTabLabelKey("permissions")).toBe("qiy.docs.tabPermissions");
});

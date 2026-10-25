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
import {
  QIY_API_KEY_MAX_ACTIVE,
  apiKeyStatus,
  canCreateApiKey,
  countActiveApiKeys,
  defaultApiKeyName,
  formatApiKeyDate,
  maskedApiKey,
} from "../app/api-keys";
import { docsEnabled, qiyFeatureFlags, qiyMenuLinks } from "../app/features";
import { buildMenuTree } from "../app/components/menu";
import { menuGroups, resources } from "../app/resources";

const model: DocsModel = {
  app: { name: "Test app" },
  features: { apiDocs: true, apiKeys: true },
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
  expect(diagram).toContain("class e_users[Users]");
  expect(diagram).toContain("class e_orders[Orders]");
  expect(diagram).toContain("+id UUID [PK,NN]");
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

test("gates the overview tabs and adds the sidebar page link", () => {
  expect(docsEnabled).toBe(true);
  expect(docsTabs({ apiDocs: true, apiKeys: true })).toEqual(["entities", "dataflows", "api", "permissions", "apiKeys"]);
  expect(docsTabs({ apiDocs: false, apiKeys: true })).toEqual(["apiKeys"]);
  expect(docsTabs({ apiDocs: false, apiKeys: false })).toEqual([]);
  expect(docsTabLabelKey("apiKeys")).toBe("qiy.docs.tabApiKeys");
  expect(qiyMenuLinks).toEqual([{ name: "qiy-docs", path: "/system/overview", label: "功能总览", labelKey: "qiy.docs.title", icon: "AppstoreOutlined", group: "system" }]);
  const tree = buildMenuTree({ resources, menuGroups, links: qiyMenuLinks });
  const found = (nodes: typeof tree): boolean => nodes.some((node) => (node.key === "qiy-docs" && node.to === "/system/overview") || found(node.children));
  expect(found(tree)).toBe(true);
  expect(qiyFeatureFlags.apiDocs || qiyFeatureFlags.apiKeys).toBe(true);
});

test("API-key helpers mirror the server rules", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const active = { id: "a", name: "A", prefix: "abcdef12", maskedKey: "qiy_abcdef12_********", createdAt: now.toISOString(), lastUsedAt: null, expiresAt: null, revokedAt: null };
  const expired = { ...active, id: "b", expiresAt: "2025-12-31T00:00:00Z" };
  const revoked = { ...active, id: "c", revokedAt: "2025-12-31T00:00:00Z" };
  expect(maskedApiKey("abcdef12")).toBe("qiy_abcdef12_********");
  expect(apiKeyStatus(active, now)).toBe("active");
  expect(apiKeyStatus(expired, now)).toBe("expired");
  expect(apiKeyStatus(revoked, now)).toBe("revoked");
  expect(countActiveApiKeys([active, expired, revoked], now)).toBe(1);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE - 1 }, () => active), now)).toBe(true);
  expect(canCreateApiKey(Array.from({ length: QIY_API_KEY_MAX_ACTIVE }, () => active), now)).toBe(false);
  expect(defaultApiKeyName([], now)).toBe("Key 2026-01-01");
  expect(formatApiKeyDate(null, "en-US")).toBe("\u2014");
  expect(formatApiKeyDate("2026-01-01T00:00:00Z", "en-US")).toContain("2026");
});

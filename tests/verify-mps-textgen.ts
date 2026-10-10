import { strict as assert } from "node:assert";
import { generateProject } from "../tools/generate-project";
import { parseMpsProjectModel } from "../tools/mps-database-ir";
import { parseQiyProject } from "../tools/qiy-project";

const structureSource = await Bun.file("languages/qiy/models/qiy.structure.mps").text();

for (const [model, application] of [["catalog", "Catalog"], ["relations", "Relations"], ["erpworkflow", "qiy-erp-workflow"]]) {
  const marker = await Bun.file(`languages/qiy.sandbox/source_gen/qiy/${model}/QiyGenerationMarker.java`).text();
  assert.match(marker, /class QiyGenerationMarker\b/, `${application}: native generator create-root rule must run alongside TextGen`);
  const nativeSource = await Bun.file(`languages/qiy.sandbox/source_gen/qiy/${model}/${application}.qiy`).text();
  const modelSource = await Bun.file(`languages/qiy.sandbox/models/qiy.${model}.mps`).text();
  const native = parseQiyProject(nativeSource);
  const bridged = parseMpsProjectModel(modelSource, structureSource);
  assert.deepStrictEqual(native.database, bridged.database);
  assert.strictEqual(native.apiClient, bridged.apiClient);
  assert.deepStrictEqual(native.elysiaPlugins, bridged.elysiaPlugins);
  assert.strictEqual(native.storageProvider, bridged.storageProvider);
  assert.deepStrictEqual(native.auth, bridged.auth);
  assert.deepStrictEqual(native.scopes, bridged.scopes);
  assert.deepStrictEqual(native.workflows, bridged.workflows);
  assert.deepStrictEqual(native.menuGroups, bridged.menuGroups);
  assert.deepStrictEqual(native.dashboardMetrics, bridged.dashboardMetrics);
  if (model === "erpworkflow") {
    assert.deepStrictEqual(native.auth, { provider: "oidc", userEntity: "users", subjectField: "externalSubject", roleField: "role" });
    assert.deepStrictEqual(native.menuGroups?.map(({ name, parent, resources }) => ({ name, parent, resources })), [
      { name: "operations", parent: undefined, resources: [] },
      { name: "sales", parent: "operations", resources: ["orders", "order_items"] },
      { name: "inventory", parent: "operations", resources: ["inventory_items"] },
      { name: "administration", parent: undefined, resources: ["users"] },
    ]);
    assert.deepStrictEqual(native.dashboardMetrics?.map(({ name, type, groupBy, days }) => ({ name, type, groupBy, days })), [
      { name: "orderCount", type: undefined, groupBy: undefined, days: undefined },
      { name: "orderStatus", type: "distribution", groupBy: "status", days: undefined },
      { name: "orderTrend", type: "trend", groupBy: "createdAt", days: 30 },
    ]);
    assert.deepStrictEqual(native.database.enums?.find(({ name }) => name === "userRole")?.values.map(({ name }) => name), ["admin", "operator", "viewer"]);
    assert.deepStrictEqual(native.database.enums?.find(({ name }) => name === "orderStatus")?.values[1], { name: "submitted", label: "已提交", color: "blue", icon: "SendOutlined" });
    assert.deepStrictEqual(native.database.entities.find(({ name }) => name === "orders")?.fields.find(({ name }) => name === "status"), {
      name: "status", type: "Text", enumName: "orderStatus", label: "订单状态", icon: "TagsOutlined", listVisible: false, sortable: false, filterable: true,
    });
  }
  const bridgedName = bridged.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  assert.deepStrictEqual(
    generateProject(native.database, native.name, native),
    generateProject(bridged.database, bridgedName, bridged),
  );
  console.log(`MPS generator marker and TextGen ${application} match the external MPS bridge`);
}

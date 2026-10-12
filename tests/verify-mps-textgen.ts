import { strict as assert } from "node:assert";
import { generateProject } from "../tools/generate-project";
import { parseMpsProjectModel } from "../tools/mps-database-ir";
import { exportMpsProjectAsQiy } from "../tools/mps-qiy";
import { parseQiyProject } from "../tools/qiy-project";

const structureSource = await Bun.file("languages/qiy/models/qiy.structure.mps").text();

function withoutDocumentation<T>(value: T): T {
  const copy = structuredClone(value);
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    delete record.comment;
    delete record.commentKey;
    Object.values(record).forEach(visit);
  };
  visit(copy);
  return copy;
}

for (const [model, application] of [["catalog", "Catalog"], ["relations", "Relations"], ["erpworkflow", "qiy-erp-workflow"]]) {
  const marker = await Bun.file(`languages/qiy.sandbox/source_gen/qiy/${model}/QiyGenerationMarker.java`).text();
  assert.match(marker, /class QiyGenerationMarker\b/, `${application}: native generator create-root rule must run alongside TextGen`);
  const nativeSource = await Bun.file(`languages/qiy.sandbox/source_gen/qiy/${model}/${application}.qiy`).text();
  const modelSource = await Bun.file(`languages/qiy.sandbox/models/qiy.${model}.mps`).text();
  const native = parseQiyProject(nativeSource);
  const bridged = parseMpsProjectModel(modelSource, structureSource);
  const nativeStructural = withoutDocumentation(native);
  const bridgedStructural = withoutDocumentation(bridged);
  assert.deepStrictEqual(nativeStructural.database, bridgedStructural.database);
  assert.strictEqual(native.apiClient, bridged.apiClient);
  assert.deepStrictEqual(native.elysiaPlugins, bridged.elysiaPlugins);
  assert.strictEqual(native.storageProvider, bridged.storageProvider);
  assert.deepStrictEqual(native.auth, bridged.auth);
  assert.deepStrictEqual(native.scopes, bridged.scopes);
  assert.deepStrictEqual(native.workflows, bridged.workflows);
  assert.deepStrictEqual(nativeStructural.menuGroups, bridgedStructural.menuGroups);
  assert.deepStrictEqual(nativeStructural.dashboardMetrics, bridgedStructural.dashboardMetrics);
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
  const authoritativeSource = exportMpsProjectAsQiy(modelSource, structureSource);
  const authoritative = parseQiyProject(authoritativeSource);
  assert.deepStrictEqual(authoritative, { ...bridged, name: bridgedName }, `${application}: authoritative MPS exporter must preserve the full Qiy model`);
  if (model === "relations") {
    assert.match(authoritativeSource, /@comment\("Product lifecycle"\)/);
    assert.match(authoritativeSource, /@comment\("Available for ordering"\)/);
    assert.match(authoritativeSource, /@comment\("Catalog master data"\)/);
    assert.match(authoritativeSource, /@comment\("Current product records"\)/);
  }
  assert.deepStrictEqual(
    generateProject(nativeStructural.database, nativeStructural.name, nativeStructural),
    generateProject(bridgedStructural.database, bridgedName, bridgedStructural),
  );
  console.log(`MPS marker and legacy TextGen ${application} structural subset match the authoritative Bun exporter`);
}

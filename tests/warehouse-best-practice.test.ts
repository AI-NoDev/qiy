import { expect, test } from "bun:test";
import { loadQiyProjectSource } from "../tools/qiy-include";
import { parseQiyProject } from "../tools/qiy-project";

test("warehouse best-practice modules expand into a valid application", async () => {
  const source = await loadQiyProjectSource("examples/warehouse-admin/app.qiy");
  const project = parseQiyProject(source);
  expect(project.name).toBe("qiy-warehouse-admin");
  expect(project.database.entities.map((entity) => entity.name)).toEqual(["warehouses", "products", "stockMovements"]);
  expect(project.database.relations?.map((relation) => relation.name)).toEqual(["stockMovementWarehouse", "stockMovementProduct"]);
  expect(project.menuGroups?.map((group) => group.name)).toEqual(["operations", "masterData"]);
});

test("labels every documentation code block with its relative example path", () => {
  const document = Bun.file("docs/guide/best-practice-warehouse.md").text();

  return document.then((content) => {
    expect(content.match(/^```/gm)).toHaveLength(16);
    expect(content.match(/<div class="qiy-code-path">/g)).toHaveLength(8);
    expect(content).toContain('<code>examples/warehouse-admin/app.qiy</code>');
    expect(content).toContain('<code>examples/warehouse-admin/modules/catalog.qiy</code>');
    expect(content).toContain('<code>examples/warehouse-admin/README.md</code>');
  });
});

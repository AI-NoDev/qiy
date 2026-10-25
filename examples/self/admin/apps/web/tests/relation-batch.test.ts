import { expect, test } from "bun:test";
import { buildRelationBatchPlan, maxRelationBatchIds } from "../app/components/relation-batch";
import type { ResourceField } from "../app/resources";

/**
 * The FK batch plan is what turns "one detail request per FK cell" into "one
 * list request per target resource". It has to group by resource, dedupe ids,
 * skip blank values, stay deterministic and cap each batch.
 */
function field(name: string, resource?: string, extra: Partial<ResourceField> = {}): ResourceField {
  return {
    name,
    label: name,
    labelKey: "qiy.resources.orders.fields." + name + ".label",
    type: "UUID",
    nullable: true,
    primaryKey: false,
    visible: true,
    listVisible: true,
    formVisible: true,
    showVisible: true,
    sortable: true,
    filterable: true,
    filterModes: ["eq"],
    ...(resource ? { relation: { resource, labelField: "name" } } : {}),
    ...extra,
  };
}

test("groups FK values by target resource, deduping and skipping empty values", () => {
  const plan = buildRelationBatchPlan(
    [field("supplierId", "suppliers"), field("warehouseId", "warehouses"), field("title")],
    [
      { id: "1", supplierId: "s2", warehouseId: "w1", title: "first" },
      { id: "2", supplierId: "s1", warehouseId: "w1", title: "second" },
      { id: "3", supplierId: "", warehouseId: null },
      { id: "4", supplierId: "s2", warehouseId: undefined },
    ],
  );
  expect(plan).toEqual([
    { resource: "suppliers", ids: ["s1", "s2"] },
    { resource: "warehouses", ids: ["w1"] },
  ]);
});

test("returns an empty plan without rows or relation fields", () => {
  expect(buildRelationBatchPlan([field("supplierId", "suppliers")], undefined)).toEqual([]);
  expect(buildRelationBatchPlan([field("supplierId", "suppliers")], [])).toEqual([]);
  expect(buildRelationBatchPlan([field("title")], [{ id: "1", title: "a" }])).toEqual([]);
  expect(buildRelationBatchPlan([], [{ id: "1", supplierId: "s1" }])).toEqual([]);
});

test("caps each resource batch so a filter query stays bounded", () => {
  const rows = Array.from({ length: maxRelationBatchIds + 25 }, (_, index) => ({ id: String(index), supplierId: "s-" + String(index).padStart(4, "0") }));
  const plan = buildRelationBatchPlan([field("supplierId", "suppliers")], rows);
  expect(plan).toHaveLength(1);
  expect(plan[0]!.ids).toHaveLength(maxRelationBatchIds);
  expect(plan[0]!.ids[0]).toBe("s-0000");
});

test("produces the same plan regardless of field and row order", () => {
  const first = buildRelationBatchPlan(
    [field("supplierId", "suppliers"), field("binId", "bins")],
    [{ id: "1", supplierId: "s2", binId: "b1" }, { id: "2", supplierId: "s1", binId: "b2" }],
  );
  const second = buildRelationBatchPlan(
    [field("binId", "bins"), field("supplierId", "suppliers")],
    [{ id: "a", binId: "b2", supplierId: "s1" }, { id: "b", binId: "b1", supplierId: "s2" }],
  );
  expect(first).toEqual([
    { resource: "bins", ids: ["b1", "b2"] },
    { resource: "suppliers", ids: ["s1", "s2"] },
  ]);
  expect(second).toEqual(first);
});

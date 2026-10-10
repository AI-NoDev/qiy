import { expect, test } from "bun:test";
import { planInventoryAllocation } from "../src/workflows/allocation";

test("splits reservations across warehouses in stable order", () => {
  const stocks = [{ id: "warehouse-b", quantity: 3, reservedQuantity: 1 }, { id: "warehouse-a", quantity: 5, reservedQuantity: 3 }];
  expect(planInventoryAllocation(stocks, 4)).toEqual([{ inventoryItemId: "warehouse-a", quantity: 2 }, { inventoryItemId: "warehouse-b", quantity: 2 }]);
  expect(stocks[0]?.id).toBe("warehouse-b");
});

test("rejects shortages and invalid quantities instead of partially reserving", () => {
  const stocks = [{ id: "warehouse-a", quantity: 2, reservedQuantity: 1 }];
  expect(() => planInventoryAllocation(stocks, 2)).toThrow("Insufficient inventory");
  expect(() => planInventoryAllocation(stocks, 0)).toThrow("must be positive");
  expect(() => planInventoryAllocation(stocks, -1)).toThrow("must be positive");
});

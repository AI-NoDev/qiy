import { Database } from "bun:sqlite";

// Seeds the examples/self demo database with a small but realistic data set:
// one organization, one warehouse with two bins, three products, inventory,
// a purchase order, a sales order and a work order.
const databasePath = process.argv[2] ?? "examples/self/admin/apps/server/qiy.sqlite";
const db = new Database(databasePath);
const now = Date.now();
db.exec("BEGIN");
try {
  db.exec("DELETE FROM shipments; DELETE FROM sales_order_lines; DELETE FROM sales_orders; DELETE FROM purchase_order_lines; DELETE FROM purchase_orders; DELETE FROM stock_movements; DELETE FROM inventory; DELETE FROM bins; DELETE FROM warehouses; DELETE FROM products; DELETE FROM customers; DELETE FROM suppliers; DELETE FROM orgs; DELETE FROM users;");
  const insert = (table: string, rows: Array<Record<string, unknown>>) => {
    for (const row of rows) {
      const keys = Object.keys(row);
      db.query(`INSERT INTO ${table} (${keys.map((key) => `"${key}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((key) => row[key] as string | number | null));
    }
  };
  insert("orgs", [{ id: "00000000-0000-4000-8000-000000000010", code: "ACME", name: "ACME Supply Group", parentId: null }]);
  insert("users", [{
    id: "00000000-0000-4000-8000-000000000001",
    subject: "http://localhost:5556/dex|CiQwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwYTESBWxvY2Fs",
    googleSubject: null,
    openidField: null,
    keycloakSubject: "CiQwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwYjISBWxvY2Fs",
    email: "admin@example.com",
    displayName: "Dex Admin",
    role: "admin",
    orgId: "00000000-0000-4000-8000-000000000010",
  }]);
  insert("suppliers", [{ id: "00000000-0000-4000-8000-000000000020", code: "SUP-1", name: "Nordic Components", email: "sales@nordic.example", leadTimeDays: 7 }]);
  insert("customers", [{ id: "00000000-0000-4000-8000-000000000030", code: "CUS-1", name: "Retail Partners Ltd", email: "po@retail.example", creditLimit: 50000 }]);
  insert("products", [
    { id: "00000000-0000-4000-8000-000000000101", sku: "WID-100", name: "Industrial Widget", uom: "EA", unitCost: 9.5, price: 15, reorderPoint: 50, active: "active" },
    { id: "00000000-0000-4000-8000-000000000102", sku: "GAD-200", name: "Smart Gadget", uom: "EA", unitCost: 24, price: 39, reorderPoint: 20, active: "active" },
    { id: "00000000-0000-4000-8000-000000000103", sku: "BRK-300", name: "Bracket Kit", uom: "BOX", unitCost: 4.25, price: 8, reorderPoint: 100, active: "active" },
  ]);
  insert("warehouses", [{ id: "00000000-0000-4000-8000-000000000201", orgId: "00000000-0000-4000-8000-000000000010", code: "WH-1", name: "Shanghai Distribution Center", active: "active" }]);
  insert("bins", [
    { id: "00000000-0000-4000-8000-000000000301", warehouseId: "00000000-0000-4000-8000-000000000201", code: "A-01-01", capacity: 500 },
    { id: "00000000-0000-4000-8000-000000000302", warehouseId: "00000000-0000-4000-8000-000000000201", code: "A-01-02", capacity: 300 },
  ]);
  insert("inventory", [
    { id: "00000000-0000-4000-8000-000000000401", inventoryKey: "WH-1/A-01-01/WID-100", warehouseId: "00000000-0000-4000-8000-000000000201", binId: "00000000-0000-4000-8000-000000000301", productId: "00000000-0000-4000-8000-000000000101", quantity: 120, reserved: 20, lotCode: "LOT-2026-01", updatedAt: now },
    { id: "00000000-0000-4000-8000-000000000402", inventoryKey: "WH-1/A-01-02/GAD-200", warehouseId: "00000000-0000-4000-8000-000000000201", binId: "00000000-0000-4000-8000-000000000302", productId: "00000000-0000-4000-8000-000000000102", quantity: 40, reserved: 0, lotCode: null, updatedAt: now },
    { id: "00000000-0000-4000-8000-000000000403", inventoryKey: "WH-1/A-01-02/BRK-300", warehouseId: "00000000-0000-4000-8000-000000000201", binId: "00000000-0000-4000-8000-000000000302", productId: "00000000-0000-4000-8000-000000000103", quantity: 75, reserved: 5, lotCode: null, updatedAt: now },
  ]);
  insert("stock_movements", [
    { id: "00000000-0000-4000-8000-000000000501", productId: "00000000-0000-4000-8000-000000000101", warehouseId: "00000000-0000-4000-8000-000000000201", binId: "00000000-0000-4000-8000-000000000301", type: "receipt", quantity: 120, reference: "PO-2025-099", occurredAt: now - 86_400_000 },
    { id: "00000000-0000-4000-8000-000000000502", productId: "00000000-0000-4000-8000-000000000102", warehouseId: "00000000-0000-4000-8000-000000000201", binId: "00000000-0000-4000-8000-000000000302", type: "adjust", quantity: 40, reference: "cycle count", occurredAt: now - 3_600_000 },
  ]);
  insert("purchase_orders", [{ id: "00000000-0000-4000-8000-000000000601", number: "PO-2026-001", supplierId: "00000000-0000-4000-8000-000000000020", status: "approved", orderedAt: now - 172_800_000, total: 1900 }]);
  insert("purchase_order_lines", [{ id: "00000000-0000-4000-8000-000000000611", purchaseOrderId: "00000000-0000-4000-8000-000000000601", productId: "00000000-0000-4000-8000-000000000101", quantity: 200, unitCost: 9.5 }]);
  insert("sales_orders", [{ id: "00000000-0000-4000-8000-000000000701", number: "SO-2026-001", customerId: "00000000-0000-4000-8000-000000000030", status: "allocated", orderedAt: now - 86_400_000, total: 300 }]);
  insert("sales_order_lines", [{ id: "00000000-0000-4000-8000-000000000711", salesOrderId: "00000000-0000-4000-8000-000000000701", productId: "00000000-0000-4000-8000-000000000101", quantity: 20, unitPrice: 15, allocated: 20 }]);
  insert("work_orders", [{ id: "00000000-0000-4000-8000-000000000801", number: "WO-2026-001", productId: "00000000-0000-4000-8000-000000000101", quantity: 50, status: "in_progress", plannedAt: now + 86_400_000 }]);
  db.exec("COMMIT");
  console.log("seeded demo data into", databasePath);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

import { resolve } from "node:path";
import { createApp } from "./app";
import { createHandler } from "./http";
import { createProductionAuthenticator } from "./auth/hybrid";
import { startRealtimeOutboxWorker } from "./realtime";
import { UsersRepository } from "./modules/users/users.repository";
import { OrgsRepository } from "./modules/orgs/orgs.repository";
import { SuppliersRepository } from "./modules/suppliers/suppliers.repository";
import { CustomersRepository } from "./modules/customers/customers.repository";
import { ProductsRepository } from "./modules/products/products.repository";
import { BomsRepository } from "./modules/boms/boms.repository";
import { Purchase_ordersRepository } from "./modules/purchase_orders/purchase_orders.repository";
import { Purchase_order_linesRepository } from "./modules/purchase_order_lines/purchase_order_lines.repository";
import { ReceiptsRepository } from "./modules/receipts/receipts.repository";
import { Sales_ordersRepository } from "./modules/sales_orders/sales_orders.repository";
import { Sales_order_linesRepository } from "./modules/sales_order_lines/sales_order_lines.repository";
import { ShipmentsRepository } from "./modules/shipments/shipments.repository";
import { WarehousesRepository } from "./modules/warehouses/warehouses.repository";
import { BinsRepository } from "./modules/bins/bins.repository";
import { InventoryRepository } from "./modules/inventory/inventory.repository";
import { Stock_movementsRepository } from "./modules/stock_movements/stock_movements.repository";
import { Work_ordersRepository } from "./modules/work_orders/work_orders.repository";





if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ users: UsersRepository, orgs: OrgsRepository, suppliers: SuppliersRepository, customers: CustomersRepository, products: ProductsRepository, boms: BomsRepository, purchase_orders: Purchase_ordersRepository, purchase_order_lines: Purchase_order_linesRepository, receipts: ReceiptsRepository, sales_orders: Sales_ordersRepository, sales_order_lines: Sales_order_linesRepository, shipments: ShipmentsRepository, warehouses: WarehousesRepository, bins: BinsRepository, inventory: InventoryRepository, stock_movements: Stock_movementsRepository, work_orders: Work_ordersRepository }, createProductionAuthenticator());
startRealtimeOutboxWorker();
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: Bun.env.HOST ?? "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(`Qiy app listening on http://localhost:${server.port}`);

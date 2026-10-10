import { resolve } from "node:path";
import { createApp } from "./app";
import { createHandler } from "./http";
import { createProductionAuthenticator } from "./auth/local";
import { UsersRepository } from "./modules/users/users.repository";
import { CustomersRepository } from "./modules/customers/customers.repository";
import { WarehousesRepository } from "./modules/warehouses/warehouses.repository";
import { ProductsRepository } from "./modules/products/products.repository";
import { InventoryItemsRepository } from "./modules/inventoryItems/inventoryItems.repository";
import { OrdersRepository } from "./modules/orders/orders.repository";
import { OrderItemsRepository } from "./modules/orderItems/orderItems.repository";





if (Bun.env.QIY_STORAGE_METADATA !== "database") throw new Error("QIY_STORAGE_METADATA=database is required for production file metadata");
const app = await createApp({ users: UsersRepository, customers: CustomersRepository, warehouses: WarehousesRepository, products: ProductsRepository, inventoryItems: InventoryItemsRepository, orders: OrdersRepository, orderItems: OrderItemsRepository }, createProductionAuthenticator());
const clientRoot = resolve(import.meta.dir, "../../web/build/client");
const server = Bun.serve({ hostname: Bun.env.HOST ?? "127.0.0.1", port: Number(Bun.env.PORT ?? 3000), fetch: createHandler((request) => app.handle(request), clientRoot) });
console.log(`Qiy app listening on http://localhost:${server.port}`);

import { Elysia, t } from "elysia";
import { buildSchema, graphql, parse, subscribe, getOperationAST, Kind, GraphQLError } from "graphql";
import type { Repositories } from "./app";
import type { Authenticator, Principal } from "./auth/guard";
import { QiyPolicyError, resolvePolicy, type QiyPolicy } from "./security/policy";
import { products } from "./schema";
import { createDataflowRoutes } from "./dataflows";
import { createUsersService } from "./modules/users/users.service";
import { createOrgsService } from "./modules/orgs/orgs.service";
import { createSuppliersService } from "./modules/suppliers/suppliers.service";
import { createCustomersService } from "./modules/customers/customers.service";
import { createProductsService } from "./modules/products/products.service";
import { createBomsService } from "./modules/boms/boms.service";
import { createPurchase_ordersService } from "./modules/purchase_orders/purchase_orders.service";
import { createPurchase_order_linesService } from "./modules/purchase_order_lines/purchase_order_lines.service";
import { createReceiptsService } from "./modules/receipts/receipts.service";
import { createSales_ordersService } from "./modules/sales_orders/sales_orders.service";
import { createSales_order_linesService } from "./modules/sales_order_lines/sales_order_lines.service";
import { createShipmentsService } from "./modules/shipments/shipments.service";
import { createWarehousesService } from "./modules/warehouses/warehouses.service";
import { createBinsService } from "./modules/bins/bins.service";
import { createInventoryService } from "./modules/inventory/inventory.service";
import { createStock_movementsService } from "./modules/stock_movements/stock_movements.service";
import { createWork_ordersService } from "./modules/work_orders/work_orders.service";
import { withPaginationLimit } from "./pagination";

type FilterOperator = "eq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
import { realtimeChannelIterator } from "./realtime";
import { realtimeCapabilities } from "./realtime";


export const graphqlTypeDefs = "enum UserRole {\n  admin\n  operator\n  viewer\n}\n\nenum PurchaseStatus {\n  draft\n  approved\n  received\n  closed\n  cancelled\n}\n\nenum SalesStatus {\n  draft\n  confirmed\n  allocated\n  shipped\n  closed\n  cancelled\n}\n\nenum WorkStatus {\n  planned\n  released\n  in_progress\n  completed\n  cancelled\n}\n\nenum ActiveState {\n  active\n  inactive\n}\n\nenum MovementType {\n  receipt\n  issue\n  transfer\n  adjust\n  production\n  consumption\n}\n\ninput QiyFilterInput {\n  field: String!\n  operator: String = \"eq\"\n  value: String!\n}\n\ntype QiyDistribution {\n  value: String\n  count: Int!\n}\n\ntype QiyTrend {\n  day: String!\n  count: Int!\n}\n\ntype Users {\n  id: ID!\n  subject: String!\n  oktaSubject: String\n  keycloakSubject: String\n  googleSubject: String\n  kindeSubject: String\n  azureSubject: String\n  email: String!\n  displayName: String\n  role: UserRole!\n  oauthProfiles: String\n  permissions: String\n  orgId: ID\n}\n\ntype UsersPage {\n  items: [Users!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput UsersCreateInput {\n  subject: String!\n  oktaSubject: String\n  keycloakSubject: String\n  googleSubject: String\n  kindeSubject: String\n  azureSubject: String\n  email: String!\n  displayName: String\n  role: UserRole!\n  oauthProfiles: String\n  permissions: String\n  orgId: ID\n}\n\ninput UsersUpdateInput {\n  subject: String\n  oktaSubject: String\n  keycloakSubject: String\n  googleSubject: String\n  kindeSubject: String\n  azureSubject: String\n  email: String\n  displayName: String\n  role: UserRole\n  oauthProfiles: String\n  permissions: String\n  orgId: ID\n}\n\ntype Orgs {\n  id: ID!\n  code: String!\n  name: String!\n  parentId: ID\n}\n\ntype OrgsPage {\n  items: [Orgs!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput OrgsCreateInput {\n  code: String!\n  name: String!\n  parentId: ID\n}\n\ninput OrgsUpdateInput {\n  code: String\n  name: String\n  parentId: ID\n}\n\ntype Suppliers {\n  id: ID!\n  code: String!\n  name: String!\n  email: String\n  leadTimeDays: Int!\n}\n\ntype SuppliersPage {\n  items: [Suppliers!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput SuppliersCreateInput {\n  code: String!\n  name: String!\n  email: String\n  leadTimeDays: Int!\n}\n\ninput SuppliersUpdateInput {\n  code: String\n  name: String\n  email: String\n  leadTimeDays: Int\n}\n\ntype Customers {\n  id: ID!\n  code: String!\n  name: String!\n  email: String\n  creditLimit: String!\n}\n\ntype CustomersPage {\n  items: [Customers!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput CustomersCreateInput {\n  code: String!\n  name: String!\n  email: String\n  creditLimit: String!\n}\n\ninput CustomersUpdateInput {\n  code: String\n  name: String\n  email: String\n  creditLimit: String\n}\n\ntype Products {\n  id: ID!\n  sku: String!\n  name: String!\n  uom: String!\n  unitCost: String!\n  price: String!\n  reorderPoint: Int!\n  active: ActiveState!\n}\n\ntype ProductsPage {\n  items: [Products!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput ProductsCreateInput {\n  sku: String!\n  name: String!\n  uom: String!\n  unitCost: String!\n  price: String!\n  reorderPoint: Int!\n  active: ActiveState!\n}\n\ninput ProductsUpdateInput {\n  sku: String\n  name: String\n  uom: String\n  unitCost: String\n  price: String\n  reorderPoint: Int\n  active: ActiveState\n}\n\ntype Boms {\n  id: ID!\n  productId: ID!\n  componentId: ID!\n  quantity: Int!\n}\n\ntype BomsPage {\n  items: [Boms!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput BomsCreateInput {\n  productId: ID!\n  componentId: ID!\n  quantity: Int!\n}\n\ninput BomsUpdateInput {\n  productId: ID\n  componentId: ID\n  quantity: Int\n}\n\ntype Purchase_orders {\n  id: ID!\n  number: String!\n  supplierId: ID!\n  status: PurchaseStatus!\n  orderedAt: String!\n  expectedDate: String!\n  total: String!\n}\n\ntype Purchase_ordersPage {\n  items: [Purchase_orders!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Purchase_ordersCreateInput {\n  number: String!\n  supplierId: ID!\n  status: PurchaseStatus!\n  orderedAt: String!\n  expectedDate: String!\n  total: String!\n}\n\ninput Purchase_ordersUpdateInput {\n  number: String\n  supplierId: ID\n  status: PurchaseStatus\n  orderedAt: String\n  expectedDate: String\n  total: String\n}\n\ntype Purchase_order_lines {\n  id: ID!\n  purchaseOrderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitCost: String!\n}\n\ntype Purchase_order_linesPage {\n  items: [Purchase_order_lines!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Purchase_order_linesCreateInput {\n  purchaseOrderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitCost: String!\n}\n\ninput Purchase_order_linesUpdateInput {\n  purchaseOrderId: ID\n  productId: ID\n  quantity: Int\n  unitCost: String\n}\n\ntype Receipts {\n  id: ID!\n  purchaseOrderId: ID!\n  warehouseId: ID!\n  status: String!\n  receivedAt: String\n}\n\ntype ReceiptsPage {\n  items: [Receipts!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput ReceiptsCreateInput {\n  purchaseOrderId: ID!\n  warehouseId: ID!\n  status: String!\n  receivedAt: String\n}\n\ninput ReceiptsUpdateInput {\n  purchaseOrderId: ID\n  warehouseId: ID\n  status: String\n  receivedAt: String\n}\n\ntype Sales_orders {\n  id: ID!\n  number: String!\n  customerId: ID!\n  status: SalesStatus!\n  orderedAt: String!\n  total: String!\n}\n\ntype Sales_ordersPage {\n  items: [Sales_orders!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Sales_ordersCreateInput {\n  number: String!\n  customerId: ID!\n  status: SalesStatus!\n  orderedAt: String!\n  total: String!\n}\n\ninput Sales_ordersUpdateInput {\n  number: String\n  customerId: ID\n  status: SalesStatus\n  orderedAt: String\n  total: String\n}\n\ntype Sales_order_lines {\n  id: ID!\n  salesOrderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitPrice: String!\n  allocated: Int!\n}\n\ntype Sales_order_linesPage {\n  items: [Sales_order_lines!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Sales_order_linesCreateInput {\n  salesOrderId: ID!\n  productId: ID!\n  quantity: Int!\n  unitPrice: String!\n  allocated: Int!\n}\n\ninput Sales_order_linesUpdateInput {\n  salesOrderId: ID\n  productId: ID\n  quantity: Int\n  unitPrice: String\n  allocated: Int\n}\n\ntype Shipments {\n  id: ID!\n  salesOrderId: ID!\n  warehouseId: ID!\n  status: String!\n  shippedAt: String\n  departureTime: String\n}\n\ntype ShipmentsPage {\n  items: [Shipments!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput ShipmentsCreateInput {\n  salesOrderId: ID!\n  warehouseId: ID!\n  status: String!\n  shippedAt: String\n  departureTime: String\n}\n\ninput ShipmentsUpdateInput {\n  salesOrderId: ID\n  warehouseId: ID\n  status: String\n  shippedAt: String\n  departureTime: String\n}\n\ntype Warehouses {\n  id: ID!\n  orgId: ID!\n  code: String!\n  name: String!\n  active: ActiveState!\n}\n\ntype WarehousesPage {\n  items: [Warehouses!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput WarehousesCreateInput {\n  orgId: ID!\n  code: String!\n  name: String!\n  active: ActiveState!\n}\n\ninput WarehousesUpdateInput {\n  orgId: ID\n  code: String\n  name: String\n  active: ActiveState\n}\n\ntype Bins {\n  id: ID!\n  warehouseId: ID!\n  code: String!\n  capacity: Int!\n}\n\ntype BinsPage {\n  items: [Bins!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput BinsCreateInput {\n  warehouseId: ID!\n  code: String!\n  capacity: Int!\n}\n\ninput BinsUpdateInput {\n  warehouseId: ID\n  code: String\n  capacity: Int\n}\n\ntype Inventory {\n  id: ID!\n  inventoryKey: String!\n  warehouseId: ID!\n  binId: ID!\n  productId: ID!\n  quantity: Int!\n  reserved: Int!\n  lotCode: String\n  updatedAt: String\n}\n\ntype InventoryPage {\n  items: [Inventory!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput InventoryCreateInput {\n  inventoryKey: String!\n  warehouseId: ID!\n  binId: ID!\n  productId: ID!\n  quantity: Int!\n  reserved: Int!\n  lotCode: String\n  updatedAt: String\n}\n\ninput InventoryUpdateInput {\n  inventoryKey: String\n  warehouseId: ID\n  binId: ID\n  productId: ID\n  quantity: Int\n  reserved: Int\n  lotCode: String\n  updatedAt: String\n}\n\ntype Stock_movements {\n  id: ID!\n  productId: ID!\n  warehouseId: ID!\n  binId: ID!\n  type: MovementType!\n  quantity: Int!\n  reference: String\n  occurredAt: String\n}\n\ntype Stock_movementsPage {\n  items: [Stock_movements!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Stock_movementsCreateInput {\n  productId: ID!\n  warehouseId: ID!\n  binId: ID!\n  type: MovementType!\n  quantity: Int!\n  reference: String\n  occurredAt: String\n}\n\ninput Stock_movementsUpdateInput {\n  productId: ID\n  warehouseId: ID\n  binId: ID\n  type: MovementType\n  quantity: Int\n  reference: String\n  occurredAt: String\n}\n\ntype Work_orders {\n  id: ID!\n  number: String!\n  productId: ID!\n  quantity: Int!\n  status: WorkStatus!\n  plannedAt: String!\n}\n\ntype Work_ordersPage {\n  items: [Work_orders!]!\n  total: Int!\n  page: Int!\n  pageSize: Int!\n}\n\ninput Work_ordersCreateInput {\n  number: String!\n  productId: ID!\n  quantity: Int!\n  status: WorkStatus!\n  plannedAt: String!\n}\n\ninput Work_ordersUpdateInput {\n  number: String\n  productId: ID\n  quantity: Int\n  status: WorkStatus\n  plannedAt: String\n}\n\ntype InventoryEvent {\n  event: String!\n  record: Inventory!\n}\n\ntype Stock_movementsEvent {\n  event: String!\n  record: Stock_movements!\n}\n\ntype ShipmentsEvent {\n  event: String!\n  record: Shipments!\n}\n\n\"Append a receipt movement and update the on-hand quantity of the target inventory record.\"\ninput ReceiveInventoryCommandInput {\n  purchaseOrderId: ID!\n  productId: ID!\n  warehouseId: ID!\n  binId: ID!\n  inventoryId: ID!\n  \"Quantity received in this posting\"\n  quantity: Int!\n  \"Absolute on-hand quantity after the receipt\"\n  newOnHand: Int!\n  reference: String!\n}\n\n\"Move an inventory record into another storage bin and record the transfer.\"\ninput PutawayStockCommandInput {\n  inventoryId: ID!\n  targetBinId: ID!\n  quantity: Int!\n  productId: ID!\n  warehouseId: ID!\n}\n\n\"Reserve an absolute quantity of an inventory record for a sales order.\"\ninput ReserveStockCommandInput {\n  inventoryId: ID!\n  \"Absolute reserved quantity after this operation\"\n  reservedQuantity: Int!\n  salesOrderId: ID!\n}\n\n\"Record a cycle count and set the counted on-hand quantity.\"\ninput AdjustStockCommandInput {\n  inventoryId: ID!\n  countedQuantity: Int!\n  reason: String!\n  productId: ID!\n  warehouseId: ID!\n  binId: ID!\n}\n\n\"Create a shipment for a sales order and mark it shipped.\"\ninput ShipSalesOrderCommandInput {\n  salesOrderId: ID!\n  warehouseId: ID!\n}\n\n\"Transfer stock between warehouses or bins with an audit movement.\"\ninput TransferInventoryCommandInput {\n  inventoryId: ID!\n  targetWarehouseId: ID!\n  targetBinId: ID!\n  quantity: Int!\n  productId: ID!\n}\n\n\"Consume components and book the produced quantity, then close the work order.\"\ninput CompleteWorkOrderCommandInput {\n  workOrderId: ID!\n  componentId: ID!\n  componentQuantity: Int!\n  outputBinId: ID!\n  outputQuantity: Int!\n  warehouseId: ID!\n  productId: ID!\n}\n\n\"Approve a draft purchase order. Operators do not hold the purchasing approval permission, so this command is a permission-denied example.\"\ninput ApprovePurchaseOrderCommandInput {\n  purchaseOrderId: ID!\n}\n\ntype Query {\n  users(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): UsersPage!\n  usersById(id: ID!): Users\n  usersAggregate(field: String!, op: String!): Float\n  usersDistribution(field: String!): [QiyDistribution!]!\n  usersTrend(field: String!, days: Int!): [QiyTrend!]!\n  orgs(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): OrgsPage!\n  orgsById(id: ID!): Orgs\n  orgsAggregate(field: String!, op: String!): Float\n  orgsDistribution(field: String!): [QiyDistribution!]!\n  orgsTrend(field: String!, days: Int!): [QiyTrend!]!\n  suppliers(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): SuppliersPage!\n  suppliersById(id: ID!): Suppliers\n  suppliersAggregate(field: String!, op: String!): Float\n  suppliersDistribution(field: String!): [QiyDistribution!]!\n  suppliersTrend(field: String!, days: Int!): [QiyTrend!]!\n  customers(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): CustomersPage!\n  customersById(id: ID!): Customers\n  customersAggregate(field: String!, op: String!): Float\n  customersDistribution(field: String!): [QiyDistribution!]!\n  customersTrend(field: String!, days: Int!): [QiyTrend!]!\n  products(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ProductsPage!\n  productsById(id: ID!): Products\n  productsAggregate(field: String!, op: String!): Float\n  productsDistribution(field: String!): [QiyDistribution!]!\n  productsTrend(field: String!, days: Int!): [QiyTrend!]!\n  boms(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): BomsPage!\n  bomsById(id: ID!): Boms\n  bomsAggregate(field: String!, op: String!): Float\n  bomsDistribution(field: String!): [QiyDistribution!]!\n  bomsTrend(field: String!, days: Int!): [QiyTrend!]!\n  purchase_orders(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Purchase_ordersPage!\n  purchase_ordersById(id: ID!): Purchase_orders\n  purchase_ordersAggregate(field: String!, op: String!): Float\n  purchase_ordersDistribution(field: String!): [QiyDistribution!]!\n  purchase_ordersTrend(field: String!, days: Int!): [QiyTrend!]!\n  purchase_order_lines(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Purchase_order_linesPage!\n  purchase_order_linesById(id: ID!): Purchase_order_lines\n  purchase_order_linesAggregate(field: String!, op: String!): Float\n  purchase_order_linesDistribution(field: String!): [QiyDistribution!]!\n  purchase_order_linesTrend(field: String!, days: Int!): [QiyTrend!]!\n  receipts(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ReceiptsPage!\n  receiptsById(id: ID!): Receipts\n  receiptsAggregate(field: String!, op: String!): Float\n  receiptsDistribution(field: String!): [QiyDistribution!]!\n  receiptsTrend(field: String!, days: Int!): [QiyTrend!]!\n  sales_orders(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Sales_ordersPage!\n  sales_ordersById(id: ID!): Sales_orders\n  sales_ordersAggregate(field: String!, op: String!): Float\n  sales_ordersDistribution(field: String!): [QiyDistribution!]!\n  sales_ordersTrend(field: String!, days: Int!): [QiyTrend!]!\n  sales_order_lines(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Sales_order_linesPage!\n  sales_order_linesById(id: ID!): Sales_order_lines\n  sales_order_linesAggregate(field: String!, op: String!): Float\n  sales_order_linesDistribution(field: String!): [QiyDistribution!]!\n  sales_order_linesTrend(field: String!, days: Int!): [QiyTrend!]!\n  shipments(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): ShipmentsPage!\n  shipmentsById(id: ID!): Shipments\n  shipmentsAggregate(field: String!, op: String!): Float\n  shipmentsDistribution(field: String!): [QiyDistribution!]!\n  shipmentsTrend(field: String!, days: Int!): [QiyTrend!]!\n  warehouses(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): WarehousesPage!\n  warehousesById(id: ID!): Warehouses\n  warehousesAggregate(field: String!, op: String!): Float\n  warehousesDistribution(field: String!): [QiyDistribution!]!\n  warehousesTrend(field: String!, days: Int!): [QiyTrend!]!\n  bins(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): BinsPage!\n  binsById(id: ID!): Bins\n  binsAggregate(field: String!, op: String!): Float\n  binsDistribution(field: String!): [QiyDistribution!]!\n  binsTrend(field: String!, days: Int!): [QiyTrend!]!\n  inventory(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): InventoryPage!\n  inventoryById(id: ID!): Inventory\n  inventoryAggregate(field: String!, op: String!): Float\n  inventoryDistribution(field: String!): [QiyDistribution!]!\n  inventoryTrend(field: String!, days: Int!): [QiyTrend!]!\n  stock_movements(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Stock_movementsPage!\n  stock_movementsById(id: ID!): Stock_movements\n  stock_movementsAggregate(field: String!, op: String!): Float\n  stock_movementsDistribution(field: String!): [QiyDistribution!]!\n  stock_movementsTrend(field: String!, days: Int!): [QiyTrend!]!\n  work_orders(page: Int = 1, pageSize: Int = 20, search: String, sort: String, order: String, filters: [QiyFilterInput!]): Work_ordersPage!\n  work_ordersById(id: ID!): Work_orders\n  work_ordersAggregate(field: String!, op: String!): Float\n  work_ordersDistribution(field: String!): [QiyDistribution!]!\n  work_ordersTrend(field: String!, days: Int!): [QiyTrend!]!\n}\n\ntype Mutation {\n  createUsers(input: UsersCreateInput!): Users!\n  updateUsers(id: ID!, input: UsersUpdateInput!): Users\n  deleteUsers(id: ID!): Users\n  deleteUsersMany(ids: [ID!]!): [Users!]!\n  createOrgs(input: OrgsCreateInput!): Orgs!\n  updateOrgs(id: ID!, input: OrgsUpdateInput!): Orgs\n  deleteOrgs(id: ID!): Orgs\n  deleteOrgsMany(ids: [ID!]!): [Orgs!]!\n  createSuppliers(input: SuppliersCreateInput!): Suppliers!\n  updateSuppliers(id: ID!, input: SuppliersUpdateInput!): Suppliers\n  deleteSuppliers(id: ID!): Suppliers\n  deleteSuppliersMany(ids: [ID!]!): [Suppliers!]!\n  createCustomers(input: CustomersCreateInput!): Customers!\n  updateCustomers(id: ID!, input: CustomersUpdateInput!): Customers\n  deleteCustomers(id: ID!): Customers\n  deleteCustomersMany(ids: [ID!]!): [Customers!]!\n  createProducts(input: ProductsCreateInput!): Products!\n  updateProducts(id: ID!, input: ProductsUpdateInput!): Products\n  deleteProducts(id: ID!): Products\n  deleteProductsMany(ids: [ID!]!): [Products!]!\n  createBoms(input: BomsCreateInput!): Boms!\n  updateBoms(id: ID!, input: BomsUpdateInput!): Boms\n  deleteBoms(id: ID!): Boms\n  deleteBomsMany(ids: [ID!]!): [Boms!]!\n  createPurchase_orders(input: Purchase_ordersCreateInput!): Purchase_orders!\n  updatePurchase_orders(id: ID!, input: Purchase_ordersUpdateInput!): Purchase_orders\n  deletePurchase_orders(id: ID!): Purchase_orders\n  deletePurchase_ordersMany(ids: [ID!]!): [Purchase_orders!]!\n  createPurchase_order_lines(input: Purchase_order_linesCreateInput!): Purchase_order_lines!\n  updatePurchase_order_lines(id: ID!, input: Purchase_order_linesUpdateInput!): Purchase_order_lines\n  deletePurchase_order_lines(id: ID!): Purchase_order_lines\n  deletePurchase_order_linesMany(ids: [ID!]!): [Purchase_order_lines!]!\n  createReceipts(input: ReceiptsCreateInput!): Receipts!\n  updateReceipts(id: ID!, input: ReceiptsUpdateInput!): Receipts\n  deleteReceipts(id: ID!): Receipts\n  deleteReceiptsMany(ids: [ID!]!): [Receipts!]!\n  createSales_orders(input: Sales_ordersCreateInput!): Sales_orders!\n  updateSales_orders(id: ID!, input: Sales_ordersUpdateInput!): Sales_orders\n  deleteSales_orders(id: ID!): Sales_orders\n  deleteSales_ordersMany(ids: [ID!]!): [Sales_orders!]!\n  createSales_order_lines(input: Sales_order_linesCreateInput!): Sales_order_lines!\n  updateSales_order_lines(id: ID!, input: Sales_order_linesUpdateInput!): Sales_order_lines\n  deleteSales_order_lines(id: ID!): Sales_order_lines\n  deleteSales_order_linesMany(ids: [ID!]!): [Sales_order_lines!]!\n  createShipments(input: ShipmentsCreateInput!): Shipments!\n  updateShipments(id: ID!, input: ShipmentsUpdateInput!): Shipments\n  deleteShipments(id: ID!): Shipments\n  deleteShipmentsMany(ids: [ID!]!): [Shipments!]!\n  createWarehouses(input: WarehousesCreateInput!): Warehouses!\n  updateWarehouses(id: ID!, input: WarehousesUpdateInput!): Warehouses\n  deleteWarehouses(id: ID!): Warehouses\n  deleteWarehousesMany(ids: [ID!]!): [Warehouses!]!\n  createBins(input: BinsCreateInput!): Bins!\n  updateBins(id: ID!, input: BinsUpdateInput!): Bins\n  deleteBins(id: ID!): Bins\n  deleteBinsMany(ids: [ID!]!): [Bins!]!\n  createInventory(input: InventoryCreateInput!): Inventory!\n  updateInventory(id: ID!, input: InventoryUpdateInput!): Inventory\n  deleteInventory(id: ID!): Inventory\n  deleteInventoryMany(ids: [ID!]!): [Inventory!]!\n  createStock_movements(input: Stock_movementsCreateInput!): Stock_movements!\n  updateStock_movements(id: ID!, input: Stock_movementsUpdateInput!): Stock_movements\n  deleteStock_movements(id: ID!): Stock_movements\n  deleteStock_movementsMany(ids: [ID!]!): [Stock_movements!]!\n  createWork_orders(input: Work_ordersCreateInput!): Work_orders!\n  updateWork_orders(id: ID!, input: Work_ordersUpdateInput!): Work_orders\n  deleteWork_orders(id: ID!): Work_orders\n  deleteWork_ordersMany(ids: [ID!]!): [Work_orders!]!\n  \"Append a receipt movement and update the on-hand quantity of the target inventory record.\"\n  runReceiveInventory(input: ReceiveInventoryCommandInput!, idempotencyKey: String!): Inventory!\n  \"Move an inventory record into another storage bin and record the transfer.\"\n  runPutawayStock(input: PutawayStockCommandInput!, idempotencyKey: String!): Inventory!\n  \"Reserve an absolute quantity of an inventory record for a sales order.\"\n  runReserveStock(input: ReserveStockCommandInput!, idempotencyKey: String!): Inventory!\n  \"Record a cycle count and set the counted on-hand quantity.\"\n  runAdjustStock(input: AdjustStockCommandInput!, idempotencyKey: String!): Inventory!\n  \"Create a shipment for a sales order and mark it shipped.\"\n  runShipSalesOrder(input: ShipSalesOrderCommandInput!, idempotencyKey: String!): Shipments!\n  \"Transfer stock between warehouses or bins with an audit movement.\"\n  runTransferInventory(input: TransferInventoryCommandInput!, idempotencyKey: String!): Inventory!\n  \"Consume components and book the produced quantity, then close the work order.\"\n  runCompleteWorkOrder(input: CompleteWorkOrderCommandInput!, idempotencyKey: String!): Work_orders!\n  \"Approve a draft purchase order. Operators do not hold the purchasing approval permission, so this command is a permission-denied example.\"\n  runApprovePurchaseOrder(input: ApprovePurchaseOrderCommandInput!): Purchase_orders!\n}\n\ntype Subscription {\n  inventoryChanged: InventoryEvent!\n  stock_movementsChanged: Stock_movementsEvent!\n  shipmentsChanged: ShipmentsEvent!\n}";
const schema = buildSchema(graphqlTypeDefs);
const scopeDefinitions = [{"resource":"warehouses","field":"orgId","claim":"org.id"}] as Array<{ resource: string; field: string; claim: string; tree?: { entity: string; parentField: string } }>;
const policyColumns: Record<string, Record<string, unknown>> = {
  "products": { "id": products.id, "sku": products.sku, "name": products.name, "uom": products.uom, "unitCost": products.unitCost, "price": products.price, "reorderPoint": products.reorderPoint, "active": products.active },
};


async function executeDataflowCommand<T>(routes: ReturnType<typeof createDataflowRoutes>, request: Request, flow: string, input: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  const path = flow.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const response = await routes.handle(new Request("http://qiy.internal/api/v1/commands/" + path, { method: "POST", headers, body: JSON.stringify(input) }));
  const payload = await response.json() as { error?: string; errorKey?: string } & Record<string, unknown>;
  if (!response.ok) throw new GraphQLError(payload.error ?? "Dataflow command failed", { extensions: { status: response.status, ...(payload.errorKey ? { errorKey: payload.errorKey } : {}) } });
  return payload as T;
}

export async function createGraphQLContext(authenticate: Authenticator, request: Request) {
  const principal = await authenticate(request);
  const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
  return { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }, policyFor: (resource: string) => resolvePolicy(resource, principal, policyColumns[resource] ?? {}) };
}

function requestedFields(query: string, operationName?: string): Set<string> {
  const document = parse(query);
  const fragments = new Map(document.definitions.filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION).map((fragment) => [fragment.name.value, fragment]));
  const fields = new Set<string>();
  const visit = (selections: readonly import("graphql").SelectionNode[], seen = new Set<string>()) => {
    for (const selection of selections) {
      if (selection.kind === Kind.FIELD) fields.add(selection.name.value);
      else if (selection.kind === Kind.INLINE_FRAGMENT) visit(selection.selectionSet.selections, seen);
      else {
        if (seen.has(selection.name.value)) continue;
        const fragment = fragments.get(selection.name.value);
        if (fragment) visit(fragment.selectionSet.selections, new Set([...seen, selection.name.value]));
      }
    }
  };
  const operation = getOperationAST(document, operationName);
  if (operation) visit(operation.selectionSet.selections);
  return fields;
}

interface GraphQLRequest { query: string; variables?: Record<string, unknown>; operationName?: string; }

export function createGraphQLRoutes(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
  users: withPaginationLimit(createUsersService(repositories.users)),
  orgs: withPaginationLimit(createOrgsService(repositories.orgs)),
  suppliers: withPaginationLimit(createSuppliersService(repositories.suppliers)),
  customers: withPaginationLimit(createCustomersService(repositories.customers)),
  products: withPaginationLimit(createProductsService(repositories.products)),
  boms: withPaginationLimit(createBomsService(repositories.boms)),
  purchase_orders: withPaginationLimit(createPurchase_ordersService(repositories.purchase_orders)),
  purchase_order_lines: withPaginationLimit(createPurchase_order_linesService(repositories.purchase_order_lines)),
  receipts: withPaginationLimit(createReceiptsService(repositories.receipts)),
  sales_orders: withPaginationLimit(createSales_ordersService(repositories.sales_orders)),
  sales_order_lines: withPaginationLimit(createSales_order_linesService(repositories.sales_order_lines)),
  shipments: withPaginationLimit(createShipmentsService(repositories.shipments)),
  warehouses: withPaginationLimit(createWarehousesService(repositories.warehouses)),
  bins: withPaginationLimit(createBinsService(repositories.bins)),
  inventory: withPaginationLimit(createInventoryService(repositories.inventory)),
  stock_movements: withPaginationLimit(createStock_movementsService(repositories.stock_movements)),
  work_orders: withPaginationLimit(createWork_ordersService(repositories.work_orders)),
  };
  const commandRoutes = createDataflowRoutes(authenticate);
  return new Elysia({ prefix: "/graphql" })
    .post("/", async ({ body, request, status }) => {
      const operation = body as GraphQLRequest;
      const principal = await authenticate(request);
      const scopes = Object.fromEntries(scopeDefinitions.map(({ resource, field, claim }) => [resource, { field, value: String(principal?.claims?.[claim] ?? "") }]));
      let fields: Set<string>;
      try { fields = requestedFields(operation.query, operation.operationName); } catch { fields = new Set(); }
      if (scopeDefinitions.some(({ resource }) => [resource, resource + "ById", resource + "Distribution", resource + "Trend", "create" + resource[0]!.toUpperCase() + resource.slice(1), "update" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1), "delete" + resource[0]!.toUpperCase() + resource.slice(1) + "Many"].some((name) => fields.has(name)) && !scopes[resource]?.value)) return status(403, { error: "Missing required data scope claim" });
      return graphql({ schema, rootValue: resolvers(services, commandRoutes), contextValue: { request, actorId: principal?.id, scopeFor: (resource: string) => { const scope = scopes[resource]; if (scope && !scope.value) throw new Error("Missing required data scope claim"); return scope; }, policyFor: (resource: string) => resolvePolicy(resource, principal, policyColumns[resource] ?? {}) }, source: operation.query, variableValues: operation.variables, operationName: operation.operationName });
    }, { body: t.Object({ query: t.String({ minLength: 1 }), variables: t.Optional(t.Record(t.String(), t.Any())), operationName: t.Optional(t.String()) }) })
    .get("/subscribe", async ({ query, request, status }) => {
      const principal = await authenticate(request);
      if (!principal) return status(401, { error: "Authentication required" });
      let document;
      try { document = parse(query.query); }
      catch { return status(400, { error: "Invalid GraphQL document" }); }
      const capabilities = realtimeCapabilities(principal);
      const contextValue = {
        request,
        actorId: principal.id,
        canSubscribe: (channel: string) => Boolean(capabilities[channel]?.includes("subscribe")),
        channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")),
        scopeFor: () => undefined,
      };
      let result: unknown;
      try { result = await subscribe({ schema, document, rootValue: resolvers(services, commandRoutes, { canSubscribe: (channel: string) => Boolean(capabilities[channel]?.includes("subscribe")), channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")) }), contextValue, variableValues: query.variables ? JSON.parse(query.variables) as Record<string, unknown> : undefined, operationName: query.operationName }); }
      catch (error) { return status(400, { error: error instanceof Error ? error.message : "Unsupported subscription" }); }
      if (!(Symbol.asyncIterator in (result as object))) {
        const failures = (result as { errors?: Array<{ message: string }> }).errors ?? [];
        const forbidden = failures.some((error) => error.message.includes("not permitted"));
        return status(forbidden ? 403 : 400, { error: failures[0]?.message ?? "Unsupported subscription" });
      }
      const iterator = result as AsyncIterableIterator<Record<string, unknown>>;
      const body = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          request.signal.addEventListener("abort", () => { void iterator.return?.(); try { controller.close(); } catch { /* already closed */ } });
          try {
            for await (const payload of iterator) controller.enqueue(encoder.encode("data: " + JSON.stringify(payload) + "\n\n"));
          } catch (error) {
            controller.enqueue(encoder.encode("event: error\ndata: " + JSON.stringify({ message: error instanceof Error ? error.message : String(error) }) + "\n\n"));
          } finally {
            try { controller.close(); } catch { /* already closed */ }
          }
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }, { query: t.Object({ query: t.String({ minLength: 1, maxLength: 20000 }), variables: t.Optional(t.String({ maxLength: 20000 })), operationName: t.Optional(t.String({ maxLength: 200 })) }) })
    .ws("/ws", {
      async message(socket, raw) {
        const ws = socket as any;
        let frame: { type?: string; id?: string; payload?: { token?: string; query?: string; variables?: Record<string, unknown>; operationName?: string } };
        try {
          // Elysia may hand the message over parsed, as text, or as a binary frame.
          frame = typeof raw === "object" && raw !== null && !(raw instanceof Uint8Array)
            ? raw as typeof frame
            : JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array));
        } catch { return ws.send(JSON.stringify({ type: "error", payload: [{ message: "Invalid message" }] })); }
        if (frame.type === "connection_init") {
          const token = frame.payload?.token ?? "";
          const headers: Record<string, string> = token ? { Authorization: /^Bearers/.test(token) ? token : "Bearer " + token } : {};
          const principal = await authenticate(new Request("http://realtime/ws", { headers }));
          if (!principal) { ws.close(4401, "Unauthorized"); return; }
          ws.data.principal = principal;
          ws.data.requestHeaders = headers;
          return ws.send(JSON.stringify({ type: "connection_ack" }));
        }
        if (frame.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
        if (frame.type === "connection_terminate") return ws.close(1000, "Terminated");
        const principal = ws.data.principal as Principal | undefined;
        if (!principal) { ws.close(4401, "Unauthorized"); return; }
        if (frame.type === "complete") { const iterator = ws.data.subscriptions?.get(frame.id); if (iterator) { void iterator.return?.(); ws.data.subscriptions.delete(frame.id); ws.send(JSON.stringify({ id: frame.id, type: "complete" })); } return; }
        if (frame.type !== "subscribe" || !frame.id) return ws.send(JSON.stringify({ type: "error", id: frame.id, payload: [{ message: "Unsupported message" }] }));
        let document;
        try { document = parse(frame.payload?.query ?? ""); } catch { return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: "Invalid GraphQL document" }] })); }
        const capabilities = realtimeCapabilities(principal);
        const contextValue = {
          request: new Request("http://realtime/ws", { headers: ws.data.requestHeaders ?? {} }),
          actorId: principal.id,
          channelFor: (prefix: string) => Object.keys(capabilities).find((channel) => (channel === prefix || channel.startsWith(prefix + ":")) && capabilities[channel]?.includes("subscribe")),
          scopeFor: () => undefined,
        };
        let result: any;
        try { result = await subscribe({ schema, document, rootValue: resolvers(services, commandRoutes, { channelFor: contextValue.channelFor }), contextValue, variableValues: frame.payload?.variables, operationName: frame.payload?.operationName }); }
        catch (error) { return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: error instanceof Error ? error.message : "Unsupported subscription" }] })); }
        if (!result || !(Symbol.asyncIterator in result)) {
          const failures = (result as { errors?: Array<{ message: string }> } | undefined)?.errors ?? [{ message: "Unsupported subscription" }];
          return ws.send(JSON.stringify({ id: frame.id, type: "error", payload: failures }));
        }
        const iterator = result as AsyncIterableIterator<Record<string, unknown>>;
        ws.data.subscriptions = ws.data.subscriptions ?? new Map();
        ws.data.subscriptions.set(frame.id, iterator);
        void (async () => {
          try { for await (const payload of iterator) { if (ws.readyState !== 1) break; ws.send(JSON.stringify({ id: frame.id, type: "next", payload })); } }
          catch (error) { if (ws.readyState === 1) ws.send(JSON.stringify({ id: frame.id, type: "error", payload: [{ message: error instanceof Error ? error.message : String(error) }] })); }
          finally { if (ws.readyState === 1) ws.send(JSON.stringify({ id: frame.id, type: "complete" })); ws.data.subscriptions?.delete(frame.id); }
        })();
      },
      close(socket) { const ws = socket as any; for (const iterator of ws.data.subscriptions?.values?.() ?? []) void iterator.return?.(); ws.data.subscriptions?.clear?.(); },
    });
}

function resolvers(services: {
  users: ReturnType<typeof createUsersService>;
  orgs: ReturnType<typeof createOrgsService>;
  suppliers: ReturnType<typeof createSuppliersService>;
  customers: ReturnType<typeof createCustomersService>;
  products: ReturnType<typeof createProductsService>;
  boms: ReturnType<typeof createBomsService>;
  purchase_orders: ReturnType<typeof createPurchase_ordersService>;
  purchase_order_lines: ReturnType<typeof createPurchase_order_linesService>;
  receipts: ReturnType<typeof createReceiptsService>;
  sales_orders: ReturnType<typeof createSales_ordersService>;
  sales_order_lines: ReturnType<typeof createSales_order_linesService>;
  shipments: ReturnType<typeof createShipmentsService>;
  warehouses: ReturnType<typeof createWarehousesService>;
  bins: ReturnType<typeof createBinsService>;
  inventory: ReturnType<typeof createInventoryService>;
  stock_movements: ReturnType<typeof createStock_movementsService>;
  work_orders: ReturnType<typeof createWork_ordersService>;
}, commandRoutes: ReturnType<typeof createDataflowRoutes>, context?: { canSubscribe?: (channel: string) => boolean; channelFor?: (prefix: string) => string | undefined }) {
  return {
  get inventoryChanged() { const channel = context?.channelFor?.("qiy:inventory"); if (!channel) throw new GraphQLError("Realtime subscription is not permitted", { extensions: { status: 403, errorKey: "realtime.forbidden" } }); const events = realtimeChannelIterator(channel); return (async function* () { try { for await (const event of events) yield { inventoryChanged: { event: event.event, record: event.record } }; } finally { events.close(); } })(); },
  get stock_movementsChanged() { const channel = context?.channelFor?.("qiy:stock_movements"); if (!channel) throw new GraphQLError("Realtime subscription is not permitted", { extensions: { status: 403, errorKey: "realtime.forbidden" } }); const events = realtimeChannelIterator(channel); return (async function* () { try { for await (const event of events) yield { stock_movementsChanged: { event: event.event, record: event.record } }; } finally { events.close(); } })(); },
  get shipmentsChanged() { const channel = context?.channelFor?.("qiy:shipments"); if (!channel) throw new GraphQLError("Realtime subscription is not permitted", { extensions: { status: 403, errorKey: "realtime.forbidden" } }); const events = realtimeChannelIterator(channel); return (async function* () { try { for await (const event of events) yield { shipmentsChanged: { event: event.event, record: event.record } }; } finally { events.close(); } })(); },
  usersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.users.aggregate(field, op, context.scopeFor("users")).then((result) => result.value); },  usersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["role"] as string[]).includes(field) ? services.users.distribution(field, context.scopeFor("users")) : Promise.reject(new Error("Unsupported distribution field")),
  usersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.users.trend(field, days, context.scopeFor("users")) : Promise.reject(new Error("Invalid trend query")),
  users: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","subject","oktaSubject","keycloakSubject","googleSubject","kindeSubject","azureSubject","email","displayName","role","passwordHash","oauthProfiles","permissions","orgId"] as string[];
    const filterableFields = ["id","subject","oktaSubject","keycloakSubject","googleSubject","kindeSubject","azureSubject","email","displayName","role","passwordHash","oauthProfiles","permissions","orgId"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"subject":["contains","startsWith","endsWith","eq"],"oktaSubject":["contains","startsWith","endsWith","eq"],"keycloakSubject":["contains","startsWith","endsWith","eq"],"googleSubject":["contains","startsWith","endsWith","eq"],"kindeSubject":["contains","startsWith","endsWith","eq"],"azureSubject":["contains","startsWith","endsWith","eq"],"email":["contains","startsWith","endsWith","eq"],"displayName":["contains","startsWith","endsWith","eq"],"role":["eq"],"passwordHash":["contains","startsWith","endsWith","eq"],"oauthProfiles":["contains","startsWith","endsWith","eq"],"permissions":["contains","startsWith","endsWith","eq"],"orgId":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.users.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("users"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  usersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.one(id, context.scopeFor("users")),
  createUsers: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.create(input, context.actorId, context.scopeFor("users")),
  updateUsers: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.update(id, input, context.actorId, context.scopeFor("users")),
  deleteUsers: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.delete(id, context.actorId, context.scopeFor("users")),
  deleteUsersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.users.deleteMany(ids, context.actorId, context.scopeFor("users")),
  orgsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.orgs.aggregate(field, op, context.scopeFor("orgs")).then((result) => result.value); },  orgsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.orgs.distribution(field, context.scopeFor("orgs")) : Promise.reject(new Error("Unsupported distribution field")),
  orgsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.orgs.trend(field, days, context.scopeFor("orgs")) : Promise.reject(new Error("Invalid trend query")),
  orgs: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","code","name","parentId"] as string[];
    const filterableFields = ["id","code","name","parentId"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"code":["contains","startsWith","endsWith","eq"],"name":["contains","startsWith","endsWith","eq"],"parentId":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.orgs.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("orgs"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  orgsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orgs.one(id, context.scopeFor("orgs")),
  createOrgs: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orgs.create(input, context.actorId, context.scopeFor("orgs")),
  updateOrgs: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orgs.update(id, input, context.actorId, context.scopeFor("orgs")),
  deleteOrgs: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orgs.delete(id, context.actorId, context.scopeFor("orgs")),
  deleteOrgsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.orgs.deleteMany(ids, context.actorId, context.scopeFor("orgs")),
  suppliersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.suppliers.aggregate(field, op, context.scopeFor("suppliers")).then((result) => result.value); },  suppliersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.suppliers.distribution(field, context.scopeFor("suppliers")) : Promise.reject(new Error("Unsupported distribution field")),
  suppliersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.suppliers.trend(field, days, context.scopeFor("suppliers")) : Promise.reject(new Error("Invalid trend query")),
  suppliers: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","code","name","email","leadTimeDays"] as string[];
    const filterableFields = ["id","code","name","email","leadTimeDays"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"code":["contains","startsWith","endsWith","eq"],"name":["contains","startsWith","endsWith","eq"],"email":["contains","startsWith","endsWith","eq"],"leadTimeDays":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.suppliers.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("suppliers"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  suppliersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.suppliers.one(id, context.scopeFor("suppliers")),
  createSuppliers: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.suppliers.create(input, context.actorId, context.scopeFor("suppliers")),
  updateSuppliers: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.suppliers.update(id, input, context.actorId, context.scopeFor("suppliers")),
  deleteSuppliers: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.suppliers.delete(id, context.actorId, context.scopeFor("suppliers")),
  deleteSuppliersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.suppliers.deleteMany(ids, context.actorId, context.scopeFor("suppliers")),
  customersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.customers.aggregate(field, op, context.scopeFor("customers")).then((result) => result.value); },  customersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.customers.distribution(field, context.scopeFor("customers")) : Promise.reject(new Error("Unsupported distribution field")),
  customersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.customers.trend(field, days, context.scopeFor("customers")) : Promise.reject(new Error("Invalid trend query")),
  customers: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","code","name","email","creditLimit"] as string[];
    const filterableFields = ["id","code","name","email","creditLimit"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"code":["contains","startsWith","endsWith","eq"],"name":["contains","startsWith","endsWith","eq"],"email":["contains","startsWith","endsWith","eq"],"creditLimit":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.customers.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("customers"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  customersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.one(id, context.scopeFor("customers")),
  createCustomers: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.create(input, context.actorId, context.scopeFor("customers")),
  updateCustomers: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.update(id, input, context.actorId, context.scopeFor("customers")),
  deleteCustomers: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.delete(id, context.actorId, context.scopeFor("customers")),
  deleteCustomersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.customers.deleteMany(ids, context.actorId, context.scopeFor("customers")),
  productsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => { if (context.policyFor("products").maskedFields.includes(field)) return Promise.reject(new Error("Aggregating a masked field is not permitted")); if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.products.aggregate(field, op, context.scopeFor("products"), context.policyFor("products")).then((result) => result.value); },  productsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => (["active"] as string[]).includes(field) ? services.products.distribution(field, context.scopeFor("products"), context.policyFor("products")) : Promise.reject(new Error("Unsupported distribution field")),
  productsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.products.trend(field, days, context.scopeFor("products"), context.policyFor("products")) : Promise.reject(new Error("Invalid trend query")),
  products: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => {
    const sortableFields = ["id","sku","name","uom","unitCost","price","reorderPoint","active"] as string[];
    const filterableFields = ["id","sku","name","uom","unitCost","price","reorderPoint","active"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"sku":["contains","startsWith","endsWith","eq"],"name":["contains","startsWith","endsWith","eq"],"uom":["contains","startsWith","endsWith","eq"],"unitCost":["eq","gt","gte","lt","lte","between","in"],"price":["eq","gt","gte","lt","lte","between","in"],"reorderPoint":["eq","gt","gte","lt","lte","between","in"],"active":["eq"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.products.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("products"), policy: context.policyFor("products"),
    });
    const policy = context.policyFor("products");
    return { ...result, items: result.data.map((record) => policy.mask(record)), page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  productsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => services.products.one(id, context.scopeFor("products"), context.policyFor("products")).then((record) => record ? context.policyFor("products").mask(record) : record),
  createProducts: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => (async () => { const policy = context.policyFor("products"); if (Object.keys(input).some((field) => policy.maskedFields.includes(field))) throw new QiyPolicyError("Masked fields cannot be written", 400, "policy.maskedField"); const record = await services.products.create(input, context.actorId, context.scopeFor("products"), policy); return record ? policy.mask(record) : record; })(),
  updateProducts: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => (async () => { const policy = context.policyFor("products"); if (Object.keys(input).some((field) => policy.maskedFields.includes(field))) throw new QiyPolicyError("Masked fields cannot be written", 400, "policy.maskedField"); const record = await services.products.update(id, input, context.actorId, context.scopeFor("products"), policy); return record ? policy.mask(record) : record; })(),
  deleteProducts: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => services.products.delete(id, context.actorId, context.scopeFor("products"), context.policyFor("products")).then((record) => record ? context.policyFor("products").mask(record) : record),
  deleteProductsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined; policyFor: (resource: string) => QiyPolicy }) => services.products.deleteMany(ids, context.actorId, context.scopeFor("products"), context.policyFor("products")).then((records) => records.map((record) => context.policyFor("products").mask(record))),
  bomsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.boms.aggregate(field, op, context.scopeFor("boms")).then((result) => result.value); },  bomsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.boms.distribution(field, context.scopeFor("boms")) : Promise.reject(new Error("Unsupported distribution field")),
  bomsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.boms.trend(field, days, context.scopeFor("boms")) : Promise.reject(new Error("Invalid trend query")),
  boms: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","productId","componentId","quantity"] as string[];
    const filterableFields = ["id","productId","componentId","quantity"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"componentId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.boms.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("boms"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  bomsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.boms.one(id, context.scopeFor("boms")),
  createBoms: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.boms.create(input, context.actorId, context.scopeFor("boms")),
  updateBoms: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.boms.update(id, input, context.actorId, context.scopeFor("boms")),
  deleteBoms: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.boms.delete(id, context.actorId, context.scopeFor("boms")),
  deleteBomsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.boms.deleteMany(ids, context.actorId, context.scopeFor("boms")),
  purchase_ordersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.purchase_orders.aggregate(field, op, context.scopeFor("purchase_orders")).then((result) => result.value); },  purchase_ordersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["status"] as string[]).includes(field) ? services.purchase_orders.distribution(field, context.scopeFor("purchase_orders")) : Promise.reject(new Error("Unsupported distribution field")),
  purchase_ordersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["orderedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.purchase_orders.trend(field, days, context.scopeFor("purchase_orders")) : Promise.reject(new Error("Invalid trend query")),
  purchase_orders: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","number","supplierId","status","orderedAt","expectedDate","total"] as string[];
    const filterableFields = ["id","number","supplierId","status","orderedAt","expectedDate","total"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"number":["contains","startsWith","endsWith","eq"],"supplierId":["eq","gt","gte","lt","lte","between","in"],"status":["eq"],"orderedAt":["eq","gt","gte","lt","lte","between","in"],"expectedDate":["eq","gt","gte","lt","lte","between","in"],"total":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.purchase_orders.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("purchase_orders"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  purchase_ordersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_orders.one(id, context.scopeFor("purchase_orders")),
  createPurchase_orders: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_orders.create(input, context.actorId, context.scopeFor("purchase_orders")),
  updatePurchase_orders: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_orders.update(id, input, context.actorId, context.scopeFor("purchase_orders")),
  deletePurchase_orders: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_orders.delete(id, context.actorId, context.scopeFor("purchase_orders")),
  deletePurchase_ordersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_orders.deleteMany(ids, context.actorId, context.scopeFor("purchase_orders")),
  purchase_order_linesAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.purchase_order_lines.aggregate(field, op, context.scopeFor("purchase_order_lines")).then((result) => result.value); },  purchase_order_linesDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.purchase_order_lines.distribution(field, context.scopeFor("purchase_order_lines")) : Promise.reject(new Error("Unsupported distribution field")),
  purchase_order_linesTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.purchase_order_lines.trend(field, days, context.scopeFor("purchase_order_lines")) : Promise.reject(new Error("Invalid trend query")),
  purchase_order_lines: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","purchaseOrderId","productId","quantity","unitCost"] as string[];
    const filterableFields = ["id","purchaseOrderId","productId","quantity","unitCost"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"purchaseOrderId":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"],"unitCost":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.purchase_order_lines.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("purchase_order_lines"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  purchase_order_linesById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_order_lines.one(id, context.scopeFor("purchase_order_lines")),
  createPurchase_order_lines: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_order_lines.create(input, context.actorId, context.scopeFor("purchase_order_lines")),
  updatePurchase_order_lines: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_order_lines.update(id, input, context.actorId, context.scopeFor("purchase_order_lines")),
  deletePurchase_order_lines: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_order_lines.delete(id, context.actorId, context.scopeFor("purchase_order_lines")),
  deletePurchase_order_linesMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.purchase_order_lines.deleteMany(ids, context.actorId, context.scopeFor("purchase_order_lines")),
  receiptsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.receipts.aggregate(field, op, context.scopeFor("receipts")).then((result) => result.value); },  receiptsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.receipts.distribution(field, context.scopeFor("receipts")) : Promise.reject(new Error("Unsupported distribution field")),
  receiptsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["receivedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.receipts.trend(field, days, context.scopeFor("receipts")) : Promise.reject(new Error("Invalid trend query")),
  receipts: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","purchaseOrderId","warehouseId","status","receivedAt"] as string[];
    const filterableFields = ["id","purchaseOrderId","warehouseId","status","receivedAt"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"purchaseOrderId":["eq","gt","gte","lt","lte","between","in"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"status":["contains","startsWith","endsWith","eq"],"receivedAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.receipts.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("receipts"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  receiptsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.receipts.one(id, context.scopeFor("receipts")),
  createReceipts: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.receipts.create(input, context.actorId, context.scopeFor("receipts")),
  updateReceipts: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.receipts.update(id, input, context.actorId, context.scopeFor("receipts")),
  deleteReceipts: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.receipts.delete(id, context.actorId, context.scopeFor("receipts")),
  deleteReceiptsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.receipts.deleteMany(ids, context.actorId, context.scopeFor("receipts")),
  sales_ordersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.sales_orders.aggregate(field, op, context.scopeFor("sales_orders")).then((result) => result.value); },  sales_ordersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["status"] as string[]).includes(field) ? services.sales_orders.distribution(field, context.scopeFor("sales_orders")) : Promise.reject(new Error("Unsupported distribution field")),
  sales_ordersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["orderedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.sales_orders.trend(field, days, context.scopeFor("sales_orders")) : Promise.reject(new Error("Invalid trend query")),
  sales_orders: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","number","customerId","status","orderedAt","total"] as string[];
    const filterableFields = ["id","number","customerId","status","orderedAt","total"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"number":["contains","startsWith","endsWith","eq"],"customerId":["eq","gt","gte","lt","lte","between","in"],"status":["eq"],"orderedAt":["eq","gt","gte","lt","lte","between","in"],"total":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.sales_orders.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("sales_orders"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  sales_ordersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_orders.one(id, context.scopeFor("sales_orders")),
  createSales_orders: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_orders.create(input, context.actorId, context.scopeFor("sales_orders")),
  updateSales_orders: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_orders.update(id, input, context.actorId, context.scopeFor("sales_orders")),
  deleteSales_orders: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_orders.delete(id, context.actorId, context.scopeFor("sales_orders")),
  deleteSales_ordersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_orders.deleteMany(ids, context.actorId, context.scopeFor("sales_orders")),
  sales_order_linesAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.sales_order_lines.aggregate(field, op, context.scopeFor("sales_order_lines")).then((result) => result.value); },  sales_order_linesDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.sales_order_lines.distribution(field, context.scopeFor("sales_order_lines")) : Promise.reject(new Error("Unsupported distribution field")),
  sales_order_linesTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.sales_order_lines.trend(field, days, context.scopeFor("sales_order_lines")) : Promise.reject(new Error("Invalid trend query")),
  sales_order_lines: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","salesOrderId","productId","quantity","unitPrice","allocated"] as string[];
    const filterableFields = ["id","salesOrderId","productId","quantity","unitPrice","allocated"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"salesOrderId":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"],"unitPrice":["eq","gt","gte","lt","lte","between","in"],"allocated":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.sales_order_lines.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("sales_order_lines"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  sales_order_linesById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_order_lines.one(id, context.scopeFor("sales_order_lines")),
  createSales_order_lines: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_order_lines.create(input, context.actorId, context.scopeFor("sales_order_lines")),
  updateSales_order_lines: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_order_lines.update(id, input, context.actorId, context.scopeFor("sales_order_lines")),
  deleteSales_order_lines: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_order_lines.delete(id, context.actorId, context.scopeFor("sales_order_lines")),
  deleteSales_order_linesMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.sales_order_lines.deleteMany(ids, context.actorId, context.scopeFor("sales_order_lines")),
  shipmentsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.shipments.aggregate(field, op, context.scopeFor("shipments")).then((result) => result.value); },  shipmentsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.shipments.distribution(field, context.scopeFor("shipments")) : Promise.reject(new Error("Unsupported distribution field")),
  shipmentsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["shippedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.shipments.trend(field, days, context.scopeFor("shipments")) : Promise.reject(new Error("Invalid trend query")),
  shipments: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","salesOrderId","warehouseId","status","shippedAt","departureTime"] as string[];
    const filterableFields = ["id","salesOrderId","warehouseId","status","shippedAt","departureTime"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"salesOrderId":["eq","gt","gte","lt","lte","between","in"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"status":["contains","startsWith","endsWith","eq"],"shippedAt":["eq","gt","gte","lt","lte","between","in"],"departureTime":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.shipments.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("shipments"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  shipmentsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.shipments.one(id, context.scopeFor("shipments")),
  createShipments: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.shipments.create(input, context.actorId, context.scopeFor("shipments")),
  updateShipments: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.shipments.update(id, input, context.actorId, context.scopeFor("shipments")),
  deleteShipments: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.shipments.delete(id, context.actorId, context.scopeFor("shipments")),
  deleteShipmentsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.shipments.deleteMany(ids, context.actorId, context.scopeFor("shipments")),
  warehousesAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.warehouses.aggregate(field, op, context.scopeFor("warehouses")).then((result) => result.value); },  warehousesDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["active"] as string[]).includes(field) ? services.warehouses.distribution(field, context.scopeFor("warehouses")) : Promise.reject(new Error("Unsupported distribution field")),
  warehousesTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.warehouses.trend(field, days, context.scopeFor("warehouses")) : Promise.reject(new Error("Invalid trend query")),
  warehouses: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","orgId","code","name","active"] as string[];
    const filterableFields = ["id","orgId","code","name","active"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"orgId":["eq","gt","gte","lt","lte","between","in"],"code":["contains","startsWith","endsWith","eq"],"name":["contains","startsWith","endsWith","eq"],"active":["eq"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.warehouses.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("warehouses"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  warehousesById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.one(id, context.scopeFor("warehouses")),
  createWarehouses: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.create(input, context.actorId, context.scopeFor("warehouses")),
  updateWarehouses: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.update(id, input, context.actorId, context.scopeFor("warehouses")),
  deleteWarehouses: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.delete(id, context.actorId, context.scopeFor("warehouses")),
  deleteWarehousesMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.warehouses.deleteMany(ids, context.actorId, context.scopeFor("warehouses")),
  binsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.bins.aggregate(field, op, context.scopeFor("bins")).then((result) => result.value); },  binsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.bins.distribution(field, context.scopeFor("bins")) : Promise.reject(new Error("Unsupported distribution field")),
  binsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.bins.trend(field, days, context.scopeFor("bins")) : Promise.reject(new Error("Invalid trend query")),
  bins: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","warehouseId","code","capacity"] as string[];
    const filterableFields = ["id","warehouseId","code","capacity"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"code":["contains","startsWith","endsWith","eq"],"capacity":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.bins.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("bins"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  binsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.bins.one(id, context.scopeFor("bins")),
  createBins: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.bins.create(input, context.actorId, context.scopeFor("bins")),
  updateBins: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.bins.update(id, input, context.actorId, context.scopeFor("bins")),
  deleteBins: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.bins.delete(id, context.actorId, context.scopeFor("bins")),
  deleteBinsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.bins.deleteMany(ids, context.actorId, context.scopeFor("bins")),
  inventoryAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.inventory.aggregate(field, op, context.scopeFor("inventory")).then((result) => result.value); },  inventoryDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => ([] as string[]).includes(field) ? services.inventory.distribution(field, context.scopeFor("inventory")) : Promise.reject(new Error("Unsupported distribution field")),
  inventoryTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["updatedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.inventory.trend(field, days, context.scopeFor("inventory")) : Promise.reject(new Error("Invalid trend query")),
  inventory: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","inventoryKey","warehouseId","binId","productId","quantity","reserved","lotCode","updatedAt"] as string[];
    const filterableFields = ["id","inventoryKey","warehouseId","binId","productId","quantity","reserved","lotCode","updatedAt"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"inventoryKey":["contains","startsWith","endsWith","eq"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"binId":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"],"reserved":["eq","gt","gte","lt","lte","between","in"],"lotCode":["contains","startsWith","endsWith","eq"],"updatedAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.inventory.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("inventory"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  inventoryById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventory.one(id, context.scopeFor("inventory")),
  createInventory: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventory.create(input, context.actorId, context.scopeFor("inventory")),
  updateInventory: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventory.update(id, input, context.actorId, context.scopeFor("inventory")),
  deleteInventory: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventory.delete(id, context.actorId, context.scopeFor("inventory")),
  deleteInventoryMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.inventory.deleteMany(ids, context.actorId, context.scopeFor("inventory")),
  stock_movementsAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.stock_movements.aggregate(field, op, context.scopeFor("stock_movements")).then((result) => result.value); },  stock_movementsDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["type"] as string[]).includes(field) ? services.stock_movements.distribution(field, context.scopeFor("stock_movements")) : Promise.reject(new Error("Unsupported distribution field")),
  stock_movementsTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["occurredAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.stock_movements.trend(field, days, context.scopeFor("stock_movements")) : Promise.reject(new Error("Invalid trend query")),
  stock_movements: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","productId","warehouseId","binId","type","quantity","reference","occurredAt"] as string[];
    const filterableFields = ["id","productId","warehouseId","binId","type","quantity","reference","occurredAt"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"productId":["eq","gt","gte","lt","lte","between","in"],"warehouseId":["eq","gt","gte","lt","lte","between","in"],"binId":["eq","gt","gte","lt","lte","between","in"],"type":["eq"],"quantity":["eq","gt","gte","lt","lte","between","in"],"reference":["contains","startsWith","endsWith","eq"],"occurredAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.stock_movements.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("stock_movements"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  stock_movementsById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.stock_movements.one(id, context.scopeFor("stock_movements")),
  createStock_movements: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.stock_movements.create(input, context.actorId, context.scopeFor("stock_movements")),
  updateStock_movements: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.stock_movements.update(id, input, context.actorId, context.scopeFor("stock_movements")),
  deleteStock_movements: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.stock_movements.delete(id, context.actorId, context.scopeFor("stock_movements")),
  deleteStock_movementsMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.stock_movements.deleteMany(ids, context.actorId, context.scopeFor("stock_movements")),
  work_ordersAggregate: ({ field, op }: { field: string; op: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => { if (!["sum", "avg", "min", "max"].includes(op)) return Promise.reject(new Error("Unsupported aggregate operator")); return services.work_orders.aggregate(field, op, context.scopeFor("work_orders")).then((result) => result.value); },  work_ordersDistribution: ({ field }: { field: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["status"] as string[]).includes(field) ? services.work_orders.distribution(field, context.scopeFor("work_orders")) : Promise.reject(new Error("Unsupported distribution field")),
  work_ordersTrend: ({ field, days }: { field: string; days: number }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => (["plannedAt"] as string[]).includes(field) && Number.isInteger(days) && days >= 1 && days <= 365 ? services.work_orders.trend(field, days, context.scopeFor("work_orders")) : Promise.reject(new Error("Invalid trend query")),
  work_orders: async (args: { page?: number; pageSize?: number; search?: string; sort?: string; order?: string; filters?: Array<{ field: string; operator?: FilterOperator; value: string }> }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => {
    const sortableFields = ["id","number","productId","quantity","status","plannedAt"] as string[];
    const filterableFields = ["id","number","productId","quantity","status","plannedAt"] as string[];
    const filterModes = {"id":["eq","gt","gte","lt","lte","between","in"],"number":["contains","startsWith","endsWith","eq"],"productId":["eq","gt","gte","lt","lte","between","in"],"quantity":["eq","gt","gte","lt","lte","between","in"],"status":["eq"],"plannedAt":["eq","gt","gte","lt","lte","between","in"]} as Record<string, FilterOperator[]>;
    if (args.sort && !sortableFields.includes(args.sort)) throw new Error("Unsupported sort field");
    if ((args.filters ?? []).some((filter) => !filterableFields.includes(filter.field))) throw new Error("Unsupported filter field");
    if ((args.filters ?? []).some((filter) => !filterModes[filter.field]?.includes(filter.operator ?? "eq"))) throw new Error("Unsupported filter operator");
    const result = await services.work_orders.list(args.page ?? 1, args.pageSize ?? 20, {
      search: args.search, sort: args.sort, order: args.order === "desc" ? "desc" : "asc",
      filters: (args.filters ?? []).map((filter) => ({ ...filter, operator: filter.operator ?? "eq" })), scope: context.scopeFor("work_orders"),
    });
    return { ...result, items: result.data, page: args.page ?? 1, pageSize: args.pageSize ?? 20 };
  },
  work_ordersById: ({ id }: { id: string }, context: { scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.work_orders.one(id, context.scopeFor("work_orders")),
  createWork_orders: ({ input }: { input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.work_orders.create(input, context.actorId, context.scopeFor("work_orders")),
  updateWork_orders: ({ id, input }: { id: string; input: Record<string, unknown> }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.work_orders.update(id, input, context.actorId, context.scopeFor("work_orders")),
  deleteWork_orders: ({ id }: { id: string }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.work_orders.delete(id, context.actorId, context.scopeFor("work_orders")),
  deleteWork_ordersMany: ({ ids }: { ids: string[] }, context: { actorId?: string; scopeFor: (resource: string) => { field: string; value: string } | undefined }) => services.work_orders.deleteMany(ids, context.actorId, context.scopeFor("work_orders")),
  runReceiveInventory: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; inventoryKey?: string; warehouseId?: string; binId?: string; productId?: string; quantity?: number; reserved?: number; lotCode?: string | null; updatedAt?: string | null }>(commandRoutes, context.request, "receiveInventory", args.input ?? {}, args.idempotencyKey),
  runPutawayStock: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; inventoryKey?: string; warehouseId?: string; binId?: string; productId?: string; quantity?: number; reserved?: number; lotCode?: string | null; updatedAt?: string | null }>(commandRoutes, context.request, "putawayStock", args.input ?? {}, args.idempotencyKey),
  runReserveStock: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; inventoryKey?: string; warehouseId?: string; binId?: string; productId?: string; quantity?: number; reserved?: number; lotCode?: string | null; updatedAt?: string | null }>(commandRoutes, context.request, "reserveStock", args.input ?? {}, args.idempotencyKey),
  runAdjustStock: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; inventoryKey?: string; warehouseId?: string; binId?: string; productId?: string; quantity?: number; reserved?: number; lotCode?: string | null; updatedAt?: string | null }>(commandRoutes, context.request, "adjustStock", args.input ?? {}, args.idempotencyKey),
  runShipSalesOrder: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; salesOrderId?: string; warehouseId?: string; status?: string; shippedAt?: string | null; departureTime?: string | null }>(commandRoutes, context.request, "shipSalesOrder", args.input ?? {}, args.idempotencyKey),
  runTransferInventory: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; inventoryKey?: string; warehouseId?: string; binId?: string; productId?: string; quantity?: number; reserved?: number; lotCode?: string | null; updatedAt?: string | null }>(commandRoutes, context.request, "transferInventory", args.input ?? {}, args.idempotencyKey),
  runCompleteWorkOrder: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; number?: string; productId?: string; quantity?: number; status?: string; plannedAt?: string }>(commandRoutes, context.request, "completeWorkOrder", args.input ?? {}, args.idempotencyKey),
  runApprovePurchaseOrder: (args: { input?: Record<string, unknown>; idempotencyKey?: string }, context: { request: Request }) => executeDataflowCommand<{ id?: string; number?: string; supplierId?: string; status?: string; orderedAt?: string; expectedDate?: string; total?: string }>(commandRoutes, context.request, "approvePurchaseOrder", args.input ?? {}, args.idempotencyKey),
  };}

export function createGraphQLResolvers(repositories: Repositories, authenticate: Authenticator = async () => null) {
  const services = {
  users: withPaginationLimit(createUsersService(repositories.users)),
  orgs: withPaginationLimit(createOrgsService(repositories.orgs)),
  suppliers: withPaginationLimit(createSuppliersService(repositories.suppliers)),
  customers: withPaginationLimit(createCustomersService(repositories.customers)),
  products: withPaginationLimit(createProductsService(repositories.products)),
  boms: withPaginationLimit(createBomsService(repositories.boms)),
  purchase_orders: withPaginationLimit(createPurchase_ordersService(repositories.purchase_orders)),
  purchase_order_lines: withPaginationLimit(createPurchase_order_linesService(repositories.purchase_order_lines)),
  receipts: withPaginationLimit(createReceiptsService(repositories.receipts)),
  sales_orders: withPaginationLimit(createSales_ordersService(repositories.sales_orders)),
  sales_order_lines: withPaginationLimit(createSales_order_linesService(repositories.sales_order_lines)),
  shipments: withPaginationLimit(createShipmentsService(repositories.shipments)),
  warehouses: withPaginationLimit(createWarehousesService(repositories.warehouses)),
  bins: withPaginationLimit(createBinsService(repositories.bins)),
  inventory: withPaginationLimit(createInventoryService(repositories.inventory)),
  stock_movements: withPaginationLimit(createStock_movementsService(repositories.stock_movements)),
  work_orders: withPaginationLimit(createWork_ordersService(repositories.work_orders)),
  };
  const commandRoutes = createDataflowRoutes(authenticate);
  return resolvers(services, commandRoutes);
}

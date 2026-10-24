CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`storageKey` text NOT NULL,
	`fileName` text,
	`contentType` text NOT NULL,
	`size` integer NOT NULL,
	`ownerId` text,
	`resource` text NOT NULL,
	`resourceId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storageKey_unique` ON `attachments` (`storageKey`);--> statement-breakpoint
CREATE INDEX `attachments_resource_idx` ON `attachments` (`resource`,`resourceId`);--> statement-breakpoint
CREATE INDEX `attachments_owner_idx` ON `attachments` (`ownerId`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`resourceId` text,
	`metadata` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_resource_idx` ON `audit_events` (`resource`,`resourceId`);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`createdAt`);--> statement-breakpoint
CREATE TABLE `bins` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouseId` text NOT NULL,
	`code` text NOT NULL,
	`capacity` integer NOT NULL,
	FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bins_code_unique` ON `bins` (`code`);--> statement-breakpoint
CREATE TABLE `boms` (
	`id` text PRIMARY KEY NOT NULL,
	`productId` text NOT NULL,
	`componentId` text NOT NULL,
	`quantity` integer NOT NULL,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`componentId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`creditLimit` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_code_unique` ON `customers` (`code`);--> statement-breakpoint
CREATE TABLE `dataflow_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text NOT NULL,
	`flow` text NOT NULL,
	`requestKeyHash` text NOT NULL,
	`requestHash` text NOT NULL,
	`response` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataflow_idempotency_actor_flow_key_idx` ON `dataflow_idempotency` (`actorId`,`flow`,`requestKeyHash`);--> statement-breakpoint
CREATE TABLE `dataflow_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`actorId` text,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`inventoryKey` text NOT NULL,
	`warehouseId` text NOT NULL,
	`binId` text NOT NULL,
	`productId` text NOT NULL,
	`quantity` integer NOT NULL,
	`reserved` integer NOT NULL,
	`lotCode` text,
	`updatedAt` integer,
	FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_inventoryKey_unique` ON `inventory` (`inventoryKey`);--> statement-breakpoint
CREATE TABLE `orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`parentId` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_code_unique` ON `orgs` (`code`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`uom` text NOT NULL,
	`unitCost` real NOT NULL,
	`price` real NOT NULL,
	`reorderPoint` integer NOT NULL,
	`active` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_unique` ON `products` (`sku`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseOrderId` text NOT NULL,
	`productId` text NOT NULL,
	`quantity` integer NOT NULL,
	`unitCost` real NOT NULL,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`supplierId` text NOT NULL,
	`status` text NOT NULL,
	`orderedAt` integer NOT NULL,
	`total` real NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_number_unique` ON `purchase_orders` (`number`);--> statement-breakpoint
CREATE TABLE `qiy_export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`resource` text NOT NULL,
	`status` text NOT NULL,
	`total` integer NOT NULL,
	`processed` integer NOT NULL,
	`payload` text,
	`result` text,
	`errors` text,
	`actorId` text,
	`leaseOwner` text,
	`leaseUntil` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qiy_export_jobs_resource_idx` ON `qiy_export_jobs` (`resource`,`createdAt`);--> statement-breakpoint
CREATE TABLE `qiy_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`resource` text NOT NULL,
	`status` text NOT NULL,
	`total` integer NOT NULL,
	`processed` integer NOT NULL,
	`failed` integer NOT NULL,
	`errors` text,
	`actorId` text,
	`payload` text,
	`leaseOwner` text,
	`leaseUntil` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qiy_import_jobs_resource_idx` ON `qiy_import_jobs` (`resource`,`createdAt`);--> statement-breakpoint
CREATE TABLE `qiy_saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`resource` text NOT NULL,
	`name` text NOT NULL,
	`ownerId` text NOT NULL,
	`shared` integer NOT NULL,
	`search` text,
	`filters` text,
	`sorters` text,
	`columns` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qiy_saved_views_resource_idx` ON `qiy_saved_views` (`resource`,`ownerId`);--> statement-breakpoint
CREATE TABLE `qiy_realtime_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer NOT NULL,
	`availableAt` integer NOT NULL,
	`deliveredAt` integer,
	`deadLetteredAt` integer,
	`lastError` text,
	`leaseOwner` text,
	`leaseUntil` integer,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `qiy_realtime_outbox_pending_idx` ON `qiy_realtime_outbox` (`deliveredAt`,`deadLetteredAt`,`availableAt`,`leaseUntil`,`createdAt`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseOrderId` text NOT NULL,
	`warehouseId` text NOT NULL,
	`status` text NOT NULL,
	`receivedAt` integer,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `sales_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`salesOrderId` text NOT NULL,
	`productId` text NOT NULL,
	`quantity` integer NOT NULL,
	`unitPrice` real NOT NULL,
	`allocated` integer NOT NULL,
	FOREIGN KEY (`salesOrderId`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `sales_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customerId` text NOT NULL,
	`status` text NOT NULL,
	`orderedAt` integer NOT NULL,
	`total` real NOT NULL,
	FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_orders_number_unique` ON `sales_orders` (`number`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`salesOrderId` text NOT NULL,
	`warehouseId` text NOT NULL,
	`status` text NOT NULL,
	`shippedAt` integer,
	FOREIGN KEY (`salesOrderId`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`productId` text NOT NULL,
	`warehouseId` text NOT NULL,
	`binId` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`reference` text,
	`occurredAt` integer,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`binId`) REFERENCES `bins`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`leadTimeDays` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_code_unique` ON `suppliers` (`code`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`oktaSubject` text,
	`keycloakSubject` text,
	`googleSubject` text,
	`kindeSubject` text,
	`azureSubject` text,
	`email` text NOT NULL,
	`displayName` text,
	`role` text NOT NULL,
	`passwordHash` text,
	`oauthProfiles` text,
	`orgId` text,
	FOREIGN KEY (`orgId`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_subject_unique` ON `users` (`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oktaSubject_unique` ON `users` (`oktaSubject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_keycloakSubject_unique` ON `users` (`keycloakSubject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_googleSubject_unique` ON `users` (`googleSubject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_kindeSubject_unique` ON `users` (`kindeSubject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_azureSubject_unique` ON `users` (`azureSubject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` text NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`productId` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text NOT NULL,
	`plannedAt` integer NOT NULL,
	FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_orders_number_unique` ON `work_orders` (`number`);
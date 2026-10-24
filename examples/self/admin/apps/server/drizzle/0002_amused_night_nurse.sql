CREATE TABLE `qiy_code_sequences` (
	`entity` text NOT NULL,
	`field` text NOT NULL,
	`bucket` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`entity`, `field`, `bucket`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`parentId` text,
	`externalId` text,
	FOREIGN KEY (`parentId`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_orgs`("id", "code", "name", "parentId", "externalId") SELECT "id", "code", "name", "parentId", "externalId" FROM `orgs`;--> statement-breakpoint
DROP TABLE `orgs`;--> statement-breakpoint
ALTER TABLE `__new_orgs` RENAME TO `orgs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `orgs_code_unique` ON `orgs` (`code`);--> statement-breakpoint
CREATE TABLE `__new_shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`salesOrderId` text NOT NULL,
	`warehouseId` text NOT NULL,
	`status` text NOT NULL,
	`shippedAt` integer,
	`departureTime` text,
	FOREIGN KEY (`salesOrderId`) REFERENCES `sales_orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_shipments`("id", "salesOrderId", "warehouseId", "status", "shippedAt", "departureTime") SELECT "id", "salesOrderId", "warehouseId", "status", "shippedAt", "departureTime" FROM `shipments`;--> statement-breakpoint
DROP TABLE `shipments`;--> statement-breakpoint
ALTER TABLE `__new_shipments` RENAME TO `shipments`;
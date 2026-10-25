CREATE TABLE `qiy_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastUsedAt` integer,
	`expiresAt` integer,
	`revokedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qiy_api_keys_prefix_unique` ON `qiy_api_keys` (`prefix`);--> statement-breakpoint
CREATE UNIQUE INDEX `qiy_api_keys_hash_unique` ON `qiy_api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `qiy_api_keys_user_idx` ON `qiy_api_keys` (`userId`);
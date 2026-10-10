CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storageKey" text NOT NULL,
	"fileName" text,
	"contentType" text NOT NULL,
	"size" integer NOT NULL,
	"ownerId" uuid,
	"resource" text NOT NULL,
	"resourceId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storageKey_unique" UNIQUE("storageKey")
);
--> statement-breakpoint
CREATE INDEX "attachments_resource_idx" ON "attachments" USING btree ("resource","resourceId");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("ownerId");
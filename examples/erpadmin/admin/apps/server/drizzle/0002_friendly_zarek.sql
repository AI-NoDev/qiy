CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actorId" uuid,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resourceId" text,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource","resourceId");--> statement-breakpoint
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" USING btree ("createdAt");
CREATE TABLE "order_idempotency" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"actorId" uuid NOT NULL,
	"requestKey" text NOT NULL,
	"response" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_idempotency" ADD CONSTRAINT "order_idempotency_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_idempotency_scope_idx" ON "order_idempotency" USING btree ("orderId","actorId","requestKey");
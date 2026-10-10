CREATE TABLE "order_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"orderId" uuid NOT NULL,
	"orderItemId" uuid NOT NULL,
	"inventoryItemId" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_orderId_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_orderItemId_order_items_id_fk" FOREIGN KEY ("orderItemId") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_reservations" ADD CONSTRAINT "order_reservations_inventoryItemId_inventory_items_id_fk" FOREIGN KEY ("inventoryItemId") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_reservations_order_idx" ON "order_reservations" USING btree ("orderId");
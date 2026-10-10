CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE INDEX "products_embedding_hnsw" ON "products" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "products_title_idx" ON "products" USING btree ("title");
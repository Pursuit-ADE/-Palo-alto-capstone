-- Synthetic monthly product usage for the low-usage alert (plan item 14). The sample has none.
CREATE TABLE "product_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"account_id" text NOT NULL,
	"product_id" text NOT NULL,
	"purchase_date" date NOT NULL,
	"purchased_quantity" integer NOT NULL,
	"usage_month" date NOT NULL,
	"quantity_used" integer NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "product_usage_purchased_quantity_positive" CHECK ("purchased_quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_usage" ADD CONSTRAINT "product_usage_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_usage" ADD CONSTRAINT "product_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_usage" ADD CONSTRAINT "product_usage_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_usage_account_product" ON "product_usage" USING btree ("account_id","product_id");

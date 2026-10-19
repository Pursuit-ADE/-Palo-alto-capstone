ALTER TABLE "app_accounts" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "query_audit" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "query_audit" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_user_id_unique" ON "app_accounts" USING btree ("user_id");

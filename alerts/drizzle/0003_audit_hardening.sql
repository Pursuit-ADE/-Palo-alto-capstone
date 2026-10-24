ALTER TABLE "app_accounts" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_attempts_key_at" ON "login_attempts" USING btree ("key","at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_accounts_user_id_unique" ON "app_accounts" USING btree ("user_id");

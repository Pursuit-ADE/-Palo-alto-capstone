CREATE TABLE "account_team" (
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"team_role" text NOT NULL,
	"snapshot_id" text NOT NULL,
	CONSTRAINT "account_team_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"year_established" integer,
	"revenue_musd" numeric(12, 2),
	"employees" integer,
	"hq_country" text,
	"parent_account" text
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"region_id" text,
	"manager_id" text,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"account_id" text NOT NULL,
	"full_name" text NOT NULL,
	"title" text NOT NULL,
	"is_cxo" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"seed" text NOT NULL,
	"as_of_date" date NOT NULL,
	"loaded_at" timestamp with time zone NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"account_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"type" text NOT NULL,
	"asset" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"account_id" text,
	"region_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"stage" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"amount_is_estimate" boolean NOT NULL,
	"engage_date" date,
	"close_date" date NOT NULL,
	"close_date_is_estimate" boolean NOT NULL,
	"is_closed" boolean NOT NULL,
	"is_won" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"series" text NOT NULL,
	"list_price" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"request_id" text NOT NULL,
	"source" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text,
	"question_sha256" text,
	"intent" jsonb,
	"metric_id" text,
	"metric_version" integer,
	"regions" text[],
	"owner_count" integer,
	"snapshot_id" text,
	"result_hash" text,
	"outcome" text NOT NULL,
	"reason" text,
	"flags" text[],
	"model" text,
	"turn" integer
);
--> statement-breakpoint
CREATE TABLE "quotas" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"user_id" text NOT NULL,
	"region_id" text NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"account_id" text NOT NULL,
	"severity" text NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_team" ADD CONSTRAINT "account_team_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_team" ADD CONSTRAINT "account_team_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_team" ADD CONSTRAINT "account_team_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotas" ADD CONSTRAINT "quotas_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
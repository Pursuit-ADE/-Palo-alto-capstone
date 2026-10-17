CREATE TABLE "alert_cursor" (
	"id" text PRIMARY KEY NOT NULL,
	"evaluated_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD COLUMN "last_digest_at" timestamp with time zone;
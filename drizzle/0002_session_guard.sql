CREATE TABLE "session_guard" (
	"user_id" text PRIMARY KEY NOT NULL,
	"hits" text DEFAULT '[]' NOT NULL,
	"flagged" text DEFAULT '[]' NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint

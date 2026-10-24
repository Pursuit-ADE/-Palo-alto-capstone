CREATE TABLE "app_accounts" (
	"username" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "app_users"("id"),
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL REFERENCES "app_accounts"("username") ON DELETE CASCADE,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);

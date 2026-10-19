-- Oct 17 audit (D4): lookups that don't scan whole tables, and audit timestamps from the database clock.
-- (The one-account-per-person index came with 0004_audit_hardening.)
CREATE INDEX "app_sessions_expires_at" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_sessions_user_id" ON "app_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "query_audit_at" ON "query_audit" USING btree ("at");--> statement-breakpoint
CREATE INDEX "query_audit_user_at" ON "query_audit" USING btree ("user_id","at");--> statement-breakpoint
ALTER TABLE "query_audit" ALTER COLUMN "at" SET DEFAULT now();

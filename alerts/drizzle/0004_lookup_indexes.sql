-- Oct 17 audit (D4): indexes for session clean-up and per-user inbox and digest lookups.
-- (The one-account-per-person index came with 0003_audit_hardening.)
CREATE INDEX "app_sessions_expires_at" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "app_sessions_user_id" ON "app_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_deliveries_user_status" ON "alert_deliveries" USING btree ("user_id","status");

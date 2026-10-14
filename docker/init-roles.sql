-- Least-privilege roles for Postgres mode (PRD S7). Runs once when the container is first created.
-- The table grants themselves are applied by the app on start (src/db/client.ts, applyGrants).
-- Local development passwords only; real deployments supply their own secrets.
CREATE ROLE app_readonly LOGIN PASSWORD 'readonly_local_dev';
CREATE ROLE app_audit LOGIN PASSWORD 'audit_local_dev';
ALTER ROLE app_readonly SET statement_timeout = '5s';
ALTER ROLE app_readonly SET default_transaction_read_only = on;

-- Least-privilege roles for Postgres mode (PRD S7). Runs once when the container is first created.
-- The table grants themselves are applied by the app on start (src/db/client.ts, applyGrants).
-- Local development passwords only; real deployments supply their own secrets.
CREATE ROLE app_readonly LOGIN PASSWORD 'readonly_local_dev';
CREATE ROLE app_audit LOGIN PASSWORD 'audit_local_dev';
CREATE ROLE app_auth LOGIN PASSWORD 'auth_local_dev';
ALTER ROLE app_readonly SET statement_timeout = '5s';
ALTER ROLE app_audit SET statement_timeout = '5s';
ALTER ROLE app_auth SET statement_timeout = '5s';
ALTER ROLE app_readonly SET default_transaction_read_only = on;

-- Alerts service (alerts/): its own database and a login that can only read, plus insert and update its own
-- state (deliveries, subscriptions, scheduler cursor). Grants are applied by alerts/src/db/client.ts on start.
CREATE DATABASE alerts;
CREATE ROLE alerts_app LOGIN PASSWORD 'alerts_local_dev';
ALTER ROLE alerts_app SET statement_timeout = '10s';

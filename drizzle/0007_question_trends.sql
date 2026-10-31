-- Counts of questions by UTC week, metric and outcome. No question text and no fingerprint.
-- Numbered 0007 because 0006 is product usage. The grant lives with the other grants in
-- src/db/client.ts. This migration runs on the embedded database too, and that database has no app_readonly role.
CREATE VIEW "question_trends" AS
  SELECT date_trunc('week', "at" AT TIME ZONE 'UTC')::date AS "week",
         coalesce(nullif("metric_id", ''), '(no metric)') AS "metric",
         "outcome",
         count(*)::int AS "count"
  FROM "query_audit"
  WHERE "source" = 'question'
  GROUP BY 1, 2, 3;

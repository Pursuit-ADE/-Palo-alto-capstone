-- A topic label for questions that were not answered (client call, Oct 24), and counts of them by week. The label
-- comes from a fixed list in src/audit/topics.ts, never from the question, so no question text is stored. The grant
-- lives with the other grants in src/db/client.ts, like 0007.
ALTER TABLE "query_audit" ADD COLUMN "topic" text;
--> statement-breakpoint
CREATE VIEW "question_topics" AS
  SELECT date_trunc('week', "at" AT TIME ZONE 'UTC')::date AS "week",
         coalesce("topic", 'other') AS "topic",
         "outcome",
         count(*)::int AS "count"
  FROM "query_audit"
  WHERE "source" = 'question' AND "outcome" <> 'answered'
  GROUP BY 1, 2, 3;

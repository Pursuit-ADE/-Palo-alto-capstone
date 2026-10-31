# Detections, hunting and triage

How someone watching the copilot (the team during the demo, or the client's SOC later) would spot misuse in the audit log. Every rule below runs against `query_audit` as it exists today. Flagged questions and locks already post to the security Slack channel when `SECURITY_SLACK_WEBHOOK_URL` is set; the rules below go further and look for patterns over time. Nothing runs them on a schedule yet.

## What the log holds

One row per question, dashboard tile or intent, written by `src/semantic/answer.ts`, including refusals.

| Column | Use in detection |
|---|---|
| `at` | When (UTC, set by the app server's clock) |
| `request_id`, `turn` | Ties a conversation's turns together |
| `source` | `question`, `dashboard`, `intent` or `auth` (sign-in events). `comparison_side` is the second figure of a "why is my number different?" comparison: same `request_id` as its question row |
| `user_id`, `role` | Who, and the role from the database (`sales_rep`, `technical_seller`, `sales_manager`, `analyst`). Sign-in rows with an unknown account use `unknown` |
| `question_sha256` | Keyed hash of the question. Same text gives the same hash only while `AUDIT_HASH_KEY` stays the same |
| `intent`, `metric_id`, `metric_version`, `regions`, `snapshot_id`, `result_hash` | What was asked for and answered |
| `outcome` | Questions: `answered`, `explanation` (a "why is my number different?" reply, with its figures in the row), `clarify`, `unsupported`, `refused_scope`, `refused_injection`, `refused_intent`, `refused_locked`, `refused_rate`, `error`. Sign-in: `login_ok`, `login_failed`, `signup_ok`, `signup_failed` |
| `reason` | Reason code or refusal message (never the question text) |
| `flags` | Suspicious-prompt codes: `instruction_override`, `role_claim`, `sql_or_code`, `link`, `pressure`, `social_proof`, `flattery`, `scope_widening` |
| `model` | `deterministic` or `claude-opus-5-5` |

**Not logged yet:** logout. Everything else above is.

## Rules

Severity follows `docs/RED-TEAM.md`. Windows are suggestions; tune them once there's real traffic.

### D1. Injection attempts (High)

One person had two or more questions refused as injection in 10 minutes.

```sql
SELECT user_id, role, count(*) AS attempts, min(at) AS first_seen, max(at) AS last_seen
FROM query_audit
WHERE outcome = 'refused_injection' AND at > now() - interval '10 minutes'
GROUP BY user_id, role
HAVING count(*) >= 2;
```

### D2. Lockout (High)

Someone hit the lock after three flagged questions in ten minutes. One row is enough to look at.

```sql
SELECT user_id, role, at, request_id
FROM query_audit
WHERE outcome = 'refused_locked' AND at > now() - interval '10 minutes';
```

### D3. Scope probing (Medium)

Someone other than the analyst keeps asking outside their scope.

```sql
SELECT user_id, role, count(*) AS refusals, array_agg(DISTINCT reason) AS reasons
FROM query_audit
WHERE role <> 'analyst'
  AND (outcome = 'refused_scope' OR 'scope_widening' = ANY(flags))
  AND at > now() - interval '1 hour'
GROUP BY user_id, role
HAVING count(*) >= 3;
```

### D4. Flagged but answered (Medium, review)

A question was flagged and still answered. Usually fine (SQL text in a question is answered in scope by design), but it's also where rewritten attacks that get past a refusal show up (F1).

```sql
SELECT at, user_id, role, flags, metric_id, regions, model
FROM query_audit
WHERE outcome IN ('answered', 'explanation') AND cardinality(flags) > 0
  AND at > now() - interval '24 hours'
ORDER BY at DESC;
```

### D5. AI provider failing (Medium)

Claude is erroring, so answers are coming from the fallback (F11). Each failed Claude attempt writes an `error` row before the fallback answers.

```sql
SELECT count(*) AS claude_errors, max(at) AS last_error
FROM query_audit
WHERE outcome = 'error' AND model = 'claude-opus-5-5'
  AND at > now() - interval '15 minutes'
HAVING count(*) >= 3;
```

### D6. Error spike (Medium)

Many errors of any kind in five minutes.

```sql
SELECT reason, count(*) AS errors
FROM query_audit
WHERE outcome = 'error' AND at > now() - interval '5 minutes'
GROUP BY reason
HAVING count(*) >= 5;
```

### D7. Answer wider than the role allows (Critical, should never fire)

A non-analyst got an answer covering more than one region. Scope checks should make this impossible, so any row is an incident.

```sql
SELECT at, user_id, role, regions, metric_id, request_id
FROM query_audit
WHERE outcome IN ('answered', 'explanation') AND role <> 'analyst' AND cardinality(regions) > 1;
```

D4 and D7 include `explanation` rows since Oct 31 (PR #50 review); `tests/discrepancy-explanation.test.ts` runs D4 from this file.

Checked Oct 17: every query in this file ran against the demo database after simulated attacks. D1, D2, D3, D4 and the shared-question hunt fired as expected; D7 returned nothing.

### D8. Password guessing (High)

Many failed sign-ins in ten minutes, across any usernames (the username itself is only a keyed hash).

```sql
SELECT count(*) AS failed, count(DISTINCT question_sha256) AS usernames, max(at) AS last_seen
FROM query_audit
WHERE source = 'auth' AND outcome IN ('login_failed', 'signup_failed') AND at > now() - interval '10 minutes'
HAVING count(*) >= 20;
```

## Hunting queries

Run these by hand, for example once a day during the demo period.

The same question from several people (a shared attack script, or a common question worth adding to the golden set):

```sql
SELECT question_sha256, count(DISTINCT user_id) AS people, count(*) AS times, array_agg(DISTINCT outcome) AS outcomes
FROM query_audit
WHERE question_sha256 IS NOT NULL AND at > now() - interval '7 days'
GROUP BY question_sha256
HAVING count(DISTINCT user_id) >= 3
ORDER BY people DESC;
```

People whose questions are flagged unusually often:

```sql
SELECT user_id, role, count(*) AS questions,
       count(*) FILTER (WHERE cardinality(flags) > 0) AS flagged,
       round(100.0 * count(*) FILTER (WHERE cardinality(flags) > 0) / count(*), 1) AS flagged_pct
FROM query_audit
WHERE source = 'question' AND at > now() - interval '7 days'
GROUP BY user_id, role
HAVING count(*) >= 5
ORDER BY flagged_pct DESC;
```

Daily trend by outcome:

```sql
SELECT date_trunc('day', at) AS day, outcome, count(*) AS n
FROM query_audit
WHERE at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

## Triage

When a rule fires:

1. **Pull the conversation:** every row for that `user_id` around the time, ordered by `at`, with `request_id` and `turn`.
2. **Check scope:** compare `role` and `regions` on answered rows. If any answer is outside the person's scope (D7), treat it as Critical and stop the demo deployment.
3. **Classify:** a real attempt, a confused user, or a false positive (see the false-positive rate in `docs/RED-TEAM.md`).
4. **Contain if needed:** end the person's sessions by deleting their rows in `app_sessions`. The ten-minute lock in `session_guard` already pauses questions.
5. **Record:** add the case to the findings table in `docs/RED-TEAM.md` with a severity. If it's a new technique, add a matrix row and a regression test.
6. **Measure:** note when the rule fired and when someone looked, to report time to respond.

Who triages: _[name]_. Escalation for anything Critical: _[name]_ the same day, and Alex in the next weekly update.

## Gaps before this is a real monitoring setup

- Nothing runs D1–D8 on a schedule yet; only individual flags and locks reach the security channel.
- There's no read-only login for a monitoring tool; the audit login can only write.
- No export to a SIEM. Retention is handled by `npm run purge` (see `docs/SYSTEM-CARD.md`).

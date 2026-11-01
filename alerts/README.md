# Actionable Alerts

Team ALTO PALS capstone for Palo Alto Networks Customer Analytics (Pursuit L3, Demo Day 11/9/2026). Part 2 of the PRD (L1–L6): private, rule-based alerts that sit beside the [governed analytics copilot](../README.md).

**No real customer or Palo Alto Networks data.** Accounts, deals and sales reps come from the public-domain [Maven Analytics CRM Sales Opportunities](https://mavenanalytics.io/data-playground/crm-sales-opportunities) sample (a fictional company). Support cases, engagements, contacts, quotas and product usage are synthetic. The data loader is the same as the copilot's, so both apps see the same snapshot. The alerts app only has the Maven dataset: if `DATASET_DIR` points at another dataset, it refuses to start rather than alert on different accounts than the copilot shows.


**Sign-in (Week 5).** People create an account with an invite code, the same codes as the copilot (same `DEMO_INVITE_SECRET`; run `npm run invites` in the copilot). The code decides which demo person the account is, and the inbox and alert settings read that person only from the session, never from the form or URL. Accounts and sessions are separate from the copilot's. With nobody signed in, `ALLOW_TEST_IDENTITIES=true` still shows the test identity switch for local testing.
## Run it

Requires Node 22.12 or newer (CI uses Node 24). No Docker needed: an embedded Postgres (PGlite) is loaded on start.

```bash
npm install
npm test          # rule catalog, routing, dedupe, preferences, send-time checks, Slack and email adapters
npm run build
npm start         # http://localhost:3000
```

The page evaluates the rules once at start, as of Oct 8, 2026 15:00 UTC, for events since Sep 1. Switch identity to compare inboxes.

## How it works

```
event (support case, engagement)
  -> rule catalog (rules/*.json, versioned, Zod-validated)
  -> subscribers of that rule whose role is in the rule's audience
  -> private routing: only users on the account's team (account_team, read from the database)
  -> one alert per (rule, user, event), enforced by a unique index
  -> preferences: right away, daily digest, quiet hours, P1 bypass
  -> access checked again immediately before delivery
  -> channel: in-app inbox, that user's own Slack webhook, that user's own email, or both
```

Before each channel call the sender re-checks, fresh from the database, that the user still has a role in the rule's audience, is still subscribed, can still see the account, is not disabled, and (when `EMPLOYEE_STATUS` is set) is an active employee; anything else is suppressed. A directory that cannot answer (an outage) is treated differently from "inactive": the alert waits and is retried, without using up an attempt, instead of being dropped for good. Each alert is claimed with a unique token before sending, and only the holder of that token can record the result, so a slow sender whose claim was taken over can't overwrite it. Failed alerts are retried on later flushes with backoff (2^attempts minutes, at most 5 channel attempts), without needing the original event again. After the last attempt the alert is marked `undelivered` and one line goes to the server log for the operator (ids only), so nothing is dropped silently (evaluator F-05, #83). Slack calls and email posts time out after 10 seconds. Delivery is at-least-once.

The inbox follows current access: an alert about an account the user can no longer see leaves the inbox (to confirm with the client; a Slack message already sent can't be recalled). Only delivered alerts are readable in the inbox. Alerts that are held for a digest, blocked by the access check or failed show up only as counts, with no account or case details. An alert whose send failed, or was cut off mid-send, is retried on the next run until its attempts run out; delivered, queued, blocked and `undelivered` alerts are not resent.

| PRD | Where |
|---|---|
| L1 versioned alert-rule catalog | `rules/*.json`, `src/alerts/rules.ts` |
| L2 starting triggers | `high_severity_case` (technical sellers), `cxo_engagement` (sales reps), `low_usage` (technical sellers and sales reps on the account team: usage under 20% of what was bought, six months after purchase; the usage data is synthetic, `src/db/product-usage.ts`, `src/alerts/low-usage.ts`). CSM triggers are stretch and not built. |
| L3 preferences | `alert_subscriptions`: frequency, quiet hours (UTC), P1 bypass, channel |
| L4 private routing, send-time check | `canSeeAccount()` in `src/alerts/engine.ts`, called at creation and again in `send()` |
| L5 channels | `src/alerts/channels.ts`: in-app inbox; Slack per-user webhooks and per-user email, or both ("Slack and email", delivered only when both accept); no shared fallback |
| L6 explanation and copilot link | `explain` template per rule; link opens the copilot with that rule's fixed question. Identity comes from the copilot's own sign-in; in test mode only, the test identity is carried along |

Templates only accept the placeholders their event type provides, and case statuses must be a known value. Event text is inserted as plain text, so a case subject can't inject template variables, and it is made safe for Slack and email: angle-bracket links and mentions are escaped, and bare URLs and domain names are defanged (`https[:]//evil[.]example`), so a case subject is readable but never clickable. Only the "Ask the copilot" link is a real link. The seller still reads the text, so a real alert never asks for a password.

Migrations in `alerts/drizzle/` start at this release's baseline (the alerts service has not been deployed with a persistent database yet). From here on they are append-only: new numbered files, never edits.

## Configuration

| Variable | Purpose |
|---|---|
| `COPILOT_URL` | Base URL for "Ask the copilot" links (default `http://localhost:3000`). Links open the copilot with a fixed prompt id (`?prompt=high_severity_case`) that the copilot maps to a known question. |
| `SLACK_USER_WEBHOOKS` | JSON map of user id to that user's own `https://hooks.slack.com/...` webhook. Never commit real values. |
| `EMAIL_USER_ADDRESSES` | JSON map of user id to that user's own email address. Never commit real inboxes. |
| `EMAIL_WEBHOOK_URL` | HTTPS endpoint that receives `{ to, subject, text, html }`. Its host must be listed in `EMAIL_WEBHOOK_HOSTS` (comma-separated), and redirects are never followed, so alert text can't be sent to an unlisted host (#65). `http://127.0.0.1` / `localhost` is allowed only with `npm run dev`. No shared team inbox, and no API key is sent: a real mail provider would need one. |
| `EMPLOYEE_STATUS` | JSON map of user id to `"active"` (or `"inactive"`). Unset: the check is off. Set: only people whose status is exactly `active` get alerts and can sign in, so an unlisted person, a typo or a malformed value gets neither. A queued digest or retry is dropped as `suppressed_inactive` once someone leaves, and a live session ends (client ask, Oct 23). Demo values are synthetic; a real rollout reads Active Directory or HR behind the `EmployeeDirectory` interface in `src/alerts/employee-status.ts`, which answers `active`, `inactive` or `unknown`. In the Docker stack the variable is passed through `docker-compose.yml`. |

## Schedule, preferences and persistence (Week 4)

- **Frequencies:** right away, daily, weekly (Mondays) or monthly (the 1st), at 13:00 UTC. A digest goes out once per slot; retries of failed alerts follow their own backoff, not the slot.
- **Preferences:** each person subscribes on the page to the rules meant for their role and sets frequency, channel, quiet hours and the P1 bypass. Changes apply to new alerts; alerts already waiting keep their channel.
- **Scheduler:** with `ALERTS_SCHEDULER=true`, it starts when the server starts (`instrumentation.ts`), with no page visit needed. A tick every `ALERTS_TICK_SECONDS` (default 60) evaluates events since the stored cursor, looking `ALERTS_LATE_WINDOW_HOURS` (default 72) further back for events imported late, then flushes due digests and retries. Deduplication means nothing is alerted twice. After a person's first digest, a digest carries only alerts queued before its slot, so an alert created after an empty Monday slot waits for the next Monday. Demo subscriptions are seeded once per database, so an unsubscribe survives a restart. Without the scheduler, the demo runs one tick as of Oct 8, 2026 15:00 UTC.
- **Persistent Postgres:** set `MIGRATION_DATABASE_URL` and `ALERTS_DATABASE_URL` (see `.env.example` and `../docker/init-roles.sql`). The `alerts_app` login reads the CRM and event tables, inserts and updates its own state, and may delete only a subscription; the CI job `alerts-postgres` proves it cannot delete alerts, change CRM data or the schema.

## Not done yet

- Per-user time zones for quiet hours and digests (UTC for now), and the CSM stretch triggers (low usage, large deal closed).
- Multiple scheduler instances: ticks are safe to overlap (alerts are claimed before sending), but the cursor assumes one scheduler.
- Shared package for the data loader instead of a copy of the copilot's.

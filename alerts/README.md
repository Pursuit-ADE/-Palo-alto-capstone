# Actionable Alerts

Team ALTO PALS capstone for Palo Alto Networks Customer Analytics (Pursuit L3, Demo Day 11/9/2026). Part 2 of the PRD (L1–L6): private, rule-based alerts that sit beside the [governed analytics copilot](../README.md).

**No real customer or Palo Alto Networks data.** Accounts, deals and sales reps come from the public-domain [Maven Analytics CRM Sales Opportunities](https://mavenanalytics.io/data-playground/crm-sales-opportunities) sample (a fictional company). Support cases, engagements, contacts and quotas are synthetic. The data loader is the same as the copilot's, so both apps see the same snapshot.

## Run it

Requires Node 20+. No Docker needed: an embedded Postgres (PGlite) is loaded on start.

```bash
npm install
npm test          # rule catalog, routing, dedupe, preferences, send-time checks, Slack adapter
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
  -> channel: in-app inbox, or that user's own Slack webhook
```

Before each channel call the sender re-checks, fresh from the database, that the user still has a role in the rule's audience, is still subscribed, and can still see the account; anything else is suppressed. Each alert is claimed with a unique token before sending, and only the holder of that token can record the result, so a slow sender whose claim was taken over can't overwrite it. Failed alerts are retried on later flushes with backoff (2^attempts minutes, at most 5 attempts), without needing the original event again. Slack calls time out after 10 seconds. Delivery is at-least-once.

The inbox follows current access: an alert about an account the user can no longer see leaves the inbox (to confirm with the client; a Slack message already sent can't be recalled). Only delivered alerts are readable in the inbox. Alerts that are held for a digest, blocked by the access check or failed show up only as counts, with no account or case details. An alert whose send failed, or was cut off mid-send, is retried on the next run; delivered, queued and blocked alerts are not resent.

| PRD | Where |
|---|---|
| L1 versioned alert-rule catalog | `rules/*.json`, `src/alerts/rules.ts` |
| L2 starting triggers | `high_severity_case` (technical sellers), `cxo_engagement` (sales reps). CSM triggers are stretch and not built. |
| L3 preferences | `alert_subscriptions`: frequency, quiet hours (UTC), P1 bypass, channel |
| L4 private routing, send-time check | `canSeeAccount()` in `src/alerts/engine.ts`, called at creation and again in `send()` |
| L5 channels | `src/alerts/channels.ts`: in-app inbox; Slack per-user webhooks with no shared fallback |
| L6 explanation and copilot link | `explain` template per rule; link opens the copilot with that rule's fixed question. Identity comes from the copilot's own sign-in; in test mode only, the test identity is carried along |

Templates only accept the placeholders their event type provides, and case statuses must be a known value. Event text is inserted as plain text, so a case subject can't inject template variables, and it is escaped for Slack, so it can't become a link or a mention.

Migrations in `alerts/drizzle/` start at this release's baseline (the alerts service has not been deployed with a persistent database yet). From here on they are append-only: new numbered files, never edits.

## Configuration

| Variable | Purpose |
|---|---|
| `COPILOT_URL` | Base URL for "Ask the copilot" links (default `http://localhost:3000`). Links open the copilot with a fixed prompt id (`?prompt=high_severity_case`) that the copilot maps to a known question. |
| `SLACK_USER_WEBHOOKS` | JSON map of user id to that user's own `https://hooks.slack.com/...` webhook. Never commit real values. |

## Not done yet

- Real scheduler (pg-boss) for continuous evaluation and timed digests, on a persistent Postgres so delivery state survives restarts. Today the service runs once at start on an in-memory database and does not read `DATABASE_URL`.
- User-editable preferences UI; demo subscriptions live in `src/alerts/demo.ts`.
- Per-user time zones for quiet hours (UTC for now), email channel, CSM triggers.
- Shared package for the data loader instead of a copy of the copilot's.

# Runbook

How to run the copilot and the alerts app, and what to do when something goes wrong. For what the system is, read the [walkthrough](WALKTHROUGH.md); for definitions, the [data dictionary](DATA-DICTIONARY.md); for security, [SECURITY.md](../SECURITY.md).

## Run the demo on a laptop

Needs Node 22.12 or newer (CI uses Node 24). No Docker.

```bash
npm ci
npm run build
```

Create `.env.local` in the repository root:

```
DEMO_INVITE_SECRET=<a long random value>
ALLOW_EMBEDDED_DB=true
```

Then:

```bash
npm run invites   # one invite code per demo person
npm start         # http://localhost:3000
```

Open the app, choose **Create one with an invite code**, and use the code for the person you want to be (Jordan Lee is the East technical seller). The code decides the person and role.

For the alerts app, put the same two lines in `alerts/.env.local`, then in `alerts/`: `npm ci`, `npm run build`, `npm start -- -p 3001`. The same invite codes work there; accounts are separate per app. Set `COPILOT_URL=http://localhost:3000` so "Ask the copilot" links open the copilot.

## Run on Postgres

```bash
docker compose up -d
```

Set the database URLs from `.env.example` (copilot: `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `AUDIT_DATABASE_URL`; alerts: `MIGRATION_DATABASE_URL`, `ALERTS_DATABASE_URL`) and leave `ALLOW_EMBEDDED_DB` unset. The app migrates and loads data as the owner login and runs as the restricted logins. Data lives in the `pgdata` volume: `docker compose down` keeps it, `docker compose down -v` deletes it.

## Settings

| Setting | App | What it does |
|---|---|---|
| `DEMO_INVITE_SECRET` | both | Turns on sign-up with invite codes. Same value in both apps. |
| `ALLOW_EMBEDDED_DB` | both | Lets a production server (`npm start`) use the in-memory database. Laptop demos only. |
| `ALLOW_TEST_IDENTITIES` | both | Local testing with `npm run dev` only: shows the "Viewing as" switch when nobody is signed in. `npm start` refuses to start with it on. |
| `AUDIT_HASH_KEY` | copilot | Key for the audit log's question fingerprints and the per-address sign-in limit. Required with `npm start` in Postgres mode (`openssl rand -hex 32`). |
| `INTENT_MODEL`, `ANTHROPIC_API_KEY` | copilot | `INTENT_MODEL=claude` uses Claude to read questions; otherwise the deterministic model. |
| `DATASET_DIR` | copilot | A confirmed second dataset (see [ONBOARDING.md](ONBOARDING.md)). The alerts app refuses anything but Maven. |
| `ALERTS_SCHEDULER`, `ALERTS_TICK_SECONDS`, `ALERTS_LATE_WINDOW_HOURS` | alerts | Background evaluation every N seconds, looking back N hours for late events. |
| `SLACK_USER_WEBHOOKS` | alerts | JSON map of user id to that person's own `https://hooks.slack.com/services/...` webhook. |
| `ENABLE_HSTS`, `COOKIE_SECURE` | both | On by default with `npm start`, read when the server starts (no rebuild needed). Set `COOKIE_SECURE=false` only for a plain-http demo in a browser that drops Secure cookies on localhost. |
| `TRUSTED_PROXY_HOPS` | both | Proxies in front of the app that append to `X-Forwarded-For` (1 for one load balancer). Unset: the header is ignored and all sign-in attempts share one limit of 100 a minute. |
| `SECURITY_SLACK_WEBHOOK_URL` | copilot | Optional Slack incoming webhook for the security channel: one message per flagged question (at most one a minute per person) and one when a session lock starts. |

## Common problems

| What you see | Why | Fix |
|---|---|---|
| Server stops with "Production needs Postgres mode" | `npm start` refuses the in-memory database by default | Laptop demo: `ALLOW_EMBEDDED_DB=true`. Shared use: set the Postgres URLs. |
| Server stops with "Production needs AUDIT_HASH_KEY" | `npm start` in Postgres mode needs a fixed audit key | Set `AUDIT_HASH_KEY` to the output of `openssl rand -hex 32`, the same value on every server. |
| "Sign-up is turned off here" | No invite secret | Set `DEMO_INVITE_SECRET` and restart. |
| "That invite code is not valid" | The codes were printed with a different secret than the server has | Run `npm run invites` with the same `DEMO_INVITE_SECRET` the server uses. |
| "The username or password is not right" | Wrong password, or the account was made in the other app | Accounts are per app; create one in each with the same invite code. |
| "Too many attempts" | 10 sign-in tries a minute per username | Wait a minute. |
| A question is refused as locked | Three flagged questions in 10 minutes | Wait 10 minutes. This is the session lock working. |
| "Dataset ... is not confirmed" | `DATASET_DIR` points at a folder nobody approved | `npm run onboard:propose` then `npm run onboard:confirm` (see ONBOARDING.md), or unset `DATASET_DIR`. |
| "This database already holds ... but the app was started for ..." | The Postgres database has another dataset | Start with the matching `DATASET_DIR`, or use a fresh database for the other one. Don't delete the old one without asking. |
| Alerts app stops with "only supports the Maven dataset" | `DATASET_DIR` is set for alerts | Unset it for the alerts app. |
| No alerts arrive in scheduler mode | Scheduler off, or the database was down at start | Set `ALERTS_SCHEDULER=true`. If the log says "alerts start-up failed; retrying", it retries on its own once the database is back. |
| Slack messages don't arrive | No webhook for that person, or not a Slack webhook URL | Add the person to `SLACK_USER_WEBHOOKS` with a `hooks.slack.com/services` URL and choose Slack in their settings. Failed sends retry with backoff, up to 5 times. |
| Coverage shows "n/a" | No quota for that period or region | Expected: coverage with no quota is not available, never zero. |
| A question gets "I can't filter ... by ..." | The question filters by something the registry can't express (deal size, product, account, an unknown name, a breakdown the metric doesn't have) | Ask by region, stage, owner or quarter. This prevents a quietly wrong number. |
| `npm start` fails with an engine or syntax error | Node older than 22.12 | Install Node 22.12+ (24 recommended). |
| Tests time out or crash on Windows | Threaded WebAssembly in the test runner | `npx vitest run --pool=forks --maxWorkers=1`. |
| The data dictionary test fails | The registry changed but the page wasn't regenerated | `npm run docs:dictionary` and commit the page. |

## Checks before a demo

```bash
npm test
npm run eval:golden                            # 66 phrasings, deterministic model
INTENT_MODEL=claude npm run eval:golden        # only with an Anthropic key; report the score first
```

CI runs the tests, a build, dependency and secret scans, CodeQL, the Postgres login tests, and a fresh-install check that starts both apps and loads their sign-in pages.

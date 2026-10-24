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
AUDIT_HASH_KEY=<a different long random value, 32+ characters>
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

Set the database URLs from `.env.example` and leave `ALLOW_EMBEDDED_DB` unset:

- **Setup, once per deploy and after new migrations:** `MIGRATION_DATABASE_URL=… npm run db:setup` (in each app). It migrates, loads data and applies grants as the owner login.
- **Running server:** copilot `DATABASE_URL`, `AUDIT_DATABASE_URL`, `AUTH_DATABASE_URL`; alerts `ALERTS_DATABASE_URL`. Leave `MIGRATION_DATABASE_URL` out of a deployed server's environment, so a leak can't hand over the database. (If it's set, start-up runs the same setup, which is handy on a laptop.)

**Any shared deployment should sit behind a proxy (a load balancer or reverse proxy) with `TRUSTED_PROXY_HOPS` set** to the number of proxies. Without it the apps can't trust `X-Forwarded-For`, so every caller shares one sign-in bucket of 100 attempts a minute, and one person sending wrong passwords can make sign-in say "too many attempts" for everyone.

## Run everything in containers (server test)

The same compose file can run both apps as production servers, the way a real server would:

```bash
printf 'AUDIT_HASH_KEY=%s\nDEMO_INVITE_SECRET=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 24)" > .env
docker compose --profile app up -d --build --wait
docker compose run --rm copilot-setup npx tsx scripts/invites.ts   # invite codes for this DEMO_INVITE_SECRET
```

For email alerts, also put `EMAIL_USER_ADDRESSES` and an HTTPS `EMAIL_WEBHOOK_URL` in `.env`: this stack runs in production mode, which refuses a localhost mail catcher.

To show the employee-status check (alerts go only to active employees, and a person marked inactive can't sign in to alerts), put `EMPLOYEE_STATUS` in `.env`, for example `EMPLOYEE_STATUS={"u_ts_east":"active","u_ts_west":"inactive","u_darcel_schlecht":"active","u_mgr_melvin_marxen":"active","u_analyst":"active"}`. The values are synthetic. Left empty, the check is off. Anyone not listed counts as inactive, so list every demo person you want to keep.

This starts Postgres, runs `copilot-setup` and `alerts-setup` once as the owner login, and then starts the copilot on http://localhost:3000 and alerts on http://localhost:3001. The two servers only get their least-privilege logins. Both listen on 127.0.0.1 only and use plain http, so cookies are not `Secure` here. Behind a real HTTPS proxy, set `COOKIE_SECURE=true`, `ENABLE_HSTS=true` and `TRUSTED_PROXY_HOPS=1` in `.env`. The `docker` workflow in CI runs this same stack on every pull request. `docker compose --profile app down` stops it.

Data lives in the `pgdata` volume: `docker compose down` keeps it, `docker compose down -v` deletes it. A volume created before Oct 18 lacks the `app_auth` login: recreate it, or run the `CREATE ROLE app_auth` lines from `docker/init-roles.sql`.

## Data retention

`npm run purge` (each app, owner login; `-- --dry-run` to count only), run daily, deletes expired sessions and idle rate-limit rows, audit rows older than `AUDIT_RETENTION_DAYS` (90), and finished alerts older than `DELIVERY_RETENTION_DAYS` (180). Day counts below 1 are refused.

## Settings

| Setting | App | What it does |
|---|---|---|
| `DEMO_INVITE_SECRET` | both | Turns on sign-up with invite codes. Same value in both apps. Each code creates one account per app. |
| `DEMO_INVITE_EXPIRES` | both | Optional date after which invite codes stop working. |
| `ALLOW_EMBEDDED_DB` | both | Lets a production server (`npm start`) use the in-memory database. Laptop demos only. |
| `ALLOW_TEST_IDENTITIES` | both | Local testing with `npm run dev` only: shows the "Viewing as" switch when nobody is signed in. `npm start` refuses to start with it on. |
| `AUDIT_HASH_KEY` | copilot | Key for the audit log's question fingerprints and the per-address sign-in limit. Required (32+ characters) for `npm start` (`openssl rand -hex 32`). |
| `INTENT_MODEL`, `ANTHROPIC_API_KEY` | copilot | `INTENT_MODEL=claude` uses Claude to read questions; otherwise the deterministic model. |
| `CLAUDE_TIMEOUT_MS` | copilot | How long a question waits for Claude before the deterministic model answers (default 8000, 1000-60000). |
| `AUTH_DATABASE_URL` | copilot | Postgres mode: the `app_auth` login for accounts and sessions. |
| `AUDIT_RETENTION_DAYS`, `DELIVERY_RETENTION_DAYS` | copilot, alerts | Retention used by `npm run purge` (defaults 90 and 180). |
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
| "Sign-up is turned off here" | No invite secret, or an unreadable `DEMO_INVITE_EXPIRES` | Set `DEMO_INVITE_SECRET` (and a date such as 2026-11-10) and restart. |
| "That invite code has already been used" | Each code makes one account per app | Log in with that account. To start over, disable it (`npm run accounts -- disable <username>`) or, on the laptop demo, restart the server. |
| "Refusing to start in production" | A required setting is missing or too short | Set what the message lists, usually `AUDIT_HASH_KEY`. |
| Someone should lose access now | Left the team, or a password leaked | `npm run accounts -- disable <username>` (add `--app alerts` for the alerts app). It also signs them out everywhere. |
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
| A question asks which comparison, or says it doesn't know a name | The deal size has no over/under/between, or the product, account, sector or person is not in the data. A sector name without "sector", "industry", or "vertical" is asked about. Coverage also can't be filtered by deal size, product, account or sector, because quota isn't split that way | Name a value that is in the data, or ask for open pipeline. A manager doesn't own deals unless the question names their team; otherwise break the number down by owner. |
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

# Governed Analytics Copilot

[![CI](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/ci.yml/badge.svg)](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/ci.yml) [![Alerts CI](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/alerts-ci.yml/badge.svg)](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/alerts-ci.yml) [![CodeQL](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/codeql.yml/badge.svg)](https://github.com/Pursuit-ADE/-Palo-alto-capstone/actions/workflows/codeql.yml)

Team ALTO PALS capstone for Palo Alto Networks Customer Analytics (Pursuit L3, Demo Day 11/9/2026).

A governed AI analytics copilot that sits next to certified dashboards. The AI only picks a registry metric and filters; it never writes SQL or math. Role-based access is enforced below the AI, and every answer states its scope and the data snapshot it came from. Private, rule-based alerts are in `alerts/` (since Week 2); Week 4 adds the scheduler, editable preferences and weekly or monthly digests.

**No real customer or Palo Alto Networks data.** Sales data is the public-domain [Maven Analytics CRM Sales Opportunities](https://mavenanalytics.io/data-playground/crm-sales-opportunities) sample (a fictional company); quotas, contacts, support cases and engagements are synthetic.

New to the project? Start with the [walkthrough](docs/WALKTHROUGH.md). To run it or fix something, see the [runbook](docs/RUNBOOK.md); every metric, rule and field is in the [data dictionary](docs/DATA-DICTIONARY.md). Reviewing it for security or AI risk? Start with the [system card](docs/SYSTEM-CARD.md), then the [red-team results](docs/RED-TEAM.md) and [detections](docs/DETECTIONS.md).

## Run it

Requires Node 22.12 or newer (CI uses Node 24). No Docker needed: the app and tests use an embedded Postgres (PGlite) loaded on start from `data/maven-crm/` plus deterministic synthetic tables.

```bash
npm install
npm test          # registry, golden phrases, seed, governed-query, audit and limit tests
npm run build
npm start         # http://localhost:3000
```

**Demo sign-in (Week 5).** People create an account with an invite code, and the code decides which demo person, and so which role and data, the account gets. The user id then comes only from the session cookie, never from a form, URL or alert link. To turn it on, put a long random `DEMO_INVITE_SECRET` in `.env.local`, run `npm run invites` to print one code per demo person, and share each code only with the person who should use it. On a laptop with the embedded database, also set `ALLOW_EMBEDDED_DB=true` (production refuses it otherwise). The client asked for Active Directory and SSO in a real rollout; this sign-up is for the demo.

For quick local testing without accounts, `ALLOW_TEST_IDENTITIES=true` with `npm run dev` still shows the "Viewing as" switch when nobody is signed in. A production server (`npm start`) refuses to start with it on.

**Postgres mode (least privilege):** `docker compose up -d`, then set the three database URLs from `.env.example`. The app migrates and loads data as the owner, answers questions as `app_readonly` (SELECT only, read-only transactions, 5 s statement timeout) and writes the audit log as `app_audit` (INSERT on `query_audit` only).

Pick a mock identity and ask, for example, "coverage by region for this quarter". An East seller only sees East; asking for West is refused. Open pipeline and open opportunity count can also be filtered by deal size, product, account, sector, or the sales rep who owns the deal. A sector counts when the question says sector, industry, or vertical beside the name. A manager named with their team means that manager's reps. Pipeline coverage can be filtered by that rep or team. A filter quota is not split by, or a name that is not in the data, gets a clarifying question instead of a number for the whole scope.

## How it works

```
phrase -> intent normalizer -> Intent (metric + filters, Zod-validated)
       -> scope from the database (role, region, account team)
       -> compiler (allowlisted tables/columns, bound parameters)
       -> result + scope statement + provenance (metric version, snapshot, result hash)
```

| Path | What it is |
|---|---|
| `registry/metrics/*.json` | The 3 governed metrics (open pipeline, pipeline coverage, open opportunity count) with synonyms |
| `registry/dictionary.json`, `registry/glossary.json` | Context layer v1: field dictionary, glossary, period and breakdown phrases, ambiguous terms |
| `registry/golden/phrases.json` | Golden phrasing set: at least 5 phrasings per metric, plus clarification cases |
| `registry/golden/metamorphic.json` | Semantic invariance cases (`tests/semantic-invariance.test.ts`): equivalent wordings must give the same request and result, a change of meaning must change it, and a valid but wrong metric counts as a failure |
| `data/maven-crm/` | The public CRM sample (accounts, opportunities, sales teams, products) |
| `src/db/schema.ts`, `src/db/seed.ts` | Data model and loader: sample data, date shift, estimates for open deals, synthetic quotas, contacts, cases and engagements |
| `src/semantic/` | Normalizer (golden-set mock of the AI model), validation, scope and SQL compiler |
| `drizzle/` | Migrations, append-only: `0000_init` is the baseline on main, later changes are new numbered files. Never edit an applied migration; `tests/migrations.test.ts` upgrades a baseline database to the current schema |
| `.github/workflows/` | CI: typecheck, tests, dependency audit, secret scan (gitleaks), static analysis (CodeQL) |

Registry changes go through pull requests (reviewed, version-controlled); there is no runtime editing.

## Decisions

- **Own registry over Cube** (Oct 9): simpler for 3 metrics on one database; revisit if the catalog grows past 15 to 20 metrics.
- **Fiscal quarters**: Palo Alto Networks' fiscal year starts Aug 1, so FY27-Q1 = Aug 1 to Oct 31, 2026 (assumption).
- **Scope**: sales reps see their own deals; managers and the technical seller who supports a team see that team; the analyst sees everything. Coverage uses the same people's quotas.

## Week 3: conversation, charts and red-team

- **Follow-up questions (A5):** the copilot keeps a chat. The only conversation state is the previous answer's structured intent, which the server re-validates and re-scopes every turn. "What about West?", "by stage" and "and next quarter?" build on the previous question; a 10-turn test proves the numbers match asking each question fresh.
- **Intent model:** `src/semantic/model.ts`. The deterministic golden-set model is the default and runs in CI. Set `INTENT_MODEL=claude` (with Anthropic credentials) to use Claude with structured output; it sees only the metric catalog, the question and the previous intent, never rows or entitlements, and its output passes the same schema, registry and scope checks. If the model is unavailable, the app falls back to the deterministic model. The client allows any AI provider (Oct 15); Claude is the one we evaluate.
- **Charts and narrative (A6):** a plain-language summary and a bar chart (with a Vega-Lite spec) are built from the governed rows, never written by a model.
- **Red-team suite (S1, S2, S6):** `tests/conversation-and-redteam.test.ts` covers instruction overrides, fake authority, emotional pressure, a role claimed mid-chat, gradual scope escalation over a conversation, SQL and links in questions, a tampered conversation state, and a compromised model proposing out-of-scope or malformed intents. Suspicious questions are flagged in the audit log with reason codes (S3); flags never change scope. After 3 flagged questions in 10 minutes, a user is locked out of asking for 10 minutes. `npm run eval:golden` checks the configured intent model against the golden set.

## Week 4: alerts finished and red-team completed

- **Alerts (`alerts/`):** weekly and monthly digests on a real schedule (Mondays and the 1st, 13:00 UTC) alongside right-away and daily; a preferences screen where each person subscribes and sets frequency, channel, quiet hours and the P1 bypass; a scheduler (`ALERTS_SCHEDULER=true`) that only checks new events and resumes from a stored cursor; and a persistent Postgres mode with a least-privilege `alerts_app` login, tested in CI. See `alerts/README.md`.
- **Red-team suite completed (S1, S2, S6):** `tests/redteam-matrix.test.ts` runs one row per PRD scenario and checks both the answer and the audit row. Questions containing a link are now blocked and logged (`refused_injection`), not just flagged. The matrix in plain language is in `docs/RED-TEAM.md`.

## Week 5: dataset onboarding (A7) and demo sign-in

- **Dataset onboarding (A7):** `src/onboard/*` and `scripts/onboard-dataset.ts` profile a second CRM folder (`data/northstar-crm/`), propose only the three existing governed metrics from `registry/metrics/*.json`, require human confirmation (`npm run onboard:confirm -- --by "<name>"`), and make the dataset queryable (`DATASET_DIR=data/northstar-crm`) without inventing metrics or SQL. See [`docs/ONBOARDING.md`](docs/ONBOARDING.md).
- **Demo sign-in:** Invite-code account creation (`npm run invites`), scrypt password hashing, and server-side session cookies (`src/server/auth.ts`, `src/server/session.ts`), with Active Directory / SSO documented for production rollout.

## Security controls

| Control | Where | Proof |
|---|---|---|
| Scope comes from the database, never the question; out-of-scope regions refused | `src/semantic/scope.ts` | `tests/governed-query.test.ts` |
| SQL from allowlisted names only, values as bound parameters, grouped results capped at 500 rows | `src/semantic/compile.ts` | injection test in `tests/governed-query.test.ts` |
| Unknown users and unrecognized roles fail closed | `resolvePrincipal()` | `tests/audit-and-limits.test.ts` |
| Audit row for every question and dashboard query, including refusals; question stored as a hash; no answer if the audit write fails | `src/semantic/answer.ts`, `query_audit` | `tests/audit-and-limits.test.ts` |
| Read-only app role, insert-only audit role, statement timeout | `src/db/client.ts`, `docker/init-roles.sql` | `tests/postgres-roles.test.ts` (CI job `postgres-roles`) |
| Question length limit and per-user rate limit (20 per minute) | `src/semantic/answer.ts`, `src/server/limits.ts` | `tests/audit-and-limits.test.ts` |
| Intent arrays bounded (3 regions, 10 stages, 2 unique breakdowns) | `src/registry/types.ts` | `tests/governed-query.test.ts` |
| Questions sent by POST (Server Action), never in the URL | `app/actions.ts`, `app/ask-panel.tsx` | |
| Security headers and a per-request nonce Content Security Policy | `next.config.ts`, `proxy.ts` | |
| Test identities off unless explicitly enabled | `src/server/identity.ts` | `tests/audit-and-limits.test.ts` |
| Reviewed changes to metrics, rules, query code and CI | `.github/CODEOWNERS` (enable "Require review from Code Owners" on main) | |
| Dependency audit, secret scan (gitleaks, full history), CodeQL | `.github/workflows/` | every push |

## Not done yet (by roadmap week)

- Company sign-in (Active Directory and SSO through OIDC) instead of demo accounts; the session code is the place it plugs in.
- A gateway rate limit in front of more than one server. The app's own counters live in `session_guard` and are shared by processes that use the same Postgres database. PGlite still resets them on restart.
- Claude golden-set evaluation in CI: CI runs the deterministic model. Run `INTENT_MODEL=claude npm run eval:golden` with Anthropic credentials to check Claude against the golden set before relying on it; a valid, in-scope but wrong metric from the model would otherwise still be answered. The client allows any AI provider (Oct 15), so Claude is the one we test.
- Low-usage alert for CSMs (stretch): the client chose the definition on Oct 15, usage below 20% of what the customer bought, six months after purchase. Not built yet: it needs product-usage data, which the sample doesn't have.
- Alerts (in `alerts/`): per-user time zones, the CSM triggers, letting people edit trigger conditions, and running more than one scheduler at once.
- Running on Postgres by default: `npm start` still uses the embedded database, and Postgres mode needs the database URLs (see the runbook).
- The test identity picker is not authentication.

## Project documents

- [PRD v1 (PDF)](docs/product/ALTO-PALS_PRD_v1.docx.pdf)
- [Roadmap v1 (PDF)](docs/product/ALTO-PALS_Roadmap_v1.docx.pdf)

## Branches and releases

Each week of the build has its own branch: `week1` (the copilot) and `week2` (adds the actionable alerts service in [`alerts/`](alerts/README.md)), and so on. Work merges into the current week branch through a reviewed pull request, and each finished week is promoted to `main`.

Stable points on `main` are tagged with [semantic versions](https://semver.org/) (`v0.1.0` is Week 1, `v0.2.0` Week 2, `v0.3.0` Week 3). [CHANGELOG.md](CHANGELOG.md) lists what each one added. Only tagged commits on `main` are stable; `week*` branches are work in progress.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch flow, the checks every pull request must pass and how reviews work. The rules themselves are in [docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md). Security issues go through [SECURITY.md](SECURITY.md), not public issues.

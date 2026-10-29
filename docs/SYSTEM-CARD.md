# System card: Governed Analytics Copilot

One page for a reviewer who asks "what is this AI system, what does it see, and how do we know it behaves?" Facts here point to the files that prove them. Last updated Oct 17, 2026 (Week 5 code with the Oct 17 security fixes).

## What it is

A copilot next to certified pipeline dashboards. A person asks a plain-language question; the app answers with one governed number, scoped to what that person may see, with a statement of where the number came from. A separate alerts app sends each account-team member private, rule-based alerts.

**Design rule:** the AI never does the math and never decides access. It only proposes a structured request (an *intent*: metric, filters, breakdown). Code checks it, reads the person's scope from the database, builds the SQL from an allowlist, and writes the answer, sentence and chart from the governed rows.

## Intended use, and out of scope

| Intended | Out of scope |
|---|---|
| Sellers, managers and analysts asking about 3 governed pipeline metrics: open pipeline, pipeline coverage, open opportunity count | Any metric not in `registry/metrics/` (refused or answered with a clarifying question) |
| Follow-up questions in a conversation | Free-form analysis, forecasting, advice, or anything the AI would have to calculate |
| A demo on public sample data plus synthetic tables | Real customer or Palo Alto Networks data, until the client runs its own review |
| Private alerts from fixed rules | Alerts written by an AI model |

## Model

| | |
|---|---|
| Default intent model | Deterministic keyword matcher (`src/semantic/normalize.ts`). Used in CI and the demo unless switched |
| Optional intent model | `claude-opus-5-5` via the Anthropic API, structured output, `INTENT_MODEL=claude` (`src/semantic/model.ts`) |
| Falls back to | The deterministic matcher when Claude errors or takes over 8 s (`CLAUDE_TIMEOUT_MS`). After 3 failures in a minute, Claude is skipped for 5 minutes (`src/server/ask.ts`) |
| What Claude receives | The metric catalog (names, descriptions, synonyms, allowed breakdowns), fiscal-quarter rules, the question, and the previous turn's intent |
| What Claude never receives from the app | Business rows, numbers, stored account or contact records, who the user is or what they may see, credentials. **But** the question is sent as typed, so any name a user types (a person, an account) does reach Anthropic. Treat questions as personal data for privacy purposes: a DPIA and processor agreements are still to do (see Known limits) |
| What Claude can return | One intent in a fixed schema, or a clarify/unsupported choice. Its own wording never reaches the screen: the user sees one of a few fixed sentences, and the audit log keeps only a fingerprint. Its output is re-validated against the schema, the registry and the user's scope |
| Narrative and chart | Built by code from the governed rows (`src/semantic/narrative.ts`), never by a model |
| Prompt version | Not logged separately yet; the prompt is in `src/semantic/model.ts` under version control |

## Data and lineage

| Source | What | Where |
|---|---|---|
| Maven Analytics CRM sample (public domain, fictional company) | Accounts, opportunities, sales teams, products | `data/maven-crm/`, `SOURCE.md` |
| Synthetic | Quotas, contacts, support cases, CXO engagements, product usage, technical sellers, analyst | `src/db/seed.ts` |
| Second dataset (onboarding demo) | Northstar CRM sample | `data/northstar-crm/`, `docs/ONBOARDING.md` |

Every answer names its snapshot and as-of date (current: `snap_alto-pals-v2`, as of Oct 8, 2026). Field meanings are in `docs/DATA-DICTIONARY.md`, generated from the registry. Metric definitions are versioned JSON in `registry/`; changes go through a reviewed pull request (`.github/CODEOWNERS`).

## Access and decision log

- Scope (region, team) comes from the database on every turn (`src/semantic/scope.ts`), never from the question.
- Every question and dashboard query writes one row to `query_audit`: a keyed hash of the question (not the text), the intent, metric and version, regions, snapshot, result hash, outcome, flags, model and turn. No answer is shown if that row can't be written.
- Sign-ins, failed sign-ins and sign-ups are audited too (`source = 'auth'`), with the username only as a keyed hash. Flagged questions and locks can also post to a security Slack channel (`SECURITY_SLACK_WEBHOOK_URL`).
- In Postgres mode the answering login is read-only, the audit login can only add audit rows, and a separate auth login handles accounts and sessions. The owner login is used only by `npm run db:setup` (`docker/init-roles.sql`, `tests/postgres-roles.test.ts`).

## Question log and trends

Client guidance (Oct 24): log every question so another agent can find trends.

- Every question writes one `query_audit` row (see "Access and decision log"). The words are never stored, only a keyed
  fingerprint.
- A question that is not answered also gets a **topic label** from a fixed list (support cases, product usage, renewals
  and churn, forecast, engagements and contacts, competitors, pricing, people, other; `src/audit/topics.ts`). The label
  comes from the list, never from the question.
- Two views hold counts only: `question_trends` (week, metric, outcome) and `question_topics` (week, topic, outcome, for
  unanswered questions). The read-only app login can read the views and still cannot read `query_audit`.
- The **trends agent** (`npm run trends:agent`, `src/audit/trends-agent.ts`) reads only those views. Code works out
  every number as a fact. With `TRENDS_AGENT=claude`, Claude picks which facts matter and says why, in words with no
  digits; any output with a number, or a fact it was not given, falls back to the plain summary. On `/trends`, analysts see
  the plain summary built by code; Claude's wording appears only in the command's output and its `--out` file.

## Evaluation (Oct 17)

Details and definitions are in `docs/RED-TEAM.md` (metrics).

| Check | Result |
|---|---|
| Same question, same number (golden set, 66 phrasings), deterministic | 66/66 |
| Golden set with Claude, 5 runs | 0 different numbers in 330 runs; 39 clarifying questions instead of a number, from a quarter-filter gap since fixed by #16 (66/66 on three runs after it) |
| Red-team matrix, deterministic and Claude (10 runs per row) | No out-of-scope data in any run |
| Prompt leak attempts with Claude | 0/30 |
| Follow-up conversations, Claude vs deterministic (one rule for both, #28) | 10-turn conversation identical on every turn, 3 of 3 runs |
| Postgres least-privilege tests | 7/7 (Docker, Oct 17). Now 8 in `tests/postgres-roles.test.ts` with the question-count test; rerun before release |

## Known limits

Findings are tracked in `docs/RED-TEAM.md` (F1–F25). The ones a reviewer should know first:

- Not built yet: backups and disaster recovery, SSO with MFA, health checks and error reporting, a DPIA and processor agreements for Anthropic, Slack and email.
- Pattern-based prompt flags are a speed bump; scope enforcement in the database is the real control.
- Topic labels are coarse: the first matching word list wins, so "use cases" counts as support cases and "will we hit quota" as forecast. Read them as trends, not exact categories.
- This is a self-assessment by the team that built it. The client's own red team should test it before any rollout.

## Retention

Defaults, to confirm with the client: `query_audit` 90 days (`AUDIT_RETENTION_DAYS`), finished alerts 180 days (`DELIVERY_RETENTION_DAYS`), expired sessions removed on every log-in and by the daily `npm run purge`. Demo accounts are disabled after Demo Day with `npm run accounts -- disable <username>`.

## Owners

| Area | Owner |
|---|---|
| Metric registry and definitions | _[name]_ |
| Red-team findings triage | Mitra Kermanian |
| Dataset onboarding confirmation | _[name]_ |
| Security incidents during the demo | _[name]_ |
| This card | _[name]_ |

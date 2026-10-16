# Walkthrough

This is a **governed analytics copilot** for the ALTO PALS capstone. Someone asks a plain-English question about pipeline. The app answers only from three approved metrics, only with the data that person is allowed to see, and it always says where the number came from. The sales data is the public Maven Analytics CRM sample (a fictional company). Nothing here is a real Palo Alto Networks customer.

## Run it

Needs Node 22.12 or newer (CI uses Node 24).

```bash
npm install
npm run build
echo ALLOW_TEST_IDENTITIES=true > .env.local
npm start
```

Sign in with a demo account (see the README: `DEMO_INVITE_SECRET` and `npm run invites`), or, for quick local testing, turn on test identities in `.env.local`. Leave test identities off anywhere other people can reach the app. Then open http://localhost:3000. Pick a person, type a question or click an example, and press **Ask**. `npm test` runs the test suite.

## What a good answer looks like

Signed in as **Jordan Lee (Technical seller, East)**, "What is our open pipeline?" returns **$495,950**. Under the number the page says:

- **Scope:** East region, Cara Losch's team (6 reps), the sales team Jordan supports.
- **Provenance:** metric `open_pipeline` version 1, snapshot `snap_alto-pals-v2`, as of **2026-10-08**, plus a short hash of the result.
- **Intent:** the structured request the system actually ran, which for that question is "open pipeline, no filters, no breakdown."

That last line is the whole product idea. The person types English. The system turns it into a small, checked request. It never lets the question write its own math or its own SQL.

## The path of one question

1. **The phrase is matched to a metric.** Today this is not a real AI model. `src/semantic/normalize.ts` is a stand-in that looks for known phrases. "pipeline coverage" beats the shorter word "pipeline," so the more specific metric wins. If the phrase matches nothing, the app says it can only answer governed metrics. If a word is ambiguous, such as "weighted," it asks a clarifying question instead of guessing.
2. **The request is checked.** `src/semantic/compile.ts` only accepts a metric that exists in the registry, a breakdown that metric allows, and a period the glossary knows. Anything else is refused.
3. **Permissions come from the database, not from the sentence.** `src/semantic/scope.ts` looks up who is signed in. Typing "West" does not grant West. If an East seller asks for West, the query is refused.
4. **SQL is built from an allowlist.** Table names, column names, and the formula come from the metric file. The user's words only become bound parameters (`$1`, `$2`), never text pasted into the query.
5. **The answer is labeled.** The page shows the number, the scope sentence, the metric version, the data snapshot, and a hash of the result.

## The three approved metrics

These live in `registry/metrics/` and are listed at the bottom of the page. Changing one means a pull request. There is no screen that edits them while the app is running.

| Metric | Plain meaning | Can be split by |
|---|---|---|
| **Open pipeline** | Sum of opportunity dollars that are not closed (not won and not lost) | region, stage, owner |
| **Open opportunity count** | How many of those open deals there are | region, stage, owner |
| **Pipeline coverage** | Open pipeline that closes in a quarter, divided by quota for that quarter. **3.0** means pipeline is three times quota | region only |

Coverage always needs a period. "This quarter" means the fiscal quarter that contains the snapshot date. The fiscal year in this demo starts **August 1**, so **FY27-Q1 is August 1 through October 31, 2026**. The snapshot date is October 8, 2026, so "this quarter" is FY27-Q1.

For a seller, coverage uses the pipeline on that seller's account team, divided by the quota of the same people (that seller or team), not the whole region's quota.

## Who can see what

The identity dropdown is a demo switch, not login.

| Person | Role | What they see |
|---|---|---|
| Jordan Lee | Technical seller, East (synthetic) | Deals and quotas of Cara Losch's team, the team Jordan supports |
| Sam Rivera | Technical seller, West (synthetic) | Celia Rouche's team |
| Darcel Schlecht | Sales rep (from the sample) | Only their own deals and quota |
| Melvin Marxen | Sales manager, Central (from the sample) | Their own team |
| Avery Patel | Customer analytics (synthetic) | Central, East and West, every team |

## The data

The demo needs no Docker and no database server. On startup the app creates an in-memory Postgres (PGlite) and loads:

- **From the public Maven Analytics "CRM Sales Opportunities" sample** (public domain, fictional company MavenTech, in `data/maven-crm/`): 85 accounts, 8,800 opportunities, 35 sales reps under 6 managers in Central, East and West, and 7 products.
- **Synthetic, because the sample has none:** quotas, contacts, support cases, engagements, the two technical sellers and the analyst.

Adjustments, all documented in `registry/dictionary.json`:

- Dates are shifted forward by the same number of days so the newest record lands on the snapshot date, Oct 8, 2026.
- Open deals have no value or close date in the sample. The product list price is used as the value, and engage date + 57 days (the median sales cycle) as the expected close date, rolled forward if already past. Both are flagged as estimates.
- Quotas are 1.2x each rep's average quarterly won revenue over the last year.

Every business row is stamped with snapshot `snap_alto-pals-v2`.

## What is built, and what is later

**Week 1 (done):** the registry, the stand-in "model," permission checks, the SQL compiler, the preview page, and tests, plus CI with dependency, secret and CodeQL scans.

**Week 2 (done):** Postgres mode with a read-only analytics role and an insert-only audit role, the query audit log, and the private alerts service in `alerts/` (high-severity support case and CXO engagement).

**Week 3 (done):** follow-up questions, Claude as an optional question reader (off unless `INTENT_MODEL=claude`), charts and plain-language summaries, and the red-team suite.

**Week 4 (on the week4 branch):** alert settings each person edits, weekly and monthly digests, a background scheduler, Postgres mode for alerts, and the full red-team matrix (`docs/RED-TEAM.md`).

**Week 5 (on the week5 branch):** demo accounts with invite codes in both apps, onboarding a second dataset (`docs/ONBOARDING.md`), and a golden set of 66 phrasings (14 to 17 per metric).

Not built yet: company sign-in (Active Directory and SSO), alerts on a second dataset, email alerts, per-user time zones, more business rules in the glossary, and running on Postgres by default (`npm start` still uses the embedded database; Postgres mode needs the database URLs).

## Where to look in the repo

- `app/page.tsx` is the page you see.
- `registry/` is the approved definitions: metrics, glossary, dictionary, and the golden phrases the stand-in model is tested against.
- `src/semantic/` is the pipeline: match the phrase, check it, apply permissions, write SQL, return the labeled answer.
- `src/db/` is the tables and the fake data.
- `tests/` checks the registry, the golden phrases, the seed, and that a governed query stays inside someone's scope.

# Walkthrough

This is a **governed analytics copilot** for the ALTO PALS capstone. Someone asks a plain-English question about pipeline. The app answers only from three approved metrics, only with the data that person is allowed to see, and it always says where the number came from. All of the data is fake. Nothing here is a real Palo Alto Networks customer.

## Run it

```bash
npm install
npm run build
npm start
```

Then open http://localhost:3000. Pick a person, type a question or click an example, and press **Ask**. `npm test` runs the test suite.

## What a good answer looks like

Signed in as **Jordan Lee (Technical seller, East)**, "What is our open pipeline?" returns **$8,168,000**. Under the number the page says:

- **Scope:** East region, limited to the 10 accounts on Jordan's account team.
- **Provenance:** metric `open_pipeline` version 1, snapshot `snap_alto-pals-v1`, as of **2026-10-08**, plus a short hash of the result.
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

For a seller, coverage uses the pipeline on that seller's account team, divided by the **region** quota.

## Who can see what

The identity dropdown is a demo switch, not login.

| Person | Role | What they see |
|---|---|---|
| Jordan Lee | Technical seller, East | East, and only the 10 East accounts on their team |
| Sam Rivera | Technical seller, West | West, same rule |
| Casey Morgan | Account owner, East | East, their accounts |
| Riley Chen | Account owner, West | West, their accounts |
| Avery Patel | Customer analytics | East and West, every account |

A regional-manager role exists in the data model (a whole region, every account in it), but none of the five demo people is a regional manager yet.

## The fake company

The demo needs no Docker and no database server. On startup the app creates an in-memory Postgres (PGlite) and fills it from the seed `alto-pals-v1`. The same seed always produces the same rows, which is why tests and the demo match. (`docker-compose.yml` is there for the real Postgres we move to in Week 2.)

The world is small: 2 regions, 20 accounts (10 East, 10 West), contacts, opportunities, quotas, plus support cases and engagements reserved for later alerts. Every business row is stamped with snapshot `snap_alto-pals-v1`.

## What is built, and what is later

**Week 1 (done):** the registry, the stand-in "model," permission checks, the SQL compiler, the preview page, and tests (all passing), plus CI with dependency, secret and CodeQL scans.

**Week 2:** a real Postgres database, a read-only analytics role, a query audit log, and more business rules in the glossary.

**Week 3:** a real AI model. It still has to emit the same structured intent and pass the same checks. Also follow-up questions, charts, and a red-team suite.

**Week 4:** private alerts. The support-case and engagement tables are already in the schema for that, but nothing sends alerts yet.

## Where to look in the repo

- `app/page.tsx` is the page you see.
- `registry/` is the approved definitions: metrics, glossary, dictionary, and the golden phrases the stand-in model is tested against.
- `src/semantic/` is the pipeline: match the phrase, check it, apply permissions, write SQL, return the labeled answer.
- `src/db/` is the tables and the fake data.
- `tests/` checks the registry, the golden phrases, the seed, and that a governed query stays inside someone's scope.

# Governed Analytics Copilot

Team ALTO PALS capstone for Palo Alto Networks Customer Analytics (Pursuit L3, Demo Day 11/9/2026).

A governed AI analytics copilot that sits next to certified dashboards. The AI only picks a registry metric and filters; it never writes SQL or math. Role-based access is enforced below the AI, and every answer states its scope and the data snapshot it came from. Private, rule-based alerts follow in Week 4.

**No real customer or Palo Alto Networks data.** Sales data is the public-domain [Maven Analytics CRM Sales Opportunities](https://mavenanalytics.io/data-playground/crm-sales-opportunities) sample (a fictional company); quotas, contacts, support cases and engagements are synthetic.

New to the project? Start with the [walkthrough](docs/WALKTHROUGH.md).

## Run it

Requires Node 20+. No Docker needed: the app and tests use an embedded Postgres (PGlite) loaded on start from `data/maven-crm/` plus deterministic synthetic tables.

```bash
npm install
npm test          # registry, golden phrases, seed and governed-query tests
npm run build
npm start         # http://localhost:3000
```

Pick a mock identity and ask, for example, "coverage by region for this quarter". An East seller only sees East; asking for West is refused.

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
| `data/maven-crm/` | The public CRM sample (accounts, opportunities, sales teams, products) |
| `src/db/schema.ts`, `src/db/seed.ts` | Data model and loader: sample data, date shift, estimates for open deals, synthetic quotas, contacts, cases and engagements |
| `src/semantic/` | Normalizer (golden-set mock of the AI model), validation, scope and SQL compiler |
| `drizzle/` | Generated migrations |
| `.github/workflows/` | CI: typecheck, tests, dependency audit, secret scan (gitleaks), static analysis (CodeQL) |

Registry changes go through pull requests (reviewed, version-controlled); there is no runtime editing.

## Decisions

- **Own registry over Cube** (Oct 9): simpler for 3 metrics on one database; revisit if the catalog grows past 15 to 20 metrics.
- **Fiscal quarters**: Palo Alto Networks' fiscal year starts Aug 1, so FY27-Q1 = Aug 1 to Oct 31, 2026 (assumption).
- **Scope**: sales reps see their own deals; managers and the technical seller who supports a team see that team; the analyst sees everything. Coverage uses the same people's quotas.

## Not done yet (by roadmap week)

- Week 2: real Postgres with a read-only analytics role, query audit log, business rules in the context layer.
- Week 3: real AI model for intent, follow-up conversations, charts, red-team suite.
- Week 4: alert rule catalog, subscriptions, private delivery with send-time permission checks.
- Mock identity picker is for the demo only; it is not authentication.

# Data dictionary

Generated from `registry/` by `npm run docs:dictionary`. Do not edit by hand: change the registry and run the command.

## Governed metrics

| Metric | Definition | Breakdowns | Version | Owner |
|---|---|---|---|---|
| Open opportunity count (`open_opportunity_count`) | Number of opportunities that are not yet closed. | region, stage, owner | v1 | Customer Analytics (metric steward) |
| Open pipeline (`open_pipeline`) | Total amount of opportunities that are not yet closed (won or lost). | region, stage, owner | v1 | Customer Analytics (metric steward) |
| Pipeline coverage (`pipeline_coverage`) | Open pipeline closing in a quota period divided by quota for the same period. 3.0 means pipeline is three times quota. The target is 3.00x. | region | v1 | Customer Analytics (metric steward) |

## Business rules

| Rule | What it means | Applied in |
|---|---|---|
| fiscal_year | The fiscal year starts August 1. FY27-Q1 is August 1 to October 31, 2026, and FY27-Q2 is November 1, 2026 to January 31, 2027. "This quarter" is the quarter containing the snapshot's as-of date. | `src/db/seed.ts` |
| open_deal | A deal is open when its stage is Prospecting or Engaging. Won and Lost deals are closed and never count toward pipeline or open deals. | `registry/metrics/open_pipeline.json` |
| region | A deal belongs to the region of the sales rep who owns it: Central, East or West. There are no other regions. | `src/db/seed.ts` |
| estimated_amount | Open deals have no value in the source data, so the product's list price is used and the amount is marked as an estimate. | `src/db/seed.ts` |
| estimated_close_date | An open deal with no close date is expected to close one median sales cycle after it was engaged. If that date has already passed, it rolls forward 0 to 59 days from the snapshot date. | `src/db/seed.ts` |
| quota | Quota is synthetic: 1.2 times each rep's average quarterly won revenue over the last four quarters, rounded to $1,000. A team's quota is the sum of its reps' quotas. | `src/db/seed.ts` |
| no_quota | Where there is no quota, coverage is not available. It is never shown as zero and is left out of rankings and charts. | `src/semantic/narrative.ts` |
| cxo | A CXO is a contact whose job title starts with "Chief". Only engagement by a CXO fires the CXO alert. | `src/db/seed.ts` |
| snapshot | Every answer comes from the newest data snapshot and states its as-of date. | `src/semantic/answer.ts` |
| follow_up | A follow-up keeps the earlier filters and breakdown only when it names no metric ("what about West?") or names the same metric with a follow-up word ("and the open pipeline by stage?"). Naming a different metric starts a new question. | `src/semantic/normalize.ts` |
| extra_filters | Open pipeline and open opportunity count can be filtered by deal size, product or series, account, sector, and the sales rep who owns the deal. A sector counts only when the question says sector, industry, or vertical beside the name. A manager named with their team means that manager's reps. A product series is labeled as a series. Commas and decimals in a deal size are kept. Pipeline coverage can be filtered by that rep or team, because quota is per rep. It cannot be filtered by deal size, product, account or sector, because quota is not split that way. An unknown name is asked about, not dropped. | `src/semantic/compile.ts` |

## Glossary

- **Open:** Stage is Prospecting or Engaging (not Won and not Lost).
- **Pipeline coverage:** Open pipeline closing in a period divided by quota for that period. We report total coverage; weighted coverage is not defined yet.
- **Fiscal quarter:** Palo Alto Networks' fiscal year starts August 1, so FY27-Q1 is Aug 1 to Oct 31, 2026 (assumption until confirmed).
- **This quarter:** The fiscal quarter containing the data snapshot's as-of date.
- **Region:** Central, East or West: the regional office of the sales rep who owns the deal.
- **Estimated amount:** Open deals have no value in the source data, so the list price of the product is used.
- **CXO:** A contact whose job title starts with "Chief", for example Chief Information Security Officer or Chief Technology Officer. Only engagement by a CXO fires the CXO alert.

## Tables

### `account_team`

Account-access mapping: reps with deals on the account and the technical seller supporting their team.

| Field | Meaning |
|---|---|
| `team_role` | account_owner or technical_seller. |

### `accounts`

Customer accounts from the CRM sample.

| Field | Meaning |
|---|---|
| `sector` | Industry (source typo 'technolgy' corrected). |
| `revenue_musd` | Annual revenue in millions of USD. |
| `hq_country` | Headquarters country. |
| `parent_account` | Parent company, if a subsidiary. |

### `opportunities`

Sales opportunities from the public Maven Analytics CRM sample (fictional company MavenTech), dates shifted to FY27.

| Field | Meaning |
|---|---|
| `amount` | Deal value in USD. Closed deals use the recorded close value; open deals have none in the source, so the product's list price is used as an estimate (amount_is_estimate = true). |
| `stage` | Sales stage from the source: Prospecting, Engaging, Won, Lost. |
| `close_date` | Actual close date for Won/Lost. For open deals, an estimate: engage date + 57 days (median sales cycle), rolled forward if already past. |
| `is_closed` | True for Won and Lost. |
| `is_won` | True only for Won. |
| `region_id` | Regional office of the sales rep who owns the deal (central, east or west). |
| `owner_user_id` | Sales rep (sales agent in the source) who owns the deal. |
| `account_id` | Customer account. Empty for many open deals in the source. |

### `quotas`

Synthetic sales quotas per sales rep and fiscal quarter (the CRM sample has no quota data): 1.2x the rep's average quarterly won revenue over the last year.

| Field | Meaning |
|---|---|
| `amount` | Quota in USD for the period. |
| `period` | Fiscal quarter label, for example FY27-Q1. |
| `region_id` | Region of the sales rep. |
| `user_id` | Sales rep the quota belongs to. |

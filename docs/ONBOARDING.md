# Onboard a second dataset (PRD A7)

Repeatability without a dataset-builder UI. A human reviews a proposal; the script
never writes SQL or a new metric formula. The three governed metrics stay in
`registry/metrics/` and still go through a pull request.

Default answers still come from `data/maven-crm/`. Confirming a second folder
only changes which CSVs the seed loader reads.

## What the folder must look like

Same files and required columns as the Maven CRM sample:

| File | Required columns |
|---|---|
| `accounts.csv` | `account` |
| `products.csv` | `product`, `sales_price` |
| `sales_teams.csv` | `sales_agent`, `manager`, `regional_office` |
| `sales_pipeline.csv` | `opportunity_id`, `sales_agent`, `product`, `deal_stage` |

`regional_office` must be Central, East or West. Open deals may leave `close_value`
and `close_date` empty; the seed loader estimates them the same way as Maven.

This repo includes a synthetic second company in `data/northstar-crm/` (fictional
Northstar Hardware, not real customer or Palo Alto Networks data).

## Steps

```bash
# 1. Profile the folder (row counts and columns only)
npm run onboard:profile -- data/northstar-crm

# 2. Propose the existing governed metrics. Review the JSON.
npm run onboard:propose -- data/northstar-crm --out onboarding/proposal.json

# 3. A person confirms. This writes onboarding/active.json. It does not edit registry/metrics.
npm run onboard:confirm -- onboarding/proposal.json --by "Your Name" --metrics open_pipeline,pipeline_coverage,open_opportunity_count

# 4. Restart the app on that folder
DATASET_DIR=data/northstar-crm npm run dev
```

Ask “What is our open pipeline?” as Avery Patel (analyst). Northstar’s open
pipeline is **$16,500** (six open deals at list price). Maven’s number is
different, which is the proof the new snapshot is the one being queried.

The demo picker still includes Maven names (Darcel, Melvin). Those people are
not in Northstar. Use Avery, Jordan Lee (East), or Sam Rivera (West).

`onboarding/active.json` is gitignored. Leave Maven as the committed default.

## What this will not do

- Invent a fourth metric or a Cube-style catalog
- Accept an arbitrary spreadsheet that does not match the CRM shape
- Skip the confirm step
- Change role scope, the compiler allowlist, or the golden phrasing set

## User onboarding vs. dataset onboarding (client feedback)

"Onboarding" comes up in two places:

1. **Dataset onboarding (PRD A7, above):** profiling and confirming a second CRM dataset (`npm run onboard:*`).
2. **User / employee onboarding (client feedback):**
   - **Real rollout:** employee identities and roles (`technical_seller`, `sales_rep`, `sales_manager`, `analyst`, region, and account-team mappings) would be provisioned through **Active Directory and enterprise SSO (OIDC/SAML)** rather than manual credential assignment.
   - **Demo Day:** per client guidance, self-serve account creation or mock demo identities (`ALLOW_TEST_IDENTITIES=true` switcher) are acceptable so reviewers can test different roles without enterprise SSO.


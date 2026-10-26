# Deploying on GCP with a BigQuery replica of Salesforce (design)

PRD D2. On the Oct 24 call, Alex said a real deployment would run on GCP and read Salesforce data that is copied into
BigQuery. This is the design for that path. It is not built for Demo Day; the demo runs with Docker compose (PRD D1).

**What does not change:** the metric registry, the intent model, scope from the database on every turn, the SQL compiler,
the audit log, the alerts engine and the evaluator. Only where the data comes from, where the app runs, and how people
sign in change.

## Recommended shape: BigQuery feeds snapshots, Postgres serves answers

```
Salesforce ──(existing replication)──> BigQuery replica
                                            │  read-only service account, scheduled daily
                                            ▼
                               Cloud Run job: snapshot loader
                                            │  writes one new snapshot (data_snapshots row + tables)
                                            ▼
Users ──SSO──> Cloud Run: copilot ──(app_readonly / app_audit / app_auth)──> Cloud SQL for PostgreSQL
               Cloud Run: alerts  ─────────────────────────────────────────┘
               Cloud Scheduler: alert ticks, purge, weekly trends agent
```

The app already answers from a numbered **snapshot** with an as-of date (`data_snapshots`, `currentSnapshot` in
`src/semantic/answer.ts`), and every answer names it. A BigQuery replica of Salesforce is itself a batch copy, so loading
it into a new snapshot once a day keeps that promise: one number per question per day, and provenance that says which
day. The answering path keeps its Postgres read-only role, statement timeout and grants unchanged.

### What gets built

| Piece | Change | Where |
|---|---|---|
| Snapshot loader | New: reads the replica through the BigQuery client and writes a new snapshot, in place of the CSV seed. Same tables, same columns, so the compiler doesn't change | `src/db/load-bigquery.ts` (new), run as a Cloud Run job |
| Field mapping | New: Salesforce objects to our tables (below), versioned with the registry | `registry/sources/salesforce.json` (new) |
| Sign-in | Replace demo accounts with OIDC through Google or Microsoft Entra (Active Directory), as Alex said on Oct 15. The user id still comes only from the session | `src/server/session.ts` |
| Employee status | Read active or inactive from the directory instead of the synthetic list, behind the existing `EmployeeDirectory` interface | `alerts/src/alerts/employee-status.ts` |
| Config | Database URLs, the model key and webhooks from Secret Manager | Cloud Run service settings |

### Salesforce to our tables

| Our table | Salesforce object (in the replica) |
|---|---|
| `accounts` | Account |
| `opportunities` | Opportunity (stage, amount, close date, owner) |
| `app_users`, `regions` | User, UserRole or territory |
| `account_team` | AccountTeamMember / OpportunityTeamMember |
| `quotas` | ForecastingQuota (or the team's own quota table) |
| `contacts`, `engagements` | Contact, CampaignMember |
| `support_cases` | Case (severity, status, created date) |
| `product_usage` | The usage source PANW already reports on (not in Salesforce; to confirm with Alex) |

The synthetic tables go away one by one as each real source is mapped. Each answer's "Data" line already says which
tables are synthetic.

### Identities and access

| Identity | Can do | Cannot do |
|---|---|---|
| Loader service account | `BigQuery Data Viewer` on the replica dataset, `BigQuery Job User`, write a new snapshot through the owner login | Reach the app, read the audit log |
| Copilot service account | Connect to Cloud SQL as `app_readonly`, `app_audit`, `app_auth` | Any BigQuery access, migrations, grants |
| Alerts service account | Its own database logins; post to Slack and email | BigQuery access |
| Trends agent job | `app_readonly`: the two count views only | Read `query_audit` or any question text |
| Evaluator | Read a pinned copy of the code in its own repository | Write to the product repository (PRD S8) |

The copilot never holds a BigQuery credential, so a bug or a prompt injection in the answering path can't reach the
replica. Cloud SQL uses private IP only, and the migration (owner) login lives only in the loader job.

### The model

Any provider is acceptable (Alex, Oct 15). Two options with the same code (`src/semantic/model.ts`):

- **Anthropic API**, as today: only the question, the catalog and the previous turn's structured intent leave GCP. No
  rows, numbers or identities.
- **Claude on Vertex AI**: the same model through Google Cloud, so the request stays inside PANW's GCP project and
  billing. A client change only.

If the model is down or slow, the deterministic model answers, as it does now.

## Alternative: query BigQuery directly

The compiler could emit BigQuery SQL and run each question against the replica, with BigQuery row-level access policies
as a second scope check. It gives fresher data, but costs more: a second SQL dialect in the compiler, a per-query cost
and latency, and a service account on the answering path that can read the whole replica. We'd choose it only if a daily
snapshot is too stale for the users.

## Open questions for PANW

1. How often is the BigQuery replica refreshed? A daily snapshot assumes at least daily.
2. Which identity provider: Google Workspace or Microsoft Entra (Active Directory)?
3. Where does product usage live, and can the loader read it?
4. Anthropic API or Claude on Vertex AI (or another provider)?
5. Who owns the GCP project, the service accounts and the on-call for the loader?

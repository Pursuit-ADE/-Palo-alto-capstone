# Governed AI Analytics Copilot: Product Requirements

**v1.3** · v1 approved by Alex Sanginov on Oct 7, 2026 · updated Nov 1 after his Oct 15 answers, the Oct 24 call and the team's reviews; statuses updated Nov 11 after Demo Day
(see [change log](#9-change-log)) · Palo Alto Networks Customer Analytics × Team ALTO PALS (Pursuit L3) · Demo Day Nov 9, 2026

This is the living copy of the PRD. It replaces the v1 PDF in this folder, which stays for history. When is in the
[roadmap](ROADMAP.md); how we keep both current is in [README.md](README.md). Where we made an assumption, it is marked as
one, so it is easy to correct. The status column says what is on `main` today.

## 1. Problem

Account teams and executives at Palo Alto Networks rely on certified dashboards. When they have a follow-up question,
they take a screenshot and chase an answer over email or Slack. An AI assistant could answer instantly, but large
language models are probabilistic and struggle with hard numbers: the same question phrased three different ways can
return three slightly different numbers. Different numbers for different roles are expected (a rep should only see
their territory); different numbers for the same role and the same question are not.

Account teams also cover many accounts (often 10 to 100 per person) and miss timely signals, such as an executive at an
account engaging with Palo Alto Networks content or a customer opening an urgent support ticket.

**Impact** (adapted from Alex's model, Oct 7): departments × at least 3–5 analysts × about 2,000 work hours a year × the
share of time spent on manual data stitching. That share is our assumption, a range of 20–40%, not a measured number.

## 2. Goals and non-goals

**Goals**

- Consistent answers: for a given role, any phrasing of a question returns the same number. Only the wording may differ.
- Executive-first: every answer opens with one sentence a leader can stop at, then the number, then the detail (Oct 24).
- Copilot next to the dashboard: a question and any number of follow-ups, with a chart.
- Role-scoped and explained: each person sees only their data, and every answer states the definition and scope it used.
- Personal, actionable alerts: each user chooses triggers, frequency and channel, and only active employees get them.
- Secure by design, and checked by an independent evaluator outside the product repository (Oct 24).
- Repeatable: deploys from the repo on a new dataset with documented steps, with a documented path to GCP and BigQuery.

**Non-goals for Demo Day**

- Real Palo Alto Networks data or real SSO. We use public and synthetic data, and demo accounts with invite codes.
  The real rollout would use Active Directory and SSO (Alex, Oct 15).
- Replacing dashboards. The copilot sits alongside them.
- Write actions. The agent is read-only on business data and takes no outbound actions beyond each user's own alerts.
- Automatic ingestion of arbitrary datasets, AI-created metrics, fine-tuning a model, or retrieval (RAG) over documents.
- Deploying to GCP. For Demo Day the GCP and BigQuery path is a design ([DEPLOYMENT-GCP.md](../DEPLOYMENT-GCP.md)).
- Enterprise-scale load testing.

## 3. Users

| Role | Why they matter | Demo Day scope |
|---|---|---|
| Technical seller / solution consultant (primary, confirmed Oct 5) | Lives "between two worlds," pre-sale and post-sale | Full: copilot and alerts |
| Sales rep / account owner | Many accounts; needs timely engagement signals | Copilot scoping and alerts |
| Executive / leader (Oct 24) | Reads one sentence and moves on; 3D charts get in the way | The one-sentence answer and the 2D default |
| Customer success manager | Adoption after the sale | Stretch: the large-deal trigger. (The low-usage alert goes to the account team: technical sellers and sales reps.) |
| Metric steward (admin) | Owns official metric definitions | Edits the registry through reviewed pull requests |
| Analyst (product owner) | Wants to know what people ask and can't get answered (Oct 24) | Question trends page and weekly trends agent |

## 4. Key user stories

- As a technical seller, I ask "what is my pipeline coverage?" in any wording and always get the same number, with the
  definition and scope shown, and whether it is on or off the 3x target.
- As an executive, I read one sentence that tells me the number and what it means, without opening a chart.
- As a technical seller, I follow up with "which region has the least coverage?" and get a breakdown and chart.
- As a technical seller, I get an alert when one of my customers opens a high-severity support ticket.
- As a sales rep, I get an alert when an executive (CXO) at one of my accounts engages with content or a campaign.
- As an account team member, I get an alert when a customer uses less than 20% of what it bought six months after purchase.
- As any user, I choose which alerts I get, how often and where, and I never see another person's accounts.
- As an analyst, I see each week which questions the copilot could not answer, by topic, without anyone's words.
- As a metric steward, I define a metric once and every answer and alert uses that definition.

## 5. Requirements

Status: **Done** is on `main`; **PR** is built and in review; **Open** is not built yet.

### Part 1: Analytics copilot

| ID | Requirement | Priority | Status |
|---|---|---|---|
| A1 | Metric registry: each metric defined once (formula, filters, grain, owner, version). Three metrics: open pipeline, pipeline coverage, open opportunity count. | Must | Done |
| A2 | Intent normalization: the AI maps any phrasing to a registry metric plus filters, using the context layer. It never writes math or SQL. Ambiguity gets a clarifying question. | Must | Done |
| A3 | Role-based scope enforced below the AI, in the query and database layer. | Must | Done |
| A4 | Scope statement on every answer: metric, definition version, filters, role scope, data date. | Must | Done |
| A5 | Follow-up questions with no fixed limit; every turn re-validated and re-scoped (Oct 7). | Must | Done |
| A9 | Context layer: dictionary, glossary, synonyms, business rules and metric logic in the versioned registry files (Oct 7). | Must | Done |
| A10 | **Executive-first answers** (Oct 24): one sentence first (the number and what it means), then the number and detail. Charts default to flat 2D; 3D is opt-in, off by default and remembered per user. | Must | Done (#56) |
| A11 | **Coverage target** (Oct 24): pipeline coverage shown against Alex's 3x target, with on/off-target words (not color alone) and a target ("battery") bar. Red below 2x and amber from 2x to 3x are our split, still to confirm. | Should | Done (#60) |
| A6 | Charts: a sensible chart for the answer shape. | Should | Done |
| A7 | Repeatable on a new dataset: a second dataset added from the runbook. | Should | Done (`docs/ONBOARDING.md`) |
| A8 | Label anything outside the registry as exploratory and unverified. | Could | Open |

### Part 2: Actionable alerts

| ID | Requirement | Priority | Status |
|---|---|---|---|
| L1 | Rule-based signal alerts on the same registry and data. | Must | Done |
| L2 | Triggers: high-severity support case (technical seller); CXO engagement (sales rep); **low usage, under 20% of what was bought, six months after purchase** (account team; Alex chose this on Oct 15). Large-deal CSM trigger stays a stretch. | Must: first two; Should: low usage | Done (low usage in #68) |
| L3 | User preferences: rules, frequency (real time or digest), quiet hours and channel. | Must | Done |
| L4 | Private routing: one shared rule evaluated per user; no alert reveals another user's accounts; access re-checked at send time. | Must | Done |
| L5 | **Channels by urgency** (Oct 24): Slack for urgent alerts (P1, for example an executive or production dashboard is broken), email for status updates and digests. | Must: one channel; Should: both | Both channels done. **Urgency standard (team decision, Nov 1):** the usual support severity scale. P1 is critical: production, or an executive or production dashboard, is down with no workaround. P2 is high: degraded, with a workaround. P3 and P4 are lower. Only P1 is urgent: it goes right away, through quiet hours and digests, on the person's chosen channel if they turned on the P1 bypass; everything else follows that person's frequency. Sending urgent alerts to Slack automatically is not built. Our assumption: a broken dashboard reaches us as a P1 support case, so no separate event type is needed. |
| L6 | Alert explains why it fired and links to the copilot. | Should | Done |
| L7 | **Active employees only** (Oct 24): check employee status before routing and again before every send, standing in for Active Directory. People who leave get no alerts and are signed out of the alerts app (#55); the copilot does the same in #89. The check is on when the status list is set (off in the plain demo). If the directory is down or can’t tell, the alert is held and retried; today that uses the same 5 attempts as a channel failure, and #90 makes it wait without using them. Only a confirmed “inactive” is final. | Must | Done in alerts (#55); copilot #89 and outages #90 open |
| L8 | Distribution lists (Oct 24 question): a list expands to members, and each member passes the same checks. | Could | Design only, waiting on Alex |

### Security and governance

| ID | Requirement | Priority | Status |
|---|---|---|---|
| S1 | Prompt-injection defenses, direct and indirect (links, documents). | Must | Done |
| S2 | Social-engineering defenses: pleas, fake authority, a role claimed mid-chat, gradual escalation. | Must | Done |
| S3 | Suspicious prompts flagged and logged as security events; repeated attempts lock the session. | Should | Done |
| S4 | Audit log of every question: who, which metric version and filters, which snapshot. A keyed fingerprint of the question, never its words, and no raw rows. | Must | Done |
| S5 | Repo hygiene: dependency, static analysis and secret scanning in CI. | Must | Done (the workflows); CI jobs blocked by GitHub billing since Oct 26 |
| S6 | Red-team test suite in CI. | Must | Done (deterministic); the run against Claude is still to do |
| S7 | Read-only analytics database role; scoped aggregates only, never raw rows to the model. | Must | Done |
| S8 | **Independent evaluator** (Oct 24): agents outside the product repo, with no write access to product code, rate findings Low, Medium or High. Findings go to the code's author as issues, fixed by normal reviewed PRs. | Must | Done (separate evaluator repo) |
| S9 | **Agent context and system rules** (Oct 24): the rules the model works under are written down as its context, and each is also enforced in code. No fine-tuning, no RAG. | Must | Done (#73) |
| S10 | **Question trends** (Oct 24): counts of questions by week, metric and outcome; unanswered questions labeled with a topic from a fixed list (never their words); a read-only trends agent writes a weekly summary whose numbers all come from code. | Should | Done (#61, #71) |

### Deployment

| ID | Requirement | Priority | Status |
|---|---|---|---|
| D1 | One-command local demo (Docker compose: Postgres, copilot, alerts). | Must | Done |
| D2 | **GCP target** (Oct 24): the app on Cloud Run, reading a BigQuery replica of Salesforce through a read-only service account. Registry, scope and audit unchanged. | Should (design for Demo Day) | Design ([DEPLOYMENT-GCP.md](../DEPLOYMENT-GCP.md)) |

### Data

No internal Palo Alto Networks data. A public Salesforce-style CRM sample (Maven Analytics, fictional company) plus
synthetic tables for what it lacks. Synthetic data is confirmed as acceptable (Alex, Oct 15).

| Object | Key fields | Source |
|---|---|---|
| Accounts, opportunities, sales teams, products | Region, stage, amount, close date | Public CRM sample |
| Quotas | Owner, region, period, amount (coverage = open pipeline ÷ quota) | Synthetic |
| Users, account teams, employee status | Role, territory, accounts, active or inactive | Synthetic, demo accounts |
| Contacts, engagement events, support cases | CXO title, campaign, severity, opened date | Synthetic |
| Product usage | Account, product, purchase date, quantity bought, monthly quantity used | Synthetic (#59) |

## 6. Success criteria (tested in CI)

| Criterion | How we measure it |
|---|---|
| Consistency | 100% of the golden phrasing set (at least 5 per metric) maps to the same intent and number |
| Ambiguity | Ambiguous phrasings return a clarifying question, never a number |
| Long conversations | A 10-turn chat returns the same numbers as asking each question fresh, and never leaves scope |
| Governance | Zero out-of-scope rows across answers, charts and alerts in a role-by-question matrix |
| Correctness | Answers match hand-computed values on a fixed snapshot |
| Security | Red-team suite passes (injection, social engineering, impersonation, poisoned links, mid-chat role claims, escalation), with the deterministic model and with Claude |
| Independent review | The evaluator's latest run has no open High finding |
| Executive-first | The sentence comes before the number, and the default chart is 2D, in both apps |
| Alert quality | Planted events alert the right active user only, at the chosen frequency |
| Repeatability | A second dataset added from the runbook alone; a fresh checkout starts with documented commands |
| Explainability | Every answer shows its definition, scope and data date |

## 7. Priorities

Never cut: server-side role scope and send-time alert re-authorization, no model-written SQL, metric definition and
answer provenance, cross-scope and prompt-injection tests, private per-user alert routing, the high-severity support-case
alert, active-employee checks (L7), and a repeatable demo. If scope must shrink, as Alex suggested, we write the assumption down and cut from the
bottom of the Should and Could items first. Timing and the cut order are in the [roadmap](ROADMAP.md).

## 8. Assumptions and questions for Alex

**Confirmed with Alex**

| Date | Decision |
|---|---|
| Oct 5 | Technical seller is the primary persona. No internal data; a public Salesforce-style sample. Code goes through PANW infosec review. If scope is too big, document assumptions and cut. |
| Oct 7 | PRD and roadmap approved ("Looks good"). No fixed limit on follow-ups; add a context layer. Weekly email updates. Impact model. |
| Oct 15 | Synthetic data is OK. Low usage is option (a): under 20% of what was bought, six months after purchase. Any AI provider is fine for this exercise. Real onboarding would be Active Directory and SSO; demo sign-up is fine. He asked for an architecture document. |
| Oct 24 | Coverage target 3x. Executives want one sentence, and no 3D graphs. Check employee status (Active Directory) before alerting. Slack for urgent alerts, email for status. An independent evaluator rating findings Low/Medium/High, outside the repo, with no write access. Real deployment would be GCP reading a BigQuery replica of Salesforce. Guardrails alone won't scale: give the agent context and system rules. Log questions so another agent can find trends. Dry run the week of Nov 2, which we're moving to by Sun Nov 1 because Pursuit freezes code on Nov 2. He has read access to the repo. |

**Our working assumptions**

- Red below 2x and amber from 2x to 3x coverage are our color split around his 3x target.
- Share of analyst time spent on data stitching: 20–40% (impact estimate only).
- Fiscal year starts Aug 1, so FY27-Q1 is Aug 1 to Oct 31, 2026.

**Open questions for Alex**

1. Do alerts need distribution lists, or is one person per alert enough for now? (L8)
2. Is the 2x boundary for red and amber right, or does he use a different one? (A11)
3. Which day and time works for a 30-minute dry run by Sun Nov 1, before Pursuit's code freeze on Nov 2?
4. May we name Palo Alto Networks at Demo Day? (He was checking with Pursuit, Oct 15.)
5. ~~Which alerts count as urgent (Slack) beyond a P1 dashboard outage? (L5)~~ Decided by the team on Nov 1 without an answer: only P1, by the standard severity scale in L5.

## 9. Change log

| Date | Change |
|---|---|
| Oct 6 | v1 drafted from the Oct 5 discovery call |
| Oct 7 | Alex approved v1. A5 follow-ups with no fixed limit, A9 context layer, email cadence, impact model |
| Oct 8 | v1.1 after team review: quota and account-team data, ambiguity and long-conversation tests, mid-chat role and escalation red-team cases, repeatability via documented script |
| Oct 26 | v1.2 from Alex's Oct 15 answers and the Oct 24 call: A10 executive-first answers, A11 3x coverage target, L2 low usage confirmed as option (a), L5 channels by urgency, L7 active employees only, L8 distribution lists (question), S8 independent evaluator, S9 agent rules, S10 question trends, D2 GCP and BigQuery design, analyst and executive users, status column, new open questions. Moved from Word to this file so it is updated with the code |
| Oct 28 | Team review (Adedoyin, Mofazzal): CSM row names the large-deal stretch; L7 says what holds on `main` today and points at #89 and #90; L7 joins the never-cut list; S5 notes the CI billing block; the dry run moves to by Sun Nov 1 for Pursuit's Nov 2 freeze |
| Nov 1 | Team decision without Alex's answer: L5 urgency standard (only P1 is urgent, by the usual severity scale; urgent alerts use the person's chosen channel). Question 5 closed. L2 low usage done (#68). |
| Nov 11 | v1.3 after Demo Day: A11, S9 and S10 marked done (merged Oct 31 in #60, #73, #61 and #71). Still not built: A8, L8 (design only) and automatic Slack for urgent alerts (L5). What is left is listed in the [roadmap](ROADMAP.md#6-after-demo-day) |

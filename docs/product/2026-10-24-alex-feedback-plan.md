# Alex's feedback: gaps and who owns them

This plan lists every request from our second call with Alex (Palo Alto Networks) and from his earlier emails. Each request is checked against `week5` at `ea45608` and given one owner. Demo Day is November 9, so everything here should land on `week5` by **Sunday, November 1**. That leaves the week of November 2 for the dry run and the v1.0 release.

**How to use this:**
- Reviewers, check that your own section is right and doable, and say so in the PR.
- Disagree, swap or split items in the PR comments.
- When it merges, each owner opens one PR per item and links it here.

## Owners at a glance

| Owner | GitHub | Area | Items |
|---|---|---|---|
| Mitra (Mira) | @MITRAKER | Client, charts, release | 1, 2, 3, 4, 5, 6 |
| Trevor | @trukwava | Answer correctness, evaluation | 7, 8, 9, 10 |
| Mofazzal | @mofazzal0413 | Alerts | 11, 12, 13 |
| Adedoyin | @brovaset | Metrics and data | 14, 15, 16 |

## What Alex asked for, and where we stand

| # | Alex's request | Today on `week5` | Gap |
|---|---|---|---|
| A | See a working demo, and get access to it | Repo is private. Our links gave him a 404 | He can't see anything we built |
| B | Executives want one data point in one sentence; avoid 3D | Graphs turn 3D on drag; the sentence follows the number | Lead with the sentence; make 3D opt-in |
| C | Coverage against target, ~3x industry standard, "battery" bar | No target in the registry; dashboard says "no coverage target is defined" | Add 3x target, on/off-target label, colors, bullet chart |
| D | Check employee status (Active Directory) before alerts | Disabling a sign-in account stops alerts (#46). No employee status exists | Add a synthetic active/inactive status and check it |
| E | Distribution lists for alerts? | One person per alert only | Ask Alex if it's needed; design only |
| F | Low-usage alert, option (a): usage under 20% of purchase, 6 months after | Not built; no usage data | Synthetic usage data plus the rule |
| G | Red team as an evaluator with low/medium/high ratings, kept outside the repo, no write access | Red-team cases and reports live in the main repo | Move the evaluator and its reports out; keep only tests in |
| H | Guardrails alone "won't scale": give the agent context and system rules | Rules exist in code; the system card doesn't present them as the agent's rules | Write them down as the agent's system rules and context |
| I | Log interactions and later find trends ("why are sellers asking about support cases?") | Every question is audited | A "question trends" report from the audit log |
| J | Would run on GCP, reading Salesforce data copied into BigQuery | Postgres only; architecture doc says "Postgres replica" | Architecture note for GCP + BigQuery |
| K | Re-measure before showing numbers | Claude score dates from Oct 18 | Re-score Claude on 69 golden phrases + red team |
| L | Dry run, week of Nov 2 | Never asked on the call | Ask by email |
| M | (from Trevor's reviews) No "quietly different answer" | 5 comparison questions still answer something else | Fix in #50/#51 |

## Mitra (@MITRAKER)

1. **Client follow-up email (A, E, L).** Thank him. Ask for his GitHub username and for 30 minutes the week of November 2. Ask whether distribution lists are needed. Correct three things we explained wrong on the call:
   - The user id comes from the session, and scope is applied in the query. Names are not "hashed".
   - There are three fixed database logins, and the owner login is used only during setup.
   - The red-team suite is 17 written cases, not live attacker agents.
   - Done when the email is sent and his answers are recorded in this file.
2. **Alex's access (A).** Add his username as a read-only collaborator, and send a short screen recording of the current build. Done when he confirms he can open the repo.
3. **Executive-first answers (B).** Every answer and dashboard tile opens with one sentence: the number and what it means. Graphs default to flat 2D; 3D is an opt-in toggle, off by default and remembered per user. Done when a test shows the sentence comes first and the default view is 2D, in both apps.
4. **Re-score Claude (K).** Run `INTENT_MODEL=claude npm run eval:golden` and `eval:redteam` with the API key, after #50 to #52 merge. Record the result in `docs/RED-TEAM.md` and the briefing.
5. **Architecture note for GCP and BigQuery (J).** Add a section to the architecture doc covering:
   - The app on Cloud Run or GKE.
   - Reading a BigQuery replica of Salesforce through a read-only service account.
   - What changes in `src/db/`: a new reader. The registry and scope stay the same.
   - Design only, no code.
6. **Release (end of week).** Promote `week5` to `main` through reviewed PRs, tag `v1.0.0`, and update the changelog.

## Trevor (@trukwava)

7. **Comparison answers that answer something else (M).** These five questions should compare properly or ask, with a test for each:
   - Two named teams.
   - Two metrics in one question.
   - Coverage and pipeline together.
   - "Is East higher than West?"
   - "How much higher is mine than the company?"
   - See the comments on #50 and #51.
8. **Merge #50 to #52 (M).** Merge order: #51, #50, then #52 using the conflict fix from #53. Add one line to the system card: when Claude and the built-in model disagree on the metric, the user is asked.
9. **Evaluator outside the repo (G).** Move the adversarial review reports (such as `docs/reviews/` from #52) and any attacker-style agent prompts into a separate repository that has no write access to this one. Re-frame them as an evaluator that rates each finding low, medium or high. This repo keeps only the 17 red-team **tests**. Done when no agent or report with write intent lives in this repo, and `docs/RED-TEAM.md` links to the separate one.
10. **System rules as the agent's context (H).** A short section in `docs/SYSTEM-CARD.md` lists the rules the model works under. For example: the user comes from the session, the model never overrides scope, and it picks only governed metrics. It also says where each rule is enforced in code. This is our answer to "guardrails don't scale": the rules are written context, and code enforces them.

## Mofazzal (@mofazzal0413)

11. **Employee status before alerts (D).** Add a synthetic `employment_status` (active or inactive), labeled synthetic like the quotas, standing in for Active Directory. The engine skips inactive people when routing and before every send, next to the disabled-account check from #46. Done when tests cover active, inactive, and becoming inactive while a digest is queued.
12. **Low-usage alert, option (a) (F).** Usage below 20% of what the customer bought, six months after purchase. It is a versioned rule in `alerts/rules/`, uses the synthetic usage data from item 14, and is routed to the account team. Done when the rule fires on seeded cases and stays silent before six months.
13. **Distribution lists (E), design only until Alex answers.** Write down how a list would work without breaking "only people who may see the account". For example, a list expands to members, and each member is still checked. Build it only if Alex says yes.

## Adedoyin (@brovaset)

14. **Synthetic usage data (F).** Monthly usage per account and product, against purchased quantity, in the seed. Labeled synthetic and deterministic. It must include accounts on both sides of 20% at the six-month mark. Done when item 12 can test against it.
15. **Coverage target and colors (C).** Add a reviewed `target: 3` to `pipeline_coverage` in the registry. Show on or off target in the sentence and the receipt. Use red below 2x, amber from 2x to 3x and green at 3x and above, with the words in the text, not color alone. Add a bullet ("battery") chart: actual bar against the target line. Confirm the thresholds once Alex replies to item 1. Done when golden phrases and the dashboard show the label.
16. **Question trends report (I).** A script or page built from `query_audit` that counts questions by metric, outcome (answered, asked, refused) and week, with no question text. It answers "what are people asking that we can't answer yet?" Done when it runs on the demo database and is linked from the runbook.

## Dates

| By | What |
|---|---|
| Mon Oct 26 | Item 1 email sent; #50 to #52 merged |
| Thu Oct 29 | Items 3, 7, 11, 14, 15 merged |
| Sun Nov 1 | Everything else merged; item 4 re-score done |
| Week of Nov 2 | Dry run with Alex; item 6 release |
| Mon Nov 9 | Demo Day |

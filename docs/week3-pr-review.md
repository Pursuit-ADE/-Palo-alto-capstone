# Week 3 PR review — PR #3

Reviewed head `4e1bd717` of [PR #3](https://github.com/Pursuit-ADE/-Palo-alto-capstone/pull/3), "Week 3: conversation, intent model, charts and red-team suite," against the approved PRD v1.1, the roadmap v1.1, the diff, and the hosted checks on that commit.

## Merge recommendation

**Safe to merge.** The branch is 13 commits ahead of `main` (`fd31c3e`) and 0 behind. GitHub reports it mergeable, rebaseable, and clean.

The approved PRD stops at A9. It has no A10, and it does not require a missing-quota sentence. The roadmap Week 3 exit check is that the technical-seller flow works end to end. A null coverage ratio on this head is rendered as an empty value and a `$0` denominator, but the checked-in Maven seed has a quota in every region, and `a6849df` on `week5` already treats a missing quota as unavailable. That is not a reason to hold PR #3.

## Findings, ordered by severity

### Not a blocker — a null coverage ratio is rendered as zero on this head

- `src/semantic/compile.ts` uses `NULLIF` on the denominator, so a zero or null denominator makes `value` null. A region with no quota row is omitted, because the grouped query starts from the quota side.
- `src/semantic/narrative.ts` still prints a ratio row when `value` is null. `Number(r.denominator ?? 0)` turns that missing denominator into `$0`. For a null value and a numerator of 100 the sentence is `Pipeline coverage for FY27-Q1 is : $100 of open pipeline closing in the quarter against $0 of quota.`
- `app/page.tsx` does the same for the dashboard: `Number(coverage.rows[0]?.value ?? 0)` and `Number(r.value ?? 0)` become `0.00x`.
- `tests/governed-query.test.ts` and `tests/conversation-and-redteam.test.ts` do not cover a null ratio. The Maven seed test expects a quota in every region.

`registry/glossary.json` on this head has no `no_quota` rule. On `week5` (`a6849df`) the glossary rule `no_quota` says coverage is not available where there is no quota, and `src/semantic/narrative.ts`, `app/page.tsx`, and `tests/week5-review.test.ts` already implement and check that. Do not add a second copy of that work on this pull request.

### Follow-up — answers do not show the metric definition text

PRD A4 requires the scope statement to include the metric, definition version, filters, role scope, and data timestamp. The goals also say each answer states the metric definition and the scope it used.

`src/semantic/answer.ts` returns the metric id, name, and version, the intent, the scope sentence, the snapshot id, the as-of date, and the result hash. `app/ask-panel.tsx` shows those fields. The metric description from the registry is not on the answer. The audit row id is created inside `audit()` and is not returned. A4 does not require an audit id.

Dashboard tiles use `answerIntent()` and do not render the receipt that the chat shows.

[PR #13](https://github.com/Pursuit-ADE/-Palo-alto-capstone/pull/13) is still an open draft against `week3`. [PR #14](https://github.com/Pursuit-ADE/-Palo-alto-capstone/pull/14) is the open provenance panel against `week5`. This review does not duplicate either one.

### Follow-up — the audit row matches S4, and it does not store fields S4 does not name

PRD S4 requires the user, a question hash or redacted text, the normalized intent, the metric version, the filters, the data snapshot, and the result hash. It says not to store raw rows.

`query_audit` stores the user, the HMAC question fingerprint, the intent (filters are inside that JSON), the metric id and version, the regions, the owner count, the snapshot id, the result hash, the outcome, the reason, the flags, the model, and the turn. Raw question text is not stored. A failed audit write returns no answer (`tests/audit-and-limits.test.ts`).

S4 does not require a compiled-query hash, a parameter hash, or a row count. Those are not missing S4 fields.

### Follow-up — the golden set is smaller than the success criterion

`registry/golden/phrases.json` has 30 cases: 7 `open_pipeline`, 5 `pipeline_coverage`, 6 `open_opportunity_count`, 10 clarifications, and 2 unsupported. The earlier count of 6, 5, and 5 was short by one pipeline phrasing and one opportunity-count phrasing.

Each metric case records the expected intent only. It does not record an identity, a metric version, or an expected number. `tests/golden.test.ts` runs in the test job and checks that the normalizer returns that intent. `scripts/eval-golden.ts` checks the configured model the same way, and it also counts a clarification as a match for a case marked unsupported. CI does not run `scripts/eval-golden.ts`.

The PRD success criterion is 10 to 20 phrasings per metric, with the same number for the same role and snapshot. This fixture does not meet that size. That is a Demo Day consistency gap, not a Week 3 merge block. The branch's own test requires at least 5 phrasings per metric, and this file meets that.

### Follow-up — the red-team file is the Week 3 suite, not a finished S6 matrix

`tests/conversation-and-redteam.test.ts` covers direct override, fake authority, emotional pressure, gradual region escalation, SQL and link text, a tampered prior intent, and a hostile model. The override, authority, and pressure cases assert an audit row. The SQL and link cases assert `flagQuestion()` and the in-scope number. They do not assert an audit row.

`app/actions.ts` has no role field. The form user id is accepted only when test identities are on and the id is one of the demo ids. There is no server-owned thread id. The previous intent is the JSON the browser sends back, and `ask()` validates it again.

`docs/WALKTHROUGH.md` points Week 4 at `docs/RED-TEAM.md`. That file is not on this head. `README.md` titles the current file "Red-team suite (S1, S2, S6)." The roadmap says the suite starts in Week 3 and is finalized in Week 5. The README title is ahead of that.

### Follow-up — charts are categorical bars

`src/semantic/narrative.ts` returns a bar spec only when there is one breakdown and at least two rows. A single number gets no chart. The table and the narrative still show the answer. A6 is a Should. The roadmap cut order allows cutting charts beyond basic bar and line. This head has the bar.

### Follow-up — the walkthrough and the README describe the model differently

`docs/WALKTHROUGH.md` says the phrase match is not a real AI model and cites `src/semantic/normalize.ts`. That file is on this head, and it is what `tests/golden.test.ts` calls. `README.md` also documents the optional Claude adapter, off unless `INTENT_MODEL=claude`, with a fallback to the deterministic model. Both can be true. The walkthrough does not mention the adapter.

The same walkthrough marks Week 3 done and names `docs/RED-TEAM.md` for Week 4. The file is not on this head.

### Dependency scan threshold

`.github/workflows/ci.yml` and `.github/workflows/alerts-ci.yml` run `npm audit --audit-level=high`. This review did not re-run an unthresholded audit, so it does not repeat a finding count or an advisory id.

## PRD requirement coverage

| Requirement | Status on `4e1bd717` | Evidence |
| --- | --- | --- |
| A2 — strict intent normalization | Met for this slice | Strict Intent in `src/registry/types.ts`. Registry check in `src/semantic/compile.ts`. Hostile-model cases in `tests/conversation-and-redteam.test.ts`. Golden file is under the 10-to-20 PRD size. |
| A3 — scope below the AI | Met for the demo | Scope is resolved again after the model returns (`src/semantic/answer.ts`). SQL intersects the server principal (`src/semantic/compile.ts`). Role-change-during-model test in `tests/conversation-and-redteam.test.ts`. |
| A4 — scope statement | Partial | Metric, version, intent, scope, snapshot id, and as-of date are on the chat receipt. The metric definition text is not. |
| A5 — follow-ups | Met | One structured intent is revalidated and re-scoped every turn. The 10-turn test compares chat rows with fresh questions. The form turn field caps at 50. There is no user-facing turn limit. |
| A6 — charts | Partial, and A6 is a Should | Deterministic bar spec from governed rows. No model-written chart. |
| S1 — injection | Met for the current inputs | Override, link, SQL, and hostile-model cases stay in scope or are refused. No URL fetch path. |
| S2 — social engineering | Met for the current inputs | Fake CEO, job pressure, role claims, and conversational scope drift do not widen scope. |
| S3 — detection and response | Met for one process, and S3 is a Should | `src/server/limits.ts` keeps the flag lock in memory for that process. |
| S4 — audit log | Met for the PRD field list | User, question fingerprint, intent, metric version, snapshot, and result hash are stored. Raw question text and raw rows are not. |
| S5 — repository controls | Hosted checks passed | Test, Postgres-role, secret-scan, and CodeQL runs on this head completed successfully. Lockfiles are committed. |
| S6 — red-team in CI | Started, not finalized | The Week 3 cases run in the test job. The roadmap leaves the finished matrix to Week 5. |
| A9 — context layer | Partial | Versioned registry files are what the normalizer and the compiler read. This head's glossary has terms and phrases, and it has no `businessRules` array. |
| Alerts | No new blocker in this diff | Slack link defanging and retry behavior are covered by the alerts tests that already exist. Scheduler, preferences, and digests stay on the Week 4 scope in the walkthrough. |

## What is already elsewhere

- Missing-quota wording, chart omission, and the `no_quota` glossary rule are on `week5` at `a6849df`.
- Provenance panel work is PR #13 (draft, `week3`) and PR #14 (open, `week5`).
- The larger golden set and the rest of the red-team matrix are later-week items in the roadmap.

## Checks

On `4e1bd717`, GitHub reports 10 completed successful check runs: `test` four times, `analyze` twice, `postgres-roles` twice, and `secret-scan` twice. The repeated names are the push run and the pull-request run.

The current approvals are two approval submissions from the same reviewer. An earlier approval from that reviewer was dismissed after later commits.

This pass did not re-run the local typecheck, test, build, or golden eval, so those local counts are not restated here.

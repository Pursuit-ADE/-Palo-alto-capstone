# Week 3 PR review — PR #3

Reviewed current head `4e1bd717` of [Pursuit-ADE/-Palo-alto-capstone PR #3](https://github.com/Pursuit-ADE/-Palo-alto-capstone/pull/3), "Week 3: conversation, intent model, charts and red-team suite," against the approved PRD, build blueprint, discovery summary, full current diff, review conversation, branch history, hosted checks, and local verification.

## Merge recommendation

**Changes required.** The branch is structurally safe to merge and most of the Week 3 slice is strong, but one user-visible Must requirement is broken on code introduced here: missing/zero quota is rendered as a malformed ratio and an invented `$0` denominator. Fix that behavior and add the regression test before merging. The other gaps below are bounded follow-ups rather than reasons to hold this PR.

## Findings, ordered by severity

### Blocker — missing quota produces a malformed and misleading answer

- `src/semantic/compile.ts:100-105` correctly returns `NULL` by dividing through `NULLIF(denominator, 0)`, but the new narrative path does not preserve the reason.
- `src/semantic/narrative.ts:12-18` renders a ratio row without checking `value` or `denominator` for `null`; it converts a missing denominator to `0` with `Number(r.denominator ?? 0)`.
- The dashboard has the same failure: `app/page.tsx:30-37,82-100` converts null coverage values to zero for the KPI and regional bars.
- Reproduction on the PR head:
  `Pipeline coverage for FY27-Q1 is : $100 of open pipeline closing in the quarter against $0 of quota.`
- There is no missing- or zero-quota regression in `tests/governed-query.test.ts:33-59` or `tests/conversation-and-redteam.test.ts:167-176`.

This violates the PRD rule that missing/zero quota returns `null` **with an explanation**, never zero or an invented value; it also misses A10 and the Week 3 "missing-quota usable state" gate. Return a typed unavailable reason, render "Coverage unavailable because no applicable quota exists," suppress the chart/value, and test both zero and absent quota.

### High follow-up — successful answers still do not satisfy A4 provenance

- `src/semantic/answer.ts:96-104` returns metric ID/name/version, intent, scope, snapshot ID/date, and result hash, but no human-readable metric definition/formula or audit ID.
- `app/ask-panel.tsx:110-113` displays those same fields; it cannot expose an audit ID because `audit()` creates an internal random row ID at `src/semantic/answer.ts:56-58` and discards it.
- Dashboard tiles are also governed answers (`answerIntent()` at `app/page.tsx:30-35`), but their rendered KPI/bar surfaces at `:67-106` omit metric version, filters, snapshot and audit ID.
- A4 requires metric ID/name, definition version, dimensions, filters, time range, role-derived scope, snapshot time, and audit ID. The raw intent covers dimensions/filters/period, but definition/formula, audit ID, and loaded snapshot timestamp are absent.

This is a pre-existing Week 2 Must gap, not a regression introduced by the Week 3 feature. It is already being addressed separately by PR #13, so do not duplicate that work here; ensure that PR lands before claiming complete PRD compliance.

### High follow-up — S4 audit evidence is materially incomplete

- `src/db/schema.ts:122-143` stores identity, role, normalized intent, metric/version, regions, owner count, snapshot, result hash, outcome, reason codes, model, and turn.
- It does **not** store the PRD-required compiled-query hash, parameter hash, row/group count, or a complete scope summary/policy decision. `src/semantic/answer.ts:81-95` compiles and executes the query but records none of those missing fields.
- Privacy behavior is otherwise good: raw questions are HMAC-fingerprinted (`src/semantic/answer.ts:33-43`), model clarification text is fingerprinted instead of stored (`:168-173`), and audit failure prevents an answer (`tests/audit-and-limits.test.ts:62-66`).

Treat the missing audit fields as a Week 5 governance/handoff requirement unless the team wants every Must green at each weekly merge.

### Medium follow-up — golden-set proof is smaller than the approved contract

- `registry/golden/phrases.json` has 30 cases total, but only 6 executable `open_pipeline`, 5 `pipeline_coverage`, and 5 `open_opportunity_count` phrasings; the rest are shared clarification/unsupported cases.
- The fixture records expected intents only. It does not record the required mock identity, metric version, expected numeric result, or per-case fixed snapshot result.
- `scripts/eval-golden.ts:10-24` checks intent/clarification equivalence only, and CI does not run this script. The local deterministic run is 30/30.
- The PRD calls for 10–20 equivalent or intentionally ambiguous phrasings **per Must metric**, with identity, version, time, dimensions/filters, clarification, and expected numeric result.

Expand the fixture before the Demo Day consistency claim. It need not block this merge if the claim is limited to "the current 30-case intent fixture passes."

### Medium follow-up — this is a partial S6 suite, not the full required matrix

- `tests/conversation-and-redteam.test.ts:101-148` covers direct override, fake authority, emotional pressure, gradual region escalation, SQL/link text, a tampered prior intent, and a hostile model.
- Client role-field tampering is not tested at the Server Action boundary (`app/actions.ts:22-46`); cross-user thread access is not represented because there are no server-owned thread IDs; and poisoned event-label handling is only indirectly covered by Slack escaping tests, not by an expected security reason code.
- The current suite also does not assert an audit row for the SQL/link cases; it checks only `flagQuestion()` (`tests/conversation-and-redteam.test.ts:122-132`).
- `docs/WALKTHROUGH.md:83-86` correctly defers the full red-team matrix to Week 4, but `README.md:61` labels this partial suite "S1, S2, S6," which can be read as complete coverage.

Keep this as a Week 4 follow-up, add the missing matrix rows and exact reason-code assertions, and describe Week 3 as the baseline red-team suite rather than completed S6.

### Medium follow-up — chart mapping implements bars only

- `src/semantic/narrative.ts:37-51` returns a bar spec only when there is exactly one breakdown and at least two rows; all KPI and other shapes return `null`.
- The UI provides a number/table fallback, so current supported questions remain usable, and chart code is deterministic and model-independent.
- A6 is a Should, but the blueprint's Week 3 gate names line/bar/KPI lookup. Either add explicit allowlisted KPI and time-series mappings when those shapes exist, or narrow the roadmap claim to categorical bars plus the existing KPI answer view.

### Low follow-up — dependency scan is green by threshold but reports known moderate findings

- Both root and `alerts/` installs report four moderate development-chain findings: deprecated `@esbuild-kit` packages and `esbuild` GHSA-67mh-4wv8-2f99 through `drizzle-kit`.
- CI uses `npm audit --audit-level=high` (`.github/workflows/ci.yml:25-27`, `alerts-ci.yml:31-33`), so this correctly does not fail the hosted check.
- The vulnerable esbuild is a nested development-tool dependency, not the production Next.js runtime. Record/triage it and remove the deprecated chain when Drizzle tooling permits; do not force a breaking downgrade merely to make `npm audit` zero.

### Low follow-up — walkthrough claims have drifted

- `docs/WALKTHROUGH.md:30-31` says the product is not using a real AI model, while the same branch includes the optional Claude adapter and documents it in `README.md:59-61`.
- `docs/WALKTHROUGH.md:83-85` labels Week 3 done and points to a Week 4 `docs/RED-TEAM.md`, but that file does not exist on this head.
- Clarify that deterministic normalization is the default, Claude is optional and not yet live-evaluated, and add the red-team document only when the Week 4 matrix exists.

## PRD requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| A2 — strict intent normalization | Strong / partial acceptance | Strict Intent at `src/registry/types.ts:67-85`; registry validation at `src/semantic/compile.ts:26-43`; hostile output tests at `tests/conversation-and-redteam.test.ts:133-147`. Golden fixture contract still undersized. |
| A3 — scope below AI | Pass for demo architecture | Scope reloads before and after model execution (`src/semantic/answer.ts:156-176`); SQL always intersects server principal (`src/semantic/compile.ts:54-66`); role-change-during-model test at `tests/conversation-and-redteam.test.ts:210-224`. |
| A4 — scope/provenance | Partial | Scope, metric/version, intent, snapshot and result hash displayed; definition/formula, audit ID and loaded timestamp missing. |
| A5 — governed follow-ups | Pass | Only one strict structured intent is carried, revalidated and re-scoped every turn (`src/semantic/answer.ts:139-176`); 10-turn/fresh-answer equivalence and tamper tests at `tests/conversation-and-redteam.test.ts:47-99`. No fixed answer-turn limit. |
| A6 — deterministic charts | Partial | Deterministic categorical bar spec from governed rows; no model chart code. KPI/time-series allowlist is not implemented. |
| S1 — direct/indirect injection | Pass for current inputs | Override/link/SQL and hostile-model cases preserve scope; no URL fetch path. Poisoned alert label belongs in the Week 4 full matrix. |
| S2 — social engineering | Pass | Fake CEO, job pressure, role claims, and conversational scope drift are tested without widening. |
| S3 — detection/response | Pass for single-process demo | Deterministic flags and per-user lock (`src/semantic/flags.ts`, `src/server/limits.ts:21-43`), documented as in-memory only. |
| S4 — privacy-conscious audit | Partial | Privacy and key decision fields are strong; query/parameter hashes, row/group count and complete scope/policy evidence are missing. |
| S5 — repository controls | Pass with tracked moderate findings | Current hosted test/build/dependency, Postgres-role, secret-scan and CodeQL checks all succeed; lockfiles committed. |
| S6 — red-team in CI | Partial, Week 4 gate | Core prompt attacks run in CI; client-role tampering, cross-user thread semantics, poisoned labels and exact reason-code matrix remain. |
| A9/A10 governance | A9 pass; A10 fail | Shared versioned registry/context is used. Missing-quota rendering is incorrect and is the merge blocker. |
| Alerts touched by this PR | No new blocker found | Slack link defanging and retry regressions are tested. Scheduler/preferences/digests and the full matrix remain the declared Week 4 scope. |

## Merge blockers versus Week 4/5 follow-ups

**Before merging PR #3**

1. Fix missing/zero-quota response semantics and add regression tests at ungrouped and grouped grains.
2. Re-run root and alerts typecheck/tests/build; keep hosted checks green.

**Week 4**

- Complete S6 matrix: forged client role/account fields, cross-user conversation behavior, poisoned event labels, and per-case audit reason codes.
- Complete alert scheduler/preferences/digests and persistent delivery operations as already planned.

**Week 5 / before claiming Demo Day PRD compliance**

- Land the A4 provenance/audit-ID work already tracked in PR #13.
- Complete S4 query/parameter hashes, counts, and policy/scope evidence.
- Expand the golden fixture to the PRD contract and run the allowed live provider against it before enabling Claude.
- Resolve or formally accept the four moderate dev-tool dependency findings.
- Add clean-machine, accessibility/mobile, timeout/recovery and explicit database/validation-error smoke evidence.

## Product assessment

The build is substantively good: the model proposes rather than executes; strict validation and fresh server scope remain authoritative; conversation state is bounded; deterministic narratives/charts use governed rows; direct attacks and a compromised model cannot widen access; and the branch has unusually strong regression coverage. It is good enough to continue the roadmap after the one missing-quota blocker is fixed.

Do not add new product features now. The genuinely useful additions are evidence and failure-handling work already implied by the PRD: typed unavailable results, the remaining red-team matrix, complete provenance/audit evidence, and a contract-complete golden fixture.

## Stack/base and merge safety

- PR base is current `main` at `fd31c3e` (Week 2 merged); head is `4e1bd717`.
- `git rev-list --left-right --count main...pr-3` is `0 13`: the PR is 13 commits ahead and not behind.
- GitHub reports `mergeable: true`, `rebaseable: true`, and `mergeable_state: clean`; generated merge ref is `8b3cbed`.
- The earlier stack dependency is resolved by retargeting from `week2` to `main`. No unrelated Week 4/5 commits are in the PR diff.

## Current checks and local verification

- GitHub API reports **10/10 current check runs completed successfully** on `4e1bd717`: test/build/dependency jobs, Postgres-role checks, secret scans, and CodeQL (duplicate push/PR workflow runs account for repeated names).
- Current head has two approvals; an older approval was dismissed after later commits and is not relied upon.
- Local root verification: typecheck passed; **107 tests passed, 4 skipped**; production build passed; deterministic golden eval **30/30**.
- Local alerts verification: typecheck passed; **39 tests passed**; production build passed. Build emitted Turbopack tracing/root warnings but completed successfully.
- Local unthresholded audits report four moderate findings in each package; hosted audit checks remain green because the configured threshold is high.
- `git diff --check main...pr-3` passes.

Origin CLI was attempted as requested, but this GitHub-only repository is not available on Origin (`Repository pursuit-ade/-Palo-alto-capstone was not found on Origin`). The current PR metadata, conversation, diff refs, approvals, and checks were therefore verified read-only from the public GitHub repository/API and local Git history; no PR action was taken.

## Context reviewed

- Approved governed analytics copilot PRD
- Build blueprint and Week 3/4/5 gates
- Discovery-call summary
- Full current PR diff and review timeline, excluding the already-fixed follow-up inheritance, noisy-flag, lockout, clarification-state, provider-fallback, migration, retry, Slack-link, provider-doc and README findings

# ALTO PALS adversarial follow-up — 2026-10-24

## Scope and pinned inputs

Repository: `Pursuit-ADE/-Palo-alto-capstone`. Isolated branch: `trevor/redteam-boundaries`, based on `week5`.

- `week5`: `ea45608ee09a4714985c4a4eea924ef158014f8e`.
- PR #50, `trevor/why-number-differs`: `e2851c90fdefe976cf835cea4a3efc7ae1f77901`, open, base `week5`.
- PR #51, `trevor/semantic-invariance`: `91a8720f4a6f05b67a24f169a57771aebbf4b00b`, open, base `week5`.
- `main`: `018a8fc3466b3b48096106bc663261f3c82a0387` (different history position; this patch intentionally targets `week5`).

All database mutations occurred in local, disposable PGlite databases loaded with the repository's fictional sample and synthetic fixtures. No production service, provider call, real channel delivery, credential enumeration, or business-data export was performed. Model probes use injected stubs, not Claude. Baseline source links below are immutable.

## Reproduced defects and minimal fixes

### R1 — Missing quota rows silently remove a pipeline region (medium)

**Prerequisite:** an authorized region has open pipeline for the requested quarter but no matching quota rows. Zero-valued quota rows are a different case, already covered by existing tests.

**Steps:** open a disposable seeded database; remove Central's FY27-Q1 quota rows; request pipeline coverage grouped by region as the analyst. The baseline omits Central entirely despite its positive pipeline. The new regression fails with `expected undefined to be defined`.

**Impact:** the breakdown and narrative hide an uncovered region. This is reporting integrity, not an authorization bypass. An overall ratio already sums numerator and denominator independently; this patch does not define whether a partially incomplete total should be unavailable.

**Cause:** the breakdown starts from `den LEFT JOIN num`. [Baseline compiler, lines 197–207](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/compile.ts#L197-L207).

**Fix:** full outer join, coalesce the region key, preserve the positive numerator and null denominator/value. Existing narrative reports no quota and omits unavailable values from the chart. Regions with neither pipeline nor quota remain absent; this is not a complete region scaffold.

**Test:** `tests/redteam-boundaries.test.ts`, first test. Fails before the patch and passes afterward.

### R2 — Relative-period interpretation and execution select different snapshots (medium)

**Prerequisite:** a newer snapshot is published while an intent model is running. No malicious user privilege is needed; this is a concurrent data-refresh condition.

**Steps:** start “open pipeline this quarter”; inside the synthetic model barrier publish a November snapshot; return the Q1 intent derived from the original October snapshot. Baseline executes against the November snapshot and reports its provenance. Regression: expected `snap_alto-pals-v2`, received `snap_redteam_new`.

**Impact:** a legitimate refresh can change the data version under an already interpreted question, returning zero or another result for the old quarter with new provenance. The fixture deliberately uses a new snapshot with no opportunity rows to make the switch visible; it does not claim that a production loader publishes incomplete snapshots.

**Cause:** [ask selects snapshot before proposing](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/answer.ts#L342-L356), while [run selects it again](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/answer.ts#L160-L168).

**Fix:** carry the snapshot row selected for interpretation into execution. Resolve authorization again after the model as before. Structured dashboard requests still select their own current snapshot.

**Test:** `tests/redteam-boundaries.test.ts`, second test. This pins the version identifier; it does not make rows immutable or serialize concurrent in-place edits.

### R3 — Older scheduler completion can regress the event cursor (low)

**Prerequisite:** overlapping processes complete ticks out of timestamp order, or the wall clock moves backward. The in-process scheduler itself serializes ticks.

**Steps:** store cursor 14:00; finish a tick with `now=13:00`. Baseline stores 13:00. The fixture isolates the exact final-write interleaving without relying on nondeterministic simultaneous execution.

**Impact:** unnecessary re-scanning, extra eligibility checks and misleading progress. Existing unique delivery keys and claim tokens limit duplication; this is not proof of duplicate delivery or missed events.

**Cause:** [unconditional cursor upsert](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/alerts/src/alerts/scheduler.ts#L23-L31).

**Fix:** atomic `GREATEST(stored_cursor, tick_time)` in the conflict update. No scheduler lock or migration is introduced.

**Test:** `alerts/tests/redteam-cursor.test.ts`. Baseline fails (13:00 instead of 14:00); patch passes.

### R4 — A schema-valid wrong model metric reaches an authorized answer (medium)

**Prerequisite:** the selected model proposes a valid but wrong metric for an otherwise clear question. This is a fault-injection proof; the frequency of live Claude misclassification was not measured.

**Steps:** ask the East seller “how many open deals?”; inject a model proposing `open_pipeline`. Baseline returns a currency answer with correct access restrictions and provenance. Access, SQL validation, and a result hash do not verify question meaning.

**Cause:** [the proposed intent proceeds straight to run](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/answer.ts#L343-L356).

**Impact:** an authorized, auditable answer to the wrong question. This extends the previously identified PR #51 model gap into a runtime mitigation.

**Fix:** when both model and deterministic normalizer produce intents but disagree on metric, ask a fixed clarification. Validate the proposal before comparing, preserving malformed-intent refusals. Do not silently replace the model's choice. This is a bounded disagreement guard: agreement can still be wrong, and deterministic clarification/unsupported outcomes do not establish what the correct model metric is. Filters, periods and breakdowns are not compared by this guard.

**Test:** `tests/redteam-observations.test.ts`, first test. Changed the observed-answer probe into a regression expecting clarification; it failed before this guard.

## Confirmed behavior requiring policy or broader design work

### E1 — Differential errors expose catalog membership (low with current public fictional data; potentially medium with a private directory)

**Reproduced:** two synthetic model proposals through `askWithFallback`, under the same East identity, yield “You do not have access to Darcel Schlecht” versus “Unknown person: Synthetic Missing Person.” No out-of-scope deal rows were returned. `tests/redteam-observations.test.ts`, second test, records this behavior explicitly as an evidence probe, not a security-policy assertion.

**Static proof:** [person resolution, lines 119–130](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/compile.ts#L119-L130) and [team resolution, lines 134–148](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/src/semantic/compile.ts#L134-L148) distinguish unknown from unauthorized catalog entries. The typed normalizer also recognizes globally known selectors, so changing only compiler error strings would be incomplete.

**Prerequisite/impact:** a caller can submit candidate names; sensitive global names would become a membership oracle. Current names come from a public fictional dataset, so this is not demonstrated private-data disclosure. The injected-model test proves the server boundary, not that every unknown name reaches the same path with either live model.

**Proposed fix if names must be secret:** scope selector lookup and UI catalogs to the principal; use the same public response for nonexistent and inaccessible selections; test deterministic and model paths, team names and clarification resumes. Keep internal audit reason codes separate. Not patched here because the repository currently treats the fictional catalog as global, and the disclosure policy is unresolved.

### E2 — Late-event coverage is bounded by business time (static proof; missed late import is a conditional risk)

[Scheduler lookback](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/alerts/src/alerts/scheduler.ts#L12-L26) defaults to 72 hours and caps configuration at 31 days. [Event matching](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/alerts/src/alerts/engine.ts#L44-L85) filters opened/occurred time, not ingestion time.

An event inserted after the cursor with business time older than the lookback (or earlier than `start`) cannot be selected on subsequent advancing ticks. Impact is a missed alert if imports can be that late. Existing tests demonstrate short-delay recovery only. A larger window changes the bound; it does not eliminate it. A durable ingestion sequence plus event-time eligibility and deduplication is the stronger design. No ingestion SLA or production importer behavior was established, so this is not asserted as a violated product guarantee.

### E3 — Dual-app offboarding is local to each database (static proof; medium operational risk if one-app disable is assumed global)

[Administration script](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/scripts/accounts.ts#L16-L36) selects exactly one database. The apps maintain separate account/session tables. Disabling only the copilot account does not disable the alerts account; [alert eligibility](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/alerts/src/alerts/engine.ts#L163-L181) checks its local account state.

This is documented per-app administration, not a demonstrated session forgery. If organization-wide offboarding is required, use a shared subject lifecycle or an explicit both-app operation with failure reporting. Different usernames can represent the same invited user in each app; matching usernames alone is unsafe. No production identity drift was observed. Alerts already rejects an explicitly non-Maven dataset setting; different independently configured app environments remain an operational hypothesis.

## CI and branch integrity

At inspection, connector run records for exact PR #50 head showed successful `ci` run 40030429914, `docker` 40030429894, and `codeql` 40030429883. PR #51 head showed successful `ci` 40042828696, `docker` 40042828316 and `codeql` 40042828226. These are historical head-associated runs, not proof of required checks on the current base or this new branch.

[CI triggers](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/.github/workflows/ci.yml#L4-L14) cover all PRs and push branches main/week*. [Alerts CI](https://github.com/Pursuit-ADE/-Palo-alto-capstone/blob/ea45608ee09a4714985c4a4eea924ef158014f8e/.github/workflows/alerts-ci.yml#L5-L9) is path-filtered on PRs. Actions are SHA-pinned and permissions read-only. No `pull_request_target` execution was identified in these workflows.

The branch-protection API request returned HTTP 404. This does not establish whether protection is absent or inaccessible. Rulesets, required checks, stale-review dismissal, strict up-to-date checks and admin bypass remain unverified. CODEOWNERS declares reviewers but does not enforce approval by itself. No repository settings or workflow permissions were modified. The difference between main and week5 is a targeting concern, not by itself proof of compromised CI.

## Residual hypotheses and limits

- Authorization is refreshed after model completion, but principal lookup and data execution are separate statements. A subsequent revocation can race execution. No transaction/RLS proof or production exploit was attempted.
- Snapshot pinning assumes versioned rows are stable after publication. In-place mutations under the same ID can still change results; this patch does not provide immutable storage.
- Atomic claim tokens protect alert row ownership, but stale takeover after channel acceptance remains at-least-once delivery, as the engine documents. External-channel idempotency is a separate requirement.
- Role/subscription/account checks precede the channel call; revocation during a call cannot recall an accepted message. Not reported as a newly demonstrated bypass.
- A future-clock tick can move the cursor forward beyond the lateness window. Monotonicity fixes backward movement only; cross-host clock discipline or a database clock remains a separate design issue.
- No production Postgres concurrency run or live Claude test was performed. No merge was performed.

## Validation of the patch

- Main app: 652 passed, 7 skipped; 28 test files passed, 1 skipped (`vitest run --maxWorkers=2`).
- Alerts: 86 passed, 2 skipped; 12 test files passed, 1 skipped (same worker limit).
- Both apps: `npm run typecheck` and `npm run build` pass.
- Main lint: no errors, 139 warnings and 1 informational diagnostic; touched-file lint has four complexity warnings. No lint suppression was added.
- `git diff --check` passes.
- Four desired-behavior regressions were observed failing before their respective fixes; the differential-error evidence probe passes on the baseline and patched code.
- Default-worker full-suite runs were interrupted after resource contention and hook timeouts; the bounded-worker runs above completed. The first bounded main run caught validation being bypassed by the new disagreement guard; validation was restored before comparison and the final complete main run passes.
- Real-Postgres role tests are among environment-dependent skipped tests. PGlite executes PostgreSQL SQL, but this is not a substitute for a multi-process Postgres concurrency test.
- PR #50/#51 were pinned and their code paths considered; this branch is not a combined integration of those unmerged PRs. In particular, #50 moved `run()` into `governed.ts`, and #51 currently demonstrates the wrong-metric answer in its own test. When composing these changes, carry snapshot pinning into the moved function and update that evidence test to expect clarification. No combined-suite pass is claimed.

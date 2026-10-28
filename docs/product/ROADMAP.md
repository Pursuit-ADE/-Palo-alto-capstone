# Governed AI Analytics Copilot: Roadmap

**v1.2** · v1 approved by Alex Sanginov on Oct 7 · updated Oct 26 after the Oct 24 call (see [change log](#6-change-log))
· Team ALTO PALS × Palo Alto Networks Customer Analytics · Demo Day Mon Nov 9, 2026

This roadmap says when things happen. What we build and why is in the [PRD](PRD.md). It is a living document: it changes
with each client update and does not need the PRD re-approved. IDs (A1, L2, S8…) refer to the PRD. Who owns each item is
in the [Oct 24 feedback plan](2026-10-24-alex-feedback-plan.md).

## 1. Milestones

| Milestone | Date | What it means | Status |
|---|---|---|---|
| M0 · Discovery | Oct 5 | Problem, persona and data direction confirmed with Alex | Done |
| M1 · PRD and roadmap | Oct 7 | Both delivered and approved by Alex | Done |
| M2 · Data and registry | Oct 11 | Dataset loaded with quota and account-team tables; 3 governed metrics | Done, `v0.1.0` |
| M3 · Governed query end to end | Oct 18 | Same formula, different legitimate scopes; tampering and SQL-injection tests | Done, `v0.2.0` (Oct 14) |
| M4 · Copilot experience | Oct 25 | Golden set, follow-ups, charts, provenance, red team | Done, `v0.3.0` (Oct 17) |
| M5 · Private alerts and red team | Nov 1 | Alerts deliver privately; red-team suite complete | Done early, `v0.5.0` (Oct 24); midpoint call with Alex Oct 24 |
| M6 · Alex's Oct 24 asks | Sun Nov 1 | Everything in the feedback plan merged; Claude re-scored | In progress, `v0.6.0` Oct 29 |
| M7 · Dry run with Alex | By Sun Nov 1 | 30-minute walkthrough on a release candidate, so his feedback lands before the freeze | To book, `v1.0.0-rc.1` |
| **Code and presentation freeze (Pursuit)** | **Mon Nov 2** | Last code merged to `main`; the Demo Day deck is final | `v1.0.0` tagged on the frozen commit |
| Dress rehearsal with staff (Pursuit, mandatory) | Wed Nov 4, 6:30–9:30 PM | Full run of the deck and live demo | Planned |
| Final dress rehearsals (Pursuit, mandatory) | Sat Nov 7 – Sun Nov 8 | Two runs from a reset demo | Planned |
| Demo Day | Mon Nov 9 | Scandinavia House, set up at 4 PM. Live demo and repo handover | Planned |

Buffer rule: each week is feature-complete on Friday; the weekend is buffer, and the milestone is checked on Sunday.

## 2. What's left, week by week

| Week | Dates | Deliverables (PRD IDs) | Exit check |
|---|---|---|---|
| Week 6 | Oct 26–Nov 1 (last week to merge code) | Coverage against the 3x target (A11) · low-usage alert (L2) · question trends, topic labels and the trends agent (S10) · the agent's rules written down (S9) · comparison questions answer properly or ask (#50–#52) · Claude re-scored on the golden set and red team (S6) · GCP and BigQuery design (D2) · PRD and roadmap v1.2 | Feedback-plan items merged by Sun Nov 1; `v0.6.0` Thu Oct 29; `v1.0.0-rc.1` for the dry run |
| Week 7 | Nov 2–Nov 8 | Code frozen Mon Nov 2: tag `v1.0.0`. After that, only the demo script, rehearsals and docs change; a fix to code only for a demo-breaking bug, agreed by the whole team · staff dress rehearsal Wed Nov 4 · final rehearsals Sat Nov 7–Sun Nov 8 · clean-machine setup · demo run from reset | Deck and code frozen; rehearsed three times |
| Demo Day | Nov 9 | Scandinavia House, set up 4 PM · live demo · repo handover for PANW infosec review | — |

Done before this update (Weeks 1–5): registry and context layer, governed query path, copilot with follow-ups and charts,
private alerts (support case and CXO engagement) with preferences and send-time re-checks, red-team suite, second dataset,
demo sign-in, executive-first answers and 2D charts (A10, #56), employee status before alerts (L7, #55), synthetic product
usage (#59), and the independent evaluator in its own repository (S8).

## 3. Client touchpoints

- Weekly email update: what shipped, a screenshot, decisions needed, scope changes and open questions.
- Oct 24: midpoint call. His asks are in the [feedback plan](2026-10-24-alex-feedback-plan.md) and PRD v1.2.
- Week of Oct 26: email Alex to book the dry run before Sun Nov 1, and ask the open questions in PRD section 8.
- By Sun Nov 1: dry run. Walk through tech stack, architecture and deployment (including the GCP path), as he asked.
- Nov 9: Demo Day.

## 4. Risks

| Risk | Impact | Plan |
|---|---|---|
| CI not running (GitHub billing, Oct 26) | High | Org owner fixes billing; until then, run the suites locally and merge nothing that touches code |
| Comparison-question fixes (#50–#52) stall | High | Owner pairs with a reviewer this week; if not merged by Sun Nov 1, the demo avoids those questions and says so |
| Claude re-score not run before the dry run | Medium | Run it right after #50–#52 merge; the deterministic model stays the default if Claude regresses |
| Alex's answers on distribution lists and the 2x line come late | Low | Both are design-only or display-only; keep our assumption and label it |
| Code and deck freeze on Mon Nov 2 (Pursuit) | High | Sun Nov 1 is the last merge day; anything not merged by then is cut (list below), not squeezed in after the freeze. Alex's dry run happens before the freeze |

## 5. Scope-cut order

If we run out of time, we write the assumption down and cut scope instead of shipping half-built features:

1. Exploratory labeling outside the registry (A8)
2. Distribution lists (L8): stays a design
3. Claude-written trends summary (keep the plain summary from code, S10)
4. Target bar chart (keep the on/off-target words, A11)
5. Low-usage alert (L2 Should)
6. Urgency-to-channel mapping (keep both channels as user preferences, L5)
7. Real-model intent in the live demo (keep the deterministic model and the governed pipeline)

Never cut: server-side role scope and send-time alert re-authorization, no model-written SQL, definition and answer
provenance, cross-scope and prompt-injection tests, private per-user alert routing, the high-severity support-case alert,
active-employee checks, and a repeatable demo.

## 6. Change log

| Date | Change |
|---|---|
| Oct 6 | v1 drafted from the Oct 5 discovery call |
| Oct 7 | Alex approved PRD and roadmap; context layer and follow-ups with no fixed limit added |
| Oct 8 | v1.1 after team review: synthetic quota and account-team tables, scans in Week 1, red team from Week 3, cut order |
| Oct 26 | v1.2: milestones marked with the releases that met them; Week 6 for Alex's Oct 24 asks; dry run week of Nov 2 on `v1.0.0-rc.1`; release tags; new risks (CI billing, #50–#52); cut order updated. Moved from Word to this file |
| Oct 28 | Pursuit's dates added: code and presentation freeze Mon Nov 2, staff dress rehearsal Wed Nov 4, final rehearsals Nov 7–8, Demo Day at Scandinavia House (set up 4 PM). The dry run with Alex and `v1.0.0` move before or onto the freeze |

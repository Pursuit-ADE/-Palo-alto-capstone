# Product documents

| File | What it is |
|---|---|
| [PRD.md](PRD.md) | What we build and why. The living copy, with a status column |
| [ROADMAP.md](ROADMAP.md) | When: milestones, what's left, risks and the cut order |
| [2026-10-24-alex-feedback-plan.md](2026-10-24-alex-feedback-plan.md) | Alex's Oct 24 asks, checked against the build, with one owner each |
| `ALTO-PALS_PRD_v1.docx.pdf`, `ALTO-PALS_Roadmap_v1.docx.pdf` | The versions Alex approved on Oct 7. Kept for history; don't edit |

## When Alex gives us new information

Every time we hear from Alex (a call, an email, an answer to an open question), update the PRD and the roadmap in the
**same pull request** that records it. Nothing about the client lives only in chat or in someone's notes.

1. **PRD section 8:** add a dated row to "Confirmed with Alex", in his words where possible. Move any question he
   answered out of "Open questions", and add the new ones.
2. **PRD requirements:** add or change the rows his answer affects. Put the date in the requirement ("(Oct 24)"), set
   the priority and status, and keep IDs stable: a new requirement gets the next free ID, an old ID is never reused.
3. **Roadmap:** move milestones, add the work to the right week, and update risks and the cut order if they changed.
4. **Change log:** one dated line in each file saying what changed and why. Bump the version (v1.2, v1.3…).
5. **Feedback plan:** if the information creates new work, add it with one owner.
6. **Shared copies:** after the PR merges, export both files to the team's Google Drive copies (or replace the Drive
   files) so the links we send Alex match the repo.
7. Open the PR with the title "Client update: <date>" and ask one teammate to check it against the call notes.

Requirement IDs in the code (`PRD S7`, `PRD A10`) point here, so a reader can follow a line of code back to the request
that caused it.

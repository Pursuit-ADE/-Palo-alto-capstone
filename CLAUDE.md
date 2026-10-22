# ALTO PALS: governed analytics copilot

Team ALTO PALS capstone for Palo Alto Networks Customer Analytics. A Next.js copilot (root) answers sales
questions from a reviewed metric registry; a private alerts service lives in `alerts/` (its own package).
Read `README.md` for the architecture and `docs/CODING-STANDARDS.md` for the rules. Those rules apply to every
change you make here.

## Commands

```bash
npm run typecheck && npm run lint && npm run format:check && npm test   # before every commit
npm run build
npm run docs:dictionary      # after any change under registry/
(cd alerts && npm run typecheck && npm test)   # when alerts/ changes
```

Node 22.12+ (CI uses 24). Tests use embedded Postgres (PGlite): no Docker, no network.

## Map

- `app/`: Next.js pages, components and server actions (`*actions.ts`).
- `src/semantic/`: intent normalizer, scope and the SQL compiler. The AI never writes SQL.
- `src/server/`: sign-in, sessions, limits, HTTPS and config. Security-sensitive.
- `src/db/`: schema, client and seed. `drizzle/` holds append-only migrations.
- `registry/`: governed metrics, dictionary, glossary and golden phrasings.
- `tests/`: Vitest, one file per behavior. `scripts/`: CLI tools run with `tsx`.

## Rules you must not break

- The user id comes only from the session cookie. Scope is applied in the query on every turn.
- Never edit an applied migration. Never widen a database grant.
- No secrets, no real customer data, no `any`, no skipped tests.
- Match the surrounding style: a one-line purpose comment at the top of each file, comments that explain why,
  and finding or requirement IDs (`audit F10`, `PRD S7`).
- Paths under `.github/CODEOWNERS` need steward review. Say so in the PR when you touch them.

## Git

- Work on a branch (`<name>/<topic>` or `<topic>-week<N>`). Never commit to `main` or `week*` directly.
- Never push, open or merge a PR, or change GitHub settings without the owner's explicit OK in this session.
- One logical change per commit, subject as a plain sentence.

For a standards audit or clean-up, use the `codebase-steward` agent (`.claude/agents/codebase-steward.md`).

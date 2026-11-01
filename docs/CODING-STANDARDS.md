# Coding standards

How code in this repository is written, checked and merged. It describes what the code already does well and
makes it the rule, so a reviewer can point to a line here instead of arguing taste. Applies to the copilot
(root) and the alerts service (`alerts/`).

## 1. Checks every change must pass

Run these from the repo root (and from `alerts/` when you touch it) before you open a pull request. CI runs
every one except the format check (see that row), and a red CI blocks merge.

| Check | Command | Rule |
|---|---|---|
| Types | `npm run typecheck` | No errors. `strict` and `noUncheckedIndexedAccess` stay on. |
| Tests | `npm test` | All pass. Never skip, `.only` or delete a test to get green. |
| Lint | `npm run lint` | No errors (Biome, `biome.jsonc`); CI fails on any error. Warnings are a burn-down: don't add new ones, and fix the existing ones in a function when you change that function (section 9). |
| Format | `npm run format:check` | Not enforced yet. Most files predate the formatter, so this stays local until one formatting-only commit after the open PRs merge; then it joins CI. Until then, don't reformat files you aren't otherwise changing. |
| Build | `npm run build` | Succeeds. |
| Docs in sync | `npm run docs:dictionary` | Re-run after any registry change; `tests/docs.test.ts` fails otherwise. |

## 2. Formatting

Biome decides formatting (`biome.jsonc`), so nobody hand-formats or argues about it in review. Run
`npm run format` to apply it, but not over the whole repo until the formatting-only commit in section 1 lands.
(Biome rather than ESLint and Prettier because typescript-eslint doesn't support TypeScript 7 yet; one tool, no
TypeScript dependency.)

- 2-space indent, LF line endings (`.gitattributes`), UTF-8, final newline (`.editorconfig`).
- Single quotes in TS/TSX, double quotes in JSX attributes, semicolons, trailing commas.
- Print width 140. Break long JSX props and long function signatures over several lines.

Formatting-only changes go in their own commit, never mixed with a behavior change.

## 3. TypeScript and React

- **No `any`, no `@ts-ignore`.** Use `unknown` and narrow, or a Zod schema at a trust boundary. A
  `@ts-expect-error` or `biome-ignore` needs a comment saying why.
- **Validate at the edges.** Anything from a form, URL, cookie, model output, CSV or env var goes through Zod
  (or an existing validator) before use.
- **Imports:** `@/…` for `src/`, relative paths inside `app/`. Type-only imports use `import type` or inline
  `type`.
- **Server vs client:** `'use client'` only where state or events need it. Server actions live in `*actions.ts`
  and re-check the session themselves.
- **Names:** files `kebab-case.ts`, components `PascalCase`, functions and variables `camelCase`, constants
  `UPPER_SNAKE_CASE`.
- **No `console.log`** in `app/` or `src/`. Scripts in `scripts/` may print.
- **Size:** keep a file under ~350 lines and a function under 60 lines with a cognitive complexity of 15 or less
  (Biome warns on both). Split before you add to one that is over.

## 4. Comments

Match what is already there: every file starts with a one-line comment saying what it is for and any
"server-only" or security note. Exported functions get a short `/** … */` when the name doesn't say everything.
Comment the *why* (a rule, an audit finding, a client decision), not the *what*. Reference findings and
requirements by their ID (`audit F10`, `PRD S7`, `T-10`).

## 5. Security rules (non-negotiable)

These come from the security reviews and the PRD; each has tests. Breaking one is a blocking review comment.

1. The user id comes only from the session cookie, never from a form, URL, query string or alert link.
2. The AI picks a registry metric and filters. It never writes SQL or does the math. Queries are built only by
   the compiler from allowlisted tables and columns with bound parameters.
3. Scope (role, region, team) is applied in the database query below the AI, on every turn.
4. Each database login has the least privilege it needs (`app_readonly`, `app_audit`, `app_auth`,
   `alerts_app`). Don't widen a grant to make something work.
5. No secrets in code, tests, fixtures or commits. Use `.env.local` (git-ignored) and `.env.example` for names
   only. CI runs gitleaks over full history.
6. No real customer or Palo Alto Networks data. Only the public Maven CRM sample and synthetic tables.
7. Dependencies are pinned to exact versions. Third-party GitHub Actions are pinned to a full commit SHA.

## 6. Data, registry and migrations

- Metrics, rules and glossary change only through a PR to `registry/` or `alerts/rules/`, reviewed by
  CODEOWNERS. There is no runtime editing.
- Migrations in `drizzle/` are append-only. Never edit an applied migration; add a new numbered one.
- After a registry change, regenerate `docs/DATA-DICTIONARY.md`.

## 7. Tests

- Every bug fix comes with a test that fails without the fix. Every new rule or permission gets an
  allowed-and-refused pair.
- Name test files after the behavior they cover (`session-expiry.test.ts`), not the date or review that found
  the bug (`oct17-fixes.test.ts`). Put the audit or finding ID in the `describe` name instead.
- Tests use the embedded database (PGlite) and are deterministic: no network, no real model calls, no sleeps.
  Model behavior is tested through the golden set and the red-team eval scripts.
- The only allowed skip is `describe.skipIf` around the Postgres-only suites, which run when `DATABASE_URL` is set
  (CI). Biome's `noSkippedTests` is off because of it, so a reviewer checks for `it.skip` and `describe.skip`.
- Scratch or probe tests are never committed. `tests/tmp/` is git-ignored for that.

## 8. Git and pull requests

- **Branches:** `<name>/<topic>` or `<topic>-week<N>`, cut from the current integration branch. Never commit
  straight to `main` or a `week*` branch.
- **Commits:** one logical change each. The subject is a plain sentence saying what changed and why it
  matters (as in the existing history), under ~72 characters where possible.
- **Pull requests:** small enough to review in 15 minutes. Say what changed, how you tested it, and which
  requirement or finding it closes. CI green and one CODEOWNER approval before merge.
- **No force-push** to a shared branch. Rebase or merge only on your own branch.
- **Binary files** (PDF, DOCX, images, video) don't belong in the repo; link them from the docs instead.

## 9. Safety rules (NASA/JPL Power of 10, adapted)

The [Power of 10](https://en.wikipedia.org/wiki/The_Power_of_10:_Rules_for_Developing_Safety-Critical_Code) are
JPL's rules for safety-critical C. These are their TypeScript equivalents. New code follows them, and existing code
is brought in line when it is next touched.

| # | Rule here | Checked by |
|---|---|---|
| 1 | Simple control flow: no recursion in app code. | Review |
| 2 | Every loop has a visible bound: loop over a finite collection, no `while (true)`, cap every input (question length, rows, rate limits, statement timeout). | Review |
| 3 | Bounded resources: every pool, queue, cache and request has a limit. | Review |
| 4 | Functions under 60 lines and cognitive complexity 15. | Biome (warning) |
| 5 | Check what you assume: validate at every boundary with Zod, and `throw` on a broken invariant instead of carrying on. | Review, tests |
| 6 | Smallest scope: `const` by default, no `var`, no module-level mutable state except a documented cache. | Biome, review |
| 7 | Never ignore a result: await or return every promise, no empty `catch`, no `.catch(() => undefined)` in app code. | Biome (warning), review |
| 8 | No code built at runtime: no `eval`, `new Function` or dynamic `require`. | Biome, CodeQL |
| 9 | No unchecked access: avoid non-null `!` and `as unknown as`. Use a checked helper that throws a clear error, or a comment saying why it is safe. | Review |
| 10 | The strictest settings and static analysis on every change: `strict`, `noUncheckedIndexedAccess`, Biome, CodeQL and gitleaks in CI. CI fails on errors; Biome's warnings (22 on Oct 22) are a burn-down that only goes down. | CI |

Security commitments from Palo Alto Networks' public posture (the CISA Secure by Design pledge and NIST SSDF) are in
section 5. Branch protection on `main` (blocked by the GitHub plan; the merge rule in `CONTRIBUTING.md` stands in) and SSO with MFA are open items in `SECURITY.md` (item 17). The repo's
dependency graph is on, so GitHub can export an SBOM (Insights → Dependency graph → Export SBOM); producing one in CI
is not set up yet.

## 10. Definition of done

Checks in section 1 pass, tests cover the change, docs (README, RUNBOOK, DATA-DICTIONARY, SYSTEM-CARD) are
updated when behavior changes, and a reviewer has approved.

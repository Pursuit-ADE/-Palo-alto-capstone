# Contributing

How Team ALTO PALS changes this repository. The rules for the code itself are in
[docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md); this page covers the workflow around them.

## Branch flow

From v0.5.0 on, `main` is the only long-lived branch. The `week1` to `week5` branches are kept for history only and take no new work.

1. Branch from `main`: `<name>/<topic>`, one small change per branch.
2. Open a pull request back into `main`. Never push to `main` directly.
3. Keep branches short-lived: merge or close within a few days, and rebase on `main` if it moves ahead.
4. Stable points on `main` get a version tag (see [Releases](#releases)).

## Before you open a pull request

Run these from the repo root, and from `alerts/` when you changed it:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

After any change under `registry/`, also run `npm run docs:dictionary` and commit the result.

CI runs the same checks plus the Postgres role tests, a fresh install, a secret scan and CodeQL. Never merge
on a red check: GitHub doesn't stop you on this plan, so the [merge rule](#merge-rule) does.

## Pull requests

- One logical change per pull request, with a title that says what changes in plain words.
- Fill in the template: what a reader sees before and after, and how the change works.
- At least one teammate approves before merge. Paths in [.github/CODEOWNERS](.github/CODEOWNERS)
  (governed definitions and security-sensitive code) need a code owner's review.
- Answer every review comment, either with a fix (name the commit) or with the reason you are leaving it.
- Merge with a merge commit, so each week's history keeps its pull request numbers.

## Merge rule

GitHub can't enforce review or required checks on `main` yet: it refuses branch protection for a private repository
on the free plan ([SECURITY.md](SECURITY.md) item 17, evaluator finding #78). Until that changes, this rule is the
control, and whoever presses merge answers for it:

1. **Checks.** Every check that ran on the pull request's latest commit is green. A workflow that didn't run
   because the change is outside its paths (`alerts-ci` without an `alerts/` change) is fine.
2. **Code owner.** Every path has an owner (#88), so every pull request needs an approving review from a code owner
   in [.github/CODEOWNERS](.github/CODEOWNERS) who is not its author. A pull request by one owner needs the
   other. GitHub doesn't request owners on this plan, so ask by hand:
   `gh pr edit <number> --add-reviewer brovaset,MITRAKER`.
3. **No shortcuts.** Never push to `main`, force-push it, or merge your own pull request without that review. Check
   it after the fact: `git log --first-parent --no-merges <last tag>..origin/main` lists any commit that reached
   `main` without a merge commit, and should print nothing. (On Nov 1 it printed nothing for `v0.5.0..origin/main`,
   which holds 31 pull request merges.)

### When GitHub allows protection

Whoever has admin on Pursuit-ADE turns this on once the organization is upgraded or the repository is public, and
only after Actions billing is healthy, because a required check that can't run blocks every merge. In Settings,
Branches (or a ruleset) for `main`:

- Require a pull request with 1 approval and **Require review from Code Owners**.
- Require status checks that report on every pull request: `test` and `fresh-install` from `ci`. Add `stack`
  (docker) and `analyze` (codeql) only if those workflows run on every pull request, which #100 changes for
  documentation-only ones. Don't require `alerts-ci`: it runs only when `alerts/` changes, so a pull request
  without those changes would wait forever.
- Block force pushes and deletions.

Then update `SECURITY.md` item 17 and delete the by-hand request from the rule above.

## Commits

- Subject line as a plain sentence ending with a period, under about 72 characters.
- The body says why, not just what. Name finding or requirement ids where they apply (`audit F10`, `PRD S7`).
- Formatting-only changes go in their own commit.

## Data and secrets

Only the public Maven CRM sample and synthetic data belong here. Never commit real Palo Alto Networks or
customer data, credentials, webhooks or `.env.local`. Report security issues through [SECURITY.md](SECURITY.md).

## Releases

Versions follow [Semantic Versioning](https://semver.org/). Tags are annotated, sit only on `main`, and are
recorded in [CHANGELOG.md](CHANGELOG.md):

| Tag | Meaning |
|---|---|
| `v0.1.0`, `v0.2.0`, `v0.3.0` | Weeks 1 to 3, as merged into `main` |
| `v0.5.0` | Weeks 4 and 5, promoted together on Oct 24 |
| `v0.6.0`, `v0.7.0` | Stable points while we finish the client feedback (Oct 29, Nov 1) |
| `v1.0.0-rc.1` | The build for the dry run with the client |
| `v1.0.0` | The Demo Day build |

To cut a release once the changes for it are merged into `main` and CI is green:

```bash
git checkout main && git pull
git tag -a v0.6.0 -m "v0.6.0: ..."
git push origin v0.6.0
```

Then move that version's notes from "Unreleased" to a new heading in the changelog.

# Contributing

How Team ALTO PALS changes this repository. The rules for the code itself are in
[docs/CODING-STANDARDS.md](docs/CODING-STANDARDS.md); this page covers the workflow around them.

## Branch flow

1. Branch from the current week branch (`week5` now): `<name>/<topic>` or `<topic>-week<N>`.
2. Open a pull request back into that week branch. Never push to `main` or a `week*` branch directly.
3. When a week is done, it is promoted with a reviewed pull request (`week5` into `week4`, and so on up to `main`).
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

CI runs the same checks plus the Postgres role tests, a fresh install, a secret scan and CodeQL. A red check
blocks the merge.

## Pull requests

- One logical change per pull request, with a title that says what changes in plain words.
- Fill in the template: what a reader sees before and after, and how the change works.
- At least one teammate approves before merge. Paths in [.github/CODEOWNERS](.github/CODEOWNERS)
  (governed definitions and security-sensitive code) need a code owner's review.
- Answer every review comment, either with a fix (name the commit) or with the reason you are leaving it.
- Merge with a merge commit, so each week's history keeps its pull request numbers.

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
| `v0.4.0`, `v0.5.0` | Weeks 4 and 5, once they are promoted to `main` |
| `v1.0.0` | The Demo Day build |

To cut a release after a week is promoted to `main`:

```bash
git checkout main && git pull
git tag -a v0.5.0 -m "Week 5: ..."
git push origin v0.5.0
```

Then move that version's notes from "Unreleased" to a new heading in the changelog.

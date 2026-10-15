# Security Policy

## Supported versions

This is a capstone project under active development. Security fixes go to the latest `week*` branch and then `main`.

## Reporting a vulnerability

Please do not report suspected vulnerabilities in a public GitHub issue. Use GitHub's private vulnerability reporting for this repository (Security tab, "Report a vulnerability"), or contact the maintainers directly.

Please include the affected branch or commit, the component, steps to reproduce, what you expected and what happened, and the potential impact.

## Data

The repository uses only the public-domain Maven Analytics CRM sample (a fictional company) and synthetic data. Real Palo Alto Networks or customer data must never be committed. Secrets (for example Slack webhooks) belong in environment variables, never in git; every push is scanned for secrets.

## Security model

- AI output is treated as untrusted input. It may only produce a typed, bounded intent; AI-generated SQL is never executed.
- Metrics, tables, columns and breakdowns are allowlisted; every value is a bound SQL parameter.
- Authorization is enforced outside the AI layer, from the database: role, region and team scope.
- Questions run under a read-only database role with a statement timeout; the audit log is written by an insert-only role.
- Every question and refusal is audited, with the question stored only as a hash.
- There is no sign-in yet. The test identity switch is off unless `ALLOW_TEST_IDENTITIES=true`, and must never be enabled where real users or real data are present. Production identity must come from a verified server-side session (SSO/OIDC).

## Before any shared deployment

The demo is safe on a laptop with public and synthetic data. Before the app is reachable by anyone else, or pointed at real data:

1. **Real sign-in.** Turn `ALLOW_TEST_IDENTITIES` off (copilot and alerts). Take the user id from a verified server-side session (SSO/OIDC) and ignore any user id in a form, URL or link. Bind the rate limit and the session lock to that session subject; today they key on the test identity, so switching identity resets them.
2. **Shared limits.** The rate limiter and session lock are in memory for one process. Before a restart-safe or multi-instance deployment, keep their counters and lock expiry in Postgres or Redis, and add the same limit at the gateway.
3. **Postgres mode.** Set all three database URLs so questions run as the read-only role with a statement timeout and the audit log is written by the insert-only role. Use the owner connection for migrations only. The embedded PGlite database is one connection and has no role separation.
4. **HTTPS and HSTS.** Serve over HTTPS and add `Strict-Transport-Security` then (it is left out so plain-http localhost works).
5. **AI provider.** Leave `INTENT_MODEL` unset until the client names an allowed provider, then run `INTENT_MODEL=claude npm run eval:golden` before relying on it. The compiler runs any valid, in-scope intent, so a wrong-but-real metric from the model would still be answered.
6. **Flags are detection, not the boundary.** Suspicious-question flags and the lock only record and slow down; scope from the database is the boundary. Never add a route that fetches URLs from a question or runs SQL from it. A question containing a link is refused and logged (`refused_injection`); links are never fetched. See `docs/RED-TEAM.md`.
7. **No live CRM with test identities on.** The demo uses the public Maven sample plus synthetic rows. Never point a build with `ALLOW_TEST_IDENTITIES=true` at real customer data: anyone can pick the analyst identity and see every region.

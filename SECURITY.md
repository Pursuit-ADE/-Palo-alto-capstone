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
- Both apps have demo accounts (invite codes, server-side sessions); each app keeps its own accounts and sessions. The test identity switch is off unless `ALLOW_TEST_IDENTITIES=true`, and must never be enabled where real users or real data are present. Production identity must come from a verified server-side session (SSO/OIDC).

## Before any shared deployment

The demo is safe on a laptop with public and synthetic data. Before the app is reachable by anyone else, or pointed at real data:

1. **Real sign-in.** The copilot now has demo accounts (Week 5): the user id comes only from a server-side session, and an invite code, not the form, sets the person and role. Passwords are scrypt hashes and session tokens are stored hashed. For a real rollout, replace sign-up with Active Directory and SSO. Turn `ALLOW_TEST_IDENTITIES` off (copilot and alerts). The app already refuses questions unless that flag is exactly `true`, and an alert link only carries a user id when the flag is on. When real sign-in exists, take the user id from the verified session and ignore any id in a form, URL or alert link. Until then, the rate limit and the lock key on the demo id, so switching demo person resets them. Do not point this build at a live CRM while test identities are on.
2. **Shared limits.** Counters and lock expiry are rows in `session_guard`, written by the audit role, so processes that share that Postgres database share the limit. PGlite still resets when the process does, because the database is in memory. Two requests at the same instant can both pass. Add the same limit at the gateway before more than one server.
3. **Postgres mode.** Set all three database URLs so questions run as the read-only role with a statement timeout and the audit log is written by the insert-only role. That role may also update `session_guard` and nothing else. Use the owner connection for migrations only. The embedded PGlite database is one connection and has no role separation. Use Postgres mode before any shared deployment.
4. **HTTPS and HSTS.** In a production build (`npm start`), both apps send `Strict-Transport-Security` and mark the session cookie Secure, unless `ENABLE_HSTS=false` or `COOKIE_SECURE=false` is set on purpose. Browsers ignore HSTS over plain http, and Chrome, Edge and Firefox accept Secure cookies on http://localhost, so the laptop demo still works.
5. **AI provider.** The client allows any AI provider (Oct 15). Before turning `INTENT_MODEL=claude` on for a demo, run `INTENT_MODEL=claude npm run eval:golden` and `INTENT_MODEL=claude npm run eval:redteam` and check both scores. The compiler runs any valid, in-scope intent, so a wrong-but-real metric from the model would still be answered.
6. **Flags record; two of them also refuse.** Questions are checked after look-alike letters, hidden characters and digit swaps ("1gnore") are cleaned up, and links are caught with or without `https://`. A link, or an instruction to ignore the rules, is refused and logged (`refused_injection`) and is never fetched or obeyed. Other flags, including `social_proof` and `flattery`, only write an audit row. None of them change scope. Never add a route that fetches URLs from a question or runs SQL from it. See `docs/RED-TEAM.md`.
7. **No test identities in production.** With `ALLOW_TEST_IDENTITIES=true`, anyone not signed in can pick the analyst identity and see every region. Both apps refuse to start in production (`npm start`) with it on; it works only with `npm run dev`.
8. **Sign-in attempts.** Log-in and sign-up allow 10 attempts a minute per username and 30 per address across usernames, reject common and easy-to-guess passwords, and (copilot) write one audit row per attempt with a fingerprint of the username, never the password. The address comes from `X-Forwarded-For`, so behind a proxy, have the proxy overwrite that header.
9. **Model text is never shown.** When Claude asks a clarifying question or declines, the person sees one of a few fixed sentences chosen from its structured output. Its own words go to the audit log only as a fingerprint.
10. **Security channel.** Set `SECURITY_SLACK_WEBHOOK_URL` to send flagged questions and session locks to a Slack channel (reason codes, who, audit row id; never the question text).
8. **Keep up with framework advisories.** Next.js 16.4.1 fixes three advisories published October 14, 2026 (GHSA-p3m5-59mp-jv5r Server Actions DoS, GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr RCE). They were in Vercel's advisory list before `npm audit` showed them, so check the framework's advisories too, not only `npm audit`.
9. **Least-privilege reads and keyed audit hashes.** The read-only login can read only the governed tables (not contacts, cases, engagements or the audit log). For real customer data, add row-level security or security-barrier views so the database enforces region and team scope by itself. Set `AUDIT_HASH_KEY` so the audit log stores keyed question fingerprints that can't be matched by hashing likely questions.

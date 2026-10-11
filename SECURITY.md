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

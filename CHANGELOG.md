# Changelog

What each version of the Governed Analytics Copilot added. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Tags live on `main` only; see [CONTRIBUTING.md](CONTRIBUTING.md#releases).

## [Unreleased]

Weeks 4 and 5, on `week4` and `week5`. They become `v0.4.0` and `v0.5.0` when promoted to `main`.

### Added

- Alerts scheduler, editable preferences, persistence, and weekly or monthly digests with quiet hours (#4).
- Dataset onboarding for a second CRM folder that proposes metrics without inventing SQL (#12).
- Provenance panel and a synthetic-data badge on every answer (#14).
- Claude intent model accepts an optional quarter on aggregate metrics (#16).
- Golden-phrasing equivalence tests and a role-by-question access matrix (#21, #22).
- Demo sign-up and sign-in with single-use invite codes; the user id comes only from the session (#11, #27).
- One follow-up rule for both intent models (#28).
- Filters for deal size, product, account, sector and rep (#42).
- Interactive sign-in, a graphs view and a chart picker (#45).
- Coding standards, `CLAUDE.md`, a codebase-steward agent and Biome lint in CI (#44).

### Security

- Disguised-attack detection, test identities refused in production, HTTPS defaults, sign-in limits,
  a security alert channel and red-team cases (#20, #24).
- Account disable, session limits and clean-up, a model circuit breaker and startup config checks (#27).
- A separate `app_auth` database role, the owner URL kept out of the running app, indexes and a
  90/180-day purge job (#25).
- Slack text can no longer use formatting characters to hide or restyle alert text (#25).

### Fixed

- Working follow-up hint and an environment-independent sign-up test (#43).

## [0.3.0] - 2026-10-17

Week 3 (#3, #18).

### Added

- Multi-turn conversation that carries filters into follow-up questions.
- Pluggable intent model: deterministic by default, Claude optional; the model only picks a registry metric and filters.
- Charts for answers.
- Red-team test suite run in CI.
- Week 3 review notes in `docs/week3-pr-review.md`.

## [0.2.0] - 2026-10-14

Week 2 (#2).

### Added

- Actionable alerts service in `alerts/`: versioned rules, private routing to the account team, in-app inbox and
  per-user Slack webhooks.

## [0.1.0] - 2026-10-11

Week 1 (#1).

### Added

- Governed analytics copilot: reviewed metric registry, role-based scope applied below the AI, governed SQL
  compiler and the golden question set.
- PRD and roadmap.

[Unreleased]: https://github.com/Pursuit-ADE/-Palo-alto-capstone/compare/v0.3.0...week5
[0.3.0]: https://github.com/Pursuit-ADE/-Palo-alto-capstone/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pursuit-ADE/-Palo-alto-capstone/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pursuit-ADE/-Palo-alto-capstone/releases/tag/v0.1.0

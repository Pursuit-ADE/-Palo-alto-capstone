# Product

<!-- impeccable:product-schema 1 -->

Written from the repository (README, `docs/product/PRD.md`, `docs/SYSTEM-CARD.md`) and the team's Nov 10 request for a light and dark redesign. Facts marked *(inferred)* were not confirmed in an interview.

## Platform

web

## Users

- **Sellers and technical sellers** on an account team: check their own team's pipeline coverage for the quarter and ask follow-up questions in their own words.
- **Sales managers**: the same view for their team, and "why is this rep's number different from mine?" questions.
- **Customer analytics (analysts)**: every region and team, plus weekly question trends.

They work at a desk during the day and present the same screens in pipeline reviews and demos on a projector, often in a dimmed room *(inferred from the Demo Day setup)*.

## Product Purpose

A governed analytics copilot for a sales organisation: one approved definition per number, so the same question asked any way gets the same number, scoped to what the person's role allows, with a receipt that shows how it was made. A separate alerts app tells account teams when something happens on their accounts.

## Positioning

The AI only reads the question and fills in a short form. Code checks the form against three reviewed metrics, the database adds who you are on every question, and the number comes with a receipt. A general chatbot cannot see the company's data or keep its numbers consistent.

## Operating Context

- Two apps with separate accounts: the copilot (this package) and the alerts app (`alerts/`).
- Data is a public, fictional CRM sample plus synthetic quotas and cases, shown with a "Synthetic data" badge everywhere.
- Demo accounts by invite code; a real rollout would use company single sign-on.
- Screens are shown live on a laptop and a projector, controlled by a presenter.

## Capabilities and Constraints

- Three governed metrics: open pipeline, pipeline coverage, open opportunity count. Coverage target 3.00x; red below 2.00x, amber up to the target, green at or above it.
- Regions are Central, East and West, and there are no others.
- Roles: rep (own deals), manager or technical seller (their team), analyst (every region).
- Numbers and Graphs views (3D charts), a conversation with follow-ups, ask-backs, refusals and explanations.
- Strict content security policy: no inline scripts; inline style attributes are allowed.
- No real customer or Palo Alto Networks data, no logos.

## Brand Commitments

- Team ALTO PALS. Palo Alto Networks-inspired colours only: charcoal and the signature orange `#fa582d`. No logos.
- Fonts ship with the app (Manrope, IBM Plex Mono); browsers never contact a font host.
- Nov 10: two styles, light ("bright") and dark, using a dark command-centre reference (glowing hub, nodes, status panel, KPI row) as an idea, not to copy.

## Evidence on Hand

- Real demo screens and the Demo Day video (outside the repo; binaries don't belong here).
- Test results: 69 of 69 phrasings read correctly, 0 of 170 attack runs got data outside the user's access, 1,500+ automated tests.
- No customer logos, testimonials or usage numbers exist; never invent them.

## Product Principles

1. The number is the product: every screen leads with the governed number and how it was made.
2. Show access, don't hide it: what a person can't see is shown as out of reach, never as zero.
3. Plain words first, detail on demand.
4. Nothing decorative may imply data the product does not have.

## Accessibility & Inclusion

WCAG 2.2 AA: contrast, visible focus, keyboard use, reduced motion, screen-reader live regions for answers, and forced-colours support already exist and must keep working.

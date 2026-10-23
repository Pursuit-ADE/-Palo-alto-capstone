<!-- One logical change per pull request. See CONTRIBUTING.md. -->

**Before:** what a reader saw or what happened before this change.

**After:** what they see or what happens now.

**How:** the approach in a few sentences. Name finding or requirement ids where they apply (`audit F10`, `PRD S7`).

## Checks

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass (and in `alerts/` if it changed)
- [ ] `npm run build` succeeds
- [ ] `npm run docs:dictionary` re-run if `registry/` changed
- [ ] New or changed behavior has a test
- [ ] No real customer data, secrets or `.env.local`
- [ ] Touches a path in `.github/CODEOWNERS`: code owner review requested

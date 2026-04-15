# Public Launch QA Report

Date: April 15, 2026

## Scope

Short Phase 1 QA pass focused on the highest-risk public-launch items:

- auth and user scoping
- receipt and dashboard ownership
- category and recurring-expense isolation
- analyze quota visibility and enforcement
- onboarding and empty states
- Telegram public-mode guardrails

## Verified

- `npm.cmd run build` passes.
- `npm.cmd run lint` passes.
- Receipt read/update/delete routes require the current user and pass `userId` into DB access.
- Dashboard expense reads are scoped to the current user and current currency.
- Categories are user-scoped.
- Recurring expenses are user-scoped.
- Analyze endpoint requires auth and enforces cooldown and daily quota.
- Analyze quota is visible on account and dashboard surfaces.
- First-run onboarding and empty states are present for scan and dashboard.
- Telegram webhook has an explicit deployment mode guard and can be disabled in public environments.

## Manual

- Full two-account cross-user verification still needs to be run manually.
- Legacy owner backfill still needs to be executed against the real database.
- Telegram private-flow behavior still needs a live bot check after any env change.

## Risks

- The repo still has a Next.js workspace-root warning during build until the config is pinned.
- Telegram public rollout remains intentionally disabled until account linking exists.
- Phase 1 QA is not complete until a real two-account test proves there is no cross-user leakage.

## Conclusion

The codebase is in a good state for Phase 1 verification, but it is not fully signed off until the manual two-account pass and owner backfill are completed.

# Session Handoff (2026-04-21)

## Current State

- The app is working on `master`.
- Latest production alias: `https://porto-receipts.vercel.app`
- Latest Vercel deploy: `https://expensetracker-j0txp7woj-nikobon1s-projects.vercel.app`
- Latest commit at handoff time: `aee0604` - `Align recurring plans header`

## What Was Changed Recently

### Scan screen layout

- In `features/expenses/components/ScanTab.tsx`, the manual and recurring cards were restructured so the action buttons sit in a stable shared layout.
- Added a shared `scan-panel-card-main` wrapper in both cards.
- Manual card uses a 2-column grid with the total field spanning the full width.
- The recurring create button is back in a consistent action slot after the form block.

### Recurring plans header

- The recurring section header now shows `Активные списания: 0` when there are no active plans.
- The `Показать будущие списания` control now uses `btn btn-secondary` so it looks like a gray button, consistent with other secondary actions.
- The button is aligned to the right edge of the recurring header row.
- The empty-state text `Пока нет активных автосписаний` was removed.

## Files Touched Most Recently

- `features/expenses/components/ScanTab.tsx`
- `app/globals.css`

## Validation

- `npm.cmd run lint` passed.
- `npm.cmd run build` passed.

## Notes for the Next Session

- If the recurring header still needs polish, focus only on `recurring-plans-head` and `recurring-preview-toggle`.
- Avoid reintroducing margin-based alignment hacks for the scan cards. The current structure is intentionally layout-driven.
- The Russian text in the PowerShell console often appears as mojibake; the source files themselves are UTF-8 and currently fine.

## Useful Paths

- `features/expenses/components/ScanTab.tsx`
- `app/globals.css`
- `PUBLIC_LAUNCH_HANDOFF_2026-04-14.md`
- `SESSION_HANDOFF.md`

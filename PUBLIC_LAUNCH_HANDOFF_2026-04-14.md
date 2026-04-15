# Public Launch Handoff

Date: April 14, 2026

## Финальный статус

На текущий момент Phase 1 в коде в основном закрыт:

- все основные данные изолированы по `user_id`
- анализ чеков ограничен по auth, cooldown и дневной квоте
- onboarding и пустые состояния для новых пользователей добавлены
- Telegram для public-окружения явно запрещен через режим `disabled`
- legacy-данные успешно привязаны к owner-пользователю `bonapartov@gmail.com`
- build и lint проходят

Что еще остается только для ручной проверки:

- двухаккаунтный QA-проход на реальной базе
- live-check Telegram private flow после любых env-изменений

Ключевой вывод:

- для безопасного публичного запуска теперь не хватает именно финального ручного QA и принятия решения по Telegram public-mode.

## Update (2026-04-15)

### Onboarding and empty states

- Added a clearer first-run onboarding flow in `features/expenses/components/ScanTab.tsx`.
- Added a first-run empty state in `features/expenses/components/DashboardTab.tsx` with explicit steps and CTA buttons.
- Added supporting styles in `app/globals.css`.

### Telegram deployment policy

- Added an explicit `TELEGRAM_DEPLOYMENT_MODE` guard in `app/api/telegram/webhook/route.ts`.
- `scripts/set-telegram-webhook.mjs` now refuses to set a webhook when Telegram mode is `disabled`.
- `RAILWAY_TELEGRAM_BOT.md` now documents `owner-only`, `internal-beta`, and `disabled` modes.

### Analyze quota visibility

- Added a read-only `/api/analyze/usage` endpoint.
- Displayed analyze quota on `app/account/page.tsx`.
- Displayed the same quota on the dashboard header in `app/page.tsx` and `features/expenses/components/DashboardTab.tsx`.

### QA / verification

- `npm.cmd run build` passes.
- `npm.cmd run lint` passes.
- Owner backfill completed successfully on the real database with `bonapartov@gmail.com`.
- Rows missing `user_id` before backfill: `receipts=91`, `custom_categories=2`, `recurring_expenses=0`, `receipt_analyze_logs=41`, `telegram_receipt_drafts=0`.
- Rows missing `user_id` after backfill: all zero.
- Remaining manual QA still needs two real accounts for cross-user validation.
- Short QA report added in `PUBLIC_LAUNCH_QA_REPORT_2026-04-15.md`.
- Manual browser checklist added in `PUBLIC_LAUNCH_MANUAL_QA_CHECKLIST_2026-04-15.md`.

### Commit trail since the original handoff

- `5eed5a1` `Add owner backfill script`
- `ec12ba5` `Improve empty state onboarding`
- `2f988b3` `Add Telegram deployment mode guard`
- `45f8cde` `Add analyze quota indicator`
- `e576be2` `Show analyze quota on dashboard`
- `273180e` `Fix dashboard lint warnings`

## Context

Repository:

- `vercel-app`

Branch:

- `master`

Latest pushed public-launch commit:

- `c295094` `Add multi-currency dashboard and analyze limits`

Phase 1 planning docs:

- `PUBLIC_LAUNCH_PLAN.md`
- `PUBLIC_LAUNCH_PHASE1_BACKLOG.md`

These planning docs are still local project documents and were intentionally not committed to git.

## What Was Delivered

### 1. Internal user model and auth integration

Delivered via:

- `19ab7c3` `Add internal user auth for public launch`

Key outcomes:

- added internal `users` model
- wired NextAuth to internal app users
- introduced current-user helper layer
- started receipt ownership and analyze-log ownership

Main files:

- `app/api/auth/[...nextauth]/route.ts`
- `lib/server/auth.ts`
- `lib/server/users.ts`
- `lib/server/receipts.ts`
- `scripts/db-migrate.mjs`

### 2. User scoping for core data APIs

Delivered via:

- `98076fc` `Scope expenses and categories by current user`

Key outcomes:

- scoped expenses dashboard reads by current user
- scoped categories by current user
- scoped recurring expenses by current user
- required auth on analyze API and stored `user_id` in analyze logs

Main files:

- `app/api/expenses/route.ts`
- `app/api/categories/route.ts`
- `app/api/recurring-expenses/route.ts`
- `app/api/analyze/route.ts`
- `lib/server/categories.ts`
- `lib/server/recurring-expenses.ts`
- `lib/server/analyze-receipt.ts`

### 3. Dashboard shortcut for manual receipt entry

Delivered via:

- `18a5e7b` `Add manual receipt entry shortcut from dashboard`

Key outcomes:

- dashboard button now says `Добавить чек`
- click switches to scan
- scan view scrolls to manual entry and focuses the store field

Main files:

- `app/page.tsx`
- `features/expenses/components/DashboardTab.tsx`
- `features/expenses/components/ScanTab.tsx`

### 4. Account settings and default currency preferences

Delivered via:

- `ed37166` `Add account settings and currency preferences`

Key outcomes:

- added account settings page and API
- added `defaultCurrency` and `timezone` persistence
- moved UI formatting off a single hardcoded global `EUR`

Main files:

- `app/api/account/route.ts`
- `app/account/page.tsx`
- `lib/account-api.ts`
- `lib/server/users.ts`
- `lib/currency.ts`

### 5. Multi-currency Phase 1 rules and analyze protection

Delivered via:

- `c295094` `Add multi-currency dashboard and analyze limits`

Key outcomes:

- receipt and recurring-expense types now carry currency
- dashboard runs in one selected currency at a time
- expenses and recurring APIs now return active currency and available currencies
- Telegram draft and summary flow now reflects receipt currency
- analyze endpoint now has:
  - auth requirement
  - per-user cooldown
  - per-user daily quota
  - mime validation
  - max image size validation

Main files:

- `features/expenses/types.ts`
- `lib/api.ts`
- `lib/recurring-api.ts`
- `features/expenses/hooks/useDashboardData.ts`
- `features/expenses/hooks/useRecurringExpenses.ts`
- `features/expenses/hooks/useReceiptFlow.ts`
- `app/api/expenses/route.ts`
- `app/api/recurring-expenses/route.ts`
- `app/api/analyze/route.ts`
- `app/api/telegram/webhook/route.ts`
- `lib/server/analyze-limits.ts`
- `lib/server/analyze-receipt.ts`
- `lib/server/receipts.ts`
- `lib/server/recurring-expenses.ts`
- `scripts/db-migrate.mjs`

### 6. Legacy data backfill script

Delivered via:

- `scripts/backfill-owner-data.mjs`

Key outcomes:

- added an idempotent one-off script to assign legacy rows to a single owner user
- supports `BACKFILL_OWNER_EMAIL` when the target owner user needs to be created
- includes `BACKFILL_DRY_RUN` for validation before touching the database

Main files:

- `scripts/backfill-owner-data.mjs`
- `package.json`

## Current Phase 1 Status

Implemented:

- internal users and auth-to-user mapping
- user-scoped receipts
- user-scoped categories
- user-scoped recurring expenses
- user-scoped dashboard aggregations and store filters
- receipt currency model
- recurring-expense currency model
- single-currency dashboard filter for Phase 1
- account settings for name, timezone, and default currency
- analyze auth, quota, cooldown, and upload constraints

Still open:

- final Phase 1 QA run with two real accounts
- Telegram production-mode decision for public launch

## Operational Notes

### Analyze limit environment knobs

The new analyze guard uses these env vars:

- `RECEIPT_ANALYZE_COOLDOWN_SECONDS`
  - default: `20`
- `RECEIPT_ANALYZE_DAILY_LIMIT`
  - default: `40`
- `RECEIPT_ANALYZE_MAX_IMAGE_MB`
  - default: `10`

### Existing cost logging knobs

Analyze cost logging still uses the existing optional cost env vars:

- `RECEIPT_COST_OPENAI_INPUT_PER_1M_USD`
- `RECEIPT_COST_OPENAI_OUTPUT_PER_1M_USD`
- `RECEIPT_COST_GEMINI_INPUT_PER_1M_USD`
- `RECEIPT_COST_GEMINI_OUTPUT_PER_1M_USD`

### Telegram scope

Telegram is still a private-path workflow.

It is not yet suitable for public rollout because:

- there is no Telegram-to-app account linking model
- Phase 1 scoping there is still based on the existing private flow assumptions

## Verification State

Latest verification before handoff:

- `npm.cmd run build`: passes
- `npm.cmd run lint`: passes

Known non-blocking warnings:

- none currently

Known environment warning during build:

- The Next.js workspace-root warning was cleaned up by pinning `turbopack.root` in `next.config.ts`.

## Recommended Next Actions

1. Run the Phase 1 QA checklist with two real accounts.
2. Decide Telegram production mode for public launch.
3. Only then consider enabling wider public access.

## QA Run Summary

- Current manual QA status: blocked on live two-account browser verification.
- Added run summary: `PUBLIC_LAUNCH_QA_RUN_2026-04-15.md`
- Added manual checklist: `PUBLIC_LAUNCH_MANUAL_QA_CHECKLIST_2026-04-15.md`

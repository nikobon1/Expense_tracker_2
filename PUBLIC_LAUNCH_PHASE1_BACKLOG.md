# Public Launch Phase 1 Backlog

## Goal

Ship a safe MVP public version where each authenticated user can:

- create and manage their own receipts
- manage their own categories
- manage their own recurring expenses
- use their own default currency
- see only their own data

## Assumptions

- Google sign-in remains the main public auth method.
- `DEV_LOGIN` stays development-only and must not be used as a public login path.
- Telegram public rollout is not part of Phase 1. Telegram should stay private or disabled until account linking is built.
- Existing personal data can be migrated to one owner account manually.

## Workstreams

## 1. Database Migration

### Task 1.1: Add users table

Create a `users` table with at least:

- `id BIGSERIAL PRIMARY KEY`
- `email TEXT NOT NULL`
- `name TEXT`
- `image TEXT`
- `default_currency TEXT NOT NULL DEFAULT 'EUR'`
- `timezone TEXT NOT NULL DEFAULT 'Europe/London'`
- `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- `updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`

Add indexes:

- unique index on `LOWER(email)`

Files:

- [db-migrate.mjs](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/scripts/db-migrate.mjs)

### Task 1.2: Add `user_id` to user-owned tables

Add nullable `user_id` first, backfill, then make non-null where safe.

Tables:

- `receipts`
- `custom_categories`
- `recurring_expenses`
- `receipt_analyze_logs`

For Telegram drafts:

- keep `telegram_receipt_drafts.user_id`
- decide whether it references internal `users.id` or Telegram chat identity for Phase 1
- for MVP public web launch, Telegram can remain non-public

Add indexes:

- `receipts(user_id, purchase_date DESC)`
- `custom_categories(user_id, LOWER(name))`
- `recurring_expenses(user_id, start_date, end_date, is_active)`
- `receipt_analyze_logs(user_id, created_at DESC)`

Files:

- [db-migrate.mjs](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/scripts/db-migrate.mjs)

### Task 1.3: Add currency fields

Add:

- `receipts.currency TEXT NOT NULL DEFAULT 'EUR'`
- `recurring_expenses.currency TEXT NOT NULL DEFAULT 'EUR'`

Files:

- [db-migrate.mjs](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/scripts/db-migrate.mjs)

### Task 1.4: Backfill existing data

Create one owner user and backfill existing rows:

- all existing `receipts`
- all existing `custom_categories`
- all existing `recurring_expenses`
- all existing `receipt_analyze_logs`

This is a one-time migration step, not a product feature.

Files:

- migration script or one-off script under `scripts/`

## 2. Auth And Current User Resolution

### Task 2.1: Extend auth to create/load internal users

On successful NextAuth sign-in:

- lookup internal user by email
- create user if missing
- attach internal user id to JWT/session

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/auth/[...nextauth]/route.ts)

### Task 2.2: Add server auth helper

Create helper functions such as:

- `getCurrentUser()`
- `requireCurrentUser()`

These should return internal app user, not only raw NextAuth session data.

Suggested new files:

- `lib/server/auth.ts`
- optional `lib/server/users.ts`

### Task 2.3: Add user persistence helpers

Functions needed:

- `getUserByEmail(email)`
- `createUser(...)`
- `upsertUserFromSession(...)`
- `getUserById(id)`
- `updateUserPreferences(...)`

Suggested new file:

- `lib/server/users.ts`

## 3. Scope All Read/Write APIs By User

### Task 3.1: Receipt creation

When saving a receipt:

- require authenticated user
- save `user_id`
- save `currency`

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/receipts/route.ts)
- [receipts.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/receipts.ts)
- [receipt-validation.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/receipt-validation.ts)

### Task 3.2: Receipt read/update/delete

Every operation by `receiptId` must verify ownership.

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/receipts/[id]/route.ts)
- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/receipts/[id]/image/route.ts)
- [receipts.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/receipts.ts)

### Task 3.3: Dashboard and expenses aggregation

Filter all dashboard reads by `user_id`.

This includes:

- expenses list
- previous period total
- category aggregation
- stores list
- analyze logs

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/expenses/route.ts)

### Task 3.4: Categories API

Make custom categories user-scoped.

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/categories/route.ts)
- [categories.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/categories.ts)

### Task 3.5: Recurring expenses API

Make recurring expenses user-scoped.

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/recurring-expenses/route.ts)
- [recurring-expenses.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/recurring-expenses.ts)

### Task 3.6: Analyze API

Require auth before AI receipt analysis for the public app.
Store `user_id` in analyze logs.

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/analyze/route.ts)
- [analyze-receipt.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/analyze-receipt.ts)
- [receipts.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/receipts.ts)

## 4. Currency Support

### Task 4.1: Add currency to types and API contracts

Extend types:

- `ReceiptData`
- `ReceiptDetails`
- `RecurringExpensePlan`
- create/update payloads where needed

Files:

- [types.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/types.ts)
- [api.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/api.ts)
- [recurring-api.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/recurring-api.ts)

### Task 4.2: Save and return currency from DB

Files:

- [receipts.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/receipts.ts)
- [recurring-expenses.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/server/recurring-expenses.ts)

### Task 4.3: Replace hardcoded `EUR` in UI

Introduce a currency formatter instead of fixed strings.

Files with known hardcoded `EUR`:

- [DashboardTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/DashboardTab.tsx)
- [ScanTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/ScanTab.tsx)
- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/telegram/webhook/route.ts)

### Task 4.4: Phase 1 currency rule

For MVP:

- show dashboard only for one selected currency at a time
- default to user’s `default_currency`
- exclude or separately filter receipts in other currencies

This avoids invalid cross-currency totals in Phase 1.

## 5. Account Settings

### Task 5.1: Add account settings endpoint

Allow updating:

- display name
- default currency
- timezone

Suggested files:

- `app/api/account/route.ts`
- `lib/server/users.ts`

### Task 5.2: Add account settings UI

Add a simple page or modal for:

- user info
- default currency
- timezone

Suggested files:

- `app/account/page.tsx`
- or settings panel in existing app shell

## 6. Store Handling For MVP

### Task 6.1: Keep free-text stores, but make them user-local

No dedicated `stores` table yet.
Instead:

- store names continue to be saved as text
- store filters are generated only from current user data
- no cross-user store leakage

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/expenses/route.ts)
- [store-normalization.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/lib/store-normalization.ts)

## 7. Onboarding

### Task 7.1: First-login bootstrap

After first successful sign-in:

- create internal user
- set defaults
- route to empty dashboard or scan screen

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/auth/[...nextauth]/route.ts)
- [page.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/page.tsx)
- [page.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/login/page.tsx)

### Task 7.2: Empty states for new users

Add clear UI for users with no receipts yet.

Files:

- [DashboardTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/DashboardTab.tsx)
- [ScanTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/ScanTab.tsx)

## 8. Rate Limits And Abuse Prevention

### Task 8.1: Protect analyze endpoint

Add:

- per-user request limit
- daily analyze quota
- clear error message when quota is exceeded

Suggested implementation:

- simple DB-backed counters for MVP
- or Upstash/Vercel KV if preferred

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/analyze/route.ts)
- new helper under `lib/server/`

### Task 8.2: Upload constraints

Keep and enforce:

- max file size
- max image dimensions
- reject invalid mime types

Files:

- [DashboardTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/DashboardTab.tsx)
- [ScanTab.tsx](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/features/expenses/components/ScanTab.tsx)
- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/analyze/route.ts)

## 9. Telegram Handling In Phase 1

### Task 9.1: Keep Telegram non-public

Do not open Telegram bot to all users in Phase 1.

Keep one of these modes:

- owner-only bot
- internal beta only
- disabled in public environment

Reason:

- there is no account-linking model yet
- public Telegram support belongs to Phase 2

Files:

- [route.ts](/C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/app/api/telegram/webhook/route.ts)
- env configuration docs

## 10. QA Checklist

### Auth

- first Google sign-in creates a user
- repeat sign-in reuses same user
- no auth means no access to protected APIs

### Receipts

- user A creates receipt, user B cannot see it
- user A edits receipt, user B cannot edit it
- dashboard totals only include current user receipts

### Categories

- user A custom category does not appear for user B
- base categories remain shared as built-in constants only

### Recurring expenses

- recurring plans are isolated per user
- recurring-generated expenses appear only for the owner

### Currency

- new receipts save correct currency
- dashboard does not mix unrelated currencies silently
- formatting matches selected/default currency

### Security

- analyze endpoint requires auth
- rate limit triggers correctly
- large uploads fail gracefully

## Recommended Implementation Order

1. DB migration: `users`, `user_id`, `currency`
2. internal user creation in auth
3. `requireCurrentUser()` helper
4. scope receipts API
5. scope expenses dashboard API
6. scope categories API
7. scope recurring expenses API
8. add settings for default currency/timezone
9. remove hardcoded `EUR`
10. add rate limits and quotas

## Nice-To-Have If There Is Time In Phase 1

- account page
- simple export of user receipts
- user-facing quota usage indicator
- onboarding checklist


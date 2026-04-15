# Public Launch Plan

## Status

Last updated: April 14, 2026

Phase 1 is mostly implemented in code and already pushed through commit `c295094`.

Completed in Phase 1:

- internal `users` model and NextAuth to internal-user mapping
- per-user scoping for receipts, categories, recurring expenses, dashboard reads, and analyze logs
- account settings for `name`, `default_currency`, and `timezone`
- multi-currency data model for receipts and recurring expenses
- single-currency dashboard mode with currency filter
- dashboard shortcut for manual receipt entry
- analyze endpoint protection with auth, cooldown, daily quota, mime validation, and size validation
- Telegram private flow updated to carry receipt currency in drafts and summaries
- one-off backfill script added for legacy rows

Still required before a safe public launch:

- run the one-time backfill of legacy data to an owner user
- final onboarding and empty-state polish for brand-new users
- explicit public-environment decision for Telegram: owner-only, internal beta, or disabled
- Phase 1 QA pass against the checklist below

## Goal

Turn the app from a single-tenant personal tracker into a public multi-user product where each user can:

- create their own account
- add their own receipts
- manage their own stores
- manage their own categories
- use their own default currency
- see only their own data

## Current Constraints

The app is no longer in the original fully shared-data state, but it is not yet ready for unrestricted public launch.

Current blockers:

- existing legacy rows still need a deliberate backfill or archive step
- onboarding is functional but not yet polished for first-time public users
- Telegram is still a private-path flow and is not linked to internal app accounts
- Phase 1 acceptance criteria still need an explicit QA run

Because of that, the app should still be treated as pre-public until the remaining Phase 1 items are closed.

## Phase 1: MVP Public Launch

### Outcome

Release a safe first public version with isolated user data and basic per-user settings.

### Scope Status

#### 1. User model and tenant isolation

Status: mostly complete

- `users` table added
- `user_id` added to:
  - `receipts`
  - `custom_categories`
  - `recurring_expenses`
  - `receipt_analyze_logs`
- main indexes added for user-scoped reads
- `currency` columns added to `receipts` and `recurring_expenses`
- remaining work:
  - backfill legacy rows to one owner user
  - optionally tighten nullable columns after backfill

#### 2. Auth to DB integration

Status: complete

- internal user record is created or reused on sign-in
- NextAuth session is mapped to internal `users.id`
- server helper layer exists for current-user resolution
- protected APIs require authenticated user where needed

#### 3. API scoping

Status: complete

- receipt create/read/update/delete is scoped by owner
- categories are user-scoped
- recurring expenses are user-scoped
- dashboard/store/category aggregations are user-scoped
- analyze logs are stored against `user_id`

#### 4. Currency support

Status: complete for Phase 1

- `default_currency` is stored on `users`
- `currency` is stored on receipts and recurring expenses
- UI no longer relies on a single global hardcoded `EUR`
- dashboard operates in one selected currency at a time
- dashboard defaults to the user default currency
- Telegram private draft flow now formats receipt totals using receipt currency

#### 5. User-owned stores

Status: complete for MVP

- `store_name` remains free text
- store filters are built only from current-user data
- no cross-user store leakage in dashboard filters

#### 6. Onboarding

Status: partial

Done:

- first sign-in creates an internal user
- account settings page exists
- scan flow already supports a no-receipt manual entry path

Remaining:

- clearer empty-state onboarding for a brand-new account
- explicit first-run guidance on dashboard vs scan entry points

#### 7. Access control and abuse prevention

Status: mostly complete for Phase 1

Done:

- analyze endpoint requires auth
- analyze usage is logged per user
- per-user cooldown is enforced
- per-user daily analyze quota is enforced
- invalid image mime types are rejected
- oversized analyze uploads are rejected

Remaining:

- optional user-facing quota indicator
- broader operational monitoring beyond current logs

### Deliverables

Status summary:

- DB migration for `users`, `user_id`, and `currency`: complete except backfill
- auth/session integration with internal user record: complete
- all core APIs scoped by `user_id`: complete
- dashboard and scan flow working per user: complete
- default currency selection and rendering: complete
- basic account settings page: complete

### Acceptance Criteria

Target status:

- User A cannot see, edit, or aggregate User B's receipts: implemented, still needs QA verification
- Custom categories are isolated per user: implemented, still needs QA verification
- Recurring expenses are isolated per user: implemented, still needs QA verification
- Stores shown in filters belong only to the current user: implemented, still needs QA verification
- A new user can sign in and add receipts from scratch: implemented, onboarding polish still open
- Currency is no longer hardcoded globally as `EUR`: implemented for the web app and Telegram private draft flow

## Phase 2: Production-Grade Public Launch

### Outcome

Turn the MVP into a robust public SaaS-ready product.

### Scope

#### 1. Stronger data model

- Add dedicated `stores` table scoped by `user_id`.
- Add optional store aliases or normalization rules per user.
- Add `user_preferences` or extend `users` with:
  - locale
  - preferred number/date format
  - dashboard default period
  - dashboard default currency

#### 2. Multi-currency analytics

- Decide one of two modes:
  - same-currency dashboards only
  - converted dashboards using stored FX rates
- If conversion is needed:
  - store `exchange_rate`
  - store `base_currency_amount`
  - define base currency per user
- Make exports and reports explicit about source and converted currency.

#### 3. Telegram account linking

- Introduce a secure Telegram-to-user linking flow.
- Add table for Telegram identities linked to internal users.
- Replace static allowlist with account linking.
- Scope Telegram drafts and saved receipts to the linked user.
- Add unlink or relink controls in account settings.

#### 4. Billing and quota controls

- Add paid or free usage tiers if public AI scanning will stay enabled.
- Track OCR or AI usage per user.
- Add hard caps, soft caps, and warning banners.
- Add admin visibility for usage and failures.

#### 5. Admin and support tooling

- Admin dashboard for:
  - user counts
  - daily active users
  - analysis volume
  - failed webhook jobs
  - failed AI calls
- Add support tooling for:
  - user lookup
  - manual relink of Telegram
  - safe replay of stuck drafts

#### 6. Security and compliance

- Add structured monitoring and alerting.
- Add privacy policy and terms pages.
- Add account deletion flow with data deletion.
- Add retention rules for drafts, logs, and uploaded images.
- Review secrets, webhooks, and auth callback settings for production.

#### 7. Product polish

- Import or export for user data.
- Better first-run tutorial.
- Better store management UI.
- Better category management UI.
- Multi-language UX if needed.
- Mobile-first polish for the entire receipt flow.

## Recommended Next Steps

1. Run the one-time backfill for legacy data and decide whether `user_id` can be made non-null everywhere.
2. Add explicit empty-state onboarding for first-time users on dashboard and scan.
3. Decide Telegram Phase 1 production mode and document the environment policy.
4. Execute the QA checklist below with at least two test accounts.
5. Only after that, enable broader public access.

## QA Checklist

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
- formatting matches selected or default currency

### Security

- analyze endpoint requires auth
- cooldown and daily quota trigger correctly
- large uploads fail gracefully
- invalid mime types fail gracefully

## Suggested Definition Of Done For Public Release

The app is ready for public access only when all of the following are true:

- every user-facing dataset is isolated by `user_id`
- there is no global data leakage in filters, charts, or APIs
- currency is modeled explicitly
- new users can onboard without manual setup
- AI usage is rate-limited and observable
- Telegram, if enabled publicly, is linked to real user accounts or explicitly disabled for the public environment

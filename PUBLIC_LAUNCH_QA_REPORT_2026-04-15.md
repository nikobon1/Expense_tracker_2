# Public Launch QA Report

Date: April 15, 2026

## Кратко

Это короткий QA-проход по самым рискованным частям Phase 1:

- auth и изоляция пользователей
- права на receipts и dashboard
- изоляция categories и recurring expenses
- видимость и enforcement analyze quota
- onboarding и empty states
- Telegram guardrails для public-режима

## Подтверждено

- `npm.cmd run build` проходит.
- `npm.cmd run lint` проходит.
- Маршруты чтения/обновления/удаления receipts проверяют текущего пользователя и передают `userId` в DB.
- Dashboard читает расходы в рамках текущего пользователя и текущей валюты.
- Категории user-scoped.
- Recurring expenses user-scoped.
- Analyze endpoint требует auth и ограничивает частоту и дневную квоту.
- Analyze quota видна на account и dashboard.
- Onboarding и empty states добавлены для scan и dashboard.
- Telegram webhook имеет явный deployment mode и может быть отключен в public-среде.

## Ручная проверка

- Полный двухаккаунтный cross-user test еще нужно прогнать вручную.
- Legacy owner backfill уже выполнен на реальной базе.
- Поведение Telegram private flow нужно перепроверять при любых изменениях env.

## Риски

- Telegram public rollout остается сознательно отключенным, пока нет account linking.
- Phase 1 нельзя считать окончательно signed off без реального двухаккаунтного теста.

## Вывод

Кодовая база готова к Phase 1 verification, но финальный sign-off все еще требует ручного двухаккаунтного QA и live-подтверждения поведения Telegram.

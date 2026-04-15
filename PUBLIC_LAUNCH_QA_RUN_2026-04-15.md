# Public Launch QA Run

Дата: 2026-04-15

## Итог

Полный двухаккаунтный ручной прогон в этом окружении не завершен: второй реальный аккаунт и отдельная живая браузерная сессия недоступны прямо сейчас.
Дополнительно: локальный `NEXT_PUBLIC_LOCAL_DASHBOARD_DEMO=true` может подменять пустой аккаунт демо-данными и маскировать реальную изоляцию.

## Что подтверждено

- `npm.cmd run build` проходит.
- `npm.cmd run lint` проходит.
- Данные receipts, categories, recurring expenses и analyze scoped по текущему пользователю в коде.
- Analyze quota и cooldown enforced server-side.
- Analyze quota отображается на dashboard и account page.
- Telegram public-mode guard запрещает webhook в `disabled`.
- Owner backfill уже выполнен на реальной базе для `bonapartov@gmail.com`.

## Что подготовлено для ручной проверки

- Чеклист: [`PUBLIC_LAUNCH_MANUAL_QA_CHECKLIST_2026-04-15.md`](C:/Users/bonap/Documents/Projects/Receipt%20app/vercel-app/PUBLIC_LAUNCH_MANUAL_QA_CHECKLIST_2026-04-15.md)

## Статус сценариев

| Сценарий | Статус | Комментарий |
| --- | --- | --- |
| 1. Изоляция данных | blocked | Нужны два реальных аккаунта и две независимые сессии |
| 2. Analyze quota и cooldown | verified in code, manual blocked | Серверная логика и UI есть, но live double-account run не сделан |
| 3. Onboarding и empty states | verified in code | UI и стили добавлены, но живой прогон не выполнен |
| 4. Telegram public-mode guard | verified in code | Режим `disabled` и отказ webhook подтверждены кодом |

## Риск

Финальный sign-off Phase 1 все еще требует реального двухаккаунтного браузерного QA.
До выключения demo fallback этот QA-проход будет давать ложноположительный результат.

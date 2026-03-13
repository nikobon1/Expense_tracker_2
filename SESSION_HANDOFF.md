# Session Handoff (2026-02-26)

## Update (2026-03-13)

### Dashboard category filter

- Updated `features/expenses/components/DashboardTab.tsx`.
- When a category is selected in the dashboard category filter, the `Expenses by day` chart now uses only expenses from that category.
- Other categories are excluded from the daily bars and tooltip breakdown until the filter is reset to `all`.
- The `Детализация расходов` table now follows the same category filter and hides rows from other categories.
- Receipt action buttons in the table stay attached to the first visible row after category filtering.

### Validation

- `npm.cmd run lint` passed.

## Update (2026-03-12)

### Telegram manual entry flow

- Reworked `app/api/telegram/webhook/route.ts` for manual purchases without receipt photo.
- Manual mode is now guided step-by-step: `amount -> store -> date -> save`.
- The bot now accepts a plain numeric message as the manual amount, without requiring `Sum ...`.
- Added fast path `/manual 12.49`.
- Existing draft edit commands were kept as fallback.
- Prevented saving an incomplete manual draft before the required flow is finished.
- `Today` now completes the date step correctly for the guided manual flow.

### Validation

- `npm.cmd run lint` passed.
- Local `npm.cmd run build` failed only because local auth env is missing for `/api/auth/[...nextauth]`.
- Production Vercel build and deploy succeeded.

### Deploy

- Production alias remains: `https://porto-receipts.vercel.app`
- Vercel production deploy completed on 2026-03-12.

## Что это

Краткий файл-памятка для следующей сессии: что уже сделано в проекте, что задеплоено, где смотреть, что ещё можно улучшить.

## Архитектура (текущая)

- `Vercel` -> Web UI / Dashboard (`Next.js`)
- `Railway` -> Telegram bot webhook + обработка чеков
- `Neon/Postgres` -> общая БД для Vercel и Railway

## Основные URL

- Vercel (дашборд): `https://porto-receipts.vercel.app`
- Railway (бот backend): `https://expense-tracker-telegram-bot-production.up.railway.app`
- Telegram webhook endpoint: `https://expense-tracker-telegram-bot-production.up.railway.app/api/telegram/webhook`
- Railway health: `https://expense-tracker-telegram-bot-production.up.railway.app/api/health`

## Git

- Репозиторий: `https://github.com/nikobon1/expense_tracker.git`
- Ветка: `master`
- Последний коммит (на момент handoff): `6766b9a`
  - `Add Telegram bot receipt workflow and dashboard updates`

## Что сделано (важное)

### 1) Telegram bot на Railway

Добавлено:

- `app/api/telegram/webhook/route.ts`
- `app/api/health/route.ts`
- `lib/server/analyze-receipt.ts`
- `lib/server/receipts.ts`
- `railway.json`
- `scripts/set-telegram-webhook.mjs`
- `RAILWAY_TELEGRAM_BOT.md`

Возможности:

- Приём фото чека или изображения как файла
- Распознавание чека (OpenAI/Gemini)
- Сохранение в общую БД
- Дедупликация Telegram updates (`telegram_processed_updates`)
- Черновик чека перед сохранением (`telegram_receipt_drafts`)
- Allowlist пользователей (`TELEGRAM_ALLOWED_USER_IDS`)

### 2) Подтверждение чека в Telegram (черновик)

Бот больше не сохраняет чек сразу.

Теперь поток такой:

1. Фото -> распознавание
2. Бот присылает черновик
3. Пользователь подтверждает/исправляет
4. После подтверждения запись сохраняется в БД

Текстовые команды (работают):

- `Сохранить`
- `Отмена`
- `Показать`
- `Дата 14/02/26`
- `Магазин Lidl`
- `Цена 3 12.49`
- `Название 2 Бананы`
- `Категория 2 Фрукты`
- `Удалить 5`

### 3) Inline-кнопки в Telegram

Добавлены кнопки под превью чека:

- `✅ Сохранить`
- `❌ Отмена`
- `🔁 Показать`
- `📅 Сегодня` (ставит дату покупки на сегодня)
- `✏️ Исправить` (показывает подсказку по текстовым правкам)

Важно:

- Для кнопок нужен `callback_query` в Telegram webhook `allowed_updates`.
- В `scripts/set-telegram-webhook.mjs` уже добавлено:
  - `["message", "edited_message", "callback_query"]`
- После изменения webhook нужно переустановить.

### 4) Веб-интерфейс (Vercel) / дашборд

Сделано:

- Формат даты в дашборде: `DD/MM/YY`
- Поле цены на подтверждении чека стало шире на мобильных
- Добавлено подтверждение/ручной ввод даты покупки в web flow
- Кнопка `Сегодня` рядом с датой
- Кнопка `Обновить` в дашборде
- Автообновление дашборда каждые `20 сек` (когда вкладка `Dashboard` активна и страница видима)

## Диагностика, которую уже подтвердили

### Railway и Vercel используют одну БД

Проверено: `DATABASE_URL` на Railway и Vercel указывает на один и тот же Neon host/db.

Итог:

- Чеки из Telegram реально пишутся в ту же БД, что читает Vercel dashboard.

### Почему чеки могли не отображаться в Vercel

Есть две типичные причины:

1. Чек не был подтверждён (`Сохранить`) в Telegram
2. Неверно распознана `purchase_date` (например, 2023/2020 вместо 2026), и чек не попадает в текущий диапазон дат

Отдельно:

- дашборд раньше не обновлялся автоматически; теперь добавлены `Обновить` + автообновление

## Известные проблемы / нюансы

1. `✏️ Исправить` могло не работать, если webhook был установлен без `callback_query`
- Причина: старый webhook `allowed_updates` не включал `callback_query`
- Решение: переустановить webhook через скрипт (см. ниже)

2. OCR иногда ошибается с годом в `purchase_date`
- Пример: чек загружен в 2026, а дата распознана как `2023-...`
- В таком случае чек не виден в февральском диапазоне 2026 в дашборде
- Временный workaround: исправить дату в Telegram (`Дата DD/MM/YY`) перед сохранением

3. `OPENAI_API_KEY` в Railway
- Если ключ вида `sk-or-v1...`, это, скорее всего, не OpenAI key (например, OpenRouter)
- Текущий код ожидает реальный OpenAI key (`platform.openai.com`) либо `GOOGLE_API_KEY`

## Новая инструкция для распознавания Total / Total a pagar

В `lib/server/analyze-receipt.ts` добавлено правило для модели:

- `Total` / `TOTAL A PAGAR` / `Total a pagar` трактовать как финальную потраченную сумму
- предпочитать её `subtotal` / промежуточным суммам
- использовать для валидации списка позиций

Это правило влияет и на Telegram-бота, и на web API (`/api/analyze`), т.к. используется общая серверная логика.

## Как переустановить Telegram webhook (важно для кнопок)

### Локально через Railway env (рекомендуется)

Из `vercel-app`:

```powershell
cmd /c "set WEBHOOK_BASE_URL=https://expense-tracker-telegram-bot-production.up.railway.app&& railway.cmd run npm.cmd run telegram:set-webhook"
```

### Что должно быть в ответе

- `ok: true`
- `description: "Webhook is already set"` (или `Webhook was set`)

## Полезные команды

### Railway deploy

```powershell
railway.cmd up -d
```

### Railway build logs

```powershell
railway.cmd logs --build --lines 120
```

### Railway runtime logs (если бот отвечает "Не удалось обработать чек")

```powershell
railway.cmd logs --service expense-tracker-telegram-bot --lines 200
```

### Vercel prod deploy (если нужно вручную)

```powershell
npx.cmd vercel@50.13.2 --prod --yes
```

## Что можно сделать следующим шагом

1. Сделать полноценный кнопочный UX для редактирования (не только подсказка):
   - выбрать поле -> бот спрашивает новое значение -> сохранить
2. Добавить защиту от подозрительно старой даты (`purchase_date`) перед сохранением
3. Добавить переключатель фильтра в дашборде по `created_at` (дате загрузки), а не только `purchase_date`
4. Поддержать OpenRouter (`sk-or-v1...`) через `baseURL`

## Следующий большой этап (согласовано)

Цель: редактировать чек прямо из дашборда и видеть оригинальное фото чека рядом с распознанными полями.

### Что хотим получить

- В дашборде открыть чек
- Увидеть фото чека
- Сравнить с распознанными полями
- Исправить магазин / дату / позиции / цены / категории
- Сохранить изменения

### Что для этого нужно

1. Сохранять фото чека (новые чеки)
- Хранить файл в object storage (не в Postgres)
- В БД хранить ссылку и метаданные (`image_url`, опционально `image_key`, `mime_type`)

2. Расширить схему БД для чеков
- Добавить поля к `receipts`:
  - `image_url` (минимум)
  - `source` (`telegram` / `web`) — желательно
  - `raw_ocr_json` — желательно (для отладки и повторного анализа)

3. Добавить API для просмотра/редактирования чека
- `GET /api/receipts/:id` (чек + позиции + image_url)
- `PATCH /api/receipts/:id` (обновление магазина/даты/позиций)

4. Добавить UI в дашборде
- Модалка или drawer по клику на чек/строку
- Слева фото чека
- Справа редактируемые поля
- Кнопка `Сохранить`

### Важное ограничение

- Для старых чеков фото уже не восстановить, если раньше оно не сохранялось.
- Фото можно начать сохранять только для новых чеков (web + Telegram потоки).

### План на следующую сессию (MVP)

1. Добавить хранение `image_url` в БД и сохранение фото для новых чеков
2. Добавить API чтения/обновления одного чека
3. Сделать модалку в дашборде с просмотром фото и редактированием

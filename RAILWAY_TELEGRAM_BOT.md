# Railway + Telegram Bot Setup

This project can run on Railway as a Next.js app and receive Telegram webhooks.

## Required environment variables

- `DATABASE_URL`
- `OPENAI_API_KEY` or `GOOGLE_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS` (comma-separated Telegram user IDs)
- `TELEGRAM_WEBHOOK_SECRET` (recommended)
- `TELEGRAM_DEPLOYMENT_MODE`:
  - `owner-only` for the private Railway bot
  - `internal-beta` for allowlisted testers
  - `disabled` for public environments

Optional (local helper script):

- `WEBHOOK_BASE_URL=https://your-app.up.railway.app`

## Deploy to Railway

1. Create a new Railway project/service from `vercel-app/`
2. Add the environment variables above
3. Railway will run `npm install`, `npm run build`, `npm run start`
4. Verify health endpoint:
   - `GET /api/health`

## Set Telegram webhook

After deployment, configure the webhook:

```bash
WEBHOOK_BASE_URL=https://your-app.up.railway.app \
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_WEBHOOK_SECRET=... \
TELEGRAM_DEPLOYMENT_MODE=owner-only \
npm run telegram:set-webhook
```

Webhook URL will be:

- `https://your-app.up.railway.app/api/telegram/webhook`

## Telegram bot behavior (MVP)

- `/start` and `/help` return usage tips
- Photo or image document -> analyze receipt -> save to DB -> reply with summary
- Non-image messages -> asks user to send a receipt photo

## Notes

- Public environments should set `TELEGRAM_DEPLOYMENT_MODE=disabled` and must not expose the webhook.
- `TELEGRAM_ALLOWED_USER_IDS` is strongly recommended for private use.
- Sending image as **document** may improve OCR quality (Telegram photo mode compresses images).

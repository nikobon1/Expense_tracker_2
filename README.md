# Expense Tracker

AI-powered expense tracking for grocery receipts.

Expense Tracker helps users turn receipt photos into structured spending data, review purchases, add expenses manually, and analyze their spending through a mobile-first dashboard and Telegram bot workflow.

## Why it exists

Tracking grocery spending is usually fragmented: receipts get lost, manual logs are slow, and analytics are too coarse. Expense Tracker makes this lightweight by combining receipt parsing, fast manual entry, and simple day-to-day reporting in one place.

## Core Capabilities

- Parse receipt images into structured purchases
- Add expenses manually without a receipt
- Review, edit, and clean parsed data before saving
- Sync web and Telegram expense capture into one shared database
- Filter spending by category, store, and date range
- Compare the selected period against a matching previous period
- Export expense history for further analysis

## Product Surface

- Web app for receipt upload, manual entry, and analytics
- Telegram bot for receipt capture and quick manual logging
- Mobile-first dashboard for recurring expense review

## Tech Stack

- Next.js
- React
- TypeScript
- Postgres
- Recharts
- OpenAI / Gemini
- Telegram Bot API

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env.local` with the required environment variables
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000`

## Status

The product already supports receipt parsing, manual expense entry, analytics, Telegram capture, and a localized mobile dashboard. Ongoing work is focused on dashboard polish, validation hardening, and internal cleanup.

## Product Docs

- [Functionality Inventory](./PRODUCT_FUNCTIONALITY_2026-03-22.md)
- [Roadmap](./PRODUCT_ROADMAP_2026-03-22.md)

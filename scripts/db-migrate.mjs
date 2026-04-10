import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(databaseUrl);

const statements = [
  `
    CREATE TABLE IF NOT EXISTS receipts (
      id SERIAL PRIMARY KEY,
      store_name TEXT,
      purchase_date DATE,
      total_amount DECIMAL(10, 2),
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS source TEXT
  `,
  `
    ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS telegram_file_id TEXT
  `,
  `
    ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS comment TEXT
  `,
  `
    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      receipt_id INTEGER REFERENCES receipts(id),
      name TEXT,
      price DECIMAL(10, 2),
      category TEXT
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_processed_updates (
      update_id BIGINT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS telegram_receipt_drafts (
      chat_id BIGINT PRIMARY KEY,
      user_id BIGINT,
      payload_text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS receipt_analyze_logs (
      id BIGSERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(12, 8),
      store_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS receipt_analyze_logs_created_at_idx
    ON receipt_analyze_logs (created_at DESC)
  `,
  `
    CREATE INDEX IF NOT EXISTS receipt_analyze_logs_store_name_idx
    ON receipt_analyze_logs (store_name)
  `,
  `
    CREATE TABLE IF NOT EXISTS custom_categories (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS custom_categories_name_lower_idx
    ON custom_categories (LOWER(name))
  `,
  `
    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      store_name TEXT NOT NULL,
      amount NUMERIC(10, 2) NOT NULL,
      category TEXT NOT NULL,
      frequency TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS recurring_expenses_schedule_idx
    ON recurring_expenses (start_date, end_date, is_active)
  `,
];

try {
  await sql.transaction((tx) => statements.map((statement) => tx.query(statement)));
  console.log("Database migrations applied successfully.");
} catch (error) {
  console.error("Database migration failed:", error);
  process.exit(1);
}

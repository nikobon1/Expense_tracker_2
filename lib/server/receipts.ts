import { neon } from "@neondatabase/serverless";
import type { ReceiptData, ReceiptItem } from "@/features/expenses/types";

type DbClient = ReturnType<typeof neon>;

export function getDb(): DbClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return neon(databaseUrl);
}

let initPromise: Promise<void> | null = null;

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const sql = getDb();

    await sql`
      CREATE TABLE IF NOT EXISTS receipts (
        id SERIAL PRIMARY KEY,
        store_name TEXT,
        purchase_date DATE,
        total_amount DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        receipt_id INTEGER REFERENCES receipts(id),
        name TEXT,
        price DECIMAL(10, 2),
        category TEXT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS telegram_processed_updates (
        update_id BIGINT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS telegram_receipt_drafts (
        chat_id BIGINT PRIMARY KEY,
        user_id BIGINT,
        payload_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export async function saveReceiptToDb(payload: {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
}): Promise<{ receiptId: number; totalAmount: number }> {
  const { store_name, purchase_date, items } = payload;

  if (!store_name || !purchase_date || !items || items.length === 0) {
    throw new Error("Missing required fields");
  }

  await initDb();
  const sql = getDb();

  const totalAmount = items.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const receiptResult = (await sql`
    INSERT INTO receipts (store_name, purchase_date, total_amount)
    VALUES (${store_name}, ${purchase_date}, ${totalAmount})
    RETURNING id
  `) as Array<{ id: number | string }>;

  const receiptId = Number(receiptResult[0]?.id);

  for (const item of items) {
    await sql`
      INSERT INTO items (receipt_id, name, price, category)
      VALUES (
        ${receiptId},
        ${item.name},
        ${Number(item.price || 0)},
        ${item.category || "Другое"}
      )
    `;
  }

  return { receiptId, totalAmount };
}

export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  await initDb();
  const sql = getDb();

  const result = (await sql`
    INSERT INTO telegram_processed_updates (update_id)
    VALUES (${updateId})
    ON CONFLICT (update_id) DO NOTHING
    RETURNING update_id
  `) as Array<{ update_id: number | string }>;

  return result.length > 0;
}

export async function saveTelegramDraft(chatId: number, userId: number | null, receipt: ReceiptData): Promise<void> {
  await initDb();
  const sql = getDb();
  const payloadText = JSON.stringify(receipt);

  await sql`
    INSERT INTO telegram_receipt_drafts (chat_id, user_id, payload_text)
    VALUES (${chatId}, ${userId}, ${payloadText})
    ON CONFLICT (chat_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      payload_text = EXCLUDED.payload_text,
      updated_at = CURRENT_TIMESTAMP
  `;
}

export async function getTelegramDraft(chatId: number): Promise<ReceiptData | null> {
  await initDb();
  const sql = getDb();

  const rows = (await sql`
    SELECT payload_text
    FROM telegram_receipt_drafts
    WHERE chat_id = ${chatId}
    LIMIT 1
  `) as Array<{ payload_text: string }>;

  if (!rows[0]?.payload_text) return null;

  try {
    return JSON.parse(rows[0].payload_text) as ReceiptData;
  } catch {
    return null;
  }
}

export async function deleteTelegramDraft(chatId: number): Promise<void> {
  await initDb();
  const sql = getDb();

  await sql`
    DELETE FROM telegram_receipt_drafts
    WHERE chat_id = ${chatId}
  `;
}

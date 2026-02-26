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
      ALTER TABLE receipts
      ADD COLUMN IF NOT EXISTS source TEXT
    `;

    await sql`
      ALTER TABLE receipts
      ADD COLUMN IF NOT EXISTS telegram_file_id TEXT
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
  source?: string;
  telegram_file_id?: string | null;
}): Promise<{ receiptId: number; totalAmount: number }> {
  const { store_name, purchase_date, items, source, telegram_file_id } = payload;

  if (!store_name || !purchase_date || !items || items.length === 0) {
    throw new Error("Missing required fields");
  }

  await initDb();
  const sql = getDb();

  const totalAmount = items.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const receiptResult = (await sql`
    INSERT INTO receipts (store_name, purchase_date, total_amount, source, telegram_file_id)
    VALUES (${store_name}, ${purchase_date}, ${totalAmount}, ${source ?? null}, ${telegram_file_id ?? null})
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

export async function getReceiptById(
  receiptId: number
): Promise<(ReceiptData & { id: number; total_amount: number; source: string | null; telegram_file_id: string | null }) | null> {
  await initDb();
  const sql = getDb();

  const receiptRows = (await sql`
    SELECT id, store_name, purchase_date, total_amount, source, telegram_file_id
    FROM receipts
    WHERE id = ${receiptId}
    LIMIT 1
  `) as Array<{
    id: number | string;
    store_name: string | null;
    purchase_date: string | Date | null;
    total_amount: number | string | null;
    source: string | null;
    telegram_file_id: string | null;
  }>;

  const receipt = receiptRows[0];
  if (!receipt) return null;

  const itemRows = (await sql`
    SELECT name, price, category
    FROM items
    WHERE receipt_id = ${receiptId}
    ORDER BY id
  `) as Array<{
    name: string | null;
    price: number | string | null;
    category: string | null;
  }>;

  const purchaseDate = receipt.purchase_date ? String(receipt.purchase_date).slice(0, 10) : "";

  return {
    id: Number(receipt.id),
    store_name: receipt.store_name ?? "",
    purchase_date: purchaseDate,
    total_amount: Number(receipt.total_amount ?? 0),
    source: receipt.source ?? null,
    telegram_file_id: receipt.telegram_file_id ?? null,
    items: itemRows.map((item) => ({
      name: item.name ?? "",
      price: Number(item.price ?? 0),
      category: item.category ?? "Другое",
    })),
  };
}

export async function updateReceiptInDb(
  receiptId: number,
  payload: { store_name: string; purchase_date: string; items: ReceiptItem[] }
): Promise<{ receiptId: number; totalAmount: number }> {
  const { store_name, purchase_date, items } = payload;

  if (!store_name || !purchase_date || !items || items.length === 0) {
    throw new Error("Missing required fields");
  }

  await initDb();
  const sql = getDb();

  const exists = (await sql`
    SELECT id
    FROM receipts
    WHERE id = ${receiptId}
    LIMIT 1
  `) as Array<{ id: number | string }>;

  if (!exists[0]?.id) {
    throw new Error("Receipt not found");
  }

  const totalAmount = items.reduce((sum, item) => sum + Number(item.price || 0), 0);

  await sql`
    UPDATE receipts
    SET store_name = ${store_name},
        purchase_date = ${purchase_date},
        total_amount = ${totalAmount}
    WHERE id = ${receiptId}
  `;

  await sql`
    DELETE FROM items
    WHERE receipt_id = ${receiptId}
  `;

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

export async function saveTelegramDraft(
  chatId: number,
  userId: number | null,
  receipt: ReceiptData,
  options?: { telegram_file_id?: string | null }
): Promise<void> {
  await initDb();
  const sql = getDb();
  const receiptWithMeta = receipt as ReceiptData & { _telegram_file_id?: string | null };
  if (options?.telegram_file_id !== undefined) {
    receiptWithMeta._telegram_file_id = options.telegram_file_id;
  }
  const payloadText = JSON.stringify(receiptWithMeta);

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

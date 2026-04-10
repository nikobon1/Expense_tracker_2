import { neon } from "@neondatabase/serverless";
import type { ReceiptData, ReceiptItem } from "@/features/expenses/types";
import { normalizeCalendarDate } from "@/lib/calendar-date";
import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeStoreName } from "@/lib/store-normalization";

type DbClient = ReturnType<typeof neon>;

export function getDb(): DbClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return neon(databaseUrl);
}

export function getDatabaseSchemaMissingMessage(): string {
  return "Database schema is not initialized. Run `npm run db:migrate` before using the app.";
}

export function isDatabaseSchemaMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const dbError = error as Error & {
    code?: string;
    sourceError?: { code?: string; message?: string };
  };

  const errorCodes = [dbError.code, dbError.sourceError?.code];
  if (errorCodes.includes("42P01") || errorCodes.includes("42703")) {
    return true;
  }

  const message = `${dbError.message} ${dbError.sourceError?.message ?? ""}`.toLowerCase();
  return message.includes("does not exist") && (
    message.includes("relation") ||
    message.includes("table") ||
    message.includes("column")
  );
}

function normalizePurchaseDate(value: string | Date | null): string {
  return normalizeCalendarDate(value);
}

function normalizeReceiptItems(items: ReceiptItem[]): Array<{
  name: string;
  price: number;
  category: string;
}> {
  return items.map((item) => ({
    name: String(item.name ?? "").trim(),
    price: Number(item.price || 0),
    category: normalizeCategory(item.category),
  }));
}

function normalizeReceiptComment(comment: string | null | undefined): string | null {
  const normalized = String(comment ?? "").trim();
  return normalized || null;
}

function normalizeTelegramDraft<T extends ReceiptData>(receipt: T): T {
  const normalizedPurchaseDate =
    normalizePurchaseDate(receipt.purchase_date) || String(receipt.purchase_date ?? "").trim();

  return {
    ...receipt,
    store_name: normalizeStoreName(receipt.store_name ?? ""),
    purchase_date: normalizedPurchaseDate,
    items: normalizeReceiptItems(Array.isArray(receipt.items) ? receipt.items : []),
    comment: normalizeReceiptComment(receipt.comment),
  };
}

export async function saveReceiptToDb(payload: {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
  comment?: string | null;
  source?: string;
  telegram_file_id?: string | null;
}): Promise<{ receiptId: number; totalAmount: number }> {
  const { store_name, purchase_date, items, comment, source, telegram_file_id } = payload;
  const normalizedStoreName = normalizeStoreName(store_name);
  const normalizedItems = normalizeReceiptItems(items);
  const normalizedComment = normalizeReceiptComment(comment);

  if (!normalizedStoreName || !purchase_date || !normalizedItems.length) {
    throw new Error("Missing required fields");
  }

  const sql = getDb();

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price, 0);
  const itemsJson = JSON.stringify(normalizedItems);

  const [receiptResult] = (await sql.transaction((tx) => [
    tx`
      WITH inserted_receipt AS (
        INSERT INTO receipts (store_name, purchase_date, total_amount, comment, source, telegram_file_id)
        VALUES (${normalizedStoreName}, ${purchase_date}, ${totalAmount}, ${normalizedComment}, ${source ?? null}, ${telegram_file_id ?? null})
        RETURNING id
      ),
      inserted_items AS (
        INSERT INTO items (receipt_id, name, price, category)
        SELECT
          inserted_receipt.id,
          item.name,
          item.price,
          item.category
        FROM inserted_receipt
        CROSS JOIN jsonb_to_recordset(${itemsJson}::jsonb) AS item(name TEXT, price NUMERIC(10, 2), category TEXT)
        RETURNING receipt_id
      )
      SELECT id
      FROM inserted_receipt
    `,
  ])) as [Array<{ id: number | string }>];

  const receiptId = Number(receiptResult[0]?.id);

  return { receiptId, totalAmount };
}

export async function getReceiptById(
  receiptId: number
): Promise<(ReceiptData & { id: number; total_amount: number; source: string | null; telegram_file_id: string | null }) | null> {
  const sql = getDb();

  const receiptRows = (await sql`
    SELECT id, store_name, purchase_date, total_amount, comment, source, telegram_file_id
    FROM receipts
    WHERE id = ${receiptId}
    LIMIT 1
  `) as Array<{
    id: number | string;
    store_name: string | null;
    purchase_date: string | Date | null;
    total_amount: number | string | null;
    comment: string | null;
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

  const purchaseDate = normalizePurchaseDate(receipt.purchase_date);

  return {
    id: Number(receipt.id),
    store_name: normalizeStoreName(receipt.store_name ?? ""),
    purchase_date: purchaseDate,
    total_amount: Number(receipt.total_amount ?? 0),
    comment: normalizeReceiptComment(receipt.comment),
    source: receipt.source ?? null,
    telegram_file_id: receipt.telegram_file_id ?? null,
    items: itemRows.map((item) => ({
      name: item.name ?? "",
      price: Number(item.price ?? 0),
      category: normalizeCategory(item.category),
    })),
  };
}

export async function updateReceiptInDb(
  receiptId: number,
  payload: { store_name: string; purchase_date: string; items: ReceiptItem[]; comment?: string | null }
): Promise<{ receiptId: number; totalAmount: number }> {
  const { store_name, purchase_date, items, comment } = payload;
  const normalizedStoreName = normalizeStoreName(store_name);
  const normalizedItems = normalizeReceiptItems(items);
  const normalizedComment = normalizeReceiptComment(comment);

  if (!normalizedStoreName || !purchase_date || !normalizedItems.length) {
    throw new Error("Missing required fields");
  }

  const sql = getDb();

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.price, 0);
  const itemsJson = JSON.stringify(normalizedItems);

  const [updateResult] = (await sql.transaction((tx) => [
    tx`
      WITH updated_receipt AS (
        UPDATE receipts
        SET store_name = ${normalizedStoreName},
            purchase_date = ${purchase_date},
            comment = ${normalizedComment},
            total_amount = ${totalAmount}
        WHERE id = ${receiptId}
        RETURNING id
      ),
      deleted_items AS (
        DELETE FROM items
        WHERE receipt_id IN (SELECT id FROM updated_receipt)
      ),
      inserted_items AS (
        INSERT INTO items (receipt_id, name, price, category)
        SELECT
          updated_receipt.id,
          item.name,
          item.price,
          item.category
        FROM updated_receipt
        CROSS JOIN jsonb_to_recordset(${itemsJson}::jsonb) AS item(name TEXT, price NUMERIC(10, 2), category TEXT)
        RETURNING receipt_id
      )
      SELECT id
      FROM updated_receipt
    `,
  ])) as [Array<{ id: number | string }>];

  if (!updateResult[0]?.id) {
    throw new Error("Receipt not found");
  }

  return { receiptId, totalAmount };
}

export async function deleteReceiptFromDb(receiptId: number): Promise<void> {
  const sql = getDb();

  const existingRows = (await sql`
    SELECT id
    FROM receipts
    WHERE id = ${receiptId}
    LIMIT 1
  `) as Array<{ id: number | string }>;

  if (!existingRows[0]?.id) {
    throw new Error("Receipt not found");
  }

  await sql`
    DELETE FROM items
    WHERE receipt_id = ${receiptId}
  `;

  const deletedReceiptRows = (await sql`
    DELETE FROM receipts
    WHERE id = ${receiptId}
    RETURNING id
  `) as Array<{ id: number | string }>;

  if (!deletedReceiptRows[0]?.id) {
    throw new Error("Receipt not found");
  }
}

export async function claimTelegramUpdate(updateId: number): Promise<boolean> {
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
  const sql = getDb();
  const receiptWithMeta = receipt as ReceiptData & { _telegram_file_id?: string | null };
  if (options?.telegram_file_id !== undefined) {
    receiptWithMeta._telegram_file_id = options.telegram_file_id;
  }
  const payloadText = JSON.stringify(normalizeTelegramDraft(receiptWithMeta));

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
  const sql = getDb();

  const rows = (await sql`
    SELECT payload_text
    FROM telegram_receipt_drafts
    WHERE chat_id = ${chatId}
    LIMIT 1
  `) as Array<{ payload_text: string }>;

  if (!rows[0]?.payload_text) return null;

  try {
    return normalizeTelegramDraft(JSON.parse(rows[0].payload_text) as ReceiptData);
  } catch {
    return null;
  }
}

export async function deleteTelegramDraft(chatId: number): Promise<void> {
  const sql = getDb();

  await sql`
    DELETE FROM telegram_receipt_drafts
    WHERE chat_id = ${chatId}
  `;
}

export async function saveReceiptAnalyzeLog(payload: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  storeName?: string | null;
}): Promise<void> {
  const sql = getDb();

  await sql`
    INSERT INTO receipt_analyze_logs (
      provider,
      model,
      input_tokens,
      output_tokens,
      total_tokens,
      estimated_cost_usd,
      store_name
    )
    VALUES (
      ${payload.provider},
      ${payload.model},
      ${Math.max(0, Math.floor(Number(payload.inputTokens || 0)))},
      ${Math.max(0, Math.floor(Number(payload.outputTokens || 0)))},
      ${Math.max(0, Math.floor(Number(payload.totalTokens || 0)))},
      ${payload.estimatedCostUsd},
      ${payload.storeName?.trim() || null}
    )
  `;
}

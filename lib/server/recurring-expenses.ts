import type {
  CreateRecurringExpensePayload,
  Expense,
  RecurringExpensePlan,
  RecurringFrequency,
} from "@/features/expenses/types";
import { normalizeCalendarDate } from "@/lib/calendar-date";
import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeStoreName } from "@/lib/store-normalization";
import { getDb } from "@/lib/server/receipts";

const RECURRING_FREQUENCIES = new Set<RecurringFrequency>(["daily", "weekly", "monthly"]);
const FAR_FUTURE_DATE = "9999-12-31";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RecurringExpenseRow = {
  id: number | string;
  title: string | null;
  store_name: string | null;
  amount: number | string | null;
  category: string | null;
  frequency: string | null;
  start_date: string | Date | null;
  end_date: string | Date | null;
  is_active: boolean | null;
};

export class RecurringExpenseValidationError extends Error {}

function failValidation(message: string): never {
  throw new RecurringExpenseValidationError(message);
}

function normalizeIsoDate(value: string | Date | null | undefined): string {
  const normalized = normalizeCalendarDate(value);
  if (normalized && ISO_DATE_RE.test(normalized)) return normalized;
  return "";
}

function parseUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(value: string, days: number): string {
  const next = parseUtcDate(value);
  next.setUTCDate(next.getUTCDate() + days);
  return formatUtcDate(next);
}

function diffDays(start: string, end: string): number {
  const startDate = parseUtcDate(start);
  const endDate = parseUtcDate(end);
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000);
}

function diffMonths(startDate: string, endDate: string): number {
  const start = parseUtcDate(startDate);
  const end = parseUtcDate(endDate);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
}

function getClampedMonthlyDate(year: number, monthIndex: number, anchorDay: number): string {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(anchorDay, lastDay);
  return formatUtcDate(new Date(Date.UTC(year, monthIndex, day)));
}

function addMonthsFromAnchor(startDate: string, monthOffset: number): string {
  const base = parseUtcDate(startDate);
  const anchorDay = base.getUTCDate();
  const targetMonthIndex = base.getUTCMonth() + monthOffset;
  const targetYear = base.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  return getClampedMonthlyDate(targetYear, normalizedMonthIndex, anchorDay);
}

function hashString(value: string): number {
  let hash = 0;

  for (const ch of value) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 2_147_483_647;
  }

  return hash || 1;
}

function toPlan(row: RecurringExpenseRow): RecurringExpensePlan {
  const frequency = String(row.frequency ?? "").trim().toLowerCase() as RecurringFrequency;
  return {
    id: Number(row.id),
    title: String(row.title ?? "").replace(/\s+/g, " ").trim(),
    store_name: normalizeStoreName(String(row.store_name ?? "")),
    amount: Number(row.amount ?? 0),
    category: normalizeCategory(String(row.category ?? "")),
    frequency: RECURRING_FREQUENCIES.has(frequency) ? frequency : "monthly",
    start_date: normalizeIsoDate(row.start_date),
    end_date: normalizeIsoDate(row.end_date) || null,
    is_active: Boolean(row.is_active),
    next_charge_date: null,
  };
}

function computeFirstOccurrenceOnOrAfter(plan: RecurringExpensePlan, anchorDate: string): string | null {
  const rangeStart = anchorDate > plan.start_date ? anchorDate : plan.start_date;
  const effectiveEnd = plan.end_date ?? FAR_FUTURE_DATE;
  if (rangeStart > effectiveEnd) return null;

  if (plan.frequency === "daily") {
    return rangeStart;
  }

  if (plan.frequency === "weekly") {
    const dayDelta = Math.max(0, diffDays(plan.start_date, rangeStart));
    const remainder = dayDelta % 7;
    return remainder === 0 ? rangeStart : addUtcDays(rangeStart, 7 - remainder);
  }

  let monthOffset = 0;
  let candidate = plan.start_date;
  while (candidate < rangeStart) {
    monthOffset += 1;
    candidate = addMonthsFromAnchor(plan.start_date, monthOffset);
  }
  return candidate;
}

function computeNextChargeDate(plan: RecurringExpensePlan, todayIso: string): string | null {
  const nextDate = computeFirstOccurrenceOnOrAfter(plan, todayIso);
  if (!nextDate) return null;
  if (plan.end_date && nextDate > plan.end_date) return null;
  return nextDate;
}

function generatePlanOccurrences(plan: RecurringExpensePlan, rangeStart: string, rangeEnd: string): string[] {
  if (!plan.start_date || rangeStart > rangeEnd) return [];

  const effectiveStart = rangeStart > plan.start_date ? rangeStart : plan.start_date;
  const effectiveEnd = plan.end_date && plan.end_date < rangeEnd ? plan.end_date : rangeEnd;
  if (!effectiveStart || !effectiveEnd || effectiveStart > effectiveEnd) return [];

  const dates: string[] = [];

  if (plan.frequency === "daily") {
    let cursor = effectiveStart;
    while (cursor <= effectiveEnd) {
      dates.push(cursor);
      cursor = addUtcDays(cursor, 1);
    }
    return dates;
  }

  if (plan.frequency === "weekly") {
    let cursor = computeFirstOccurrenceOnOrAfter(plan, effectiveStart);
    while (cursor && cursor <= effectiveEnd) {
      dates.push(cursor);
      cursor = addUtcDays(cursor, 7);
    }
    return dates;
  }

  let cursor = computeFirstOccurrenceOnOrAfter(plan, effectiveStart);
  let monthOffset = cursor ? diffMonths(plan.start_date, cursor) : 0;
  while (cursor && cursor <= effectiveEnd) {
    dates.push(cursor);
    monthOffset += 1;
    cursor = addMonthsFromAnchor(plan.start_date, monthOffset);
  }

  return dates;
}

function mapRecurringExpense(plan: RecurringExpensePlan, date: string): Expense {
  const receiptId = -hashString(`recurring-receipt:${plan.id}:${date}`);
  const expenseId = -hashString(`recurring-item:${plan.id}:${date}`);

  return {
    id: expenseId,
    receiptId,
    date,
    store: plan.store_name,
    item: plan.title,
    price: Number(plan.amount.toFixed(2)),
    category: plan.category,
    sourceType: "recurring",
    recurringId: plan.id,
    recurringFrequency: plan.frequency,
    canEdit: false,
  };
}

export function isRecurringExpenseValidationError(error: unknown): error is RecurringExpenseValidationError {
  return error instanceof RecurringExpenseValidationError;
}

export function parseRecurringExpensePayload(payload: unknown): CreateRecurringExpensePayload {
  const raw = (payload ?? {}) as Record<string, unknown>;

  const title = String(raw.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) {
    failValidation("Название списания обязательно.");
  }
  if (title.length > 80) {
    failValidation("Название списания должно быть не длиннее 80 символов.");
  }

  const storeName = normalizeStoreName(String(raw.store_name ?? ""));
  if (!storeName) {
    failValidation("Укажите сервис или магазин.");
  }

  const amount = Number(raw.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    failValidation("Сумма списания должна быть больше нуля.");
  }

  const category = normalizeCategory(String(raw.category ?? ""));
  if (!category) {
    failValidation("Категория обязательна.");
  }

  const frequency = String(raw.frequency ?? "").trim().toLowerCase() as RecurringFrequency;
  if (!RECURRING_FREQUENCIES.has(frequency)) {
    failValidation("Неверная частота списания.");
  }

  const startDate = normalizeIsoDate(String(raw.start_date ?? ""));
  if (!startDate || !ISO_DATE_RE.test(startDate)) {
    failValidation("Дата начала должна быть в формате YYYY-MM-DD.");
  }

  return {
    title,
    store_name: storeName,
    amount: Number(amount.toFixed(2)),
    category,
    frequency,
    start_date: startDate,
  };
}

export async function getRecurringExpensePlansInDb(options?: {
  activeOnly?: boolean;
  fromDate?: string;
  toDate?: string;
  userId?: number;
}): Promise<RecurringExpensePlan[]> {
  const sql = getDb();
  const activeOnly = options?.activeOnly ?? false;
  const fromDate = normalizeIsoDate(options?.fromDate ?? "");
  const toDate = normalizeIsoDate(options?.toDate ?? "");
  const userId = options?.userId ?? null;

  const rows = (fromDate && toDate)
    ? (await sql`
        SELECT id, title, store_name, amount, category, frequency, start_date, end_date, is_active
        FROM recurring_expenses
        WHERE user_id = ${userId}
          AND start_date <= ${toDate}
          AND COALESCE(end_date, ${FAR_FUTURE_DATE}::date) >= ${fromDate}
          AND (${activeOnly} = FALSE OR is_active = TRUE)
        ORDER BY created_at DESC, id DESC
      `) as RecurringExpenseRow[]
    : (await sql`
        SELECT id, title, store_name, amount, category, frequency, start_date, end_date, is_active
        FROM recurring_expenses
        WHERE user_id = ${userId}
          AND (${activeOnly} = FALSE OR is_active = TRUE)
        ORDER BY created_at DESC, id DESC
      `) as RecurringExpenseRow[];

  const todayIso = formatUtcDate(new Date());
  return rows.map((row) => {
    const plan = toPlan(row);
    return {
      ...plan,
      next_charge_date: plan.is_active ? computeNextChargeDate(plan, todayIso) : null,
    };
  });
}

export async function createRecurringExpenseInDb(
  payload: CreateRecurringExpensePayload,
  options: { userId: number }
): Promise<RecurringExpensePlan> {
  const sql = getDb();
  const userId = options.userId;

  const rows = (await sql`
    INSERT INTO recurring_expenses (title, store_name, amount, category, frequency, start_date, user_id)
    VALUES (
      ${payload.title},
      ${payload.store_name},
      ${payload.amount},
      ${payload.category},
      ${payload.frequency},
      ${payload.start_date},
      ${userId}
    )
    RETURNING id, title, store_name, amount, category, frequency, start_date, end_date, is_active
  `) as RecurringExpenseRow[];

  const plan = toPlan(rows[0]);
  return {
    ...plan,
    next_charge_date: computeNextChargeDate(plan, formatUtcDate(new Date())),
  };
}

export async function deactivateRecurringExpenseInDb(id: number, options: { userId: number }): Promise<boolean> {
  const sql = getDb();
  const userId = options.userId;

  const rows = (await sql`
    UPDATE recurring_expenses
    SET
      is_active = FALSE,
      end_date = COALESCE(end_date, CURRENT_DATE),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
      AND user_id = ${userId}
      AND is_active = TRUE
    RETURNING id
  `) as Array<{ id: number | string }>;

  return rows.length > 0;
}

export function generateRecurringExpensesForRange(
  plans: RecurringExpensePlan[],
  rangeStart: string,
  rangeEnd: string
): Expense[] {
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return [];

  return plans.flatMap((plan) =>
    generatePlanOccurrences(plan, rangeStart, rangeEnd).map((date) => mapRecurringExpense(plan, date))
  );
}

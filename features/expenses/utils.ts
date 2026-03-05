import type { Expense } from "./types";

export interface CategoryPoint {
  name: string;
  value: number;
}

export interface DailyPoint {
  date: string;
  amount: number;
  receiptCount: number;
  receiptSegments: DailyReceiptSegment[];
}

export interface DailyReceiptSegment {
  receiptId: number;
  store: string;
  amount: number;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildDateRange(startDate: string, endDate: string): string[] {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return [];
  if (startDate > endDate) return [];

  const result: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

export function buildCategoryData(expenses: Expense[]): CategoryPoint[] {
  return expenses.reduce<CategoryPoint[]>((acc, exp) => {
    const existing = acc.find((d) => d.name === exp.category);
    if (existing) {
      existing.value += exp.price;
    } else {
      acc.push({ name: exp.category, value: exp.price });
    }
    return acc;
  }, []);
}

export function buildDailyData(expenses: Expense[], startDate?: string, endDate?: string): DailyPoint[] {
  const byDate = new Map<string, { amount: number; receipts: Map<number, DailyReceiptSegment> }>();

  for (const exp of expenses) {
    let dateEntry = byDate.get(exp.date);
    if (!dateEntry) {
      dateEntry = { amount: 0, receipts: new Map<number, DailyReceiptSegment>() };
      byDate.set(exp.date, dateEntry);
    }

    dateEntry.amount += exp.price;
    const receiptEntry = dateEntry.receipts.get(exp.receiptId);
    if (receiptEntry) {
      receiptEntry.amount += exp.price;
    } else {
      dateEntry.receipts.set(exp.receiptId, {
        receiptId: exp.receiptId,
        store: exp.store,
        amount: exp.price,
      });
    }
  }

  if (startDate && endDate) {
    for (const date of buildDateRange(startDate, endDate)) {
      if (!byDate.has(date)) {
        byDate.set(date, { amount: 0, receipts: new Map<number, DailyReceiptSegment>() });
      }
    }
  }

  return Array.from(byDate.entries())
    .map(([date, entry]) => {
      const receiptSegments = Array.from(entry.receipts.values()).sort((a, b) => b.amount - a.amount);
      return {
        date,
        amount: entry.amount,
        receiptCount: receiptSegments.length,
        receiptSegments,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}


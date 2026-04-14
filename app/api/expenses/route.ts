import { NextRequest, NextResponse } from "next/server";
import { normalizeCalendarDate } from "@/lib/calendar-date";
import { normalizeCategory } from "@/lib/category-normalization";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";
import { normalizeStoreName } from "@/lib/store-normalization";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";
import {
  generateRecurringExpensesForRange,
  getRecurringExpenseCurrenciesInDb,
  getRecurringExpensePlansInDb,
} from "@/lib/server/recurring-expenses";
import {
  getDatabaseSchemaMissingMessage,
  getDb,
  isDatabaseSchemaMissingError,
} from "@/lib/server/receipts";

function shiftDateByMonths(dateString: string, monthOffset: number) {
  const [yearPart, monthPart, dayPart] = dateString.split("-").map(Number);
  const year = Number.isFinite(yearPart) ? yearPart : 0;
  const month = Number.isFinite(monthPart) ? monthPart : 0;
  const day = Number.isFinite(dayPart) ? dayPart : 0;

  const targetMonthIndex = month - 1 + monthOffset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const normalizedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(targetYear, normalizedMonthIndex, normalizedDay)).toISOString().split("T")[0];
}

function normalizeIsoDate(value: string | Date | null | undefined): string {
  return normalizeCalendarDate(value);
}

function aggregateCategoryTotals(rows: Array<{ category?: unknown; total?: unknown }>) {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const category = normalizeCategory(String(row.category ?? ""));
    const amount = Number(row.total ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    totals.set(category, (totals.get(category) ?? 0) + amount);
  }

  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const store = (searchParams.get("store") ?? "").trim();
    const activeCurrency = normalizeCurrencyCode(searchParams.get("currency") ?? currentUser.defaultCurrency);
    const hasStoreFilter = store.length > 0 && store.toLowerCase() !== "all";

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Missing date range" }, { status: 400 });
    }

    const sql = getDb();
    const normalizedStoreFilter = hasStoreFilter ? normalizeStoreName(store) : "";
    const prevPeriodStart = shiftDateByMonths(startDate, -1);
    const prevPeriodEnd = shiftDateByMonths(endDate, -1);
    const rangeFloor = prevPeriodStart < startDate ? prevPeriodStart : startDate;
    const rangeCeiling = prevPeriodEnd > endDate ? prevPeriodEnd : endDate;

    const expensesRows = (await sql`
      SELECT
        i.id,
        r.id as receipt_id,
        r.purchase_date as date,
        r.store_name as store,
        i.name as item,
        i.price,
        i.category,
        r.currency
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${startDate} AND ${endDate}
        AND r.user_id = ${currentUser.id}
        AND COALESCE(r.currency, ${DEFAULT_CURRENCY}) = ${activeCurrency}
      ORDER BY r.purchase_date DESC
    `) as Array<{
      id: number | string;
      receipt_id: number | string;
      date: string | Date | null;
      store: string | null;
      item: string | null;
      price: number | string | null;
      category: string | null;
      currency: string | null;
    }>;

    const prevMonthRows = (await sql`
      SELECT store_name, COALESCE(SUM(total_amount), 0) as total
      FROM receipts
      WHERE purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
        AND user_id = ${currentUser.id}
        AND COALESCE(currency, ${DEFAULT_CURRENCY}) = ${activeCurrency}
      GROUP BY store_name
    `) as Array<{
      store_name: string | null;
      total: number | string | null;
    }>;

    const prevPeriodCategoryRows = (await sql`
      SELECT r.store_name, i.category, COALESCE(SUM(i.price), 0) as total
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
        AND r.user_id = ${currentUser.id}
        AND COALESCE(r.currency, ${DEFAULT_CURRENCY}) = ${activeCurrency}
      GROUP BY r.store_name, i.category
    `) as Array<{
      store_name: string | null;
      category: string | null;
      total: number | string | null;
    }>;

    const stores = (await sql`
      SELECT DISTINCT TRIM(store_name) as store
      FROM receipts
      WHERE purchase_date BETWEEN ${startDate} AND ${endDate}
        AND user_id = ${currentUser.id}
        AND COALESCE(currency, ${DEFAULT_CURRENCY}) = ${activeCurrency}
        AND store_name IS NOT NULL
        AND TRIM(store_name) <> ''
      ORDER BY store
    `) as Array<{ store: string | null }>;

    const receiptCurrencyRows = (await sql`
      SELECT DISTINCT COALESCE(currency, ${DEFAULT_CURRENCY}) AS currency
      FROM receipts
      WHERE user_id = ${currentUser.id}
      ORDER BY currency
    `) as Array<{ currency: string | null }>;

    const analyzeCostRows = (await sql`
      SELECT
        id,
        provider,
        model,
        input_tokens,
        output_tokens,
        total_tokens,
        estimated_cost_usd,
        store_name,
        created_at
      FROM receipt_analyze_logs
      WHERE created_at::date BETWEEN ${startDate} AND ${endDate}
        AND user_id = ${currentUser.id}
      ORDER BY created_at DESC
      LIMIT 20
    `) as Array<{
      id: number | string | null;
      provider: string | null;
      model: string | null;
      input_tokens: number | string | null;
      output_tokens: number | string | null;
      total_tokens: number | string | null;
      estimated_cost_usd: number | string | null;
      store_name: string | null;
      created_at: string;
    }>;

    const recurringPlans = await getRecurringExpensePlansInDb({
      fromDate: rangeFloor,
      toDate: rangeCeiling,
      userId: currentUser.id,
      currency: activeCurrency,
    });
    const recurringCurrencies = await getRecurringExpenseCurrenciesInDb(currentUser.id);
    const recurringExpenses = generateRecurringExpensesForRange(recurringPlans, startDate, endDate);
    const prevRecurringExpenses = generateRecurringExpensesForRange(recurringPlans, prevPeriodStart, prevPeriodEnd);

    const matchesStoreFilter = (rawStore: unknown) => {
      if (!hasStoreFilter) return true;
      return normalizeStoreName(String(rawStore ?? "")) === normalizedStoreFilter;
    };

    const receiptExpenses: Array<{
      id: number;
      receiptId: number;
      date: string;
      store: string;
      item: string;
      price: number;
      category: string;
      currency: string;
      sourceType: "receipt";
      recurringId: null;
      recurringFrequency: null;
      canEdit: true;
    }> = expensesRows.map((entry) => ({
        id: Number(entry.id),
        receiptId: Number(entry.receipt_id),
        date: normalizeIsoDate(entry.date),
        store: normalizeStoreName(String(entry.store ?? "")),
        item: String(entry.item ?? ""),
        price: Number(entry.price ?? 0),
        category: normalizeCategory(String(entry.category ?? "")),
        currency: normalizeCurrencyCode(entry.currency ?? DEFAULT_CURRENCY),
        sourceType: "receipt" as const,
        recurringId: null,
        recurringFrequency: null,
        canEdit: true,
      }));

    const expenses = [...receiptExpenses, ...recurringExpenses]
      .filter((entry) => matchesStoreFilter(entry.store))
      .sort((a, b) => b.date.localeCompare(a.date) || b.receiptId - a.receiptId || b.id - a.id);

    const prevMonthTotal =
      prevMonthRows.reduce((sum, row) => {
        if (!matchesStoreFilter(row.store_name)) return sum;
        return sum + Number(row.total ?? 0);
      }, 0) +
      prevRecurringExpenses.reduce((sum, row) => {
        if (!matchesStoreFilter(row.store)) return sum;
        return sum + Number(row.price ?? 0);
      }, 0);

    const prevPeriodCategoryTotals = aggregateCategoryTotals(
      prevPeriodCategoryRows
        .filter((row) => matchesStoreFilter(row.store_name))
        .map((row) => ({
          category: row.category,
          total: row.total,
        }))
        .concat(
          prevRecurringExpenses
            .filter((row) => matchesStoreFilter(row.store))
            .map((row) => ({
              category: row.category,
              total: row.price,
            }))
        )
    );

    const filteredAnalyzeCostRows = analyzeCostRows.filter((row) => matchesStoreFilter(row.store_name));
    const analyzeCostTotal = filteredAnalyzeCostRows.reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);

    const normalizedStores = Array.from(
      new Set(
        stores
          .map((row) => normalizeStoreName(String(row.store ?? "")))
          .filter(Boolean)
          .concat(recurringExpenses.map((row) => normalizeStoreName(String(row.store ?? ""))).filter(Boolean))
      )
    ).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      expenses,
      activeCurrency,
      currencies: Array.from(
        new Set(
          receiptCurrencyRows
            .map((row) => normalizeCurrencyCode(row.currency ?? DEFAULT_CURRENCY))
            .concat(recurringCurrencies.map((value) => normalizeCurrencyCode(value)))
        )
      ).sort((a, b) => a.localeCompare(b)),
      prevMonthTotal: Number(prevMonthTotal || 0),
      prevPeriodCategoryTotals,
      analyzeCost: {
        totalUsd: Number(analyzeCostTotal.toFixed(8)),
        count: filteredAnalyzeCostRows.length,
        items: filteredAnalyzeCostRows.map((row) => ({
          id: Number(row.id ?? 0),
          provider: String(row.provider ?? ""),
          model: String(row.model ?? ""),
          inputTokens: Number(row.input_tokens ?? 0),
          outputTokens: Number(row.output_tokens ?? 0),
          totalTokens: Number(row.total_tokens ?? 0),
          estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
          storeName: normalizeStoreName(String(row.store_name ?? "")),
          createdAt: row.created_at,
        })),
      },
      stores: normalizedStores,
    });
  } catch (error) {
    console.error("Get expenses error:", error);

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof Error && error.message.includes("DATABASE_URL")) {
      return NextResponse.json({
        expenses: [],
        activeCurrency: DEFAULT_CURRENCY,
        currencies: [DEFAULT_CURRENCY],
        prevMonthTotal: 0,
        prevPeriodCategoryTotals: [],
        analyzeCost: {
          totalUsd: 0,
          count: 0,
          items: [],
        },
        stores: [],
      });
    }

    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json(
        { error: getDatabaseSchemaMissingMessage() },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get expenses" },
      { status: 500 }
    );
  }
}

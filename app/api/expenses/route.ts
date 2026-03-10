import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { normalizeCategory } from '@/lib/category-normalization';
import { normalizeStoreName } from '@/lib/store-normalization';

function shiftDateByMonths(dateString: string, monthOffset: number) {
    const [yearPart, monthPart, dayPart] = dateString.split('-').map(Number);
    const year = Number.isFinite(yearPart) ? yearPart : 0;
    const month = Number.isFinite(monthPart) ? monthPart : 0;
    const day = Number.isFinite(dayPart) ? dayPart : 0;

    const targetMonthIndex = month - 1 + monthOffset;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
    const normalizedDay = Math.min(day, lastDayOfTargetMonth);

    return new Date(Date.UTC(targetYear, normalizedMonthIndex, normalizedDay))
        .toISOString()
        .split('T')[0];
}

function getDb() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is not set');
    }
    return neon(databaseUrl);
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
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('start');
        const endDate = searchParams.get('end');
        const store = (searchParams.get('store') ?? '').trim();
        const hasStoreFilter = store.length > 0 && store.toLowerCase() !== 'all';

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
        }

        const sql = getDb();

        const normalizedStoreFilter = hasStoreFilter ? normalizeStoreName(store) : '';

        // Get expenses for the period.
        const expensesRows = await sql`
      SELECT 
        i.id,
        r.id as receipt_id,
        r.purchase_date as date,
        r.store_name as store,
        i.name as item,
        i.price,
        i.category
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${startDate} AND ${endDate}
      ORDER BY r.purchase_date DESC
    `;

        // Compare against the same date range shifted one calendar month back.
        const prevPeriodStart = shiftDateByMonths(startDate, -1);
        const prevPeriodEnd = shiftDateByMonths(endDate, -1);

        const prevMonthRows = await sql`
      SELECT store_name, COALESCE(SUM(total_amount), 0) as total
      FROM receipts
      WHERE purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
      GROUP BY store_name
    `;

        const prevPeriodCategoryRows = await sql`
      SELECT r.store_name, i.category, COALESCE(SUM(i.price), 0) as total
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
      GROUP BY r.store_name, i.category
    `;

        const stores = await sql`
      SELECT DISTINCT TRIM(store_name) as store
      FROM receipts
      WHERE purchase_date BETWEEN ${startDate} AND ${endDate}
        AND store_name IS NOT NULL
        AND TRIM(store_name) <> ''
      ORDER BY store
    `;

        await sql`
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
    `;

        const analyzeCostRows = await sql`
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
      ORDER BY created_at DESC
      LIMIT 20
    `;

        const matchesStoreFilter = (rawStore: unknown) => {
            if (!hasStoreFilter) return true;
            return normalizeStoreName(String(rawStore ?? "")) === normalizedStoreFilter;
        };

        const expenses = expensesRows
            .map((e) => ({
                id: e.id,
                receiptId: Number(e.receipt_id),
                date: e.date,
                store: normalizeStoreName(String(e.store ?? "")),
                item: e.item,
                price: Number(e.price),
                category: normalizeCategory(String(e.category ?? ""))
            }))
            .filter((entry) => matchesStoreFilter(entry.store));

        const prevMonthTotal = prevMonthRows.reduce((sum, row) => {
            if (!matchesStoreFilter(row.store_name)) return sum;
            return sum + Number(row.total ?? 0);
        }, 0);

        const prevPeriodCategoryTotals = aggregateCategoryTotals(
            prevPeriodCategoryRows
                .filter((row) => matchesStoreFilter(row.store_name))
                .map((row) => ({
                    category: row.category,
                    total: row.total
                }))
        );

        const filteredAnalyzeCostRows = analyzeCostRows.filter((row) => matchesStoreFilter(row.store_name));
        const analyzeCostTotal = filteredAnalyzeCostRows.reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);

        const normalizedStores = Array.from(
            new Set(
                stores
                    .map((row) => normalizeStoreName(String(row.store ?? "")))
                    .filter(Boolean)
            )
        ).sort((a, b) => a.localeCompare(b));

        return NextResponse.json({
            expenses,
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
            stores: normalizedStores
        });
    } catch (error) {
        console.error('Get expenses error:', error);

        // If database is not configured, return empty data
        if (error instanceof Error && error.message.includes('DATABASE_URL')) {
            return NextResponse.json({
                expenses: [],
                prevMonthTotal: 0,
                prevPeriodCategoryTotals: [],
                analyzeCost: {
                    totalUsd: 0,
                    count: 0,
                    items: []
                },
                stores: []
            });
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get expenses' },
            { status: 500 }
        );
    }
}

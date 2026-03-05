import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { normalizeCategory } from '@/lib/category-normalization';

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

        // Get expenses for the period
        const expenses = hasStoreFilter ? await sql`
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
        AND r.store_name = ${store}
      ORDER BY r.purchase_date DESC
    ` : await sql`
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

        const prevMonthResult = hasStoreFilter ? await sql`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM receipts
      WHERE purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
        AND store_name = ${store}
    ` : await sql`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM receipts
      WHERE purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
    `;

        const prevPeriodCategoryRows = hasStoreFilter ? await sql`
      SELECT i.category, COALESCE(SUM(i.price), 0) as total
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
        AND r.store_name = ${store}
      GROUP BY i.category
    ` : await sql`
      SELECT i.category, COALESCE(SUM(i.price), 0) as total
      FROM receipts r
      JOIN items i ON r.id = i.receipt_id
      WHERE r.purchase_date BETWEEN ${prevPeriodStart} AND ${prevPeriodEnd}
      GROUP BY i.category
    `;

        const stores = await sql`
      SELECT DISTINCT TRIM(store_name) as store
      FROM receipts
      WHERE purchase_date BETWEEN ${startDate} AND ${endDate}
        AND store_name IS NOT NULL
        AND TRIM(store_name) <> ''
      ORDER BY store
    `;

        return NextResponse.json({
            expenses: expenses.map(e => ({
                id: e.id,
                receiptId: Number(e.receipt_id),
                date: e.date,
                store: e.store,
                item: e.item,
                price: Number(e.price),
                category: normalizeCategory(String(e.category ?? ""))
            })),
            prevMonthTotal: Number(prevMonthResult[0]?.total || 0),
            prevPeriodCategoryTotals: aggregateCategoryTotals(prevPeriodCategoryRows),
            stores: stores
                .map((row) => String(row.store ?? "").trim())
                .filter(Boolean)
        });
    } catch (error) {
        console.error('Get expenses error:', error);

        // If database is not configured, return empty data
        if (error instanceof Error && error.message.includes('DATABASE_URL')) {
            return NextResponse.json({
                expenses: [],
                prevMonthTotal: 0,
                prevPeriodCategoryTotals: [],
                stores: []
            });
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get expenses' },
            { status: 500 }
        );
    }
}

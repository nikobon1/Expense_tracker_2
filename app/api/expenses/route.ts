import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

function getDb() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is not set');
    }
    return neon(databaseUrl);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('start');
        const endDate = searchParams.get('end');

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
        }

        const sql = getDb();

        // Get expenses for the period
        const expenses = await sql`
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

        // Calculate previous month total
        const startDateObj = new Date(startDate);
        const prevMonthEnd = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), 0);
        const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);

        const prevMonthResult = await sql`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM receipts
      WHERE purchase_date BETWEEN ${prevMonthStart.toISOString().split('T')[0]} AND ${prevMonthEnd.toISOString().split('T')[0]}
    `;

        return NextResponse.json({
            expenses: expenses.map(e => ({
                id: e.id,
                receiptId: Number(e.receipt_id),
                date: e.date,
                store: e.store,
                item: e.item,
                price: Number(e.price),
                category: e.category
            })),
            prevMonthTotal: Number(prevMonthResult[0]?.total || 0)
        });
    } catch (error) {
        console.error('Get expenses error:', error);

        // If database is not configured, return empty data
        if (error instanceof Error && error.message.includes('DATABASE_URL')) {
            return NextResponse.json({
                expenses: [],
                prevMonthTotal: 0
            });
        }

        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to get expenses' },
            { status: 500 }
        );
    }
}

import { NextRequest, NextResponse } from "next/server";
import type { ReceiptItem } from "@/features/expenses/types";
import {
  getDatabaseSchemaMissingMessage,
  isDatabaseSchemaMissingError,
  saveReceiptToDb,
} from "@/lib/server/receipts";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      store_name?: string;
      purchase_date?: string;
      items?: ReceiptItem[];
    };

    const result = await saveReceiptToDb({
      store_name: body.store_name ?? "",
      purchase_date: body.purchase_date ?? "",
      items: body.items ?? [],
      source: "web",
    });

    return NextResponse.json({ success: true, receiptId: result.receiptId });
  } catch (error) {
    console.error("Save receipt error:", error);
    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json(
        { error: getDatabaseSchemaMissingMessage() },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save receipt" },
      { status: 500 }
    );
  }
}

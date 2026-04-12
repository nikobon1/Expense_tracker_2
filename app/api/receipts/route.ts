import { NextRequest, NextResponse } from "next/server";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";
import {
  getDatabaseSchemaMissingMessage,
  isDatabaseSchemaMissingError,
  saveReceiptToDb,
} from "@/lib/server/receipts";
import {
  getReceiptValidationErrorMessage,
  isReceiptValidationError,
  parseReceiptPayload,
} from "@/lib/server/receipt-validation";

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = parseReceiptPayload(await request.json());

    const result = await saveReceiptToDb({
      store_name: body.store_name,
      purchase_date: body.purchase_date,
      items: body.items,
      comment: body.comment,
      source: "web",
      userId: currentUser.id,
    });

    return NextResponse.json({ success: true, receiptId: result.receiptId });
  } catch (error) {
    console.error("Save receipt error:", error);
    if (isInvalidJsonError(error)) {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400 }
      );
    }

    if (isReceiptValidationError(error)) {
      return NextResponse.json(
        { error: getReceiptValidationErrorMessage(error) },
        { status: 400 }
      );
    }

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        { error: error.message },
        { status: 401 }
      );
    }

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

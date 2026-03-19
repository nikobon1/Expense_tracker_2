import { NextRequest, NextResponse } from "next/server";
import {
  getDatabaseSchemaMissingMessage,
  getReceiptById,
  isDatabaseSchemaMissingError,
  updateReceiptInDb,
} from "@/lib/server/receipts";
import {
  getReceiptValidationErrorMessage,
  isReceiptValidationError,
  parseReceiptPayload,
} from "@/lib/server/receipt-validation";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseReceiptId(rawId: string): number {
  const parsed = Number(rawId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid receipt id");
  }
  return parsed;
}

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const receiptId = parseReceiptId(id);

    const receipt = await getReceiptById(receiptId);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    return NextResponse.json(receipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load receipt";
    const status = /invalid receipt id/i.test(message)
      ? 400
      : isDatabaseSchemaMissingError(error)
        ? 503
        : 500;

    const responseMessage = isDatabaseSchemaMissingError(error)
      ? getDatabaseSchemaMissingMessage()
      : message;
    return NextResponse.json({ error: responseMessage }, { status });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const receiptId = parseReceiptId(id);

    const body = parseReceiptPayload(await request.json());

    const updated = await updateReceiptInDb(receiptId, {
      store_name: body.store_name,
      purchase_date: body.purchase_date,
      items: body.items,
    });

    return NextResponse.json({ success: true, receiptId: updated.receiptId, totalAmount: updated.totalAmount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update receipt";
    const status =
      /invalid receipt id/i.test(message)
        ? 400
        : isInvalidJsonError(error)
          ? 400
          : isReceiptValidationError(error)
            ? 400
        : /receipt not found/i.test(message)
          ? 404
          : isDatabaseSchemaMissingError(error)
            ? 503
            : 500;

    const responseMessage = isInvalidJsonError(error)
      ? "Request body must be valid JSON"
      : isReceiptValidationError(error)
        ? getReceiptValidationErrorMessage(error)
        : isDatabaseSchemaMissingError(error)
          ? getDatabaseSchemaMissingMessage()
          : message;

    return NextResponse.json({ error: responseMessage }, { status });
  }
}

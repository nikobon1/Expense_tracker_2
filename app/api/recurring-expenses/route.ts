import { NextRequest, NextResponse } from "next/server";
import {
  createRecurringExpenseInDb,
  deactivateRecurringExpenseInDb,
  getRecurringExpensePlansInDb,
  isRecurringExpenseValidationError,
  parseRecurringExpensePayload,
} from "@/lib/server/recurring-expenses";
import {
  getDatabaseSchemaMissingMessage,
  isDatabaseSchemaMissingError,
} from "@/lib/server/receipts";

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export async function GET() {
  try {
    const plans = await getRecurringExpensePlansInDb({ activeOnly: true });
    return NextResponse.json({ plans });
  } catch (error) {
    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load recurring expenses" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = parseRecurringExpensePayload(await request.json());
    await createRecurringExpenseInDb(payload);
    const plans = await getRecurringExpensePlansInDb({ activeOnly: true });
    return NextResponse.json({ plans });
  } catch (error) {
    if (isInvalidJsonError(error)) {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    if (isRecurringExpenseValidationError(error)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create recurring expense" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const payload = (await request.json()) as { id?: unknown };
    const id = Number(payload?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid recurring expense id" }, { status: 400 });
    }

    const deleted = await deactivateRecurringExpenseInDb(id);
    if (!deleted) {
      return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });
    }

    const plans = await getRecurringExpensePlansInDb({ activeOnly: true });
    return NextResponse.json({ plans });
  } catch (error) {
    if (isInvalidJsonError(error)) {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete recurring expense" },
      { status: 500 }
    );
  }
}

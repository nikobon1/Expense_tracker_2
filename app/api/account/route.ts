import { NextRequest, NextResponse } from "next/server";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";
import { updateUserPreferences } from "@/lib/server/users";

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

export async function GET() {
  try {
    const currentUser = await requireCurrentUser();
    return NextResponse.json({ user: currentUser });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load account" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const payload = (await request.json()) as {
      name?: unknown;
      defaultCurrency?: unknown;
      timezone?: unknown;
    };

    const updatedUser = await updateUserPreferences(currentUser.id, {
      name: typeof payload.name === "string" ? payload.name : null,
      defaultCurrency: typeof payload.defaultCurrency === "string" ? payload.defaultCurrency : null,
      timezone: typeof payload.timezone === "string" ? payload.timezone : null,
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    if (isInvalidJsonError(error)) {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (error instanceof Error && /timezone|user not found|invalid user id/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update account" },
      { status: 500 }
    );
  }
}

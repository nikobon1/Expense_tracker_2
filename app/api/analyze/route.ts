import { NextRequest, NextResponse } from "next/server";
import { analyzeReceiptImageDataUrl } from "@/lib/server/analyze-receipt";
import { assertAnalyzeAllowed, isAnalyzeLimitError } from "@/lib/server/analyze-limits";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    await assertAnalyzeAllowed(currentUser.id);
    const body = (await request.json()) as { image?: string };
    const data = await analyzeReceiptImageDataUrl(body.image ?? "", { userId: currentUser.id });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Analyze error:", error);

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (isAnalyzeLimitError(error)) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { analyzeReceiptImageDataUrl } from "@/lib/server/analyze-receipt";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = (await request.json()) as { image?: string };
    const data = await analyzeReceiptImageDataUrl(body.image ?? "", { userId: currentUser.id });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Analyze error:", error);

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

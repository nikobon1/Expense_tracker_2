import { NextRequest, NextResponse } from "next/server";
import { analyzeReceiptImageDataUrl } from "@/lib/server/analyze-receipt";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { image?: string };
    const data = await analyzeReceiptImageDataUrl(body.image ?? "");
    return NextResponse.json(data);
  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

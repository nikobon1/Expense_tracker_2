import { NextRequest, NextResponse } from "next/server";
import { getReceiptById } from "@/lib/server/receipts";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

function parseReceiptId(rawId: string): number {
  const parsed = Number(rawId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid receipt id");
  }
  return parsed;
}

async function telegramApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !json.ok || json.result === undefined) {
    throw new Error(json.description || `Telegram API error (${method})`);
  }

  return json.result;
}

async function fetchTelegramFileAsDataUrl(fileId: string, fallbackMime = "image/jpeg"): Promise<string> {
  const file = await telegramApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram file path is missing");

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${getTelegramBotToken()}/${file.file_path}`);
  if (!fileResponse.ok) throw new Error("Failed to download image from Telegram");

  const headerContentType = fileResponse.headers.get("content-type") || "";
  const contentType = headerContentType.startsWith("image/") ? headerContentType : fallbackMime;
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const receiptId = parseReceiptId(id);

    const receipt = await getReceiptById(receiptId);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    if (!receipt.telegram_file_id) {
      return NextResponse.json({ error: "No Telegram image for this receipt" }, { status: 404 });
    }

    const image = await fetchTelegramFileAsDataUrl(receipt.telegram_file_id);
    return NextResponse.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load receipt image";
    const status =
      /invalid receipt id/i.test(message) ? 400 : /not found|no telegram image/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

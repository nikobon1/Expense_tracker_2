import OpenAI from "openai";
import type { ReceiptData } from "@/features/expenses/types";
import { CATEGORIES } from "@/features/expenses/constants";
import { normalizeCategory } from "@/lib/category-normalization";
import { saveReceiptAnalyzeLog } from "@/lib/server/receipts";

const CATEGORY_PROMPT_LIST = CATEGORIES.map((category) => `- ${category}`).join("\n");

const SYSTEM_PROMPT = `Ты — помощник для анализа продуктовых чеков из магазинов Португалии.
Проанализируй фото чека. Извлеки:
1. Дату покупки (формат: YYYY-MM-DD)
2. Название магазина
3. Список товаров с ценами

Для каждого товара определи категорию на русском языке. Возможные категории:
${CATEGORY_PROMPT_LIST}

Верни ТОЛЬКО чистый JSON без markdown форматирования в следующем формате:
{
  "store_name": "Название магазина",
  "purchase_date": "YYYY-MM-DD",
  "items": [
    {"name": "Название товара на русском", "price": 1.99, "category": "Категория"}
  ]
}`;

const TOTAL_AMOUNT_HINTS = `
Additional receipt rules:
- "Total a pagar" is the final amount paid and must be treated as the true purchase total.
- If the receipt contains "Total", "TOTAL A PAGAR", or "Total a pagar", treat that line as the final amount actually paid/spent.
- Prefer the final paid total over subtotal/intermediate totals.
- Use the final paid total to validate extracted items.
- If extracted item prices do not match "Total a pagar", reconcile them using item-level discounts and by excluding savings/discount summary lines.
- Use the category "Кофе" for coffee beans, ground coffee, capsules, instant coffee, and similar coffee products.
- For Pingo Doce receipts, a number in parentheses directly under an item is that item's discount amount, not a separate product line.
- For Pingo Doce receipts, "Total Poupanca" means total savings/discount and must not be added as a product or expense.
- If an item has its own discount shown below it, use the net price actually paid for that item after subtracting the discount.
`;

const EFFECTIVE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\n${TOTAL_AMOUNT_HINTS}`;

type UsagePayload = {
  provider: "openai:gpt-4o" | "google:gemini-2.0-flash";
  model: "gpt-4o" | "gemini-2.0-flash";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function parsePositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function estimateUsdCost(payload: UsagePayload): number | null {
  // Defaults are estimates in USD per 1M tokens and can be overridden via env.
  const defaultInputRatePerMillion = payload.provider === "openai:gpt-4o" ? 2.5 : 0.1;
  const defaultOutputRatePerMillion = payload.provider === "openai:gpt-4o" ? 10 : 0.4;

  const inputRatePerMillion =
    payload.provider === "openai:gpt-4o"
      ? parsePositiveNumber(process.env.RECEIPT_COST_OPENAI_INPUT_PER_1M_USD) ?? defaultInputRatePerMillion
      : parsePositiveNumber(process.env.RECEIPT_COST_GEMINI_INPUT_PER_1M_USD) ?? defaultInputRatePerMillion;
  const outputRatePerMillion =
    payload.provider === "openai:gpt-4o"
      ? parsePositiveNumber(process.env.RECEIPT_COST_OPENAI_OUTPUT_PER_1M_USD) ?? defaultOutputRatePerMillion
      : parsePositiveNumber(process.env.RECEIPT_COST_GEMINI_OUTPUT_PER_1M_USD) ?? defaultOutputRatePerMillion;

  const inputCost = (payload.inputTokens / 1_000_000) * inputRatePerMillion;
  const outputCost = (payload.outputTokens / 1_000_000) * outputRatePerMillion;
  return Number((inputCost + outputCost).toFixed(8));
}

async function logAnalyzeUsage(payload: UsagePayload, options?: { storeName?: string | null; userId?: number | null }) {
  const estimatedCostUsd = estimateUsdCost(payload);
  const logPayload = {
    provider: payload.provider,
    model: payload.model,
    input_tokens: payload.inputTokens,
    output_tokens: payload.outputTokens,
    total_tokens: payload.totalTokens,
    estimated_cost_usd: estimatedCostUsd,
    store_name: options?.storeName?.trim() || null,
    cost_rates_configured:
      payload.provider === "openai:gpt-4o"
        ? Boolean(process.env.RECEIPT_COST_OPENAI_INPUT_PER_1M_USD) &&
          Boolean(process.env.RECEIPT_COST_OPENAI_OUTPUT_PER_1M_USD)
        : Boolean(process.env.RECEIPT_COST_GEMINI_INPUT_PER_1M_USD) &&
          Boolean(process.env.RECEIPT_COST_GEMINI_OUTPUT_PER_1M_USD),
    user_id: options?.userId ?? null,
    logged_at: new Date().toISOString(),
  };

  console.info("receipt_analyze_usage", logPayload);

  try {
    await saveReceiptAnalyzeLog({
      provider: payload.provider,
      model: payload.model,
      inputTokens: payload.inputTokens,
      outputTokens: payload.outputTokens,
      totalTokens: payload.totalTokens,
      estimatedCostUsd,
      storeName: options?.storeName?.trim() || null,
      userId: options?.userId ?? null,
    });
  } catch (error) {
    console.warn("Failed to persist receipt analyze usage:", error);
  }
}

function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned;
}

function ensureSupportedImageDataUrl(image: string): { mimeType: string; base64Data: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(image);
  if (!match) {
    throw new Error("Invalid image payload");
  }

  return { mimeType: match[1], base64Data: match[2] };
}

function toIsoDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(dateA: Date, dateB: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((dateA.getTime() - dateB.getTime()) / msPerDay);
}

function buildUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function normalizeAnalyzedPurchaseDate(value: string): string {
  const normalized = String(value ?? "").trim();
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const minYear = currentYear - 5;
  const maxYear = currentYear + 1;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return toIsoDateUtc(now);
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return toIsoDateUtc(now);
  }

  const year = parsed.getUTCFullYear();
  if (year >= minYear && year <= maxYear) {
    const month = parsed.getUTCMonth() + 1;
    const day = parsed.getUTCDate();
    const daysFromNow = daysBetween(parsed, now);

    // If OCR produced an ambiguous mm/dd variant far in the future, prefer swapped dd/mm
    // when it lands near the current date.
    if (month <= 12 && day <= 12 && daysFromNow > 7) {
      const swapped = buildUtcDate(year, day, month);
      const swappedDaysFromNow = daysBetween(swapped, now);
      if (swappedDaysFromNow >= -365 && swappedDaysFromNow <= 7) {
        return toIsoDateUtc(swapped);
      }
    }

    return normalized;
  }

  // Common OCR case: short year interpreted as 20 years in the past (e.g. 2006 instead of 2026).
  const shiftedYear = year + 20;
  if (shiftedYear >= minYear && shiftedYear <= maxYear) {
    return `${shiftedYear}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  }

  return toIsoDateUtc(now);
}

function sanitizeAnalyzedReceipt(receipt: ReceiptData): ReceiptData {
  return {
    ...receipt,
    store_name: String(receipt.store_name ?? "").trim(),
    purchase_date: normalizeAnalyzedPurchaseDate(receipt.purchase_date),
    items: Array.isArray(receipt.items)
      ? receipt.items.map((item) => ({
          name: String(item.name ?? "").trim(),
          price: Number(item.price || 0),
          category: normalizeCategory(item.category),
        }))
      : [],
    comment: typeof receipt.comment === "string" ? receipt.comment.trim() || undefined : undefined,
  };
}

export async function analyzeReceiptImageDataUrl(
  image: string,
  options?: { userId?: number | null }
): Promise<ReceiptData> {
  if (!image) {
    throw new Error("Image is required");
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;

  if (!openaiKey && !googleKey) {
    throw new Error("No API key configured. Please set OPENAI_API_KEY or GOOGLE_API_KEY.");
  }

  const { mimeType, base64Data } = ensureSupportedImageDataUrl(image);

  if (openaiKey) {
    const openai = new OpenAI({ apiKey: openaiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: EFFECTIVE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Проанализируй этот чек и извлеки данные:" },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const promptTokens = Number(response.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(response.usage?.completion_tokens ?? 0);
    const totalTokens =
      Number(response.usage?.total_tokens ?? promptTokens + completionTokens);

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = sanitizeAnalyzedReceipt(JSON.parse(extractJson(content)) as ReceiptData);

    await logAnalyzeUsage({
      provider: "openai:gpt-4o",
      model: "gpt-4o",
      inputTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      outputTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
      totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
    }, { storeName: parsed.store_name, userId: options?.userId ?? null });

    return parsed;
  }

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${EFFECTIVE_SYSTEM_PROMPT}\n\nПроанализируй этот чек и извлеки данные:` },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!geminiResponse.ok) {
    let message = "Gemini API error";
    try {
      const error = (await geminiResponse.json()) as { error?: { message?: string } };
      message = error.error?.message || message;
    } catch {
      const text = await geminiResponse.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  const geminiData = (await geminiResponse.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const promptTokens = Number(geminiData.usageMetadata?.promptTokenCount ?? 0);
  const completionTokens = Number(geminiData.usageMetadata?.candidatesTokenCount ?? 0);
  const totalTokens = Number(geminiData.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens);

  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = sanitizeAnalyzedReceipt(JSON.parse(extractJson(text)) as ReceiptData);

  await logAnalyzeUsage({
    provider: "google:gemini-2.0-flash",
    model: "gemini-2.0-flash",
    inputTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
    outputTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
  }, { storeName: parsed.store_name, userId: options?.userId ?? null });

  return parsed;
}





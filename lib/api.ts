import type { Expense, ReceiptData, ReceiptDetails, ReceiptItem } from "@/features/expenses/types";

interface ExpensesResponse {
  expenses: Expense[];
  prevMonthTotal: number;
  prevPeriodCategoryTotals: Array<{ category: string; total: number }>;
  analyzeCost: {
    totalUsd: number;
    count: number;
    items: Array<{
      id: number;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      storeName: string;
      createdAt: string;
    }>;
  };
  stores: string[];
}

interface CategoriesResponse {
  categories: string[];
  customCategories: string[];
}

function normalizeIsoDate(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";

  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) {
    return normalized.slice(0, 10);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return "";

  return parsed.toISOString().slice(0, 10);
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const raw = await response.text();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getErrorMessage(response: Response, payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }

  if (typeof payload === "string") {
    const text = payload.trim();
    if (response.status === 413 || /request entity too large/i.test(text)) {
      return "Фото слишком большое. Попробуйте изображение меньшего размера или более сильное сжатие.";
    }
    if (text) {
      return text.slice(0, 200);
    }
  }

  if (response.status === 413) {
    return "Фото слишком большое. Попробуйте изображение меньшего размера или более сильное сжатие.";
  }

  return fallback;
}

export async function analyzeReceipt(image: string): Promise<ReceiptData> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });

  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Ошибка анализа"));
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Сервер вернул некорректный ответ при анализе чека");
  }

  return payload as ReceiptData;
}

export async function saveReceipt(payload: {
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
}): Promise<void> {
  const response = await fetch("/api/receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const parsed = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, parsed, "Ошибка сохранения"));
  }
}

export async function getReceipt(receiptId: number): Promise<ReceiptDetails> {
  const response = await fetch(`/api/receipts/${receiptId}`);
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось загрузить чек"));
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Сервер вернул некорректный ответ по чеку");
  }

  const receipt = payload as ReceiptDetails;
  return {
    ...receipt,
    purchase_date: normalizeIsoDate(receipt.purchase_date),
  };
}

export async function updateReceipt(
  receiptId: number,
  payload: { store_name: string; purchase_date: string; items: ReceiptItem[] }
): Promise<void> {
  const response = await fetch(`/api/receipts/${receiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const parsed = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, parsed, "Не удалось обновить чек"));
  }
}

export async function getReceiptImageFromTelegram(receiptId: number): Promise<string> {
  const response = await fetch(`/api/receipts/${receiptId}/image`);
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось загрузить фото чека"));
  }

  if (!payload || typeof payload !== "object" || !("image" in payload)) {
    throw new Error("Сервер вернул некорректный ответ по фото чека");
  }

  const image = (payload as { image?: unknown }).image;
  if (typeof image !== "string" || !image) {
    throw new Error("Фото чека не найдено");
  }

  return image;
}

export async function getExpenses(startDate: string, endDate: string, store: string = "all"): Promise<ExpensesResponse> {
  const params = new URLSearchParams({
    start: startDate,
    end: endDate,
  });

  if (store && store !== "all") {
    params.set("store", store);
  }

  const response = await fetch(`/api/expenses?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Failed to load expenses");
  }
  return response.json();
}

export async function getCategories(): Promise<CategoriesResponse> {
  const response = await fetch("/api/categories");
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось загрузить категории"));
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Сервер вернул некорректный ответ по категориям");
  }

  return payload as CategoriesResponse;
}

export async function createCategory(name: string): Promise<CategoriesResponse & { category: string; existed?: boolean }> {
  const response = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось сохранить категорию"));
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Сервер вернул некорректный ответ по сохранению категории");
  }

  return payload as CategoriesResponse & { category: string; existed?: boolean };
}

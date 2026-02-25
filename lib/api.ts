import type { Expense, ReceiptData, ReceiptItem } from "@/features/expenses/types";

interface ExpensesResponse {
  expenses: Expense[];
  prevMonthTotal: number;
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

export async function getExpenses(startDate: string, endDate: string): Promise<ExpensesResponse> {
  const response = await fetch(`/api/expenses?start=${startDate}&end=${endDate}`);
  if (!response.ok) {
    throw new Error("Failed to load expenses");
  }
  return response.json();
}


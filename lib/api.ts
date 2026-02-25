import type { Expense, ReceiptData, ReceiptItem } from "@/features/expenses/types";

interface ExpensesResponse {
  expenses: Expense[];
  prevMonthTotal: number;
}

export async function analyzeReceipt(image: string): Promise<ReceiptData> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Ошибка анализа");
  }

  return response.json();
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

  if (!response.ok) {
    throw new Error("Ошибка сохранения");
  }
}

export async function getExpenses(startDate: string, endDate: string): Promise<ExpensesResponse> {
  const response = await fetch(`/api/expenses?start=${startDate}&end=${endDate}`);
  if (!response.ok) {
    throw new Error("Failed to load expenses");
  }
  return response.json();
}


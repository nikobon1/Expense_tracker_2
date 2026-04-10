import type { CreateRecurringExpensePayload, RecurringExpensePlan } from "@/features/expenses/types";

interface RecurringExpensesResponse {
  plans: RecurringExpensePlan[];
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

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim().slice(0, 200);
  }

  return fallback;
}

export async function getRecurringExpenses(): Promise<RecurringExpensePlan[]> {
  const response = await fetch("/api/recurring-expenses");
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось загрузить автосписания."));
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as RecurringExpensesResponse).plans)) {
    throw new Error("Сервер вернул некорректный ответ по автосписаниям.");
  }

  return (payload as RecurringExpensesResponse).plans;
}

export async function createRecurringExpense(payload: CreateRecurringExpensePayload): Promise<RecurringExpensePlan[]> {
  const response = await fetch("/api/recurring-expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const parsed = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, parsed, "Не удалось сохранить автосписание."));
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as RecurringExpensesResponse).plans)) {
    throw new Error("Сервер вернул некорректный ответ после сохранения автосписания.");
  }

  return (parsed as RecurringExpensesResponse).plans;
}

export async function deleteRecurringExpense(id: number): Promise<RecurringExpensePlan[]> {
  const response = await fetch("/api/recurring-expenses", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const parsed = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, parsed, "Не удалось остановить автосписание."));
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as RecurringExpensesResponse).plans)) {
    throw new Error("Сервер вернул некорректный ответ после остановки автосписания.");
  }

  return (parsed as RecurringExpensesResponse).plans;
}

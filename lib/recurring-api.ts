import type { CreateRecurringExpensePayload, RecurringExpensePlan } from "@/features/expenses/types";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";

export interface RecurringExpensesResponse {
  activeCurrency: string;
  currencies: string[];
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

function uniqueCurrencies(values: string[], fallback: string): string[] {
  const normalizedFallback = normalizeCurrencyCode(fallback);
  const normalizedValues = values
    .map((value) => normalizeCurrencyCode(value))
    .filter((value, index, list) => list.indexOf(value) === index);

  return normalizedValues.length > 0 ? normalizedValues : [normalizedFallback];
}

function normalizePlan(plan: RecurringExpensePlan): RecurringExpensePlan {
  return {
    ...plan,
    currency: normalizeCurrencyCode(plan.currency ?? DEFAULT_CURRENCY),
  };
}

function normalizeRecurringExpensesResponse(
  payload: RecurringExpensesResponse,
  fallbackCurrency: string
): RecurringExpensesResponse {
  return {
    ...payload,
    activeCurrency: normalizeCurrencyCode(payload.activeCurrency ?? fallbackCurrency),
    currencies: uniqueCurrencies(payload.currencies ?? [], fallbackCurrency),
    plans: payload.plans.map(normalizePlan),
  };
}

export async function getRecurringExpenses(currency?: string): Promise<RecurringExpensesResponse> {
  const params = new URLSearchParams();
  if (currency) {
    params.set("currency", currency);
  }

  const response = await fetch(`/api/recurring-expenses${params.size > 0 ? `?${params.toString()}` : ""}`);
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Не удалось загрузить автосписания."));
  }

  if (!payload || typeof payload !== "object" || !Array.isArray((payload as RecurringExpensesResponse).plans)) {
    throw new Error("Сервер вернул некорректный ответ по автосписаниям.");
  }

  return normalizeRecurringExpensesResponse(
    payload as RecurringExpensesResponse,
    currency ?? DEFAULT_CURRENCY
  );
}

export async function createRecurringExpense(payload: CreateRecurringExpensePayload): Promise<RecurringExpensesResponse> {
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

  return normalizeRecurringExpensesResponse(
    parsed as RecurringExpensesResponse,
    payload.currency ?? DEFAULT_CURRENCY
  );
}

export async function deleteRecurringExpense(id: number, currency?: string): Promise<RecurringExpensesResponse> {
  const params = new URLSearchParams();
  if (currency) {
    params.set("currency", currency);
  }

  const response = await fetch(`/api/recurring-expenses${params.size > 0 ? `?${params.toString()}` : ""}`, {
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

  return normalizeRecurringExpensesResponse(
    parsed as RecurringExpensesResponse,
    currency ?? DEFAULT_CURRENCY
  );
}

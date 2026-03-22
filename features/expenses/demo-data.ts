import type { Expense } from "@/features/expenses/types";

type AnalyzeCostItem = {
  id: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  storeName: string;
  createdAt: string;
};

export type DashboardDemoData = {
  expenses: Expense[];
  prevMonthTotal: number;
  prevPeriodCategoryTotals: Array<{ category: string; total: number }>;
  analyzeCost: {
    totalUsd: number;
    count: number;
    items: AnalyzeCostItem[];
  };
  stores: string[];
};

function clampDate(date: Date, min: Date, max: Date): Date {
  if (date < min) return new Date(min);
  if (date > max) return new Date(max);
  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayOffset(base: Date, offset: number, min: Date, max: Date): string {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + offset);
  return toIsoDate(clampDate(next, min, max));
}

export function buildLocalDashboardDemoData(params: {
  startDate: string;
  endDate: string;
  selectedStore: string;
}): DashboardDemoData {
  const min = new Date(`${params.startDate}T00:00:00.000Z`);
  const max = new Date(`${params.endDate}T00:00:00.000Z`);
  const base = new Date(max);

  const expenses: Expense[] = [
    { id: 1001, receiptId: 501, date: dayOffset(base, -18, min, max), store: "ВкусВилл", item: "Продуктовая корзина", price: 42.8, category: "Продукты" },
    { id: 1002, receiptId: 501, date: dayOffset(base, -18, min, max), store: "ВкусВилл", item: "Минеральная вода", price: 6.4, category: "Продукты" },
    { id: 1003, receiptId: 502, date: dayOffset(base, -15, min, max), store: "Кофемания", item: "Обед команды", price: 29.5, category: "Кафе и рестораны" },
    { id: 1004, receiptId: 503, date: dayOffset(base, -12, min, max), store: "Яндекс Go", item: "Трансфер в аэропорт", price: 34.2, category: "Транспорт" },
    { id: 1005, receiptId: 504, date: dayOffset(base, -10, min, max), store: "Ozon", item: "USB-C док-станция", price: 89.99, category: "Офис" },
    { id: 1006, receiptId: 504, date: dayOffset(base, -10, min, max), store: "Ozon", item: "Набор блокнотов", price: 18.75, category: "Офис" },
    { id: 1007, receiptId: 505, date: dayOffset(base, -8, min, max), store: "Surf Coffee", item: "Кофе на команду", price: 14.2, category: "Кофе" },
    { id: 1008, receiptId: 506, date: dayOffset(base, -6, min, max), store: "Перекрёсток", item: "Пополнение кухни", price: 57.3, category: "Продукты" },
    { id: 1009, receiptId: 507, date: dayOffset(base, -5, min, max), store: "Яндекс Go", item: "Поздняя поездка домой", price: 21.6, category: "Транспорт" },
    { id: 1010, receiptId: 508, date: dayOffset(base, -4, min, max), store: "Кофемания", item: "Кофе с клиентом", price: 11.8, category: "Кофе" },
    { id: 1011, receiptId: 509, date: dayOffset(base, -3, min, max), store: "М.Видео", item: "Портативный монитор", price: 179.0, category: "Техника" },
    { id: 1012, receiptId: 510, date: dayOffset(base, -2, min, max), store: "Азбука вкуса", item: "Ужин и продукты", price: 36.4, category: "Продукты" },
    { id: 1013, receiptId: 511, date: dayOffset(base, -1, min, max), store: "Notion", item: "Подписка команды", price: 24.0, category: "Софт" },
    { id: 1014, receiptId: 512, date: dayOffset(base, 0, min, max), store: "Яндекс Go", item: "Поездка до вокзала", price: 18.4, category: "Транспорт" },
  ];

  const filteredExpenses =
    params.selectedStore === "all"
      ? expenses
      : expenses.filter((expense) => expense.store === params.selectedStore);

  const allStores = Array.from(new Set(expenses.map((expense) => expense.store))).sort((a, b) =>
    a.localeCompare(b)
  );

  const filteredStores = Array.from(new Set(filteredExpenses.map((expense) => expense.store))).sort((a, b) =>
    a.localeCompare(b)
  );

  const prevPeriodCategoryTotals = [
    { category: "Продукты", total: 102.4 },
    { category: "Транспорт", total: 58.2 },
    { category: "Офис", total: 76.5 },
    { category: "Кофе", total: 16.9 },
    { category: "Техника", total: 121.0 },
    { category: "Софт", total: 24.0 },
  ];

  const analyzeItems: AnalyzeCostItem[] = [
    {
      id: 9001,
      provider: "openai",
      model: "gpt-5.4-mini",
      inputTokens: 1880,
      outputTokens: 442,
      totalTokens: 2322,
      estimatedCostUsd: 0.0124,
      storeName: "ВкусВилл",
      createdAt: `${dayOffset(base, -18, min, max)}T09:15:00.000Z`,
    },
    {
      id: 9002,
      provider: "openai",
      model: "gpt-5.4-mini",
      inputTokens: 2144,
      outputTokens: 516,
      totalTokens: 2660,
      estimatedCostUsd: 0.0141,
      storeName: "Ozon",
      createdAt: `${dayOffset(base, -10, min, max)}T11:42:00.000Z`,
    },
    {
      id: 9003,
      provider: "openai",
      model: "gpt-5.4-mini",
      inputTokens: 1762,
      outputTokens: 403,
      totalTokens: 2165,
      estimatedCostUsd: 0.0113,
      storeName: "М.Видео",
      createdAt: `${dayOffset(base, -3, min, max)}T16:08:00.000Z`,
    },
  ];

  const filteredAnalyzeItems =
    params.selectedStore === "all"
      ? analyzeItems
      : analyzeItems.filter((item) => item.storeName === params.selectedStore);

  return {
    expenses: filteredExpenses,
    prevMonthTotal: params.selectedStore === "all" ? 498.7 : 124.6,
    prevPeriodCategoryTotals,
    analyzeCost: {
      totalUsd: Number(
        filteredAnalyzeItems.reduce((sum, item) => sum + item.estimatedCostUsd, 0).toFixed(4)
      ),
      count: filteredAnalyzeItems.length,
      items: filteredAnalyzeItems,
    },
    stores: params.selectedStore === "all" ? allStores : filteredStores,
  };
}

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

type DemoExpenseTemplate = {
  receiptId: number;
  dayOffset: number;
  store: string;
  item: string;
  price: number;
  category: string;
};

type DemoAnalyzeTemplate = {
  id: number;
  dayOffset: number;
  storeName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

type DemoScenarioDefinition = {
  label: string;
  description: string;
  expenses: DemoExpenseTemplate[];
  analyzeItems: DemoAnalyzeTemplate[];
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

export type DemoScenarioKey = "smart-shopper" | "family" | "solo";

export const DEMO_SCENARIOS: Array<{ key: DemoScenarioKey; label: string; description: string }> = [
  {
    key: "smart-shopper",
    label: "Smart Shopper",
    description: "Comparison-heavy grocery scenario with Pingo Doce, Continente, Lidl, and Mercadona.",
  },
  {
    key: "family",
    label: "Family Budget",
    description: "Bigger basket sizes, kids-related categories, and weekly household planning.",
  },
  {
    key: "solo",
    label: "Solo Lifestyle",
    description: "Compact budget with coffee, transport, subscriptions, and quick convenience shopping.",
  },
];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDateByMonths(dateString: string, monthOffset: number): string {
  const [yearPart, monthPart, dayPart] = dateString.split("-").map(Number);
  const year = Number.isFinite(yearPart) ? yearPart : 0;
  const month = Number.isFinite(monthPart) ? monthPart : 0;
  const day = Number.isFinite(dayPart) ? dayPart : 0;

  const targetMonthIndex = month - 1 + monthOffset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const normalizedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(targetYear, normalizedMonthIndex, normalizedDay)).toISOString().split("T")[0];
}

function createDateFromOffset(anchorDate: string, dayOffset: number): string {
  const base = new Date(`${anchorDate}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return toIsoDate(base);
}

function isInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en")
  );
}

function aggregateCategoryTotals(expenses: Expense[]) {
  const totals = new Map<string, number>();

  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.price);
  }

  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "en"));
}

function buildExpenses(anchorDate: string, templates: DemoExpenseTemplate[]): Expense[] {
  return templates.map((template, index) => ({
    id: index + 1,
    receiptId: template.receiptId,
    date: createDateFromOffset(anchorDate, template.dayOffset),
    store: template.store,
    item: template.item,
    price: template.price,
    category: template.category,
  }));
}

function buildAnalyzeItems(anchorDate: string, templates: DemoAnalyzeTemplate[]): AnalyzeCostItem[] {
  return templates.map((template) => ({
    id: template.id,
    provider: "openai",
    model: "gpt-5.4-mini",
    inputTokens: template.inputTokens,
    outputTokens: template.outputTokens,
    totalTokens: template.inputTokens + template.outputTokens,
    estimatedCostUsd: template.estimatedCostUsd,
    storeName: template.storeName,
    createdAt: `${createDateFromOffset(anchorDate, template.dayOffset)}T12:00:00.000Z`,
  }));
}

const DEMO_SCENARIO_MAP: Record<DemoScenarioKey, DemoScenarioDefinition> = {
  "smart-shopper": {
    label: "Smart Shopper",
    description: "Best for showing grocery analytics and store-vs-store comparisons.",
    expenses: [
      { receiptId: 1101, dayOffset: -50, store: "Pingo Doce", item: "Weekly groceries", price: 52.3, category: "Groceries" },
      { receiptId: 1101, dayOffset: -50, store: "Pingo Doce", item: "Fruit refill", price: 8.4, category: "Produce" },
      { receiptId: 1102, dayOffset: -47, store: "Continente", item: "Household refill", price: 28.7, category: "Household" },
      { receiptId: 1103, dayOffset: -43, store: "Lidl", item: "Protein yogurt pack", price: 11.9, category: "Dairy" },
      { receiptId: 1104, dayOffset: -40, store: "Mercadona", item: "Bakery top-up", price: 9.6, category: "Bakery" },
      { receiptId: 1105, dayOffset: -36, store: "Pingo Doce", item: "Fresh vegetables", price: 17.2, category: "Produce" },
      { receiptId: 1105, dayOffset: -36, store: "Pingo Doce", item: "Chicken and pasta", price: 23.1, category: "Groceries" },
      { receiptId: 1106, dayOffset: -32, store: "Continente", item: "Detergent and paper", price: 31.8, category: "Household" },
      { receiptId: 1107, dayOffset: -28, store: "Pingo Doce", item: "Weekly groceries", price: 56.9, category: "Groceries" },
      { receiptId: 1107, dayOffset: -28, store: "Pingo Doce", item: "Eggs and milk", price: 10.4, category: "Dairy" },
      { receiptId: 1108, dayOffset: -24, store: "Continente", item: "Weekly groceries", price: 64.1, category: "Groceries" },
      { receiptId: 1108, dayOffset: -24, store: "Continente", item: "Cleaning sprays", price: 14.3, category: "Household" },
      { receiptId: 1109, dayOffset: -21, store: "Lidl", item: "Bread and pastries", price: 12.6, category: "Bakery" },
      { receiptId: 1110, dayOffset: -18, store: "Mercadona", item: "Vegetable mix", price: 13.7, category: "Produce" },
      { receiptId: 1111, dayOffset: -15, store: "Pingo Doce", item: "Family groceries", price: 72.8, category: "Groceries" },
      { receiptId: 1111, dayOffset: -15, store: "Pingo Doce", item: "Fresh fish", price: 18.9, category: "Protein" },
      { receiptId: 1112, dayOffset: -12, store: "Continente", item: "Family groceries", price: 69.4, category: "Groceries" },
      { receiptId: 1112, dayOffset: -12, store: "Continente", item: "Home essentials", price: 19.7, category: "Household" },
      { receiptId: 1113, dayOffset: -9, store: "Pingo Doce", item: "Yogurt and milk", price: 12.3, category: "Dairy" },
      { receiptId: 1114, dayOffset: -7, store: "Continente", item: "Fruit and veg", price: 21.5, category: "Produce" },
      { receiptId: 1115, dayOffset: -5, store: "Pingo Doce", item: "Dinner ingredients", price: 34.8, category: "Groceries" },
      { receiptId: 1116, dayOffset: -3, store: "Continente", item: "Bulk snacks", price: 16.9, category: "Snacks" },
      { receiptId: 1117, dayOffset: -2, store: "Lidl", item: "Quick bakery stop", price: 8.7, category: "Bakery" },
      { receiptId: 1118, dayOffset: 0, store: "Mercadona", item: "Weekend refill", price: 41.2, category: "Groceries" },
    ],
    analyzeItems: [
      { id: 9101, dayOffset: -24, storeName: "Continente", inputTokens: 2140, outputTokens: 522, estimatedCostUsd: 0.0142 },
      { id: 9102, dayOffset: -15, storeName: "Pingo Doce", inputTokens: 2058, outputTokens: 488, estimatedCostUsd: 0.0135 },
      { id: 9103, dayOffset: -5, storeName: "Pingo Doce", inputTokens: 1864, outputTokens: 433, estimatedCostUsd: 0.0121 },
    ],
  },
  family: {
    label: "Family Budget",
    description: "Bigger baskets, household items, and recurring family purchases.",
    expenses: [
      { receiptId: 2101, dayOffset: -52, store: "Continente", item: "Big weekly basket", price: 88.4, category: "Groceries" },
      { receiptId: 2101, dayOffset: -52, store: "Continente", item: "Baby wipes", price: 10.8, category: "Baby" },
      { receiptId: 2102, dayOffset: -48, store: "Wells", item: "Pharmacy refill", price: 26.5, category: "Health" },
      { receiptId: 2103, dayOffset: -44, store: "Pingo Doce", item: "Fruit and snacks", price: 29.7, category: "Produce" },
      { receiptId: 2104, dayOffset: -39, store: "IKEA", item: "Storage boxes", price: 47.0, category: "Home" },
      { receiptId: 2105, dayOffset: -35, store: "Continente", item: "School lunch supplies", price: 34.6, category: "Groceries" },
      { receiptId: 2106, dayOffset: -30, store: "Decathlon", item: "Kids swim gear", price: 39.9, category: "Kids" },
      { receiptId: 2107, dayOffset: -27, store: "Pingo Doce", item: "Weekly basket", price: 74.2, category: "Groceries" },
      { receiptId: 2107, dayOffset: -27, store: "Pingo Doce", item: "Milk and yogurt", price: 15.7, category: "Dairy" },
      { receiptId: 2108, dayOffset: -21, store: "Continente", item: "Cleaning refill", price: 24.4, category: "Household" },
      { receiptId: 2109, dayOffset: -19, store: "Wells", item: "Kids vitamins", price: 17.2, category: "Health" },
      { receiptId: 2110, dayOffset: -16, store: "Pingo Doce", item: "Family dinner", price: 31.8, category: "Groceries" },
      { receiptId: 2111, dayOffset: -13, store: "Continente", item: "Weekly basket", price: 82.5, category: "Groceries" },
      { receiptId: 2111, dayOffset: -13, store: "Continente", item: "Diapers", price: 22.9, category: "Baby" },
      { receiptId: 2112, dayOffset: -9, store: "IKEA", item: "Kids room organizer", price: 35.4, category: "Home" },
      { receiptId: 2113, dayOffset: -6, store: "Pingo Doce", item: "Fruit and bakery", price: 19.6, category: "Produce" },
      { receiptId: 2114, dayOffset: -4, store: "Continente", item: "Weekend basket", price: 57.1, category: "Groceries" },
      { receiptId: 2115, dayOffset: -1, store: "Wells", item: "First aid refill", price: 15.4, category: "Health" },
    ],
    analyzeItems: [
      { id: 9201, dayOffset: -27, storeName: "Pingo Doce", inputTokens: 2284, outputTokens: 558, estimatedCostUsd: 0.0153 },
      { id: 9202, dayOffset: -13, storeName: "Continente", inputTokens: 2412, outputTokens: 601, estimatedCostUsd: 0.0164 },
      { id: 9203, dayOffset: -1, storeName: "Wells", inputTokens: 1698, outputTokens: 390, estimatedCostUsd: 0.0108 },
    ],
  },
  solo: {
    label: "Solo Lifestyle",
    description: "Compact spending pattern with coffee, transport, quick meals, and subscriptions.",
    expenses: [
      { receiptId: 3101, dayOffset: -51, store: "Minipreco", item: "Quick groceries", price: 22.4, category: "Groceries" },
      { receiptId: 3102, dayOffset: -46, store: "Uber", item: "Airport ride", price: 18.1, category: "Transport" },
      { receiptId: 3103, dayOffset: -42, store: "Starbucks", item: "Coffee and snack", price: 8.9, category: "Coffee" },
      { receiptId: 3104, dayOffset: -37, store: "Bolt", item: "Evening ride", price: 11.4, category: "Transport" },
      { receiptId: 3105, dayOffset: -34, store: "Continente Bom Dia", item: "Dinner ingredients", price: 16.7, category: "Groceries" },
      { receiptId: 3106, dayOffset: -29, store: "Netflix", item: "Monthly subscription", price: 12.0, category: "Subscriptions" },
      { receiptId: 3107, dayOffset: -25, store: "Starbucks", item: "Coffee meeting", price: 7.6, category: "Coffee" },
      { receiptId: 3108, dayOffset: -21, store: "Uber", item: "Coworking ride", price: 9.8, category: "Transport" },
      { receiptId: 3109, dayOffset: -18, store: "Minipreco", item: "Pantry top-up", price: 25.1, category: "Groceries" },
      { receiptId: 3110, dayOffset: -15, store: "Glovo", item: "Late dinner", price: 14.5, category: "Dining" },
      { receiptId: 3111, dayOffset: -11, store: "Spotify", item: "Music subscription", price: 7.0, category: "Subscriptions" },
      { receiptId: 3112, dayOffset: -8, store: "Continente Bom Dia", item: "Fresh lunch items", price: 13.4, category: "Produce" },
      { receiptId: 3113, dayOffset: -5, store: "Uber", item: "Client meeting ride", price: 10.2, category: "Transport" },
      { receiptId: 3114, dayOffset: -3, store: "Starbucks", item: "Coffee", price: 4.8, category: "Coffee" },
      { receiptId: 3115, dayOffset: -1, store: "Glovo", item: "Dinner delivery", price: 17.3, category: "Dining" },
    ],
    analyzeItems: [
      { id: 9301, dayOffset: -18, storeName: "Minipreco", inputTokens: 1540, outputTokens: 364, estimatedCostUsd: 0.0091 },
      { id: 9302, dayOffset: -8, storeName: "Continente Bom Dia", inputTokens: 1682, outputTokens: 391, estimatedCostUsd: 0.0102 },
    ],
  },
};

export function buildDashboardDemoData(params: {
  startDate: string;
  endDate: string;
  selectedStore: string;
  scenario: DemoScenarioKey;
}): DashboardDemoData {
  const scenario = DEMO_SCENARIO_MAP[params.scenario];
  const fullExpenses = buildExpenses(params.endDate, scenario.expenses);
  const fullAnalyzeItems = buildAnalyzeItems(params.endDate, scenario.analyzeItems);

  const previousStart = shiftDateByMonths(params.startDate, -1);
  const previousEnd = shiftDateByMonths(params.endDate, -1);

  const expensesInCurrentRange = fullExpenses.filter((expense) =>
    isInRange(expense.date, params.startDate, params.endDate)
  );
  const expensesInPreviousRange = fullExpenses.filter((expense) =>
    isInRange(expense.date, previousStart, previousEnd)
  );

  const filteredCurrentExpenses =
    params.selectedStore === "all"
      ? expensesInCurrentRange
      : expensesInCurrentRange.filter((expense) => expense.store === params.selectedStore);
  const filteredPreviousExpenses =
    params.selectedStore === "all"
      ? expensesInPreviousRange
      : expensesInPreviousRange.filter((expense) => expense.store === params.selectedStore);

  const filteredAnalyzeItems = fullAnalyzeItems.filter((item) => {
    if (!isInRange(item.createdAt.slice(0, 10), params.startDate, params.endDate)) {
      return false;
    }

    if (params.selectedStore !== "all" && item.storeName !== params.selectedStore) {
      return false;
    }

    return true;
  });

  return {
    expenses: filteredCurrentExpenses,
    prevMonthTotal: Number(
      filteredPreviousExpenses.reduce((sum, expense) => sum + expense.price, 0).toFixed(2)
    ),
    prevPeriodCategoryTotals: aggregateCategoryTotals(filteredPreviousExpenses),
    analyzeCost: {
      totalUsd: Number(
        filteredAnalyzeItems.reduce((sum, item) => sum + item.estimatedCostUsd, 0).toFixed(4)
      ),
      count: filteredAnalyzeItems.length,
      items: filteredAnalyzeItems,
    },
    stores: uniqueSorted(expensesInCurrentRange.map((expense) => expense.store)),
  };
}

export function buildLocalDashboardDemoData(params: {
  startDate: string;
  endDate: string;
  selectedStore: string;
}): DashboardDemoData {
  return buildDashboardDemoData({
    ...params,
    scenario: "smart-shopper",
  });
}

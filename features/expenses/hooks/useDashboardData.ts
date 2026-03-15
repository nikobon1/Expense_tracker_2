"use client";

import { useCallback, useState } from "react";
import type { Expense } from "@/features/expenses/types";
import { getExpenses } from "@/lib/api";

function getLocalIsoDate(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function getInitialDateRange() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: getLocalIsoDate(firstDay),
    end: getLocalIsoDate(today),
  };
}

export function useDashboardData() {
  const [startDate, setStartDate] = useState(() => getInitialDateRange().start);
  const [endDate, setEndDate] = useState(() => getInitialDateRange().end);
  const [selectedStore, setSelectedStore] = useState("all");
  const [stores, setStores] = useState<string[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prevMonthTotal, setPrevMonthTotal] = useState(0);
  const [prevPeriodCategoryTotals, setPrevPeriodCategoryTotals] = useState<Array<{ category: string; total: number }>>([]);
  const [analyzeCost, setAnalyzeCost] = useState<{
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
  }>({ totalUsd: 0, count: 0, items: [] });
  const [isLoading, setIsLoading] = useState(false);

  const loadExpenses = useCallback(async () => {
    if (!startDate || !endDate) return;

    setIsLoading(true);
    try {
      const data = await getExpenses(startDate, endDate, selectedStore);
      setExpenses(data.expenses);
      setPrevMonthTotal(data.prevMonthTotal);
      setPrevPeriodCategoryTotals(data.prevPeriodCategoryTotals);
      setAnalyzeCost(data.analyzeCost);
      setStores(data.stores);
    } catch (error) {
      console.error("Error loading expenses:", error);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, selectedStore]);

  return {
    startDate,
    endDate,
    selectedStore,
    stores,
    expenses,
    prevMonthTotal,
    prevPeriodCategoryTotals,
    analyzeCost,
    isLoading,
    setStartDate,
    setEndDate,
    setSelectedStore,
    loadExpenses,
  };
}

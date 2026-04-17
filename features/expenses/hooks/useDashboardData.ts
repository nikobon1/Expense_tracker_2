"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLocalDashboardDemoData } from "@/features/expenses/demo-data";
import type { Expense } from "@/features/expenses/types";
import { getExpenses } from "@/lib/api";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";

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

export function useDashboardData(defaultCurrency: string = DEFAULT_CURRENCY) {
  const isLocalDashboardDemoEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_LOCAL_DASHBOARD_DEMO?.trim().toLowerCase() === "true";
  const [startDate, setStartDate] = useState(() => getInitialDateRange().start);
  const [endDate, setEndDate] = useState(() => getInitialDateRange().end);
  const [selectedStore, setSelectedStore] = useState("all");
  const [selectedCurrency, setSelectedCurrency] = useState(() => normalizeCurrencyCode(defaultCurrency));
  const [currencies, setCurrencies] = useState<string[]>([normalizeCurrencyCode(defaultCurrency)]);
  const [activeCurrency, setActiveCurrency] = useState(() => normalizeCurrencyCode(defaultCurrency));
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
  const latestRequestIdRef = useRef(0);

  useEffect(() => {
    setSelectedCurrency(normalizeCurrencyCode(defaultCurrency));
  }, [defaultCurrency]);

  const syncEndDateToToday = useCallback(() => {
    const today = getLocalIsoDate(new Date());
    setEndDate((current) => (current === today ? current : today));
  }, []);

  const loadExpenses = useCallback(async () => {
    if (!startDate || !endDate) return;

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsLoading(true);
    try {
      const data = await getExpenses(startDate, endDate, selectedStore, selectedCurrency);
      const resolvedData =
        isLocalDashboardDemoEnabled && data.expenses.length === 0
          ? {
              ...buildLocalDashboardDemoData({ startDate, endDate, selectedStore }),
              activeCurrency: normalizeCurrencyCode(selectedCurrency),
              currencies: [normalizeCurrencyCode(selectedCurrency)],
            }
          : data;

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      setExpenses(resolvedData.expenses);
      setActiveCurrency(normalizeCurrencyCode(resolvedData.activeCurrency ?? selectedCurrency));
      setCurrencies(
        Array.isArray(resolvedData.currencies) && resolvedData.currencies.length > 0
          ? resolvedData.currencies.map((value) => normalizeCurrencyCode(value))
          : [normalizeCurrencyCode(selectedCurrency)]
      );
      setPrevMonthTotal(resolvedData.prevMonthTotal);
      setPrevPeriodCategoryTotals(resolvedData.prevPeriodCategoryTotals);
      setAnalyzeCost(resolvedData.analyzeCost);
      setStores(resolvedData.stores);
    } catch (error) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      console.error("Error loading expenses:", error);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [endDate, isLocalDashboardDemoEnabled, selectedCurrency, selectedStore, startDate]);

  useEffect(() => {
    const handleExpensesChanged = () => {
      void loadExpenses();
    };

    window.addEventListener("expense-tracker:expenses-changed", handleExpensesChanged);
    return () => window.removeEventListener("expense-tracker:expenses-changed", handleExpensesChanged);
  }, [loadExpenses]);

  return {
    startDate,
    endDate,
    selectedStore,
    selectedCurrency,
    currencies,
    activeCurrency,
    stores,
    expenses,
    prevMonthTotal,
    prevPeriodCategoryTotals,
    analyzeCost,
    isLoading,
    setStartDate,
    setEndDate,
    setSelectedStore,
    setSelectedCurrency,
    syncEndDateToToday,
    loadExpenses,
  };
}

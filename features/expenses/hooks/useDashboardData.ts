"use client";

import { useCallback, useState } from "react";
import type { Expense } from "@/features/expenses/types";
import { getExpenses } from "@/lib/api";

function getInitialDateRange() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    start: firstDay.toISOString().split("T")[0],
    end: today.toISOString().split("T")[0],
  };
}

export function useDashboardData() {
  const [startDate, setStartDate] = useState(() => getInitialDateRange().start);
  const [endDate, setEndDate] = useState(() => getInitialDateRange().end);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [prevMonthTotal, setPrevMonthTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadExpenses = useCallback(async () => {
    if (!startDate || !endDate) return;

    setIsLoading(true);
    try {
      const data = await getExpenses(startDate, endDate);
      setExpenses(data.expenses);
      setPrevMonthTotal(data.prevMonthTotal);
    } catch (error) {
      console.error("Error loading expenses:", error);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  return {
    startDate,
    endDate,
    expenses,
    prevMonthTotal,
    isLoading,
    setStartDate,
    setEndDate,
    loadExpenses,
  };
}

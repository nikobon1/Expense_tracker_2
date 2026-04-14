"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreateRecurringExpensePayload, RecurringExpensePlan } from "@/features/expenses/types";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  getRecurringExpenses,
} from "@/lib/recurring-api";

export function useRecurringExpenses(defaultCurrency?: string) {
  const [plans, setPlans] = useState<RecurringExpensePlan[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [activeCurrency, setActiveCurrency] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadPlans = useCallback(async (currency?: string) => {
    setIsLoading(true);
    try {
      const nextData = await getRecurringExpenses(currency);
      setPlans(nextData.plans);
      setCurrencies(nextData.currencies);
      setActiveCurrency(nextData.activeCurrency);
    } catch (error) {
      console.error("Failed to load recurring expenses:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans(defaultCurrency);
  }, [defaultCurrency, loadPlans]);

  const createPlan = useCallback(async (payload: CreateRecurringExpensePayload) => {
    setIsSaving(true);
    try {
      const nextData = await createRecurringExpense(payload);
      setPlans(nextData.plans);
      setCurrencies(nextData.currencies);
      setActiveCurrency(nextData.activeCurrency);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const deletePlan = useCallback(async (id: number, currency?: string) => {
    setDeletingId(id);
    try {
      const nextData = await deleteRecurringExpense(id, currency ?? activeCurrency);
      setPlans(nextData.plans);
      setCurrencies(nextData.currencies);
      setActiveCurrency(nextData.activeCurrency);
    } finally {
      setDeletingId(null);
    }
  }, [activeCurrency]);

  return {
    plans,
    currencies,
    activeCurrency,
    isLoading,
    isSaving,
    deletingId,
    loadPlans,
    createPlan,
    deletePlan,
  };
}

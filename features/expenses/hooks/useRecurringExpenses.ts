"use client";

import { useCallback, useEffect, useState } from "react";
import type { CreateRecurringExpensePayload, RecurringExpensePlan } from "@/features/expenses/types";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  getRecurringExpenses,
} from "@/lib/recurring-api";

export function useRecurringExpenses() {
  const [plans, setPlans] = useState<RecurringExpensePlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextPlans = await getRecurringExpenses();
      setPlans(nextPlans);
    } catch (error) {
      console.error("Failed to load recurring expenses:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const createPlan = useCallback(async (payload: CreateRecurringExpensePayload) => {
    setIsSaving(true);
    try {
      const nextPlans = await createRecurringExpense(payload);
      setPlans(nextPlans);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const deletePlan = useCallback(async (id: number) => {
    setDeletingId(id);
    try {
      const nextPlans = await deleteRecurringExpense(id);
      setPlans(nextPlans);
    } finally {
      setDeletingId(null);
    }
  }, []);

  return {
    plans,
    isLoading,
    isSaving,
    deletingId,
    loadPlans,
    createPlan,
    deletePlan,
  };
}

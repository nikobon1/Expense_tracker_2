"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIES } from "@/features/expenses/constants";
import { createCategory, getCategories } from "@/lib/api";

function normalizeCategoryLabel(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export type AddCategoryResult =
  | { status: "added"; category: string; message: string }
  | { status: "exists"; category: string; message: string }
  | { status: "invalid"; message: string };

export function useCategoryOptions() {
  const [categoryOptions, setCategoryOptions] = useState<string[]>(CATEGORIES);

  useEffect(() => {
    let isCancelled = false;

    const loadCategories = async () => {
      try {
        const data = await getCategories();
        if (!isCancelled && Array.isArray(data.categories) && data.categories.length > 0) {
          setCategoryOptions(data.categories);
        }
      } catch (error) {
        console.error("Failed to load categories:", error);
      }
    };

    void loadCategories();

    return () => {
      isCancelled = true;
    };
  }, []);

  const addCategory = useCallback(async (value: string): Promise<AddCategoryResult> => {
    const normalized = normalizeCategoryLabel(value);
    if (!normalized) {
      return { status: "invalid", message: "Введите название категории." };
    }

    if (normalized.length > 40) {
      return { status: "invalid", message: "Название категории должно быть не длиннее 40 символов." };
    }

    try {
      const result = await createCategory(normalized);
      if (Array.isArray(result.categories) && result.categories.length > 0) {
        setCategoryOptions(result.categories);
      }

      const category = result.category || normalized;
      if (result.existed) {
        return {
          status: "exists",
          category,
          message: `Категория «${category}» уже есть в списке.`,
        };
      }

      return {
        status: "added",
        category,
        message: `Категория «${category}» добавлена.`,
      };
    } catch (error) {
      return {
        status: "invalid",
        message: error instanceof Error ? error.message : "Не удалось сохранить категорию.",
      };
    }
  }, []);

  return {
    categoryOptions,
    addCategory,
  };
}

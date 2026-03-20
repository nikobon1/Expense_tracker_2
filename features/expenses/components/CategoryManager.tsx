"use client";

import { useEffect, useState } from "react";
import type { AddCategoryResult, DeleteCategoryResult } from "@/features/expenses/hooks/useCategoryOptions";

interface CategoryManagerProps {
  customCategories: string[];
  onAddCategory: (value: string) => Promise<AddCategoryResult>;
  onDeleteCategory: (value: string) => Promise<DeleteCategoryResult>;
}

type FeedbackState = {
  tone: "success" | "error";
  message: string;
} | null;

export default function CategoryManager({
  customCategories,
  onAddCategory,
  onDeleteCategory,
}: CategoryManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handleSubmit = async () => {
    const result = await onAddCategory(draft);
    setFeedback({
      tone: result.status === "invalid" ? "error" : "success",
      message: result.message,
    });

    if (result.status === "added" || result.status === "exists") {
      setDraft("");
    }
    if (result.status === "added") {
      setIsOpen(false);
    }
  };

  const handleDelete = async (category: string) => {
    if (!window.confirm(`Удалить категорию «${category}»?`)) return;

    setPendingDelete(category);
    const result = await onDeleteCategory(category);
    setPendingDelete(null);

    setFeedback({
      tone: result.status === "invalid" ? "error" : "success",
      message: result.message,
    });
  };

  return (
    <div className="category-manager">
      {!isOpen ? (
        <button type="button" className="btn btn-secondary" onClick={() => setIsOpen(true)}>
          + Новая категория
        </button>
      ) : (
        <div className="category-manager-form">
          <input
            type="text"
            className="scan-field-input category-manager-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Например: Соусы"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSubmit();
              }
              if (e.key === "Escape") {
                setIsOpen(false);
                setDraft("");
              }
            }}
            autoFocus
          />
          <div className="category-manager-actions">
            <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()}>
              Добавить
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsOpen(false);
                setDraft("");
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <div className="category-manager-list">
        <div className="category-manager-list-head">
          <span>Пользовательские категории</span>
          <span>{customCategories.length}</span>
        </div>

        {customCategories.length > 0 ? (
          <div className="category-manager-chips">
            {customCategories.map((category) => (
              <div key={category} className="category-manager-chip">
                <span>{category}</span>
                <button
                  type="button"
                  className="category-manager-delete"
                  onClick={() => void handleDelete(category)}
                  disabled={pendingDelete === category}
                >
                  {pendingDelete === category ? "..." : "Удалить"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="category-manager-empty">Пока нет пользовательских категорий.</p>
        )}
      </div>

      {feedback && <p className={`category-manager-feedback ${feedback.tone}`}>{feedback.message}</p>}
    </div>
  );
}

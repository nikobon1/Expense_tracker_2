"use client";

import { useEffect, useState } from "react";
import type { AddCategoryResult } from "@/features/expenses/hooks/useCategoryOptions";

interface CategoryManagerProps {
  onAddCategory: (value: string) => Promise<AddCategoryResult>;
}

export default function CategoryManager({ onAddCategory }: CategoryManagerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<AddCategoryResult | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handleSubmit = async () => {
    const result = await onAddCategory(draft);
    setFeedback(result);

    if (result.status === "added" || result.status === "exists") {
      setDraft("");
    }
    if (result.status === "added") {
      setIsOpen(false);
    }
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

      {feedback && (
        <p className={`category-manager-feedback ${feedback.status === "invalid" ? "error" : "success"}`}>
          {feedback.message}
        </p>
      )}
    </div>
  );
}

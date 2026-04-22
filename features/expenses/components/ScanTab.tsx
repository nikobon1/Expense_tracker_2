"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import Image from "next/image";
import CategoryManager from "@/features/expenses/components/CategoryManager";
import type { AddCategoryResult, DeleteCategoryResult } from "@/features/expenses/hooks/useCategoryOptions";
import type {
  Expense,
  CreateRecurringExpensePayload,
  ReceiptData,
  ReceiptItem,
  RecurringExpensePlan,
  RecurringFrequency,
} from "@/features/expenses/types";
import { getExpenses } from "@/lib/api";
import { formatCurrencyAmount } from "@/lib/currency";

interface ScanTabProps {
  uploadedImage: string | null;
  receiptData: ReceiptData | null;
  editedItems: ReceiptItem[];
  storeName: string;
  purchaseDate: string;
  purchaseDateManual: string;
  purchaseDateWarningText: string | null;
  manualStoreName: string;
  manualPurchaseDate: string;
  manualTotal: string;
  categoryOptions: string[];
  customCategories: string[];
  recurringPlans: RecurringExpensePlan[];
  isRecurringLoading: boolean;
  isRecurringSaving: boolean;
  deletingRecurringId: number | null;
  isAnalyzing: boolean;
  isSaving: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDrop: (e: DragEvent) => void;
  onFileSelect: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onSave: () => void;
  onManualSave: () => void;
  onCreateRecurring: (payload: CreateRecurringExpensePayload) => Promise<void>;
  onDeleteRecurring: (id: number) => Promise<void>;
  onAddCategory: (value: string) => Promise<AddCategoryResult>;
  onDeleteCategory: (value: string) => Promise<DeleteCategoryResult>;
  onStoreNameChange: (value: string) => void;
  onPurchaseDateChange: (value: string) => void;
  onPurchaseDateManualChange: (value: string) => void;
  onManualStoreNameChange: (value: string) => void;
  onManualPurchaseDateChange: (value: string) => void;
  onManualTotalChange: (value: string) => void;
  onManualTotalBlur: () => void;
  onItemUpdate: (index: number, field: keyof ReceiptItem, value: string | number) => void;
  onItemDelete: (index: number) => void;
  currentTotal: number;
  focusManualEntrySignal?: number;
  currencyCode?: string;
}

function getLocalTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function getLocalTodayIsoFromDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function getLocalMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    start: getLocalTodayIsoFromDate(start),
    end: getLocalTodayIsoFromDate(end),
  };
}

function formatDisplayDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");

  if (!year || !month || !day) return isoDate;

  return `${day}.${month}.${year.slice(-2)}`;
}

function getFrequencyLabel(value: RecurringFrequency): string {
  switch (value) {
    case "daily":
      return "Каждый день";
    case "weekly":
      return "Каждую неделю";
    case "monthly":
    default:
      return "Каждый месяц";
  }
}

export default function ScanTab({
  uploadedImage,
  receiptData,
  editedItems,
  storeName,
  purchaseDate,
  purchaseDateManual,
  purchaseDateWarningText,
  manualStoreName,
  manualPurchaseDate,
  manualTotal,
  categoryOptions,
  customCategories,
  recurringPlans,
  isRecurringLoading,
  isRecurringSaving,
  deletingRecurringId,
  isAnalyzing,
  isSaving,
  fileInputRef,
  onDrop,
  onFileSelect,
  onAnalyze,
  onReset,
  onSave,
  onManualSave,
  onCreateRecurring,
  onDeleteRecurring,
  onAddCategory,
  onDeleteCategory,
  onStoreNameChange,
  onPurchaseDateChange,
  onPurchaseDateManualChange,
  onManualStoreNameChange,
  onManualPurchaseDateChange,
  onManualTotalChange,
  onManualTotalBlur,
  onItemUpdate,
  onItemDelete,
  currentTotal,
  focusManualEntrySignal = 0,
  currencyCode = "EUR",
}: ScanTabProps) {
  const manualSectionRef = useRef<HTMLDivElement | null>(null);
  const manualStoreInputRef = useRef<HTMLInputElement | null>(null);
  const recurringCategoryFallback = useMemo(
    () => categoryOptions.find((option) => option === "Подписки") ?? categoryOptions[0] ?? "Подписки",
    [categoryOptions]
  );
  const [futureRecurringExpenses, setFutureRecurringExpenses] = useState<Expense[]>([]);
  const [isFutureRecurringLoading, setIsFutureRecurringLoading] = useState(false);
  const [futureRecurringError, setFutureRecurringError] = useState<string | null>(null);
  const [showFutureRecurring, setShowFutureRecurring] = useState(false);
  const [futureRecurringLoadedCurrency, setFutureRecurringLoadedCurrency] = useState<string | null>(null);
  const [recurringTitle, setRecurringTitle] = useState("");
  const [recurringStoreName, setRecurringStoreName] = useState("");
  const [recurringAmount, setRecurringAmount] = useState("");
  const [recurringFrequency, setRecurringFrequency] = useState<RecurringFrequency>("monthly");
  const [recurringStartDate, setRecurringStartDate] = useState(getLocalTodayIso);
  const [recurringCategory, setRecurringCategory] = useState(recurringCategoryFallback);
  const [recurringFeedback, setRecurringFeedback] = useState<string | null>(null);
  const [recurringFeedbackType, setRecurringFeedbackType] = useState<"success" | "error" | null>(null);
  const resolvedRecurringCategory = categoryOptions.includes(recurringCategory)
    ? recurringCategory
    : recurringCategoryFallback;
  const formatCurrency = (value: number, maximumFractionDigits = 2) =>
    formatCurrencyAmount(value, currencyCode, {
      minimumFractionDigits: maximumFractionDigits,
      maximumFractionDigits,
    });

  const loadFutureRecurringExpenses = useCallback(async () => {
    const monthRange = getLocalMonthRange();
    const todayIso = getLocalTodayIso();
    const rangeStart = todayIso > monthRange.start ? todayIso : monthRange.start;

    setIsFutureRecurringLoading(true);
    setFutureRecurringError(null);

    try {
      const response = await getExpenses(rangeStart, monthRange.end, "all", currencyCode);
      const nextExpenses = response.expenses
        .filter((expense) => expense.sourceType === "recurring" && expense.date >= todayIso)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

      setFutureRecurringExpenses(nextExpenses);
      setFutureRecurringLoadedCurrency(currencyCode);
      setShowFutureRecurring(true);
    } catch (error) {
      setFutureRecurringExpenses([]);
      setShowFutureRecurring(true);
      setFutureRecurringError(error instanceof Error ? error.message : "ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð±ÑƒÐ´ÑƒÑ‰Ð¸Ðµ ÑÐ¿Ð¸ÑÐ°Ð½Ð¸Ñ.");
    } finally {
      setIsFutureRecurringLoading(false);
    }
  }, [currencyCode]);

  const toggleFutureRecurring = useCallback(() => {
    if (showFutureRecurring) {
      setShowFutureRecurring(false);
      return;
    }

    if (futureRecurringLoadedCurrency === currencyCode) {
      setShowFutureRecurring(true);
      return;
    }

    void loadFutureRecurringExpenses();
  }, [currencyCode, futureRecurringLoadedCurrency, loadFutureRecurringExpenses, showFutureRecurring]);

  useEffect(() => {
    if (!focusManualEntrySignal || uploadedImage) return;

    manualSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      manualStoreInputRef.current?.focus();
      manualStoreInputRef.current?.select();
    }, 150);
  }, [focusManualEntrySignal, uploadedImage]);

  useEffect(() => {
    setShowFutureRecurring(false);
    setFutureRecurringExpenses([]);
    setFutureRecurringLoadedCurrency(null);
    setFutureRecurringError(null);
  }, [currencyCode]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleOpenManualEntry = () => {
    manualSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      manualStoreInputRef.current?.focus();
      manualStoreInputRef.current?.select();
    }, 150);
  };

  const handleRecurringSave = async () => {
    setRecurringFeedback(null);
    setRecurringFeedbackType(null);

    try {
      await onCreateRecurring({
        title: recurringTitle,
        store_name: recurringStoreName,
        amount: Number(String(recurringAmount).replace(",", ".")),
        currency: currencyCode,
        category: resolvedRecurringCategory,
        frequency: recurringFrequency,
        start_date: recurringStartDate,
      });

      setRecurringTitle("");
      setRecurringStoreName("");
      setRecurringAmount("");
      setRecurringFrequency("monthly");
      setRecurringStartDate(getLocalTodayIso());
      setRecurringCategory(recurringCategoryFallback);
      setFutureRecurringExpenses([]);
      setFutureRecurringLoadedCurrency(null);
      setShowFutureRecurring(false);
      setRecurringFeedback("Автосписание сохранено.");
      setRecurringFeedbackType("success");
    } catch (error) {
      setRecurringFeedback(error instanceof Error ? error.message : "Не удалось сохранить автосписание.");
      setRecurringFeedbackType("error");
    }
  };

  const handleRecurringDelete = async (id: number) => {
    try {
      await onDeleteRecurring(id);
      setFutureRecurringExpenses([]);
      setFutureRecurringLoadedCurrency(null);
      setShowFutureRecurring(false);
      setRecurringFeedback("Автосписание остановлено.");
      setRecurringFeedbackType("success");
    } catch (error) {
      setRecurringFeedback(error instanceof Error ? error.message : "Не удалось остановить автосписание.");
      setRecurringFeedbackType("error");
    }
  };

  if (!uploadedImage) {
    return (
      <div className="scan-empty-state">
        <div className="card scan-empty-hero">
          <div className="scan-empty-hero-copy">
            <div className="scan-empty-kicker">Первые шаги</div>
            <h3>Добавьте первый чек за пару действий</h3>
            <p>
              Загрузите фото или введите сумму вручную. После сохранения данные сразу попадут в ваш дашборд и
              останутся привязанными только к вашему аккаунту.
            </p>
          </div>

          <div className="scan-empty-steps">
            <div className="scan-empty-step">
              <strong>1</strong>
              <span>Загрузите фото или откройте быстрый ввод.</span>
            </div>
            <div className="scan-empty-step">
              <strong>2</strong>
              <span>Проверьте магазин, дату, позиции и категории.</span>
            </div>
            <div className="scan-empty-step">
              <strong>3</strong>
              <span>Сохраните чек и посмотрите аналитику в дашборде.</span>
            </div>
          </div>

          <div className="scan-empty-actions">
            <button type="button" className="btn btn-primary" onClick={handleUploadClick}>
              Загрузить фото
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleOpenManualEntry}>
              Ввести вручную
            </button>
          </div>
        </div>

        <div className="scan-empty-panels">
          <div className="card scan-panel-card scan-panel-card--upload">
          <h3>Загрузите фото чека</h3>
          <div
            className="upload-area"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={handleUploadClick}
          >
            <div className="upload-icon">Загрузить</div>
            <p>Перетащите изображение сюда или нажмите для выбора файла</p>
            <span>Поддерживаются JPG и PNG</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
            />
          </div>
        </div>

          <div className="card scan-panel-card scan-panel-card--manual" ref={manualSectionRef}>
          <div className="scan-panel-card-main">
          <h3>Быстрое добавление</h3>
          <p className="scan-field-hint">Сохраните общую сумму, если фото чека нет.</p>

          <div className="scan-form-grid scan-manual-grid">
            <div>
              <label className="scan-field-label">Магазин</label>
              <input
                ref={manualStoreInputRef}
                type="text"
                value={manualStoreName}
                onChange={(e) => onManualStoreNameChange(e.target.value)}
                className="scan-field-input"
                placeholder="Название магазина"
              />
            </div>

            <div>
              <div className="scan-date-label-row">
                <label className="scan-field-label">Дата покупки</label>
              </div>
              <input
                type="date"
                value={manualPurchaseDate}
                onChange={(e) => onManualPurchaseDateChange(e.target.value)}
                className="scan-field-input"
              />
            </div>

            <div className="scan-manual-total-field">
              <label className="scan-field-label">{`Общая сумма (${currencyCode})`}</label>
              <input
                type="text"
                inputMode="decimal"
                value={manualTotal}
                onChange={(e) => onManualTotalChange(e.target.value)}
                onBlur={onManualTotalBlur}
                className="scan-field-input"
                placeholder="12,49 или 1 234,56"
              />
              <p className="scan-field-hint">Поддерживаются точка, запятая, пробелы и символ валюты.</p>
            </div>
          </div>
          </div>

          <button className="btn btn-primary btn-full" onClick={onManualSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <div className="spinner"></div>
                Сохранение...
              </>
            ) : (
              <>Сохранить без чека</>
            )}
          </button>

          <div className="scan-panel-card-footer">
            <div className="category-manager-panel">
              <h4>Категории</h4>
              <CategoryManager
                customCategories={customCategories}
                onAddCategory={onAddCategory}
                onDeleteCategory={onDeleteCategory}
              />
            </div>
          </div>
        </div>

          <div className="card scan-panel-card scan-panel-card--recurring">
          <div className="scan-panel-card-main">
          <h3>Автосписания</h3>
          <p className="scan-field-hint">Для подписок и других регулярных расходов. Они будут автоматически попадать в аналитику.</p>

          <div className="scan-form-grid recurring-form-grid">
            <div>
              <label className="scan-field-label">Название</label>
              <input
                type="text"
                value={recurringTitle}
                onChange={(e) => setRecurringTitle(e.target.value)}
                className="scan-field-input"
                placeholder="Netflix, Spotify, аренда"
              />
            </div>

            <div>
              <label className="scan-field-label">Сервис / магазин</label>
              <input
                type="text"
                value={recurringStoreName}
                onChange={(e) => setRecurringStoreName(e.target.value)}
                className="scan-field-input"
                placeholder="Netflix"
              />
            </div>

            <div>
              <label className="scan-field-label">{`Сумма (${currencyCode})`}</label>
              <input
                type="text"
                inputMode="decimal"
                value={recurringAmount}
                onChange={(e) => setRecurringAmount(e.target.value)}
                className="scan-field-input"
                placeholder="9.99"
              />
            </div>

            <div>
              <label className="scan-field-label">Частота</label>
              <select
                value={recurringFrequency}
                onChange={(e) => setRecurringFrequency(e.target.value as RecurringFrequency)}
                className="scan-field-input"
              >
                <option value="monthly">Каждый месяц</option>
                <option value="weekly">Каждую неделю</option>
                <option value="daily">Каждый день</option>
              </select>
            </div>

            <div>
              <label className="scan-field-label">Дата начала</label>
              <input
                type="date"
                value={recurringStartDate}
                onChange={(e) => setRecurringStartDate(e.target.value)}
                className="scan-field-input"
              />
            </div>

            <div>
                <label className="scan-field-label">Категория</label>
              <select
                value={resolvedRecurringCategory}
                onChange={(e) => setRecurringCategory(e.target.value)}
                className="scan-field-input"
              >
                {categoryOptions.map((cat) => (
                  <option key={`recurring-category-${cat}`} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="scan-recurring-spacer" aria-hidden="true" />
          </div>

          <button className="btn btn-primary btn-full" onClick={() => void handleRecurringSave()} disabled={isRecurringSaving}>
            {isRecurringSaving ? (
              <>
                <div className="spinner"></div>
                Сохранение...
              </>
            ) : (
              <>Создать автосписание</>
            )}
          </button>

          <div className="scan-panel-card-footer">
            {recurringFeedback ? (
              <p className={`recurring-feedback ${recurringFeedbackType === "error" ? "error" : "success"}`}>
                {recurringFeedback}
              </p>
            ) : null}

            <div className="recurring-plans">
              <div className="recurring-plans-head">
                <div className="recurring-plans-head-copy">
                  <h4>{`Активные списания: ${recurringPlans.length}`}</h4>
                </div>
                <button type="button" className="btn btn-secondary recurring-preview-toggle" onClick={() => void toggleFutureRecurring()}>
                  {showFutureRecurring ? "Скрыть будущие списания" : "Показать будущие списания"}
                </button>
              </div>

              {isRecurringLoading ? (
                <p className="recurring-empty">{"Загрузка..."}</p>
              ) : recurringPlans.length === 0 ? (
                <div className="recurring-plan-list recurring-plan-list--empty"></div>
              ) : (
                <div className="recurring-plan-list">
                  {recurringPlans.map((plan) => (
                    <div key={plan.id} className="recurring-plan-card">
                      <div>
                        <strong>{plan.title}</strong>
                        <span>{plan.store_name}</span>
                      </div>
                      <div>
                        <strong>{formatCurrency(plan.amount)}</strong>
                        <span>{plan.category}</span>
                        <span>
                          {getFrequencyLabel(plan.frequency)}
                          {plan.next_charge_date ? ` • следующее ${plan.next_charge_date}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="category-manager-delete"
                        onClick={() => void handleRecurringDelete(plan.id)}
                        disabled={deletingRecurringId === plan.id}
                      >
                        {deletingRecurringId === plan.id ? "Остановка..." : "Остановить"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showFutureRecurring ? (
                <div className="recurring-future">
                  <div className="recurring-future-head">
                    <h4>{"Будущие списания в текущем месяце"}</h4>
                    <span>{futureRecurringExpenses.length}</span>
                  </div>

                  {isFutureRecurringLoading ? (
                    <p className="recurring-empty">{"Загрузка..."}</p>
                  ) : futureRecurringError ? (
                    <p className="recurring-empty">{futureRecurringError}</p>
                  ) : futureRecurringExpenses.length === 0 ? (
                    <p className="recurring-empty">{"Пока нет будущих списаний на этот месяц."}</p>
                  ) : (
                    <div className="recurring-future-list">
                      {futureRecurringExpenses.map((expense) => (
                        <div key={expense.id} className="recurring-future-card">
                          <div>
                            <strong>{expense.item}</strong>
                            <span>{expense.store}</span>
                          </div>
                          <div>
                            <strong>{formatCurrency(expense.price)}</strong>
                            <span>{expense.category}</span>
                            <span>
                              {formatDisplayDate(expense.date)}
                              {expense.recurringFrequency ? ` • ${getFrequencyLabel(expense.recurringFrequency)}` : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }
  return (
    <div className="preview-container">
      <div className="card">
        <h3>Загруженный чек</h3>
        <div className="preview-image">
          <Image
            src={uploadedImage}
            alt="Чек"
            width={1200}
            height={1800}
            unoptimized
            className="scan-image"
          />
        </div>
        <button className="btn btn-secondary btn-full mt-16" onClick={onReset}>
          Удалить
        </button>
      </div>

      <div>
        {!receiptData && (
          <div className="card">
            <h3>Анализ чека</h3>
            <button className="btn btn-primary btn-full" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <>
                  <div className="spinner"></div>
                  Анализируем...
                </>
              ) : (
                <>Распознать чек</>
              )}
            </button>
          </div>
        )}

        {receiptData && editedItems.length > 0 && (
          <div className="card">
            <h3>Проверьте данные</h3>

            <div className="scan-form-grid">
              <div>
                <label className="scan-field-label">Магазин</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => onStoreNameChange(e.target.value)}
                  className="scan-field-input"
                />
              </div>

              <div>
                <div className="scan-date-label-row">
                  <label className="scan-field-label">Дата покупки</label>
                  <button
                    type="button"
                    className="scan-date-today-btn"
                    onClick={() => onPurchaseDateChange(getLocalTodayIso())}
                  >
                    Сегодня
                  </button>
                </div>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => onPurchaseDateChange(e.target.value)}
                  className="scan-field-input"
                />
                <p className="scan-field-hint">Можно исправить дату вручную и ввести её в формате ДД/ММ/ГГ.</p>
                <input
                  type="text"
                  value={purchaseDateManual}
                  onChange={(e) => onPurchaseDateManualChange(e.target.value)}
                  placeholder="Например: 14/02/26"
                  inputMode="numeric"
                  className="scan-field-input scan-date-manual-input"
                />
                {purchaseDateWarningText ? (
                  <div className="scan-date-warning" role="alert">
                    {purchaseDateWarningText}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="receipt-editor-items-head">
              <h4>Категории и позиции</h4>
              <CategoryManager
                customCategories={customCategories}
                onAddCategory={onAddCategory}
                onDeleteCategory={onDeleteCategory}
              />
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Название</th>
                    <th className="scan-col-price">{`Цена (${currencyCode})`}</th>
                    <th className="scan-col-category">Категория</th>
                    <th className="scan-col-delete"></th>
                  </tr>
                </thead>
                <tbody>
                  {editedItems.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => onItemUpdate(index, "name", e.target.value)}
                        />
                      </td>
                      <td className="scan-col-price">
                        <input
                          type="number"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="scan-price-input"
                          value={item.price}
                          onChange={(e) => onItemUpdate(index, "price", parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td>
                        <select value={item.category} onChange={(e) => onItemUpdate(index, "category", e.target.value)}>
                          {Array.from(new Set([...categoryOptions, item.category].filter(Boolean))).map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button className="delete-btn" onClick={() => onItemDelete(index)}>
                          Удалить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="total-row">
              <span className="total-label">Итого:</span>
              <span className="total-value">{formatCurrency(currentTotal)}</span>
            </div>

            <button className="btn btn-primary btn-full mt-16" onClick={onSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <div className="spinner"></div>
                  Сохранение...
                </>
              ) : (
                <>Сохранить в базу</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

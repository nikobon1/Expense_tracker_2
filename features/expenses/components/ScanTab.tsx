"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from "react";
import Image from "next/image";
import CategoryManager from "@/features/expenses/components/CategoryManager";
import type { AddCategoryResult, DeleteCategoryResult } from "@/features/expenses/hooks/useCategoryOptions";
import type {
  CreateRecurringExpensePayload,
  ReceiptData,
  ReceiptItem,
  RecurringExpensePlan,
  RecurringFrequency,
} from "@/features/expenses/types";
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

  useEffect(() => {
    if (!focusManualEntrySignal || uploadedImage) return;

    manualSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      manualStoreInputRef.current?.focus();
      manualStoreInputRef.current?.select();
    }, 150);
  }, [focusManualEntrySignal, uploadedImage]);

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
          <div className="card">
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

          <div className="card" ref={manualSectionRef}>
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
                <button
                  type="button"
                  className="scan-date-today-btn"
                  onClick={() => onManualPurchaseDateChange(getLocalTodayIso())}
                >
                  Сегодня
                </button>
              </div>
              <input
                type="date"
                value={manualPurchaseDate}
                onChange={(e) => onManualPurchaseDateChange(e.target.value)}
                className="scan-field-input"
              />
            </div>

            <div>
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

          <div className="category-manager-panel">
            <h4>Категории</h4>
            <CategoryManager
              customCategories={customCategories}
              onAddCategory={onAddCategory}
              onDeleteCategory={onDeleteCategory}
            />
          </div>
        </div>

          <div className="card">
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

          {recurringFeedback ? (
            <p className={`recurring-feedback ${recurringFeedbackType === "error" ? "error" : "success"}`}>
              {recurringFeedback}
            </p>
          ) : null}

          <div className="recurring-plans">
            <div className="recurring-plans-head">
              <h4>Активные списания</h4>
              <span>{recurringPlans.length}</span>
            </div>

            {isRecurringLoading ? (
              <p className="recurring-empty">Загрузка...</p>
            ) : recurringPlans.length === 0 ? (
              <p className="recurring-empty">Пока нет активных автосписаний.</p>
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

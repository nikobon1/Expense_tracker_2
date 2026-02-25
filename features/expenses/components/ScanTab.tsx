"use client";

import type { DragEvent, RefObject } from "react";
import Image from "next/image";
import { CATEGORIES } from "@/features/expenses/constants";
import type { ReceiptData, ReceiptItem } from "@/features/expenses/types";

interface ScanTabProps {
  uploadedImage: string | null;
  receiptData: ReceiptData | null;
  editedItems: ReceiptItem[];
  storeName: string;
  purchaseDate: string;
  isAnalyzing: boolean;
  isSaving: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDrop: (e: DragEvent) => void;
  onFileSelect: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onSave: () => void;
  onStoreNameChange: (value: string) => void;
  onPurchaseDateChange: (value: string) => void;
  onItemUpdate: (index: number, field: keyof ReceiptItem, value: string | number) => void;
  onItemDelete: (index: number) => void;
  currentTotal: number;
}

export default function ScanTab({
  uploadedImage,
  receiptData,
  editedItems,
  storeName,
  purchaseDate,
  isAnalyzing,
  isSaving,
  fileInputRef,
  onDrop,
  onFileSelect,
  onAnalyze,
  onReset,
  onSave,
  onStoreNameChange,
  onPurchaseDateChange,
  onItemUpdate,
  onItemDelete,
  currentTotal,
}: ScanTabProps) {
  if (!uploadedImage) {
    return (
      <div className="card">
        <h3>📷 Загрузите фото чека</h3>
        <div
          className="upload-area"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="upload-icon">📤</div>
          <p>Перетащите изображение или нажмите для выбора</p>
          <span>Поддерживаются: JPG, PNG</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="preview-container">
      <div className="card">
        <h3>🖼️ Загруженный чек</h3>
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
          🗑️ Удалить
        </button>
      </div>

      <div>
        {!receiptData && (
          <div className="card">
            <h3>🔍 Анализ чека</h3>
            <button className="btn btn-primary btn-full" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <>
                  <div className="spinner"></div>
                  Анализируем...
                </>
              ) : (
                <>🔍 Распознать чек</>
              )}
            </button>
          </div>
        )}

        {receiptData && editedItems.length > 0 && (
          <div className="card">
            <h3>✏️ Проверьте данные</h3>

            <div className="scan-form-grid">
              <div>
                <label className="scan-field-label">
                  🏪 Магазин
                </label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => onStoreNameChange(e.target.value)}
                  className="scan-field-input"
                />
              </div>
              <div>
                <label className="scan-field-label">
                  📅 Дата
                </label>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => onPurchaseDateChange(e.target.value)}
                  className="scan-field-input"
                />
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Название</th>
                    <th className="scan-col-price">Цена (€)</th>
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
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button className="delete-btn" onClick={() => onItemDelete(index)}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="total-row">
              <span className="total-label">💰 Итого:</span>
              <span className="total-value">{currentTotal.toFixed(2)} €</span>
            </div>

            <button className="btn btn-primary btn-full mt-16" onClick={onSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <div className="spinner"></div>
                  Сохраняем...
                </>
              ) : (
                <>💾 Сохранить в базу данных</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

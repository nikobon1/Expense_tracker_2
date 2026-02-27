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
  purchaseDateManual: string;
  manualStoreName: string;
  manualPurchaseDate: string;
  manualTotal: string;
  isAnalyzing: boolean;
  isSaving: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onDrop: (e: DragEvent) => void;
  onFileSelect: (file: File) => void;
  onAnalyze: () => void;
  onReset: () => void;
  onSave: () => void;
  onManualSave: () => void;
  onStoreNameChange: (value: string) => void;
  onPurchaseDateChange: (value: string) => void;
  onPurchaseDateManualChange: (value: string) => void;
  onManualStoreNameChange: (value: string) => void;
  onManualPurchaseDateChange: (value: string) => void;
  onManualTotalChange: (value: string) => void;
  onItemUpdate: (index: number, field: keyof ReceiptItem, value: string | number) => void;
  onItemDelete: (index: number) => void;
  currentTotal: number;
}

function getLocalTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function ScanTab({
  uploadedImage,
  receiptData,
  editedItems,
  storeName,
  purchaseDate,
  purchaseDateManual,
  manualStoreName,
  manualPurchaseDate,
  manualTotal,
  isAnalyzing,
  isSaving,
  fileInputRef,
  onDrop,
  onFileSelect,
  onAnalyze,
  onReset,
  onSave,
  onManualSave,
  onStoreNameChange,
  onPurchaseDateChange,
  onPurchaseDateManualChange,
  onManualStoreNameChange,
  onManualPurchaseDateChange,
  onManualTotalChange,
  onItemUpdate,
  onItemDelete,
  currentTotal,
}: ScanTabProps) {
  if (!uploadedImage) {
    return (
      <div className="scan-empty-state">
        <div className="card">
          <h3>рџ“· Р—Р°РіСЂСѓР·РёС‚Рµ С„РѕС‚Рѕ С‡РµРєР°</h3>
          <div
            className="upload-area"
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">рџ“¤</div>
            <p>РџРµСЂРµС‚Р°С‰РёС‚Рµ РёР·РѕР±СЂР°Р¶РµРЅРёРµ РёР»Рё РЅР°Р¶РјРёС‚Рµ РґР»СЏ РІС‹Р±РѕСЂР°</p>
            <span>РџРѕРґРґРµСЂР¶РёРІР°СЋС‚СЃСЏ: JPG, PNG</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
            />
          </div>
        </div>

        <div className="card">
          <h3>Quick Add</h3>
          <p className="scan-field-hint">Save a single total when there is no receipt photo.</p>

          <div className="scan-form-grid scan-manual-grid">
            <div>
              <label className="scan-field-label">Store</label>
              <input
                type="text"
                value={manualStoreName}
                onChange={(e) => onManualStoreNameChange(e.target.value)}
                className="scan-field-input"
                placeholder="Store name"
              />
            </div>

            <div>
              <div className="scan-date-label-row">
                <label className="scan-field-label">Purchase date</label>
                <button
                  type="button"
                  className="scan-date-today-btn"
                  onClick={() => onManualPurchaseDateChange(getLocalTodayIso())}
                >
                  Today
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
              <label className="scan-field-label">Total amount (EUR)</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={manualTotal}
                onChange={(e) => onManualTotalChange(e.target.value)}
                className="scan-field-input"
                placeholder="0.00"
              />
            </div>
          </div>

          <button className="btn btn-primary btn-full" onClick={onManualSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <div className="spinner"></div>
                Saving...
              </>
            ) : (
              <>Save without receipt</>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-container">
      <div className="card">
        <h3>рџ–јпёЏ Р—Р°РіСЂСѓР¶РµРЅРЅС‹Р№ С‡РµРє</h3>
        <div className="preview-image">
          <Image
            src={uploadedImage}
            alt="Р§РµРє"
            width={1200}
            height={1800}
            unoptimized
            className="scan-image"
          />
        </div>
        <button className="btn btn-secondary btn-full mt-16" onClick={onReset}>
          рџ—‘пёЏ РЈРґР°Р»РёС‚СЊ
        </button>
      </div>

      <div>
        {!receiptData && (
          <div className="card">
            <h3>рџ”Ќ РђРЅР°Р»РёР· С‡РµРєР°</h3>
            <button className="btn btn-primary btn-full" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <>
                  <div className="spinner"></div>
                  РђРЅР°Р»РёР·РёСЂСѓРµРј...
                </>
              ) : (
                <>рџ”Ќ Р Р°СЃРїРѕР·РЅР°С‚СЊ С‡РµРє</>
              )}
            </button>
          </div>
        )}

        {receiptData && editedItems.length > 0 && (
          <div className="card">
            <h3>вњЏпёЏ РџСЂРѕРІРµСЂСЊС‚Рµ РґР°РЅРЅС‹Рµ</h3>

            <div className="scan-form-grid">
              <div>
                <label className="scan-field-label">
                  рџЏЄ РњР°РіР°Р·РёРЅ
                </label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => onStoreNameChange(e.target.value)}
                  className="scan-field-input"
                />
              </div>
              <div>
                <div className="scan-date-label-row">
                  <label className="scan-field-label">
                    рџ“… Р”Р°С‚Р° РїРѕРєСѓРїРєРё
                  </label>
                  <button
                    type="button"
                    className="scan-date-today-btn"
                    onClick={() => onPurchaseDateChange(getLocalTodayIso())}
                  >
                    РЎРµРіРѕРґРЅСЏ
                  </button>
                </div>
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => onPurchaseDateChange(e.target.value)}
                  className="scan-field-input"
                />
                <p className="scan-field-hint">РџРѕРґС‚РІРµСЂРґРёС‚Рµ РґР°С‚Сѓ РїРѕРєСѓРїРєРё. РњРѕР¶РЅРѕ РёСЃРїСЂР°РІРёС‚СЊ РІСЂСѓС‡РЅСѓСЋ РІ С„РѕСЂРјР°С‚Рµ Р”Р”/РњРњ/Р“Р“.</p>
                <input
                  type="text"
                  value={purchaseDateManual}
                  onChange={(e) => onPurchaseDateManualChange(e.target.value)}
                  placeholder="РќР°РїСЂРёРјРµСЂ: 14/02/26"
                  inputMode="numeric"
                  className="scan-field-input scan-date-manual-input"
                />
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>РќР°Р·РІР°РЅРёРµ</th>
                    <th className="scan-col-price">Р¦РµРЅР° (в‚¬)</th>
                    <th className="scan-col-category">РљР°С‚РµРіРѕСЂРёСЏ</th>
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
                          рџ—‘пёЏ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="total-row">
              <span className="total-label">рџ’° РС‚РѕРіРѕ:</span>
              <span className="total-value">{currentTotal.toFixed(2)} в‚¬</span>
            </div>

            <button className="btn btn-primary btn-full mt-16" onClick={onSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <div className="spinner"></div>
                  РЎРѕС…СЂР°РЅСЏРµРј...
                </>
              ) : (
                <>рџ’ѕ РЎРѕС…СЂР°РЅРёС‚СЊ РІ Р±Р°Р·Сѓ РґР°РЅРЅС‹С…</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


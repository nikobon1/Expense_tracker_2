"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CATEGORY } from "@/features/expenses/constants";
import { analyzeReceipt, saveReceipt } from "@/lib/api";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";
import { formatAmountForInput, parseFlexibleAmount } from "@/lib/amount";
import { getReceiptDateWarning } from "@/lib/receipt-date-warning";
import type { AlertState, ReceiptData, ReceiptItem } from "@/features/expenses/types";

const MAX_UPLOAD_DIMENSION = 1600;
const MAX_ANALYZE_PAYLOAD_CHARS = 3_500_000;

function formatManualDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
}

function formatHumanDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function toIsoDateIfValid(year: number, month: number, day: number): string | null {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parseManualDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const normalized = raw.replace(/\./g, "/").replace(/-/g, "/");

  let match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(normalized);
  if (match) {
    return toIsoDateIfValid(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
  }

  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (match) {
    return toIsoDateIfValid(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(normalized);
  if (match) {
    return toIsoDateIfValid(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target?.result ?? ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = dataUrl;
  });
}

async function optimizeImageForUpload(file: File): Promise<string> {
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);

  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;

  const maxSide = Math.max(width, height);
  if (maxSide > MAX_UPLOAD_DIMENSION) {
    const ratio = MAX_UPLOAD_DIMENSION / maxSide;
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Не удалось подготовить изображение");
  }

  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.9;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (dataUrl.length > MAX_ANALYZE_PAYLOAD_CHARS && quality > 0.45) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrl.length > MAX_ANALYZE_PAYLOAD_CHARS) {
    throw new Error("Фото слишком большое. Обрежьте изображение чека или сделайте фото ближе.");
  }

  return dataUrl;
}

function getLocalTodayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function notifyExpensesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("expense-tracker:expenses-changed"));
}

function getDateWarningThresholdDays(): number {
  const raw = process.env.NEXT_PUBLIC_RECEIPT_DATE_WARNING_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.floor(parsed);
}

function getDateWarningText(purchaseDate: string): string | null {
  const warning = getReceiptDateWarning(purchaseDate, getDateWarningThresholdDays());
  if (!warning?.shouldWarn) return null;

  if (warning.direction === "past") {
    return `Дата чека на ${warning.diffDays} дн. раньше сегодняшней. Проверьте дату перед сохранением.`;
  }

  if (warning.direction === "future") {
    return `Дата чека на ${warning.diffDays} дн. позже сегодняшней. Проверьте дату перед сохранением.`;
  }

  return null;
}

export function useReceiptFlow(defaultCurrency: string = DEFAULT_CURRENCY) {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [editedItems, setEditedItems] = useState<ReceiptItem[]>([]);
  const [storeName, setStoreName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseDateManual, setPurchaseDateManual] = useState("");
  const [manualStoreName, setManualStoreName] = useState("");
  const [manualPurchaseDate, setManualPurchaseDate] = useState(getLocalTodayIso);
  const [manualTotal, setManualTotal] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const purchaseDateWarningText = useMemo(() => getDateWarningText(purchaseDate), [purchaseDate]);
  const purchaseDatePreviewText = useMemo(() => {
    const parsed = parseManualDate(purchaseDateManual);
    if (!parsed) return null;
    return `Сохранится как: ${formatHumanDate(parsed)}`;
  }, [purchaseDateManual]);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(null), 3000);
    return () => clearTimeout(timer);
  }, [alert]);

  const handleFile = useCallback(async (file: File) => {
    try {
      const optimizedImage = await optimizeImageForUpload(file);
      setUploadedImage(optimizedImage);
      setReceiptData(null);
      setEditedItems([]);
      setStoreName("");
      setPurchaseDate("");
      setPurchaseDateManual("");
      setAlert(null);
    } catch (error) {
      setAlert({
        type: "error",
        message: error instanceof Error ? error.message : "Ошибка подготовки изображения",
      });
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleAnalyzeReceipt = useCallback(async () => {
    if (!uploadedImage) return;

    setIsAnalyzing(true);
    try {
      const data = await analyzeReceipt(uploadedImage);
      const normalizedData: ReceiptData = {
        ...data,
        currency: normalizeCurrencyCode(defaultCurrency),
      };
      setReceiptData(normalizedData);
      setEditedItems(normalizedData.items);
      setStoreName(normalizedData.store_name);
      setPurchaseDate(normalizedData.purchase_date);
      setPurchaseDateManual(formatManualDate(normalizedData.purchase_date));
      setAlert({ type: "success", message: "Чек успешно распознан!" });
    } catch (error) {
      setAlert({
        type: "error",
        message: error instanceof Error ? error.message : "Ошибка анализа",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [defaultCurrency, uploadedImage]);

  const handlePurchaseDateChange = useCallback((value: string) => {
    setPurchaseDate(value);
    setPurchaseDateManual(formatManualDate(value));
  }, []);

  const handlePurchaseDateManualChange = useCallback((value: string) => {
    setPurchaseDateManual(value);
    const parsed = parseManualDate(value);
    if (parsed) {
      setPurchaseDate(parsed);
    }
  }, []);

  const handleSaveReceipt = useCallback(async () => {
    if (editedItems.length === 0) return;

    const warning = getReceiptDateWarning(purchaseDate, getDateWarningThresholdDays());
    if (warning?.shouldWarn && typeof window !== "undefined") {
      const directionText = warning.direction === "past" ? "раньше" : "позже";
      const confirmed = window.confirm(
        `Дата чека на ${warning.diffDays} дн. ${directionText} сегодняшней. Сохранить всё равно?`
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    try {
      await saveReceipt({
        store_name: storeName,
        purchase_date: purchaseDate,
        items: editedItems,
        currency: normalizeCurrencyCode(defaultCurrency),
      });

      setAlert({ type: "success", message: "Чек сохранен в базу данных" });
      setReceiptData(null);
      setEditedItems([]);
      setUploadedImage(null);
      setStoreName("");
      setPurchaseDate("");
      setPurchaseDateManual("");
      notifyExpensesChanged();
    } catch {
      setAlert({ type: "error", message: "Ошибка сохранения в БД" });
    } finally {
      setIsSaving(false);
    }
  }, [defaultCurrency, editedItems, purchaseDate, storeName]);

  const handleManualSave = useCallback(async () => {
    const normalizedStoreName = manualStoreName.trim();
    const totalAmount = parseFlexibleAmount(manualTotal);

    if (!normalizedStoreName) {
      setAlert({ type: "error", message: "Укажите магазин перед сохранением." });
      return;
    }

    if (!manualPurchaseDate) {
      setAlert({ type: "error", message: "Выберите дату покупки." });
      return;
    }

    if (totalAmount === null || totalAmount <= 0) {
      setAlert({
        type: "error",
        message: "Введите сумму больше нуля. Поддерживаются форматы: 12.49, 12,49, 1 234,56, €12.49.",
      });
      return;
    }

    setIsSaving(true);
    try {
      await saveReceipt({
        store_name: normalizedStoreName,
        purchase_date: manualPurchaseDate,
        currency: normalizeCurrencyCode(defaultCurrency),
        items: [
          {
            name: "Покупка без чека",
            price: totalAmount,
            category: DEFAULT_CATEGORY,
          },
        ],
      });

      setAlert({ type: "success", message: "Покупка без чека сохранена." });
      setManualStoreName("");
      setManualPurchaseDate(getLocalTodayIso());
      setManualTotal("");
      notifyExpensesChanged();
    } catch {
      setAlert({ type: "error", message: "Не удалось сохранить покупку." });
    } finally {
      setIsSaving(false);
    }
  }, [defaultCurrency, manualPurchaseDate, manualStoreName, manualTotal]);

  const normalizeManualTotal = useCallback(() => {
    const parsed = parseFlexibleAmount(manualTotal);
    if (parsed === null) return;
    setManualTotal(formatAmountForInput(parsed));
  }, [manualTotal]);

  const updateItem = useCallback((index: number, field: keyof ReceiptItem, value: string | number) => {
    setEditedItems((prevItems) => {
      const next = [...prevItems];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  const deleteItem = useCallback((index: number) => {
    setEditedItems((prevItems) => prevItems.filter((_, i) => i !== index));
  }, []);

  const resetScanner = useCallback(() => {
    setUploadedImage(null);
    setReceiptData(null);
    setEditedItems([]);
    setStoreName("");
    setPurchaseDate("");
    setPurchaseDateManual("");
  }, []);

  const currentTotal = useMemo(
    () => editedItems.reduce((sum, item) => sum + Number(item.price), 0),
    [editedItems]
  );

  return {
    uploadedImage,
    isAnalyzing,
    receiptData,
    editedItems,
    storeName,
    purchaseDate,
    purchaseDateManual,
    purchaseDateWarningText,
    purchaseDatePreviewText,
    manualStoreName,
    manualPurchaseDate,
    manualTotal,
    isSaving,
    alert,
    fileInputRef,
    handleDrop,
    handleFile,
    handleAnalyzeReceipt,
    handleSaveReceipt,
    handleManualSave,
    setStoreName,
    setPurchaseDate: handlePurchaseDateChange,
    setPurchaseDateManual: handlePurchaseDateManualChange,
    setManualStoreName,
    setManualPurchaseDate,
    setManualTotal,
    normalizeManualTotal,
    updateItem,
    deleteItem,
    resetScanner,
    currentTotal,
  };
}


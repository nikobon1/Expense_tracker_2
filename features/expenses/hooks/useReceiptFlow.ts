"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeReceipt, saveReceipt } from "@/lib/api";
import type { AlertState, ReceiptData, ReceiptItem } from "@/features/expenses/types";

export function useReceiptFlow() {
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [editedItems, setEditedItems] = useState<ReceiptItem[]>([]);
  const [storeName, setStoreName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!alert) return;
    const timer = setTimeout(() => setAlert(null), 3000);
    return () => clearTimeout(timer);
  }, [alert]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setUploadedImage(e.target?.result as string);
      setReceiptData(null);
      setEditedItems([]);
    };
    reader.readAsDataURL(file);
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
      setReceiptData(data);
      setEditedItems(data.items);
      setStoreName(data.store_name);
      setPurchaseDate(data.purchase_date);
      setAlert({ type: "success", message: "Чек успешно распознан!" });
    } catch (error) {
      setAlert({
        type: "error",
        message: error instanceof Error ? error.message : "Ошибка анализа",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [uploadedImage]);

  const handleSaveReceipt = useCallback(async () => {
    if (editedItems.length === 0) return;

    setIsSaving(true);
    try {
      await saveReceipt({
        store_name: storeName,
        purchase_date: purchaseDate,
        items: editedItems,
      });

      setAlert({ type: "success", message: "Чек сохранен в базу данных" });
      setReceiptData(null);
      setEditedItems([]);
      setUploadedImage(null);
    } catch {
      setAlert({ type: "error", message: "Ошибка сохранения в БД" });
    } finally {
      setIsSaving(false);
    }
  }, [editedItems, purchaseDate, storeName]);

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
    isSaving,
    alert,
    fileInputRef,
    handleDrop,
    handleFile,
    handleAnalyzeReceipt,
    handleSaveReceipt,
    setStoreName,
    setPurchaseDate,
    updateItem,
    deleteItem,
    resetScanner,
    currentTotal,
  };
}


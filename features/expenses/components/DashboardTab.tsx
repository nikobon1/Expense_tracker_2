"use client";

import Image from "next/image";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import CategoryManager from "@/features/expenses/components/CategoryManager";
import { CHART_COLORS } from "@/features/expenses/constants";
import type { AddCategoryResult, DeleteCategoryResult } from "@/features/expenses/hooks/useCategoryOptions";
import { analyzeReceipt, deleteReceipt, getReceipt, getReceiptImageFromTelegram, updateReceipt } from "@/lib/api";
import { buildCategoryData, buildDailyData } from "@/features/expenses/utils";
import type { DailyPoint, DailyReceiptSegment } from "@/features/expenses/utils";
import type { Expense, ReceiptData, ReceiptItem } from "@/features/expenses/types";

interface DashboardTabProps {
  startDate: string;
  endDate: string;
  selectedStore: string;
  stores: string[];
  expenses: Expense[];
  categoryOptions: string[];
  customCategories: string[];
  prevMonthTotal: number;
  prevPeriodCategoryTotals: Array<{ category: string; total: number }>;
  analyzeCost: {
    totalUsd: number;
    count: number;
    items: Array<{
      id: number;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      storeName: string;
      createdAt: string;
    }>;
  };
  isLoading?: boolean;
  onAddCategory: (value: string) => Promise<AddCategoryResult>;
  onDeleteCategory: (value: string) => Promise<DeleteCategoryResult>;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onStoreChange: (value: string) => void;
  onRefresh?: () => void;
  onOpenScan?: () => void;
  isReadOnly?: boolean;
  readOnlyNotice?: string;
}

type DailyBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: DailyPoint;
};

type DailyTooltipContentProps = {
  active?: boolean;
  label?: string | number;
  payload?: ReadonlyArray<{ value?: number; payload?: DailyPoint }>;
};

type LedgerSortField = "price" | "date";
type LedgerSortDirection = "desc" | "asc";

type EditableReceipt = {
  id: number;
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
  comment: string;
  source?: string | null;
  telegram_file_id?: string | null;
};

type ComparisonSummary = {
  changes: string[];
  currentTotal: number;
  analyzedTotal: number;
};

type LedgerReceiptGroup = {
  receiptId: number;
  date: string;
  store: string;
  items: Expense[];
  total: number;
  categories: string[];
};

const MAX_UPLOAD_DIMENSION = 1600;
const MAX_ANALYZE_PAYLOAD_CHARS = 3_500_000;
const DAILY_CHART_STEP_EUR = 20;
const ACTIVITY_CHART_DAYS = 7;

function getLocalTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function shiftDateByMonths(dateString: string, monthOffset: number): string {
  const [yearPart, monthPart, dayPart] = dateString.split("-").map(Number);
  const year = Number.isFinite(yearPart) ? yearPart : 0;
  const month = Number.isFinite(monthPart) ? monthPart : 0;
  const day = Number.isFinite(dayPart) ? dayPart : 0;

  const targetMonthIndex = month - 1 + monthOffset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const normalizedDay = Math.min(day, lastDayOfTargetMonth);

  return new Date(Date.UTC(targetYear, normalizedMonthIndex, normalizedDay)).toISOString().split("T")[0];
}

function formatPeriodLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
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
    const img = new window.Image();
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

function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function truncateLabel(value: string, maxLength: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, Math.max(0, maxLength - 2)).trimEnd()}..`;
}

function formatCountNoun(count: number, singular: string, paucal: string, plural: string): string {
  const abs = Math.abs(count) % 100;
  const lastDigit = abs % 10;

  if (abs >= 11 && abs <= 19) return plural;
  if (lastDigit === 1) return singular;
  if (lastDigit >= 2 && lastDigit <= 4) return paucal;
  return plural;
}

function buildAxisTicks(maxValue: number, step: number): number[] {
  const upperBound = Math.max(step, Math.ceil(Math.max(0, maxValue) / step) * step);
  const ticks: number[] = [];

  for (let value = 0; value <= upperBound; value += step) {
    ticks.push(value);
  }

  return ticks;
}

function sanitizeItems(items: ReceiptItem[]): ReceiptItem[] {
  return items
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      price: Number(item.price ?? 0),
      category: String(item.category ?? "").trim() || "Другое",
    }))
    .filter((item) => item.name || item.price > 0);
}

function escapeExcelXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildExpensesExcelXml(params: {
  startDate: string;
  endDate: string;
  selectedStore: string;
  expenses: Expense[];
}): string {
  const { startDate, endDate, selectedStore, expenses } = params;
  const storeLabel = selectedStore === "all" ? "Все магазины" : selectedStore;
  const generatedAt = new Date().toISOString();

  const headerRows = [
    ["Отчет", "Расходы"],
    ["Период", `${startDate} - ${endDate}`],
    ["Магазин", storeLabel],
    ["Сгенерировано", generatedAt],
    ["", ""],
    ["Дата", "Магазин", "Товар", "Категория", "Цена (€)", "Чек ID"],
  ];

  const dataRows = expenses.map((expense) => [
    expense.date,
    expense.store,
    expense.item,
    expense.category,
    expense.price.toFixed(2),
    String(expense.receiptId),
  ]);

  const allRows = [...headerRows, ...dataRows];

  const toCell = (value: string) =>
    `<Cell><Data ss:Type="String">${escapeExcelXml(String(value ?? ""))}</Data></Cell>`;

  const xmlRows = allRows
    .map((row) => `<Row>${row.map((cell) => toCell(String(cell))).join("")}</Row>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Worksheet ss:Name="Расходы">
    <Table>${xmlRows}</Table>
  </Worksheet>
</Workbook>`;
}

function buildComparisonSummary(current: EditableReceipt, analyzed: ReceiptData): ComparisonSummary {
  const currentItems = sanitizeItems(current.items);
  const analyzedItems = sanitizeItems(analyzed.items ?? []);

  const changes: string[] = [];

  if (current.store_name.trim() !== (analyzed.store_name ?? "").trim()) {
    changes.push(`Магазин: "${current.store_name || "не указан"}" -> "${analyzed.store_name || "не указан"}"`);
  }

  if (current.purchase_date !== (analyzed.purchase_date ?? "")) {
    changes.push(`Дата: ${current.purchase_date || "не указана"} -> ${analyzed.purchase_date || "не указана"}`);
  }

  if (currentItems.length !== analyzedItems.length) {
    changes.push(`Количество позиций: ${currentItems.length} -> ${analyzedItems.length}`);
  }

  const currentNames = new Set(currentItems.map((item) => normalizeItemName(item.name)).filter(Boolean));
  const analyzedNames = new Set(analyzedItems.map((item) => normalizeItemName(item.name)).filter(Boolean));

  const missingInDashboard = [...analyzedNames].filter((name) => !currentNames.has(name));
  const extraInDashboard = [...currentNames].filter((name) => !analyzedNames.has(name));

  if (missingInDashboard.length > 0) {
    changes.push(`Не хватает в данных дашборда: ${missingInDashboard.slice(0, 3).join(", ")}${missingInDashboard.length > 3 ? "..." : ""}`);
  }

  if (extraInDashboard.length > 0) {
    changes.push(`Лишние в данных дашборда: ${extraInDashboard.slice(0, 3).join(", ")}${extraInDashboard.length > 3 ? "..." : ""}`);
  }

  const currentTotal = currentItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const analyzedTotal = analyzedItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
  if (Math.abs(currentTotal - analyzedTotal) >= 0.01) {
    changes.push(`Сумма: ${currentTotal.toFixed(2)} € -> ${analyzedTotal.toFixed(2)} €`);
  }

  return {
    changes,
    currentTotal,
    analyzedTotal,
  };
}

export default function DashboardTab({
  startDate,
  endDate,
  selectedStore,
  stores,
  expenses,
  categoryOptions,
  customCategories,
  prevMonthTotal,
  prevPeriodCategoryTotals,
  analyzeCost,
  isLoading = false,
  onAddCategory,
  onDeleteCategory,
  onStartDateChange,
  onEndDateChange,
  onStoreChange,
  onRefresh,
  onOpenScan,
  isReadOnly = false,
  readOnlyNotice = "Это демо-режим. В этой версии редактирование и сохранение отключены.",
}: DashboardTabProps) {
  const [activeBarDate, setActiveBarDate] = useState<string | null>(null);
  const tooltipReceiptLimit: number | "all" = ACTIVITY_CHART_DAYS;
  const setTooltipReceiptLimit = (_value: number | "all") => undefined;
  const [isCategoryComparisonOpen, setIsCategoryComparisonOpen] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<"periods" | "stores">("periods");
  const [comparisonView, setComparisonView] = useState<"table" | "lines">("lines");
  const [comparisonStoreA, setComparisonStoreA] = useState<string>("");
  const [comparisonStoreB, setComparisonStoreB] = useState<string>("");
  const [isAnalyzeCostOpen, setIsAnalyzeCostOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isEditorDeleting, setIsEditorDeleting] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ledgerStoreFilter, setLedgerStoreFilter] = useState<string>("all");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllLedger, setShowAllLedger] = useState(false);
  const [ledgerSortField, setLedgerSortField] = useState<LedgerSortField>("price");
  const [ledgerSortDirection, setLedgerSortDirection] = useState<LedgerSortDirection>("desc");
  const [expandedLedgerReceipts, setExpandedLedgerReceipts] = useState<number[]>([]);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorReceipt, setEditorReceipt] = useState<EditableReceipt | null>(null);
  const [comparisonImage, setComparisonImage] = useState<string | null>(null);
  const [comparisonData, setComparisonData] = useState<ReceiptData | null>(null);
  const compareFileInputRef = useRef<HTMLInputElement | null>(null);

  const getReceiptSegmentColor = (segment: DailyReceiptSegment, index: number) =>
    CHART_COLORS[(segment.receiptId + index) % CHART_COLORS.length];

  const formatDashboardDate = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1].slice(-2)}`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(parsed);
  };

  const expensesTotal = expenses.reduce((sum, exp) => sum + exp.price, 0);
  const amountChange = expensesTotal - prevMonthTotal;
  const percentChange =
    prevMonthTotal > 0 ? (amountChange / prevMonthTotal) * 100 : 0;
  const prevPeriodStart = shiftDateByMonths(startDate, -1);
  const prevPeriodEnd = shiftDateByMonths(endDate, -1);
  const currentPeriodLabel = `${formatPeriodLabel(startDate)} - ${formatPeriodLabel(endDate)}`;
  const previousPeriodLabel = `${formatPeriodLabel(prevPeriodStart)} - ${formatPeriodLabel(prevPeriodEnd)}`;
  const periodCompareMax = Math.max(expensesTotal, prevMonthTotal, 0);
  const currentPeriodWidth = periodCompareMax > 0 ? (expensesTotal / periodCompareMax) * 100 : 0;
  const previousPeriodWidth = periodCompareMax > 0 ? (prevMonthTotal / periodCompareMax) * 100 : 0;
  const currentPeriodLineWidth = expensesTotal > 0 ? Math.max(currentPeriodWidth, 8) : 0;
  const previousPeriodLineWidth = prevMonthTotal > 0 ? Math.max(previousPeriodWidth, 8) : 0;
  const categoryData = useMemo(
    () => buildCategoryData(expenses).sort((a, b) => b.value - a.value),
    [expenses]
  );
  const categoryFilterOptions = useMemo(
    () => [...categoryData.map((point) => point.name)].sort((a, b) => a.localeCompare(b, "ru")),
    [categoryData]
  );
  const filteredCategoryData = useMemo(() => {
    if (categoryFilter === "all") return categoryData;
    return categoryData.filter((point) => point.name === categoryFilter);
  }, [categoryData, categoryFilter]);
  const categoryChartData = useMemo(
    () => [...filteredCategoryData].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ru")),
    [filteredCategoryData]
  );
  const categoryFilteredExpenses = useMemo(() => {
    if (categoryFilter === "all") return expenses;
    return expenses.filter((expense) => expense.category === categoryFilter);
  }, [categoryFilter, expenses]);
  const toggleCategoryFilter = (category: string) => {
    setCategoryFilter((prev) => (prev === category ? "all" : category));
  };
  const handleDashboardStartDateChange = (value: string) => {
    if (!value) {
      onStartDateChange(value);
      return;
    }

    if (endDate && value > endDate) {
      onEndDateChange(value);
    }

    onStartDateChange(value);
  };
  const handleDashboardEndDateChange = (value: string) => {
    if (!value) {
      onEndDateChange(value);
      return;
    }

    if (startDate && value < startDate) {
      onStartDateChange(value);
    }

    onEndDateChange(value);
  };
  const filteredCategoryTotal = useMemo(
    () => categoryChartData.reduce((sum, point) => sum + point.value, 0),
    [categoryChartData]
  );
  const prevCategoryTotalMap = useMemo(() => {
    const totals = new Map<string, number>();
    for (const point of prevPeriodCategoryTotals) {
      const category = String(point.category ?? "").trim();
      const total = Number(point.total ?? 0);
      if (!category || !Number.isFinite(total)) continue;
      totals.set(category, (totals.get(category) ?? 0) + total);
    }
    return totals;
  }, [prevPeriodCategoryTotals]);
  const categoryComparisonRows = useMemo(() => {
    const currentTotals = new Map<string, number>();
    for (const point of categoryData) {
      if (categoryFilter !== "all" && point.name !== categoryFilter) continue;
      currentTotals.set(point.name, point.value);
    }

    const allCategories =
      categoryFilter === "all"
        ? new Set<string>([
            ...currentTotals.keys(),
            ...prevCategoryTotalMap.keys(),
          ])
        : new Set<string>([categoryFilter]);

    return Array.from(allCategories)
      .map((category) => {
        const currentTotal = currentTotals.get(category) ?? 0;
        const previousTotal = prevCategoryTotalMap.get(category) ?? 0;
        const delta = currentTotal - previousTotal;
        const percent = previousTotal > 0 ? (delta / previousTotal) * 100 : null;

        return {
          category,
          currentTotal,
          previousTotal,
          delta,
          percent,
          sortValue: currentTotal + previousTotal,
        };
      })
      .filter((row) => row.currentTotal > 0 || row.previousTotal > 0)
      .sort((a, b) => b.sortValue - a.sortValue);
  }, [categoryData, categoryFilter, prevCategoryTotalMap]);
  const comparisonScopeLabel = useMemo(() => {
    const scope: string[] = [];

    if (selectedStore !== "all") {
      scope.push(`Магазин: ${selectedStore}`);
    }

    if (categoryFilter !== "all") {
      scope.push(`Категория: ${categoryFilter}`);
    }

    return scope.join(" • ");
  }, [categoryFilter, selectedStore]);
  const categoryComparisonChartData = useMemo(
    () =>
      categoryComparisonRows.map((row) => ({
        category: row.category,
        current: Number(row.currentTotal.toFixed(2)),
        previous: Number(row.previousTotal.toFixed(2)),
      })),
    [categoryComparisonRows]
  );
  const storeComparisonRows = useMemo(() => {
    if (!comparisonStoreA || !comparisonStoreB || comparisonStoreA === comparisonStoreB) {
      return [];
    }

    const currentTotals = new Map<string, number>();
    const previousTotals = new Map<string, number>();

    for (const expense of expenses) {
      if (categoryFilter !== "all" && expense.category !== categoryFilter) continue;

      if (expense.store === comparisonStoreA) {
        currentTotals.set(expense.category, (currentTotals.get(expense.category) ?? 0) + expense.price);
      }

      if (expense.store === comparisonStoreB) {
        previousTotals.set(expense.category, (previousTotals.get(expense.category) ?? 0) + expense.price);
      }
    }

    const allCategories = new Set<string>([
      ...currentTotals.keys(),
      ...previousTotals.keys(),
    ]);

    return Array.from(allCategories)
      .map((category) => {
        const currentTotal = currentTotals.get(category) ?? 0;
        const previousTotal = previousTotals.get(category) ?? 0;
        const delta = currentTotal - previousTotal;
        const percent = previousTotal > 0 ? (delta / previousTotal) * 100 : null;

        return {
          category,
          currentTotal,
          previousTotal,
          delta,
          percent,
          sortValue: currentTotal + previousTotal,
        };
      })
      .filter((row) => row.currentTotal > 0 || row.previousTotal > 0)
      .sort((a, b) => b.sortValue - a.sortValue);
  }, [categoryFilter, comparisonStoreA, comparisonStoreB, expenses]);
  const activeComparisonRows = comparisonMode === "stores" ? storeComparisonRows : categoryComparisonRows;
  const comparisonLeftLabel = comparisonMode === "stores" ? comparisonStoreA || "Магазин A" : currentPeriodLabel;
  const comparisonRightLabel = comparisonMode === "stores" ? comparisonStoreB || "Магазин B" : previousPeriodLabel;
  const comparisonTitle =
    comparisonMode === "stores" ? "Сравнение категорий по магазинам" : "Сравнение категорий по периодам";
  const comparisonStoresHint =
    "Чтобы сравнить два магазина, установите верхний фильтр магазина в «Все магазины», затем выберите Магазин A и Магазин B ниже.";
  const comparisonSubtitle = useMemo(() => {
    if (comparisonMode === "stores") {
      const parts = [`${comparisonLeftLabel} по сравнению с ${comparisonRightLabel}`, currentPeriodLabel];

      if (categoryFilter !== "all") {
        parts.push(`Категория: ${categoryFilter}`);
      }

      if (selectedStore !== "all") {
        parts.push("Для межмагазинного сравнения выберите сверху: Все магазины");
      }

      return parts.join(" • ");
    }

    return `${currentPeriodLabel} по сравнению с ${previousPeriodLabel}${comparisonScopeLabel ? ` • ${comparisonScopeLabel}` : ""}`;
  }, [
    categoryFilter,
    comparisonLeftLabel,
    comparisonMode,
    comparisonRightLabel,
    comparisonScopeLabel,
    currentPeriodLabel,
    previousPeriodLabel,
    selectedStore,
  ]);
  const comparisonEmptyMessage = useMemo(() => {
    if (comparisonMode !== "stores") {
      return "Нет данных для сравнения категорий за выбранные периоды.";
    }

    const availableStoreCount = new Set(
      expenses.map((expense) => String(expense.store ?? "").trim()).filter(Boolean)
    ).size;

    if (selectedStore !== "all") {
      return "Для сравнения магазинов переключите верхний фильтр магазина на «Все магазины».";
    }

    if (availableStoreCount < 2) {
      return "Недостаточно магазинов в выбранном периоде для сравнения.";
    }

    if (!comparisonStoreA || !comparisonStoreB) {
      return "Выберите два магазина для сравнения.";
    }

    if (comparisonStoreA === comparisonStoreB) {
      return "Выберите два разных магазина.";
    }

    return "Нет данных для сравнения выбранных магазинов за текущий период.";
  }, [comparisonMode, comparisonStoreA, comparisonStoreB, expenses, selectedStore]);
  const activeComparisonChartData = useMemo(
    () =>
      activeComparisonRows.map((row) => ({
        category: row.category,
        current: Number(row.currentTotal.toFixed(2)),
        previous: Number(row.previousTotal.toFixed(2)),
      })),
    [activeComparisonRows]
  );
  useEffect(() => {
    if (categoryFilter !== "all" && !categoryFilterOptions.includes(categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, categoryFilterOptions]);
  useEffect(() => {
    setShowAllCategories(false);
  }, [categoryFilter, selectedStore, startDate, endDate]);
  const dailyData = useMemo(
    () => buildDailyData(categoryFilteredExpenses, startDate, endDate),
    [categoryFilteredExpenses, endDate, startDate]
  );
  const storeOptions = useMemo(() => {
    const baseStores = [...new Set(stores.map((store) => String(store ?? "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "ru")
    );

    if (selectedStore !== "all" && !baseStores.includes(selectedStore)) {
      return [...baseStores, selectedStore].sort((a, b) => a.localeCompare(b, "ru"));
    }

    return baseStores;
  }, [selectedStore, stores]);
  const storeComparisonOptions = useMemo(
    () =>
      [...new Set(expenses.map((expense) => String(expense.store ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ru")
      ),
    [expenses]
  );
  const ledgerStoreOptions = useMemo(
    () =>
      [...new Set(categoryFilteredExpenses.map((expense) => String(expense.store ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ru")
      ),
    [categoryFilteredExpenses]
  );
  useEffect(() => {
    if (storeComparisonOptions.length === 0) {
      if (comparisonStoreA !== "") setComparisonStoreA("");
      return;
    }

    if (!storeComparisonOptions.includes(comparisonStoreA)) {
      setComparisonStoreA(storeComparisonOptions[0] ?? "");
    }
  }, [comparisonStoreA, storeComparisonOptions]);
  useEffect(() => {
    if (storeComparisonOptions.length < 2) {
      if (comparisonStoreB !== "") setComparisonStoreB("");
      return;
    }

    if (!storeComparisonOptions.includes(comparisonStoreB)) {
      const fallback = storeComparisonOptions.find((store) => store !== comparisonStoreA) ?? "";
      setComparisonStoreB(fallback);
    }
  }, [comparisonStoreA, comparisonStoreB, storeComparisonOptions]);
  useEffect(() => {
    if (ledgerStoreFilter !== "all" && !ledgerStoreOptions.includes(ledgerStoreFilter)) {
      setLedgerStoreFilter("all");
    }
  }, [ledgerStoreFilter, ledgerStoreOptions]);
  useEffect(() => {
    setExpandedLedgerReceipts([]);
  }, [categoryFilter, endDate, ledgerSortDirection, ledgerSortField, ledgerStoreFilter, selectedStore, startDate]);
  const activeStore = selectedStore === "all" ? "all" : selectedStore;
  const transactionCount = useMemo(
    () => new Set(expenses.map((expense) => expense.receiptId)).size,
    [expenses]
  );
  const averageTransactionValue = transactionCount > 0
    ? expensesTotal / transactionCount
    : 0;
  const activeDays = useMemo(
    () => dailyData.filter((point) => point.amount > 0).length,
    [dailyData]
  );
  const strongestDay = useMemo(
    () =>
      dailyData.reduce<DailyPoint | null>(
        (best, point) => (point.amount > (best?.amount ?? 0) ? point : best),
        null
      ),
    [dailyData]
  );
  const topCategory = categoryData[0] ?? null;
  const topCategories = useMemo(() => {
    if (expensesTotal <= 0) {
      return categoryData.slice(0, 4).map((entry) => ({ ...entry, share: 0 }));
    }

    return categoryData
      .slice(0, 4)
      .map((entry) => ({ ...entry, share: (entry.value / expensesTotal) * 100 }));
  }, [categoryData, expensesTotal]);
  const categoryListItems = useMemo(() => {
    if (filteredCategoryTotal <= 0) {
      return categoryChartData.map((entry) => ({ ...entry, share: 0 }));
    }

    return categoryChartData.map((entry) => ({
      ...entry,
      share: (entry.value / filteredCategoryTotal) * 100,
    }));
  }, [categoryChartData, filteredCategoryTotal]);
  const ledgerDetailExpenses = useMemo(() => {
    if (ledgerStoreFilter === "all") return categoryFilteredExpenses;
    return categoryFilteredExpenses.filter((expense) => expense.store === ledgerStoreFilter);
  }, [categoryFilteredExpenses, ledgerStoreFilter]);
  const sortLedgerExpenses = (items: Expense[]) => {
    return [...items].sort((a, b) => {
      if (ledgerSortField === "date") {
        if (ledgerSortDirection === "asc") {
          return a.date.localeCompare(b.date) || a.price - b.price || a.id - b.id;
        }

        return b.date.localeCompare(a.date) || b.price - a.price || b.id - a.id;
      }

      if (ledgerSortDirection === "asc") {
        return a.price - b.price || b.date.localeCompare(a.date) || b.id - a.id;
      }

      return b.price - a.price || b.date.localeCompare(a.date) || b.id - a.id;
    });
  };
  const sortedLedgerExpenses = useMemo(
    () => sortLedgerExpenses(ledgerDetailExpenses),
    [ledgerDetailExpenses, ledgerSortDirection, ledgerSortField]
  );
  const ledgerReceiptGroups = useMemo(() => {
    const groups = new Map<number, LedgerReceiptGroup>();

    for (const expense of ledgerDetailExpenses) {
      const existing = groups.get(expense.receiptId);
      if (existing) {
        existing.items.push(expense);
        existing.total += expense.price;
        continue;
      }

      groups.set(expense.receiptId, {
        receiptId: expense.receiptId,
        date: expense.date,
        store: expense.store,
        items: [expense],
        total: expense.price,
        categories: [],
      });
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => b.price - a.price || a.item.localeCompare(b.item, "ru") || a.id - b.id),
      categories: [...new Set(group.items.map((item) => String(item.category ?? "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ru")
      ),
      total: Number(group.total.toFixed(2)),
    }));
  }, [ledgerDetailExpenses]);
  const sortLedgerReceipts = (items: LedgerReceiptGroup[]) => {
    return [...items].sort((a, b) => {
      if (ledgerSortField === "date") {
        if (ledgerSortDirection === "asc") {
          return a.date.localeCompare(b.date) || a.total - b.total || a.receiptId - b.receiptId;
        }

        return b.date.localeCompare(a.date) || b.total - a.total || b.receiptId - a.receiptId;
      }

      if (ledgerSortDirection === "asc") {
        return a.total - b.total || b.date.localeCompare(a.date) || b.receiptId - a.receiptId;
      }

      return b.total - a.total || b.date.localeCompare(a.date) || b.receiptId - a.receiptId;
    });
  };
  const sortedLedgerReceipts = useMemo(
    () => sortLedgerReceipts(ledgerReceiptGroups),
    [ledgerReceiptGroups, ledgerSortDirection, ledgerSortField]
  );
  const recentExpenses = useMemo(
    () => sortLedgerExpenses(categoryFilteredExpenses).slice(0, 5),
    [categoryFilteredExpenses, ledgerSortDirection, ledgerSortField]
  );
  const formatCurrency = (value: number) => `${value.toFixed(2)} EUR`;
  const strongestDayDateLabel = strongestDay ? formatDashboardDate(strongestDay.date) : "Нет данных";
  const strongestDayAmountLabel = strongestDay ? formatCurrency(strongestDay.amount) : "Ждем данные";
  const deltaLabel =
    prevMonthTotal > 0
      ? `${amountChange >= 0 ? "+" : "-"}${Math.abs(amountChange).toFixed(2)} EUR`
      : "Нет данных за прошлый период";

  const dashboardMonthLabel = useMemo(() => {
    const parsed = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return currentPeriodLabel;

    const formatted = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(parsed);

    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  }, [currentPeriodLabel, endDate]);
  const activityChartData = useMemo(() => {
    return dailyData.slice(-ACTIVITY_CHART_DAYS);
  }, [dailyData]);
  const activityChartYAxisTicks = useMemo(
    () => buildAxisTicks(Math.max(...activityChartData.map((point) => point.amount), 0), DAILY_CHART_STEP_EUR),
    [activityChartData]
  );
  const activityChartYAxisDomain: [number, number] = [
    0,
    activityChartYAxisTicks[activityChartYAxisTicks.length - 1] ?? DAILY_CHART_STEP_EUR,
  ];
  const desktopDailyChartYAxisTicks = useMemo(
    () => buildAxisTicks(Math.max(...dailyData.map((point) => point.amount), 0), DAILY_CHART_STEP_EUR),
    [dailyData]
  );
  const desktopDailyChartYAxisDomain: [number, number] = [
    0,
    desktopDailyChartYAxisTicks[desktopDailyChartYAxisTicks.length - 1] ?? DAILY_CHART_STEP_EUR,
  ];
  const activeStoreLabel = activeStore === "all" ? "Все магазины" : activeStore;
  const ledgerStoreFilterLabel = ledgerStoreFilter === "all" ? "Все магазины" : ledgerStoreFilter;
  const activeCategoryLabel = categoryFilter === "all" ? "Все категории" : categoryFilter;
  const visibleCategoryItems = showAllCategories ? categoryListItems : categoryListItems.slice(0, 4);
  const visibleLedgerReceipts = sortedLedgerReceipts;
  const receiptFirstExpenseId = useMemo(() => {
    const first = new Map<number, number>();
    for (const exp of ledgerDetailExpenses) {
      if (!first.has(exp.receiptId)) {
        first.set(exp.receiptId, exp.id);
      }
    }
    return first;
  }, [ledgerDetailExpenses]);
  const toggleLedgerReceipt = (receiptId: number) => {
    setExpandedLedgerReceipts((prev) =>
      prev.includes(receiptId) ? prev.filter((id) => id !== receiptId) : [...prev, receiptId]
    );
  };

  const currentEditorTotal = useMemo(() => {
    if (!editorReceipt) return 0;
    return sanitizeItems(editorReceipt.items).reduce((sum, item) => sum + Number(item.price || 0), 0);
  }, [editorReceipt]);
  const showReadOnlyNotice = () => {
    window.alert(readOnlyNotice);
  };

  const comparisonSummary = useMemo(() => {
    if (!editorReceipt || !comparisonData) return null;
    return buildComparisonSummary(editorReceipt, comparisonData);
  }, [editorReceipt, comparisonData]);

  const openEditor = async (receiptId: number) => {
    if (isReadOnly) {
      showReadOnlyNotice();
      return;
    }

    setIsEditorOpen(true);
    setIsEditorLoading(true);
    setEditorError(null);
    setComparisonImage(null);
    setComparisonData(null);

    try {
      const receipt = await getReceipt(receiptId);
      setEditorReceipt({
        id: receipt.id,
        store_name: receipt.store_name,
        purchase_date: receipt.purchase_date,
        items: sanitizeItems(receipt.items),
        comment: receipt.comment ?? "",
        source: receipt.source ?? null,
        telegram_file_id: receipt.telegram_file_id ?? null,
      });
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось загрузить чек");
      setEditorReceipt(null);
    } finally {
      setIsEditorLoading(false);
    }
  };

  const formatDateTime = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  };

  const closeEditor = () => {
    if (isEditorSaving || isEditorDeleting || isComparing) return;
    setIsEditorOpen(false);
    setIsEditorLoading(false);
    setIsEditorDeleting(false);
    setEditorError(null);
    setEditorReceipt(null);
    setComparisonImage(null);
    setComparisonData(null);
  };

  const handleDeleteReceipt = async (receiptId: number, options?: { fromEditor?: boolean }) => {
    const fromEditor = options?.fromEditor ?? false;
    if (!window.confirm(`Удалить чек #${receiptId}? Это действие нельзя отменить.`)) {
      return;
    }

    if (fromEditor) {
      setEditorError(null);
      setIsEditorDeleting(true);
    }

    try {
      await deleteReceipt(receiptId);

      if (fromEditor) {
        setIsEditorOpen(false);
        setIsEditorLoading(false);
        setEditorReceipt(null);
        setComparisonImage(null);
        setComparisonData(null);
      }

      await onRefresh?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось удалить чек";
      if (fromEditor) {
        setEditorError(message);
      } else {
        window.alert(message);
      }
    } finally {
      if (fromEditor) {
        setIsEditorDeleting(false);
      }
    }
  };

  const updateEditorItem = (index: number, field: keyof ReceiptItem, value: string | number) => {
    setEditorReceipt((prev) => {
      if (!prev) return prev;
      const nextItems = [...prev.items];
      nextItems[index] = { ...nextItems[index], [field]: value };
      return { ...prev, items: nextItems };
    });
  };

  const deleteEditorItem = (index: number) => {
    setEditorReceipt((prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.filter((_, i) => i !== index) };
    });
  };

  const addEditorItem = () => {
    setEditorReceipt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: [...prev.items, { name: "", price: 0, category: "Другое" }],
      };
    });
  };

  const handleCompareFile = async (file: File) => {
    if (!editorReceipt) return;

    setEditorError(null);
    setIsComparing(true);

    try {
      const optimizedImage = await optimizeImageForUpload(file);
      setComparisonImage(optimizedImage);
      const analyzed = await analyzeReceipt(optimizedImage);
      setComparisonData(analyzed);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сравнить с фото");
    } finally {
      setIsComparing(false);
    }
  };

  const handleCompareTelegramImage = async () => {
    if (!editorReceipt || !editorReceipt.telegram_file_id) return;

    setEditorError(null);
    setIsComparing(true);

    try {
      const imageDataUrl = await getReceiptImageFromTelegram(editorReceipt.id);
      setComparisonImage(imageDataUrl);
      const analyzed = await analyzeReceipt(imageDataUrl);
      setComparisonData(analyzed);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сравнить с фото из Telegram");
    } finally {
      setIsComparing(false);
    }
  };

  const handleApplyComparison = () => {
    if (!editorReceipt || !comparisonData) return;

    setEditorReceipt({
      ...editorReceipt,
      store_name: (comparisonData.store_name ?? "").trim(),
      purchase_date: comparisonData.purchase_date ?? "",
      items: sanitizeItems(comparisonData.items ?? []),
    });
  };

  const handleSaveEditor = async () => {
    if (!editorReceipt) return;

    const preparedItems = sanitizeItems(editorReceipt.items);
    if (!editorReceipt.store_name.trim()) {
      setEditorError("Укажите магазин");
      return;
    }

    if (!editorReceipt.purchase_date) {
      setEditorError("Укажите дату покупки");
      return;
    }

    if (preparedItems.length === 0) {
      setEditorError("Добавьте хотя бы одну позицию");
      return;
    }

    setEditorError(null);
    setIsEditorSaving(true);

    try {
      await updateReceipt(editorReceipt.id, {
        store_name: editorReceipt.store_name.trim(),
        purchase_date: editorReceipt.purchase_date,
        items: preparedItems,
        comment: editorReceipt.comment.trim(),
      });

      closeEditor();
      onRefresh?.();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setIsEditorSaving(false);
    }
  };

  const renderDailyTooltip = ({ active, label, payload }: DailyTooltipContentProps) => {
    if (!active || !payload?.length) return null;

    const point = payload[0]?.payload;
    if (!point) return null;

    const count = point.receiptCount ?? 0;
    const receiptLabel = count === 1 ? "чек" : count >= 2 && count <= 4 ? "чека" : "чеков";
    const visibleSegments = point.receiptSegments;
    const hiddenSegments: DailyReceiptSegment[] = [];
    const hiddenCount = hiddenSegments.length;
    const hiddenTotal = hiddenSegments.reduce((sum, segment) => sum + segment.amount, 0);

    return (
      <div
        style={{
          background: "#1a1a24",
          border: "1px solid #27272a",
          borderRadius: 10,
          padding: "10px 12px",
          minWidth: 220,
          maxWidth: 280,
          boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ color: "#e4e4e7", fontWeight: 600, marginBottom: 6 }}>
          {formatDashboardDate(String(label ?? point.date))}
        </div>
        <div style={{ color: "#fafafa", fontWeight: 700, marginBottom: 2 }}>{point.amount.toFixed(2)} €</div>
        <div style={{ color: "#a1a1aa", fontSize: 12, marginBottom: point.receiptSegments.length ? 8 : 0 }}>
          {count} {receiptLabel}
        </div>

        {visibleSegments.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {visibleSegments.map((segment, index) => (
              <div
                key={`tooltip-segment-${point.date}-${segment.receiptId}`}
                style={{ display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 8, alignItems: "center" }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: getReceiptSegmentColor(segment, index),
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.12) inset",
                  }}
                />
                <span style={{ color: "#d4d4d8", fontSize: 12, lineHeight: 1.2 }}>
                  {segment.store || "Без магазина"} #{segment.receiptId}
                </span>
                <span style={{ color: "#f4f4f5", fontSize: 12, fontWeight: 600 }}>{segment.amount.toFixed(2)} €</span>
              </div>
            ))}

            {hiddenCount > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "10px 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  marginTop: 2,
                  paddingTop: 6,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.18)",
                  }}
                />
                <span style={{ color: "#a1a1aa", fontSize: 12, lineHeight: 1.2 }}>
                  И ещё {hiddenCount} {hiddenCount === 1 ? "чек" : hiddenCount >= 2 && hiddenCount <= 4 ? "чека" : "чеков"}
                </span>
                <span style={{ color: "#d4d4d8", fontSize: 12, fontWeight: 600 }}>{hiddenTotal.toFixed(2)} €</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDailyBar = ({ x, y, width, height, payload }: DailyBarShapeProps) => {
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !payload
    ) {
      return null;
    }

    const isActive = payload.date === activeBarDate;
    const segments = payload.receiptSegments ?? [];
    const canSplit = isActive && segments.length > 1 && payload.amount > 0;
    const inset = Math.max(1, Math.min(2, width / 8));

    let bottom = y + height;
    let cumulative = 0;

    return (
      <g>
        <rect x={x} y={y} width={width} height={height} rx={4} ry={4} fill={isActive ? "#4f46e5" : "#6366f1"} />

        {canSplit &&
          segments.map((segment, index) => {
            const segmentHeight = Math.max(1, (segment.amount / payload.amount) * height);
            const segmentBottom = bottom;
            const segmentTop = Math.max(y, segmentBottom - segmentHeight);
            bottom = segmentTop;

            return (
              <rect
                key={`segment-fill-${payload.date}-${index}`}
                x={x + inset}
                y={segmentTop}
                width={Math.max(0, width - inset * 2)}
                height={Math.max(0, segmentBottom - segmentTop)}
                fill={getReceiptSegmentColor(segment, index)}
                fillOpacity={0.9}
              />
            );
          })}

        {canSplit &&
          segments.slice(0, -1).map((segment, index) => {
            cumulative += segment.amount;
            const boundaryY = y + height - (cumulative / payload.amount) * height;

            return (
              <line
                key={`segment-line-${payload.date}-${index}`}
                x1={x + inset}
                x2={x + width - inset}
                y1={boundaryY}
                y2={boundaryY}
                stroke="rgba(255,255,255,0.55)"
                strokeWidth={1.25}
              />
            );
          })}
      </g>
    );
  };

  const handleExportExcel = () => {
    if (isReadOnly) {
      showReadOnlyNotice();
      return;
    }

    const xml = buildExpensesExcelXml({
      startDate,
      endDate,
      selectedStore: activeStore,
      expenses,
    });

    const blob = new Blob([`\uFEFF${xml}`], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const storePart = activeStore === "all" ? "all-stores" : activeStore.replace(/[^\w\-]+/g, "_");
    link.href = url;
    link.download = `expenses_${startDate}_${endDate}_${storePart}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="dashboard-surface dashboard-mobile-shell">
      <div className="dashboard-mobile-frame">
        <header className="dashboard-mobile-topbar">
          <div>
            <div className="dashboard-mobile-kicker">{dashboardMonthLabel}</div>
            <h2>Трекер Расходов</h2>
          </div>
          <div className="dashboard-mobile-topbar-actions">
            {onOpenScan ? (
              <button type="button" className="dashboard-desktop-top-action" onClick={onOpenScan}>
                Сканировать
              </button>
            ) : null}
            <div className="dashboard-mobile-avatar" aria-hidden="true">
              ТР
            </div>
          </div>
        </header>

        <section className="dashboard-mobile-controls">
          <div className="dashboard-mobile-date-row">
            <div className="dashboard-mobile-date-card">
              <label htmlFor="dashboard-start-date">Начало периода</label>
              <input
                id="dashboard-start-date"
                type="date"
                aria-label="Начало периода"
                name="dashboardStartDate"
                value={startDate}
                onChange={(e) => handleDashboardStartDateChange(e.target.value)}
              />
            </div>
            <div className="dashboard-mobile-date-card">
              <label htmlFor="dashboard-end-date">Конец периода</label>
              <input
                id="dashboard-end-date"
                type="date"
                aria-label="Конец периода"
                name="dashboardEndDate"
                value={endDate}
                onChange={(e) => handleDashboardEndDateChange(e.target.value)}
              />
            </div>
          </div>

          <div className="dashboard-mobile-filter-card">
            <label htmlFor="dashboard-store-select">Магазин</label>
            <select
              id="dashboard-store-select"
              className="dashboard-mobile-select"
              aria-label="Магазин"
              name="dashboardStore"
              value={activeStore}
              onChange={(e) => onStoreChange(e.target.value)}
            >
              <option value="all">Все магазины</option>
              {storeOptions.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="dashboard-mobile-summary">
          <div className="dashboard-mobile-summary-main">
            <div className="dashboard-mobile-summary-head">
              <span>Общие расходы</span>
              <strong>{expensesTotal.toFixed(2)} €</strong>
              <p>
                {currentPeriodLabel} • {activeStoreLabel}
              </p>
            </div>

            <div className="dashboard-mobile-summary-pills">
              <div className="dashboard-mobile-summary-pill">
                <span>Чеки</span>
                <strong>{transactionCount}</strong>
              </div>
              <div className="dashboard-mobile-summary-pill">
                <span>Средний чек</span>
                <strong>{averageTransactionValue.toFixed(2)} €</strong>
              </div>
              <div className="dashboard-mobile-summary-pill">
                <span>Активных дней</span>
                <strong>{activeDays}</strong>
              </div>
            </div>

            <div className="dashboard-mobile-summary-compare" aria-hidden="true">
              <div className="dashboard-mobile-summary-row">
                <span>Текущий</span>
                <div className="dashboard-mobile-summary-track">
                  <div className="dashboard-mobile-summary-fill current" style={{ width: `${currentPeriodLineWidth}%` }} />
                </div>
                <strong>{expensesTotal.toFixed(2)} €</strong>
              </div>
              <div className="dashboard-mobile-summary-row">
                <span>Прошлый</span>
                <div className="dashboard-mobile-summary-track">
                  <div className="dashboard-mobile-summary-fill previous" style={{ width: `${previousPeriodLineWidth}%` }} />
                </div>
                <strong>{prevMonthTotal.toFixed(2)} €</strong>
              </div>
            </div>
          </div>

          <div className="dashboard-mobile-summary-side">
            <div className="dashboard-mobile-summary-foot">
              <span>{deltaLabel}</span>
              <span>{strongestDay ? `Пиковый день: ${strongestDayDateLabel}` : "Пиковый день еще не определен"}</span>
            </div>

            <div className="dashboard-mobile-summary-actions">
              <button type="button" className="dashboard-mobile-action-btn" onClick={onRefresh} disabled={isLoading}>
                {isLoading ? "Обновляем..." : "Обновить"}
              </button>
              <button
                type="button"
                className="dashboard-mobile-action-btn ghost"
                onClick={handleExportExcel}
                disabled={isReadOnly || isLoading || expenses.length === 0}
              >
                Экспорт
              </button>
            </div>
          </div>
        </section>

        {expenses.length > 0 ? (
          <>
            <section className="dashboard-mobile-panels">
              <article className="dashboard-mobile-panel">
                <div className="dashboard-mobile-panel-head">
                  <div className="dashboard-mobile-panel-head-main">
                    <span className="dashboard-mobile-panel-kicker">Категории</span>
                    <h3>Структура трат</h3>
                  </div>
                  <div className="dashboard-mobile-panel-actions">
                    {categoryListItems.length > 4 && (
                      <button
                        type="button"
                        className="dashboard-mobile-link-btn"
                        onClick={() => setShowAllCategories((prev) => !prev)}
                      >
                        {showAllCategories ? "Свернуть" : "Показать все"}
                      </button>
                    )}
                  <select
                    className="dashboard-mobile-inline-select"
                    aria-label="Фильтр категории"
                    name="dashboardCategory"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">Все</option>
                    {categoryFilterOptions.map((category) => (
                      <option key={`mobile-category-filter-${category}`} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  </div>
                </div>

                {categoryChartData.length > 0 ? (
                  <>
                    <div className="dashboard-mobile-donut-wrap">
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={categoryChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={54}
                            outerRadius={84}
                            paddingAngle={3}
                            dataKey="value"
                            label={false}
                            labelLine={false}
                          >
                            {categoryChartData.map((entry, index) => (
                              <Cell
                                key={`mobile-cell-${entry.name}`}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                                onClick={() => toggleCategoryFilter(entry.name)}
                                style={{ cursor: "pointer" }}
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value) => `${Number(value).toFixed(2)} €`} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="dashboard-mobile-donut-center">
                        <span>{activeCategoryLabel}</span>
                        <strong>{filteredCategoryTotal.toFixed(0)} €</strong>
                      </div>
                    </div>

                    <div
                      className={`dashboard-mobile-category-list ${
                        showAllCategories ? "is-scrollable" : ""
                      }`}
                    >
                      {visibleCategoryItems.map((entry, index) => {
                        const isActiveCategory = categoryFilter === entry.name;

                        return (
                          <button
                            key={`mobile-top-${entry.name}`}
                            type="button"
                            className={`dashboard-mobile-category-btn ${isActiveCategory ? "active" : ""}`}
                            onClick={() => toggleCategoryFilter(entry.name)}
                          >
                            <span
                              className="dashboard-mobile-category-dot"
                              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                            />
                            <div>
                              <strong>{entry.name}</strong>
                              <span>{entry.share.toFixed(0)}%</span>
                            </div>
                            <b>{entry.value.toFixed(2)} €</b>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="dashboard-mobile-empty-card">Нет расходов по выбранной категории.</div>
                )}
              </article>

              <article className="dashboard-mobile-panel">
                <div className="dashboard-mobile-panel-head">
                  <div>
                    <span className="dashboard-mobile-panel-kicker">Активность</span>
                    <h3>Динамика по дням</h3>
                  </div>
                  <div className="dashboard-mobile-segmented" style={{ display: "none" }}>
                    {([
                      { value: 5, label: "5" },
                      { value: 10, label: "10" },
                      { value: "all", label: "Все" },
                    ] as const).map((option) => {
                      const isActive = tooltipReceiptLimit === option.value;

                      return (
                        <button
                          key={String(option.value)}
                          type="button"
                          className={`dashboard-mobile-segmented-btn ${isActive ? "active" : ""}`}
                          onClick={() => setTooltipReceiptLimit(option.value)}
                          aria-pressed={isActive}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activityChartData.some((point) => point.amount > 0) ? (
                  <>
                    <ResponsiveContainer width="100%" height={210}>
                      <BarChart
                        data={activityChartData}
                        onMouseMove={(state) => {
                          const nextLabel = state && typeof state.activeLabel === "string" ? state.activeLabel : null;
                          setActiveBarDate(nextLabel);
                        }}
                        onMouseLeave={() => setActiveBarDate(null)}
                      >
                        <XAxis
                          dataKey="date"
                          tickFormatter={(value) => formatDashboardDate(String(value)).slice(0, 5)}
                          tick={{ fill: "#94a3b8", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          width={44}
                          domain={activityChartYAxisDomain}
                          ticks={activityChartYAxisTicks}
                          tickFormatter={(value) => `${Number(value).toFixed(0)}€`}
                          tick={{ fill: "#94a3b8", fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={(props) => renderDailyTooltip(props as DailyTooltipContentProps)} />
                        <Bar dataKey="amount" fill="#7c3aed" radius={[8, 8, 0, 0]} shape={renderDailyBar} />
                      </BarChart>
                    </ResponsiveContainer>

                    <div className="dashboard-mobile-activity-meta">
                      <div>
                        <span>Пиковый день</span>
                        <strong>{strongestDayDateLabel}</strong>
                      </div>
                      <div>
                        <span>Лидер</span>
                        <strong>{topCategory?.name ?? "Без данных"}</strong>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="dashboard-mobile-empty-card">За выбранный период активность пока не появилась.</div>
                )}
              </article>
            </section>

            <section className="dashboard-mobile-panel dashboard-mobile-compare">
              <div className="dashboard-mobile-compare-head">
                <div className="dashboard-mobile-panel-head-main">
                  <span className="dashboard-mobile-panel-kicker">Сравнение категорий</span>
                  <h3>{comparisonTitle}</h3>
                </div>
                <button
                  type="button"
                  className="dashboard-mobile-link-btn dashboard-mobile-compare-toggle"
                  onClick={() => setIsCategoryComparisonOpen((prev) => !prev)}
                  aria-expanded={isCategoryComparisonOpen}
                  aria-controls="dashboard-category-comparison-content"
                >
                  {isCategoryComparisonOpen ? "Свернуть" : "Показать"}
                </button>
              </div>

              <p className="dashboard-mobile-compare-subtitle">
                {comparisonSubtitle}
              </p>

              {isCategoryComparisonOpen ? (
                <div id="dashboard-category-comparison-content">
                  <div className="dashboard-mobile-compare-content">
                    <div className="dashboard-mobile-segmented" aria-label="Режим сравнения категорий">
                      <button
                        type="button"
                        className={`dashboard-mobile-segmented-btn ${comparisonMode === "periods" ? "active" : ""}`}
                        onClick={() => setComparisonMode("periods")}
                        aria-pressed={comparisonMode === "periods"}
                      >
                        Периоды
                      </button>
                      <button
                        type="button"
                        className={`dashboard-mobile-segmented-btn ${comparisonMode === "stores" ? "active" : ""}`}
                        onClick={() => setComparisonMode("stores")}
                        aria-pressed={comparisonMode === "stores"}
                      >
                        Магазины
                      </button>
                    </div>

                    {comparisonMode === "stores" ? (
                      <div className="dashboard-mobile-compare-filters">
                        <div className="dashboard-mobile-filter-card">
                          <label htmlFor="dashboard-compare-store-a">Магазин A</label>
                          <select
                            id="dashboard-compare-store-a"
                            className="dashboard-mobile-select"
                            aria-label="Магазин A"
                            value={comparisonStoreA}
                            onChange={(e) => setComparisonStoreA(e.target.value)}
                          >
                            {storeComparisonOptions.map((store) => (
                              <option key={`compare-a-${store}`} value={store}>
                                {store}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="dashboard-mobile-filter-card">
                          <label htmlFor="dashboard-compare-store-b">Магазин B</label>
                          <select
                            id="dashboard-compare-store-b"
                            className="dashboard-mobile-select"
                            aria-label="Магазин B"
                            value={comparisonStoreB}
                            onChange={(e) => setComparisonStoreB(e.target.value)}
                          >
                            {storeComparisonOptions.map((store) => (
                              <option key={`compare-b-${store}`} value={store}>
                                {store}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p className="dashboard-mobile-compare-note">{comparisonStoresHint}</p>
                      </div>
                    ) : null}

                    {activeComparisonRows.length > 0 ? (
                      <>
                      <div className="dashboard-mobile-segmented" aria-label="Формат сравнения категорий">
                        <button
                          type="button"
                          className={`dashboard-mobile-segmented-btn ${comparisonView === "lines" ? "active" : ""}`}
                          onClick={() => setComparisonView("lines")}
                          aria-pressed={comparisonView === "lines"}
                        >
                          Линии
                        </button>
                        <button
                          type="button"
                          className={`dashboard-mobile-segmented-btn ${comparisonView === "table" ? "active" : ""}`}
                          onClick={() => setComparisonView("table")}
                          aria-pressed={comparisonView === "table"}
                        >
                          Таблица
                        </button>
                      </div>

                      {comparisonView === "lines" ? (
                        <div className="dashboard-mobile-compare-chart">
                          <div className="dashboard-mobile-compare-legend">
                            <span>
                              <i className="current" aria-hidden="true" />
                              {comparisonLeftLabel}
                            </span>
                            <span>
                              <i className="previous" aria-hidden="true" />
                              {comparisonRightLabel}
                            </span>
                          </div>
                          <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={activeComparisonChartData} margin={{ top: 12, right: 12, left: 0, bottom: 6 }}>
                              <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
                              <XAxis
                                dataKey="category"
                                tickFormatter={(value) => truncateLabel(String(value), 12)}
                                tick={{ fill: "#8f98aa", fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis
                                tick={{ fill: "#8f98aa", fontSize: 11 }}
                                axisLine={false}
                                tickLine={false}
                                width={52}
                                tickFormatter={(value) => `${Number(value).toFixed(0)}€`}
                              />
                              <Tooltip
                                formatter={(value) => `${Number(value).toFixed(2)} €`}
                                labelFormatter={(label) => `Категория: ${label}`}
                                contentStyle={{
                                  background: "#12151f",
                                  border: "1px solid rgba(148, 163, 184, 0.16)",
                                  borderRadius: 12,
                                  color: "#f8fafc",
                                }}
                              />
                              <Line
                                type="monotone"
                                dataKey="current"
                                stroke="#a855f7"
                                strokeWidth={3}
                                dot={{ r: 4, fill: "#a855f7", strokeWidth: 0 }}
                                activeDot={{ r: 5 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="previous"
                                stroke="#f8fafc"
                                strokeOpacity={0.75}
                                strokeWidth={2.4}
                                dot={{ r: 3.5, fill: "#f8fafc", strokeWidth: 0 }}
                                activeDot={{ r: 5 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="dashboard-mobile-compare-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Категория</th>
                                <th style={{ textAlign: "right" }}>{comparisonLeftLabel}</th>
                                <th style={{ textAlign: "right" }}>{comparisonRightLabel}</th>
                                <th style={{ textAlign: "right" }}>Δ</th>
                                <th style={{ textAlign: "right" }}>Δ%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {activeComparisonRows.map((row) => (
                                <tr key={`dashboard-mobile-compare-${row.category}`}>
                                  <td>{row.category}</td>
                                  <td style={{ textAlign: "right" }}>{row.currentTotal.toFixed(2)} €</td>
                                  <td style={{ textAlign: "right" }}>{row.previousTotal.toFixed(2)} €</td>
                                  <td
                                    style={{ textAlign: "right" }}
                                    className={row.delta > 0 ? "compare-negative" : row.delta < 0 ? "compare-positive" : "compare-neutral"}
                                  >
                                    {row.delta > 0 ? "↑ " : row.delta < 0 ? "↓ " : ""}
                                    {Math.abs(row.delta).toFixed(2)} €
                                  </td>
                                  <td
                                    style={{ textAlign: "right" }}
                                    className={row.delta > 0 ? "compare-negative" : row.delta < 0 ? "compare-positive" : "compare-neutral"}
                                  >
                                    {row.percent === null ? "—" : `${row.percent > 0 ? "+" : ""}${row.percent.toFixed(1)}%`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      </>
                    ) : (
                      <div className="dashboard-mobile-empty-card">{comparisonEmptyMessage}</div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="dashboard-mobile-ledger">
              <div className="dashboard-mobile-panel-head">
                <div className="dashboard-mobile-panel-head-main">
                  <span className="dashboard-mobile-panel-kicker">Детализация расходов</span>
                  <h3>Последние покупки</h3>
                </div>
                <span className="dashboard-mobile-panel-note">
                  {visibleLedgerReceipts.length} {formatCountNoun(visibleLedgerReceipts.length, "чек", "чека", "чеков")}
                </span>
              </div>

              {false && (
                <div className="dashboard-mobile-ledger-actions">
                  <button
                    type="button"
                    className="dashboard-mobile-link-btn"
                    onClick={() => setShowAllLedger((prev) => !prev)}
                  >
                    {showAllLedger ? "Свернуть" : "Показать все"}
                  </button>
                </div>
              )}

              <div className="dashboard-mobile-ledger-actions">
                <div className="dashboard-mobile-ledger-filter">
                  <select
                    className="dashboard-mobile-select"
                    aria-label="Фильтр детализации по магазину"
                    value={ledgerStoreFilter}
                    onChange={(e) => setLedgerStoreFilter(e.target.value)}
                  >
                    <option value="all">Все магазины</option>
                    {ledgerStoreOptions.map((store) => (
                      <option key={`ledger-store-${store}`} value={store}>
                        {store}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-mobile-sort-group" aria-label="Параметры сортировки покупок">
                  <button
                    type="button"
                    className={`dashboard-mobile-sort-mode ${
                      ledgerSortField === "price" ? "active" : ""
                    }`}
                    aria-label="Сортировать по сумме"
                    title="Сортировать по сумме"
                    aria-pressed={ledgerSortField === "price"}
                    onClick={() => setLedgerSortField("price")}
                  >
                    €
                  </button>
                  <button
                    type="button"
                    className={`dashboard-mobile-sort-mode ${
                      ledgerSortField === "date" ? "active" : ""
                    }`}
                    aria-label="Сортировать по дате"
                    title="Сортировать по дате"
                    aria-pressed={ledgerSortField === "date"}
                    onClick={() => setLedgerSortField("date")}
                  >
                    📅
                  </button>
                </div>
                <button
                  type="button"
                  className="dashboard-mobile-sort-btn"
                  aria-label={
                    ledgerSortField === "price"
                      ? ledgerSortDirection === "desc"
                        ? "Сейчас по сумме: сначала дорогие. Нажмите, чтобы показать сначала дешёвые"
                        : "Сейчас по сумме: сначала дешёвые. Нажмите, чтобы показать сначала дорогие"
                      : ledgerSortDirection === "desc"
                        ? "Сейчас по дате: сначала новые. Нажмите, чтобы показать сначала старые"
                        : "Сейчас по дате: сначала старые. Нажмите, чтобы показать сначала новые"
                  }
                  title={
                    ledgerSortField === "price"
                      ? ledgerSortDirection === "desc"
                        ? "Сначала дорогие"
                        : "Сначала дешёвые"
                      : ledgerSortDirection === "desc"
                        ? "Сначала новые"
                        : "Сначала старые"
                  }
                  onClick={() =>
                    setLedgerSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
                  }
                >
                  <span
                    className={`dashboard-mobile-sort-arrow ${
                      ledgerSortDirection === "desc" ? "active" : ""
                    }`}
                    aria-hidden="true"
                  >
                    ↓
                  </span>
                  <span
                    className={`dashboard-mobile-sort-arrow ${
                      ledgerSortDirection === "asc" ? "active" : ""
                    }`}
                    aria-hidden="true"
                  >
                    ↑
                  </span>
                </button>
              </div>

              <div className="dashboard-mobile-ledger-table">
                <table>
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Магазин</th>
                      <th>Товар</th>
                      <th>Категория</th>
                      <th style={{ textAlign: "right" }}>Цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgerReceipts.map((receipt) => {
                      const isExpanded = expandedLedgerReceipts.includes(receipt.receiptId);
                      const itemCount = receipt.items.length;
                      const categoryCount = receipt.categories.length;
                      const leadItem = receipt.items[0]?.item ?? "Без товаров";
                      const itemSummary =
                        itemCount <= 1
                          ? truncateLabel(leadItem, 28)
                          : `${truncateLabel(leadItem, 18)} +${itemCount - 1}`;
                      const categorySummary =
                        categoryCount <= 1
                          ? receipt.categories[0] ?? "Без категории"
                          : `${categoryCount} ${formatCountNoun(categoryCount, "категория", "категории", "категорий")}`;

                      return (
                        <Fragment key={`mobile-ledger-receipt-${receipt.receiptId}`}>
                          <tr
                            className={`dashboard-mobile-ledger-row ${isExpanded ? "is-expanded" : ""}`}
                            onClick={() => toggleLedgerReceipt(receipt.receiptId)}
                          >
                            <td>{formatDashboardDate(receipt.date)}</td>
                            <td>
                              <div className="dashboard-mobile-ledger-store">
                                <span>{receipt.store}</span>
                                {!isReadOnly ? (
                                  <button
                                    type="button"
                                    className="dashboard-mobile-receipt-link"
                                    aria-label={`Редактировать чек #${receipt.receiptId}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void openEditor(receipt.receiptId);
                                    }}
                                  >
                                    Редактировать чек #{receipt.receiptId}
                                  </button>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="dashboard-mobile-ledger-summary">
                                <strong className="dashboard-mobile-ledger-item-cell" title={leadItem}>
                                  {itemSummary}
                                </strong>
                                <span>
                                  {itemCount} {formatCountNoun(itemCount, "товар", "товара", "товаров")}
                                </span>
                              </div>
                            </td>
                            <td>{categorySummary}</td>
                            <td style={{ textAlign: "right" }}>{receipt.total.toFixed(2)} €</td>
                          </tr>
                          {isExpanded ? (
                            <tr className="dashboard-mobile-ledger-expanded-row">
                              <td colSpan={5}>
                                <div className="dashboard-mobile-ledger-expanded">
                                  {receipt.items.map((item) => (
                                    <div
                                      key={`mobile-ledger-item-${receipt.receiptId}-${item.id}`}
                                      className="dashboard-mobile-ledger-expanded-item"
                                    >
                                      <div>
                                        <strong>{item.item}</strong>
                                        <span>{item.category}</span>
                                      </div>
                                      <strong>{item.price.toFixed(2)} €</strong>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="dashboard-mobile-empty">
            <div className="dashboard-mobile-empty-icon">0</div>
            <h3>Пока нет расходов</h3>
            <p>Добавьте первый чек через сканирование, и этот экран начнет заполняться автоматически.</p>
          </section>
        )}
      </div>

      {onOpenScan ? (
        <button type="button" className="dashboard-mobile-scan-fab" onClick={onOpenScan}>
          Сканировать
        </button>
      ) : null}

      <nav className="dashboard-mobile-nav" aria-label="Навигация dashboard">
        <button type="button" className="active">
          Дашборд
        </button>
        {onOpenScan ? (
          <button type="button" onClick={onOpenScan}>
            Скан
          </button>
        ) : null}
        <button type="button" onClick={onRefresh} disabled={isLoading}>
          Обновить
        </button>
      </nav>

      {false && (
        <>
      <section className="dashboard-desktop-hero">
        <div className="dashboard-desktop-hero-main">
          <div className="dashboard-desktop-eyebrow">Финансовый дашборд</div>
          <div className="dashboard-desktop-headline-row">
            <div>
              <h2>Центр контроля расходов</h2>
              <p>{currentPeriodLabel} | {activeStore === "all" ? "Все магазины" : activeStore} | {categoryFilter === "all" ? "Все категории" : categoryFilter}</p>
            </div>

            <div className="dashboard-desktop-total">
              <span>Расходы за период</span>
              <strong>{formatCurrency(expensesTotal)}</strong>
              <small>{deltaLabel}</small>
            </div>
          </div>

          <div className="dashboard-desktop-period-rails" aria-hidden="true">
            <div className="dashboard-desktop-period-row">
              <span>Текущий период</span>
              <div className="dashboard-desktop-period-track">
                <div className="dashboard-desktop-period-fill current" style={{ width: `${currentPeriodLineWidth}%` }} />
              </div>
              <strong>{formatCurrency(expensesTotal)}</strong>
            </div>
            <div className="dashboard-desktop-period-row">
              <span>Прошлый период</span>
              <div className="dashboard-desktop-period-track">
                <div className="dashboard-desktop-period-fill previous" style={{ width: `${previousPeriodLineWidth}%` }} />
              </div>
              <strong>{formatCurrency(prevMonthTotal)}</strong>
            </div>
          </div>
        </div>

        <div className="dashboard-desktop-hero-side">
          <div className="dashboard-desktop-mini-card">
            <span className="dashboard-desktop-mini-label">Охват</span>
            <strong>{transactionCount} чеков</strong>
            <p>{expenses.length} позиций | {activeDays} активных дней</p>
          </div>
          <div className="dashboard-desktop-mini-card">
            <span className="dashboard-desktop-mini-label">Пиковый день</span>
            <strong>{strongestDayDateLabel}</strong>
            <p>{strongestDayAmountLabel}</p>
          </div>
        </div>
      </section>

      <div className="date-filter">
        <div>
          <label>📅 Начало периода</label>
          <input type="date" value={startDate} onChange={(e) => handleDashboardStartDateChange(e.target.value)} />
        </div>
        <div>
          <label>📅 Конец периода</label>
          <input type="date" value={endDate} onChange={(e) => handleDashboardEndDateChange(e.target.value)} />
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card primary">
          <div className="metric-label">💰 Общие расходы</div>
          <div className="metric-value">{expensesTotal.toFixed(2)} €</div>
          <div className="metric-secondary">Тот же период: {prevMonthTotal.toFixed(2)} €</div>
            <div className="metric-period-compare" aria-hidden="true">
              <div className="metric-period-row">
              <span className="metric-period-name">Текущий</span>
              <div className="metric-period-track">
                <div className="metric-period-line current" style={{ width: `${currentPeriodLineWidth}%` }} />
              </div>
            </div>
            <div className="metric-period-row">
              <span className="metric-period-name">Прошлый</span>
              <div className="metric-period-track">
                <div className="metric-period-line previous" style={{ width: `${previousPeriodLineWidth}%` }} />
              </div>
            </div>
          </div>
          {prevMonthTotal > 0 ? (
            <div className={`metric-delta ${amountChange >= 0 ? "negative" : "positive"}`}>
              {amountChange >= 0 ? "↑" : "↓"} {Math.abs(amountChange).toFixed(2)} € ({Math.abs(percentChange).toFixed(1)}%)
            </div>
          ) : (
            <div className="metric-delta neutral">Нет данных для сравнения</div>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-label">🧾 Товары и покупки</div>
          <div className="metric-card-filter">
            <label htmlFor="dashboard-store-filter" className="metric-filter-label">
              Магазин
            </label>
            <select
              id="dashboard-store-filter"
              className="metric-filter-select"
              value={activeStore}
              onChange={(e) => onStoreChange(e.target.value)}
            >
              <option value="all">Все магазины</option>
              {storeOptions.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
            <span className="metric-filter-hint">Фильтр применяется ко всему дашборду</span>
          </div>
          <div className="metric-breakdown">
            <div className="metric-breakdown-row">
              <span>Товаров</span>
              <strong>{expenses.length}</strong>
            </div>
            <div className="metric-breakdown-row">
              <span>Транзакций</span>
              <strong>{transactionCount}</strong>
            </div>
            <div className="metric-breakdown-row">
              <span>Средний чек</span>
              <strong>{averageTransactionValue.toFixed(2)} €</strong>
            </div>
          </div>
        </div>
        <div className="metric-card metric-actions-card">
          <div className="metric-label">{"\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044f"}</div>
          <div className="dashboard-action-buttons">
            <button type="button" className="btn btn-secondary dashboard-refresh-btn" onClick={onRefresh} disabled={isLoading}>
              {isLoading ? "\u041e\u0431\u043d\u043e\u0432\u043b\u044f\u0435\u043c..." : "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}
            </button>
            <button
              type="button"
              className="btn btn-secondary dashboard-refresh-btn"
              onClick={handleExportExcel}
              disabled={isReadOnly || isLoading || expenses.length === 0}
            >
              {"\u042d\u043a\u0441\u043f\u043e\u0440\u0442 \u0432 Excel"}
            </button>
          </div>
        </div>
      </div>

      {expenses.length > 0 && (
        <section className="dashboard-desktop-insights">
          <article className="dashboard-desktop-panel">
            <div className="dashboard-desktop-panel-head">
              <div>
                <span className="dashboard-desktop-panel-kicker">Фокус</span>
                <h3>Топ категорий</h3>
              </div>
              <span className="dashboard-desktop-panel-note">
                {topCategory ? `Лидер: ${topCategory.name}` : "Нет данных по категориям"}
              </span>
            </div>

            <div className="dashboard-desktop-rank-list">
              {topCategories.map((entry, index) => (
                <button
                  key={`desktop-top-${entry.name}`}
                  type="button"
                  className={`dashboard-desktop-rank-item ${categoryFilter === entry.name ? "active" : ""}`}
                  onClick={() => toggleCategoryFilter(entry.name)}
                >
                  <div>
                    <span className="dashboard-desktop-rank-index">0{index + 1}</span>
                    <strong>{entry.name}</strong>
                  </div>
                  <div>
                    <strong>{formatCurrency(entry.value)}</strong>
                    <span>{entry.share.toFixed(0)}%</span>
                  </div>
                </button>
              ))}
            </div>
          </article>

          <article className="dashboard-desktop-panel">
            <div className="dashboard-desktop-panel-head">
              <div>
                <span className="dashboard-desktop-panel-kicker">Последние операции</span>
                <h3>Свежие позиции</h3>
              </div>
              <span className="dashboard-desktop-panel-note">Показано: {recentExpenses.length}</span>
            </div>

            <div className="dashboard-desktop-activity-list">
              {recentExpenses.map((exp) => {
                const isFirstInReceipt = receiptFirstExpenseId.get(exp.receiptId) === exp.id;

                return (
                  <div key={`hero-expense-${exp.id}`} className="dashboard-desktop-activity-item">
                    <div>
                      <strong>{exp.item}</strong>
                      <span>
                        {exp.store} | {formatDashboardDate(exp.date)}
                      </span>
                    </div>
                    <div>
                      <strong>{formatCurrency(exp.price)}</strong>
                      <span>{exp.category}</span>
                      {!isReadOnly && isFirstInReceipt ? (
                        <button
                          type="button"
                          className="dashboard-desktop-link"
                          onClick={() => void openEditor(exp.receiptId)}
                        >
                          Чек #{exp.receiptId}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </section>
      )}

      <div className="cost-dropdown-card">
        <button
          type="button"
          className="cost-dropdown-toggle"
          onClick={() => setIsAnalyzeCostOpen((prev) => !prev)}
          aria-expanded={isAnalyzeCostOpen}
          aria-controls="analyze-cost-dropdown-content"
        >
          <span>🧠 Стоимость распознавания</span>
          <span>
            {analyzeCost.totalUsd.toFixed(4)} $ · {analyzeCost.count} фото · {isAnalyzeCostOpen ? "▲" : "▼"}
          </span>
        </button>

        {isAnalyzeCostOpen && (
          <div id="analyze-cost-dropdown-content" className="cost-dropdown-content">
            {analyzeCost.items.length > 0 ? (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Когда</th>
                      <th>Магазин</th>
                      <th>Модель</th>
                      <th style={{ textAlign: "right" }}>Токены</th>
                      <th style={{ textAlign: "right" }}>Стоимость</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyzeCost.items.map((item) => (
                      <tr key={`analyze-cost-${item.id}`}>
                        <td>{formatDateTime(item.createdAt)}</td>
                        <td>{item.storeName || "—"}</td>
                        <td>{item.model}</td>
                        <td style={{ textAlign: "right" }}>{item.totalTokens}</td>
                        <td style={{ textAlign: "right" }}>{item.estimatedCostUsd.toFixed(6)} $</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <p>Нет данных по стоимости распознавания за выбранный период</p>
              </div>
            )}
          </div>
        )}
      </div>

      {expenses.length > 0 ? (
        <>
          <div className="charts-grid">
            <div className="chart-card">
              <h4>🥧 Расходы по категориям</h4>
              <div className="category-filter-row">
                <label htmlFor="dashboard-category-filter" className="metric-filter-label">
                  {"\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f"}
                </label>
                <select
                  id="dashboard-category-filter"
                  className="category-filter-select"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="all">{"\u0412\u0441\u0435 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438"}</option>
                  {categoryFilterOptions.map((category) => (
                    <option key={`category-filter-${category}`} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={false}
                    labelLine={false}
                  >
                    {categoryChartData.map((entry, index) => (
                      <Cell
                        key={`cell-${entry.name}`}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        onClick={() => toggleCategoryFilter(entry.name)}
                        style={{ cursor: "pointer" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)} €`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="category-legend" aria-label="Легенда категорий">
                {categoryChartData.map((entry, index) => {
                  const percent = filteredCategoryTotal > 0 ? (entry.value / filteredCategoryTotal) * 100 : 0;
                  const isActiveCategory = categoryFilter === entry.name;
                  return (
                    <button
                      key={`legend-${entry.name}`}
                      type="button"
                      className={`category-legend-item ${isActiveCategory ? "active" : ""}`}
                      onClick={() => toggleCategoryFilter(entry.name)}
                      aria-pressed={isActiveCategory}
                    >
                      <div className="category-legend-left">
                        <span
                          className="category-legend-dot"
                          style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="category-legend-name">{entry.name}</span>
                      </div>
                      <span className="category-legend-value">
                        {entry.value.toFixed(2)} € ({percent.toFixed(0)}%)
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="chart-card">
              <h4>📊 Расходы по дням</h4>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: "#a1a1aa", fontSize: 12 }}>Чеков в подсказке</span>
                <div style={{ display: "inline-flex", gap: 6 }}>
                  {([
                    { value: 5, label: "5" },
                    { value: 10, label: "10" },
                    { value: "all", label: "все" },
                  ] as const).map((option) => {
                    const isActive = tooltipReceiptLimit === option.value;
                    return (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => setTooltipReceiptLimit(option.value)}
                        style={{
                          border: isActive ? "1px solid #6366f1" : "1px solid #3f3f46",
                          background: isActive ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.02)",
                          color: isActive ? "#e0e7ff" : "#d4d4d8",
                          borderRadius: 999,
                          padding: "4px 10px",
                          fontSize: 12,
                          lineHeight: 1.2,
                          cursor: "pointer",
                        }}
                        aria-pressed={isActive}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={dailyData}
                  onMouseMove={(state) => {
                    const nextLabel = state && typeof state.activeLabel === "string" ? state.activeLabel : null;
                    setActiveBarDate(nextLabel);
                  }}
                  onMouseLeave={() => setActiveBarDate(null)}
                >
                  <XAxis dataKey="date" tickFormatter={formatDashboardDate} tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis
                    width={52}
                    domain={desktopDailyChartYAxisDomain}
                    ticks={desktopDailyChartYAxisTicks}
                    tickFormatter={(value) => `${Number(value).toFixed(0)}€`}
                    tick={{ fill: "#a1a1aa", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={(props) => renderDailyTooltip(props as DailyTooltipContentProps)} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} shape={renderDailyBar} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card dashboard-desktop-ledger-card">
            <div className="compare-card-header">
              <h3>🔎 {comparisonTitle}</h3>
              <button
                type="button"
                className="btn btn-secondary compare-toggle-btn"
                onClick={() => setIsCategoryComparisonOpen((prev) => !prev)}
                aria-expanded={isCategoryComparisonOpen}
                aria-controls="category-comparison-content"
              >
                {isCategoryComparisonOpen ? "Свернуть" : "Показать"}
              </button>
            </div>
            <p className="card-subtitle">{comparisonSubtitle}</p>
            {isCategoryComparisonOpen && (
              <div id="category-comparison-content">
                <div className="compare-card-controls">
                  <div className="dashboard-mobile-segmented" aria-label="Режим сравнения категорий">
                    <button
                      type="button"
                      className={`dashboard-mobile-segmented-btn ${comparisonMode === "periods" ? "active" : ""}`}
                      onClick={() => setComparisonMode("periods")}
                      aria-pressed={comparisonMode === "periods"}
                    >
                      Периоды
                    </button>
                    <button
                      type="button"
                      className={`dashboard-mobile-segmented-btn ${comparisonMode === "stores" ? "active" : ""}`}
                      onClick={() => setComparisonMode("stores")}
                      aria-pressed={comparisonMode === "stores"}
                    >
                      Магазины
                    </button>
                  </div>

                  {comparisonMode === "stores" ? (
                    <div className="compare-store-filters">
                      <div className="metric-card-filter">
                        <label htmlFor="desktop-compare-store-a" className="metric-filter-label">
                          Магазин A
                        </label>
                        <select
                          id="desktop-compare-store-a"
                          className="metric-filter-select"
                          value={comparisonStoreA}
                          onChange={(e) => setComparisonStoreA(e.target.value)}
                        >
                          {storeComparisonOptions.map((store) => (
                            <option key={`desktop-compare-a-${store}`} value={store}>
                              {store}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="metric-card-filter">
                        <label htmlFor="desktop-compare-store-b" className="metric-filter-label">
                          Магазин B
                        </label>
                        <select
                          id="desktop-compare-store-b"
                          className="metric-filter-select"
                          value={comparisonStoreB}
                          onChange={(e) => setComparisonStoreB(e.target.value)}
                        >
                          {storeComparisonOptions.map((store) => (
                            <option key={`desktop-compare-b-${store}`} value={store}>
                              {store}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="metric-filter-hint">{comparisonStoresHint}</p>
                    </div>
                  ) : null}
                </div>

                {activeComparisonRows.length > 0 ? (
                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Категория</th>
                          <th style={{ textAlign: "right" }}>{comparisonLeftLabel}</th>
                          <th style={{ textAlign: "right" }}>{comparisonRightLabel}</th>
                          <th style={{ textAlign: "right" }}>Δ</th>
                          <th style={{ textAlign: "right" }}>Δ%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeComparisonRows.map((row) => (
                          <tr key={`compare-${row.category}`}>
                            <td>{row.category}</td>
                            <td style={{ textAlign: "right" }}>{row.currentTotal.toFixed(2)} €</td>
                            <td style={{ textAlign: "right" }}>{row.previousTotal.toFixed(2)} €</td>
                            <td
                              style={{ textAlign: "right" }}
                              className={row.delta > 0 ? "compare-negative" : row.delta < 0 ? "compare-positive" : "compare-neutral"}
                            >
                              {row.delta > 0 ? "↑ " : row.delta < 0 ? "↓ " : ""}
                              {Math.abs(row.delta).toFixed(2)} €
                            </td>
                            <td
                              style={{ textAlign: "right" }}
                              className={row.delta > 0 ? "compare-negative" : row.delta < 0 ? "compare-positive" : "compare-neutral"}
                            >
                              {row.percent === null ? "—" : `${row.percent > 0 ? "+" : ""}${row.percent.toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>{comparisonEmptyMessage}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="dashboard-desktop-panel-head dashboard-desktop-ledger-head">
              <div>
                <h3>📋 Детализация расходов</h3>
                <span className="dashboard-desktop-panel-note">
                  {sortedLedgerExpenses.length} позиций • {ledgerStoreFilterLabel}
                </span>
              </div>
              <div className="dashboard-desktop-ledger-controls">
                <div className="dashboard-desktop-ledger-filter">
                  <select
                    className="dashboard-mobile-select"
                    aria-label="Фильтр детализации по магазину"
                    value={ledgerStoreFilter}
                    onChange={(e) => setLedgerStoreFilter(e.target.value)}
                  >
                    <option value="all">Все магазины</option>
                    {ledgerStoreOptions.map((store) => (
                      <option key={`desktop-ledger-store-${store}`} value={store}>
                        {store}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Магазин</th>
                    <th>Товар</th>
                    <th>Категория</th>
                    <th style={{ textAlign: "right" }}>Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLedgerExpenses.map((exp) => {
                    const isFirstInReceipt = receiptFirstExpenseId.get(exp.receiptId) === exp.id;

                    return (
                      <tr key={exp.id}>
                        <td>{formatDashboardDate(exp.date)}</td>
                        <td>
                          <div className="dashboard-desktop-ledger-store-cell">
                            <span>{exp.store}</span>
                            {!isReadOnly && isFirstInReceipt && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: "0.2rem 0.45rem", fontSize: "0.72rem", lineHeight: 1.2 }}
                                onClick={() => void openEditor(exp.receiptId)}
                              >
                                ✏️ Чек #{exp.receiptId}
                              </button>
                            )}
                          </div>
                        </td>
                        <td>{exp.item}</td>
                        <td>{exp.category}</td>
                        <td style={{ textAlign: "right" }}>{exp.price.toFixed(2)} €</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="empty-state">
            <div className="icon">📭</div>
            <p>Нет данных за выбранный период</p>
            <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
              Загрузите чеки во вкладке &quot;Сканирование&quot;
            </p>
          </div>
        </div>
      )}

        </>
      )}

      {isEditorOpen && (
        <div className="receipt-editor-overlay" onClick={closeEditor}>
          <div className="receipt-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-editor-header">
              <h3>✏️ Редактирование чека{editorReceipt ? ` #${editorReceipt.id}` : ""}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeEditor}
                disabled={isEditorSaving || isEditorDeleting || isComparing}
              >
                Закрыть
              </button>
            </div>

            {isEditorLoading && (
              <div className="receipt-editor-loading">
                <div className="spinner"></div>
                <span>Загружаем чек...</span>
              </div>
            )}

            {!isEditorLoading && editorError && (
              <div className="alert error" style={{ marginTop: 0 }}>
                {editorError}
              </div>
            )}

            {!isEditorLoading && editorReceipt && (
              <>
                <div className="scan-form-grid" style={{ marginBottom: "1rem" }}>
                  <div>
                    <label className="scan-field-label">🏪 Магазин</label>
                    <input
                      type="text"
                      className="scan-field-input"
                      value={editorReceipt.store_name}
                      onChange={(e) =>
                        setEditorReceipt((prev) => (prev ? { ...prev, store_name: e.target.value } : prev))
                      }
                    />
                  </div>
                  <div>
                    <div className="scan-date-label-row">
                      <label className="scan-field-label">📅 Дата покупки</label>
                      <button
                        type="button"
                        className="scan-date-today-btn"
                        onClick={() =>
                          setEditorReceipt((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  purchase_date: getLocalTodayIso(),
                                }
                              : prev
                          )
                        }
                      >
                        Сегодня
                      </button>
                    </div>
                    <input
                      type="date"
                      className="scan-field-input"
                      value={editorReceipt.purchase_date}
                      onChange={(e) =>
                        setEditorReceipt((prev) => (prev ? { ...prev, purchase_date: e.target.value } : prev))
                      }
                    />
                  </div>
                  <div className="receipt-editor-comment-field">
                    <label className="scan-field-label">рџ’¬ РљРѕРјРјРµРЅС‚Р°СЂРёР№ Рє С‡РµРєСѓ</label>
                    <textarea
                      className="scan-field-input receipt-editor-comment-input"
                      value={editorReceipt.comment}
                      onChange={(e) =>
                        setEditorReceipt((prev) => (prev ? { ...prev, comment: e.target.value } : prev))
                      }
                      placeholder="Например: покупка на неделю, скидка по карте, товары для дома"
                      maxLength={500}
                      rows={4}
                    />
                  </div>
                </div>

                <div className="receipt-editor-compare">
                  <div className="receipt-editor-compare-head">
                    <h4>📸 Сверка с фото</h4>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        ref={compareFileInputRef}
                        type="file"
                        accept="image/*"
                        className="visually-hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            void handleCompareFile(file);
                          }
                          e.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => compareFileInputRef.current?.click()}
                        disabled={isComparing}
                      >
                        {isComparing ? "Сравниваем..." : "Загрузить фото для сравнения"}
                      </button>
                      {editorReceipt.source === "telegram" && editorReceipt.telegram_file_id && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void handleCompareTelegramImage()}
                          disabled={isComparing}
                        >
                          {isComparing ? "Сравниваем..." : "Подтянуть фото из Telegram"}
                        </button>
                      )}
                    </div>
                  </div>

                  {comparisonImage && (
                    <div className="receipt-editor-image-wrap">
                      <Image
                        src={comparisonImage}
                        alt="Фото чека для сравнения"
                        width={600}
                        height={900}
                        unoptimized
                        className="receipt-editor-image"
                      />
                    </div>
                  )}

                  {comparisonSummary && (
                    <div className="receipt-editor-summary">
                      {comparisonSummary.changes.length > 0 ? (
                        <ul>
                          {comparisonSummary.changes.map((change) => (
                            <li key={change}>{change}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>Расхождений не найдено. Данные совпадают с фото.</p>
                      )}

                      <div className="receipt-editor-summary-totals">
                        <span>В дашборде: {comparisonSummary.currentTotal.toFixed(2)} €</span>
                        <span>По фото: {comparisonSummary.analyzedTotal.toFixed(2)} €</span>
                      </div>

                      <button type="button" className="btn btn-secondary" onClick={handleApplyComparison}>
                        Применить данные с фото
                      </button>
                    </div>
                  )}
                </div>

                <div className="receipt-editor-items-head">
                  <h4>🧾 Позиции</h4>
                  <div className="receipt-editor-head-actions">
                    <CategoryManager
                      customCategories={customCategories}
                      onAddCategory={onAddCategory}
                      onDeleteCategory={onDeleteCategory}
                    />
                    <button type="button" className="btn btn-secondary" onClick={addEditorItem}>
                    + Добавить позицию
                    </button>
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
                      {editorReceipt.items.map((item, index) => (
                        <tr key={index}>
                          <td>
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateEditorItem(index, "name", e.target.value)}
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
                              onChange={(e) => updateEditorItem(index, "price", parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td>
                            <select
                              value={item.category}
                              onChange={(e) => updateEditorItem(index, "category", e.target.value)}
                            >
                              {Array.from(new Set([...categoryOptions, item.category].filter(Boolean))).map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button className="delete-btn" type="button" onClick={() => deleteEditorItem(index)}>
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
                  <span className="total-value">{currentEditorTotal.toFixed(2)} €</span>
                </div>

                <div className="receipt-editor-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleDeleteReceipt(editorReceipt.id, { fromEditor: true })}
                    disabled={isEditorSaving || isEditorDeleting || isComparing}
                    style={{ color: "var(--error)" }}
                  >
                    {isEditorDeleting ? "Удаляем..." : "Удалить чек"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeEditor}
                    disabled={isEditorSaving || isEditorDeleting || isComparing}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSaveEditor()}
                    disabled={isEditorSaving || isEditorDeleting || isComparing}
                  >
                    {isEditorSaving ? "Сохраняем..." : "Сохранить изменения"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



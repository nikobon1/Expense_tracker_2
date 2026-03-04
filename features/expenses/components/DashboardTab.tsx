"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CATEGORIES, CHART_COLORS } from "@/features/expenses/constants";
import { analyzeReceipt, getReceipt, getReceiptImageFromTelegram, updateReceipt } from "@/lib/api";
import { buildCategoryData, buildDailyData } from "@/features/expenses/utils";
import type { DailyPoint, DailyReceiptSegment } from "@/features/expenses/utils";
import type { Expense, ReceiptData, ReceiptItem } from "@/features/expenses/types";

interface DashboardTabProps {
  startDate: string;
  endDate: string;
  expenses: Expense[];
  prevMonthTotal: number;
  isLoading?: boolean;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRefresh?: () => void;
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

type TooltipReceiptLimit = 5 | 10 | "all";

type EditableReceipt = {
  id: number;
  store_name: string;
  purchase_date: string;
  items: ReceiptItem[];
  source?: string | null;
  telegram_file_id?: string | null;
};

type ComparisonSummary = {
  changes: string[];
  currentTotal: number;
  analyzedTotal: number;
};

const MAX_UPLOAD_DIMENSION = 1600;
const MAX_ANALYZE_PAYLOAD_CHARS = 3_500_000;

function getLocalTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
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

function sanitizeItems(items: ReceiptItem[]): ReceiptItem[] {
  return items
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      price: Number(item.price ?? 0),
      category: String(item.category ?? "").trim() || "Другое",
    }))
    .filter((item) => item.name || item.price > 0);
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
  expenses,
  prevMonthTotal,
  isLoading = false,
  onStartDateChange,
  onEndDateChange,
  onRefresh,
}: DashboardTabProps) {
  const [activeBarDate, setActiveBarDate] = useState<string | null>(null);
  const [tooltipReceiptLimit, setTooltipReceiptLimit] = useState<TooltipReceiptLimit>(5);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
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
  const categoryData = buildCategoryData(expenses);
  const dailyData = buildDailyData(expenses);

  const receiptFirstExpenseId = useMemo(() => {
    const first = new Map<number, number>();
    for (const exp of expenses) {
      if (!first.has(exp.receiptId)) {
        first.set(exp.receiptId, exp.id);
      }
    }
    return first;
  }, [expenses]);

  const currentEditorTotal = useMemo(() => {
    if (!editorReceipt) return 0;
    return sanitizeItems(editorReceipt.items).reduce((sum, item) => sum + Number(item.price || 0), 0);
  }, [editorReceipt]);

  const comparisonSummary = useMemo(() => {
    if (!editorReceipt || !comparisonData) return null;
    return buildComparisonSummary(editorReceipt, comparisonData);
  }, [editorReceipt, comparisonData]);

  const openEditor = async (receiptId: number) => {
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

  const closeEditor = () => {
    if (isEditorSaving || isComparing) return;
    setIsEditorOpen(false);
    setIsEditorLoading(false);
    setEditorError(null);
    setEditorReceipt(null);
    setComparisonImage(null);
    setComparisonData(null);
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
    const visibleSegments =
      tooltipReceiptLimit === "all"
        ? point.receiptSegments
        : point.receiptSegments.slice(0, tooltipReceiptLimit);
    const hiddenSegments =
      tooltipReceiptLimit === "all" ? [] : point.receiptSegments.slice(tooltipReceiptLimit);
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

  return (
    <div>
      <div className="date-filter">
        <div>
          <label>📅 Начало периода</label>
          <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} />
        </div>
        <div>
          <label>📅 Конец периода</label>
          <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} />
        </div>
        <div className="dashboard-refresh-wrap">
          <label>Обновление</label>
          <button type="button" className="btn btn-secondary dashboard-refresh-btn" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Обновляем..." : "Обновить"}
          </button>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card primary">
          <div className="metric-label">💰 Общие расходы</div>
          <div className="metric-value">{expensesTotal.toFixed(2)} €</div>
          <div className="metric-secondary">Тот же период: {prevMonthTotal.toFixed(2)} €</div>
          {prevMonthTotal > 0 ? (
            <div className={`metric-delta ${amountChange >= 0 ? "negative" : "positive"}`}>
              {amountChange >= 0 ? "↑" : "↓"} {Math.abs(amountChange).toFixed(2)} € ({Math.abs(percentChange).toFixed(1)}%)
            </div>
          ) : (
            <div className="metric-delta neutral">Нет данных для сравнения</div>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-label">🧾 Количество товаров</div>
          <div className="metric-value">{expenses.length}</div>
        </div>
      </div>

      {expenses.length > 0 ? (
        <>
          <div className="charts-grid">
            <div className="chart-card">
              <h4>🥧 Расходы по категориям</h4>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }: { name?: string; percent?: number }) =>
                      `${name || ""} ${((percent || 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `${Number(value).toFixed(2)} €`} />
                </PieChart>
              </ResponsiveContainer>
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
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip content={(props) => renderDailyTooltip(props as DailyTooltipContentProps)} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} shape={renderDailyBar} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <h3>📋 Детализация расходов</h3>
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
                  {expenses.map((exp) => {
                    const isFirstInReceipt = receiptFirstExpenseId.get(exp.receiptId) === exp.id;

                    return (
                      <tr key={exp.id}>
                        <td>{formatDashboardDate(exp.date)}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <span>{exp.store}</span>
                            {isFirstInReceipt && (
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

      {isEditorOpen && (
        <div className="receipt-editor-overlay" onClick={closeEditor}>
          <div className="receipt-editor-modal" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-editor-header">
              <h3>✏️ Редактирование чека{editorReceipt ? ` #${editorReceipt.id}` : ""}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeEditor}
                disabled={isEditorSaving || isComparing}
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
                  <button type="button" className="btn btn-secondary" onClick={addEditorItem}>
                    + Добавить позицию
                  </button>
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
                        <tr key={`${index}-${item.name}`}>
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
                              {CATEGORIES.map((cat) => (
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
                    onClick={closeEditor}
                    disabled={isEditorSaving || isComparing}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void handleSaveEditor()}
                    disabled={isEditorSaving || isComparing}
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


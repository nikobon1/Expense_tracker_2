"use client";

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
import { CHART_COLORS } from "@/features/expenses/constants";
import { buildCategoryData, buildDailyData } from "@/features/expenses/utils";
import type { Expense } from "@/features/expenses/types";

interface DashboardTabProps {
  startDate: string;
  endDate: string;
  expenses: Expense[];
  prevMonthTotal: number;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

export default function DashboardTab({
  startDate,
  endDate,
  expenses,
  prevMonthTotal,
  onStartDateChange,
  onEndDateChange,
}: DashboardTabProps) {
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
  const percentChange =
    prevMonthTotal > 0 ? ((expensesTotal - prevMonthTotal) / prevMonthTotal) * 100 : 0;
  const categoryData = buildCategoryData(expenses);
  const dailyData = buildDailyData(expenses);

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
      </div>

      <div className="metrics-grid">
        <div className="metric-card primary">
          <div className="metric-label">💰 Общие расходы</div>
          <div className="metric-value">{expensesTotal.toFixed(2)} €</div>
          {prevMonthTotal > 0 && (
            <div className={`metric-delta ${percentChange >= 0 ? "negative" : "positive"}`}>
              {percentChange >= 0 ? "↑" : "↓"} {Math.abs(percentChange).toFixed(1)}% vs пред. месяц
            </div>
          )}
        </div>
        <div className="metric-card">
          <div className="metric-label">🧾 Количество товаров</div>
          <div className="metric-value">{expenses.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">📅 Пред. месяц</div>
          <div className="metric-value">{prevMonthTotal.toFixed(2)} €</div>
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
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dailyData}>
                  <XAxis dataKey="date" tickFormatter={formatDashboardDate} tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#a1a1aa", fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={(label) => formatDashboardDate(String(label))}
                    formatter={(value) => [`${Number(value).toFixed(2)} €`, "Сумма"]}
                    contentStyle={{ background: "#1a1a24", border: "1px solid #27272a", borderRadius: "8px" }}
                  />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
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
                  {expenses.map((exp) => (
                    <tr key={exp.id}>
                      <td>{formatDashboardDate(exp.date)}</td>
                      <td>{exp.store}</td>
                      <td>{exp.item}</td>
                      <td>{exp.category}</td>
                      <td style={{ textAlign: "right" }}>{exp.price.toFixed(2)} €</td>
                    </tr>
                  ))}
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
    </div>
  );
}


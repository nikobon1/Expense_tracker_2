"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import DashboardTab from "@/features/expenses/components/DashboardTab";
import { CATEGORIES } from "@/features/expenses/constants";
import {
  DEMO_SCENARIOS,
  buildDashboardDemoData,
  type DemoScenarioKey,
} from "@/features/expenses/demo-data";
import type {
  AddCategoryResult,
  DeleteCategoryResult,
} from "@/features/expenses/hooks/useCategoryOptions";

const DEMO_READ_ONLY_NOTICE =
  "Это демо-версия продукта. В ней можно изучить интерфейс и аналитику, но нельзя редактировать данные.";

function getLocalIsoDate(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function getInitialDateRange() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  return {
    start: getLocalIsoDate(firstDay),
    end: getLocalIsoDate(today),
  };
}

const readOnlyCategoryAdd = async (): Promise<AddCategoryResult> => ({
  status: "invalid",
  message: DEMO_READ_ONLY_NOTICE,
});

const readOnlyCategoryDelete = async (): Promise<DeleteCategoryResult> => ({
  status: "invalid",
  message: DEMO_READ_ONLY_NOTICE,
});

export default function DemoPage() {
  const initialRange = getInitialDateRange();
  const [scenario, setScenario] = useState<DemoScenarioKey>("smart-shopper");
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [selectedStore, setSelectedStore] = useState("all");

  const activeScenario =
    DEMO_SCENARIOS.find((item) => item.key === scenario) ?? DEMO_SCENARIOS[0];

  const demoData = useMemo(
    () =>
      buildDashboardDemoData({
        startDate,
        endDate,
        selectedStore,
        scenario,
      }),
    [endDate, scenario, selectedStore, startDate]
  );

  const categoryOptions = useMemo(
    () =>
      [...new Set([...CATEGORIES, ...demoData.expenses.map((expense) => expense.category)])].sort(
        (a, b) => a.localeCompare(b, "en")
      ),
    [demoData.expenses]
  );
  const resetSelectedStore = useEffectEvent(() => {
    setSelectedStore("all");
  });

  useEffect(() => {
    if (selectedStore !== "all" && !demoData.stores.includes(selectedStore)) {
      resetSelectedStore();
    }
  }, [demoData.stores, selectedStore]);

  return (
    <div className="app-container demo-page">
      <main className="main-full">
        <section className="demo-hero">
          <div className="alert warning demo-hero-alert">
            <strong>Демо-режим.</strong> Показывает мок-данные и не требует входа.
          </div>

          <div className="demo-hero-copy">
            <div>
              <span className="demo-hero-kicker">Public Demo</span>
              <h1>Покажите продукт без онбординга, логина и пустого экрана</h1>
              <p>
                Это живая демо-версия dashboard на реалистичных данных. Пользователь может
                переключать сценарии, фильтры, сравнение магазинов и посмотреть, нравится ли ему
                аналитика до покупки или входа.
              </p>
            </div>

            <div className="demo-hero-actions">
              <Link href="/login" className="btn btn-primary">
                Войти в полную версию
              </Link>
              <a href="#demo-dashboard" className="btn btn-secondary">
                Перейти к демо
              </a>
            </div>
          </div>

          <div className="demo-scenario-block">
            <div>
              <h2>Сценарии</h2>
              <p>{activeScenario.description}</p>
            </div>

            <div className="dashboard-mobile-segmented demo-scenario-tabs" aria-label="Сценарии демо">
              {DEMO_SCENARIOS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`dashboard-mobile-segmented-btn ${scenario === item.key ? "active" : ""}`}
                  onClick={() => setScenario(item.key)}
                  aria-pressed={scenario === item.key}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="demo-quick-notes">
          <article className="demo-note-card">
            <strong>Что можно проверить</strong>
            <p>Динамику расходов, структуру категорий, детализацию чеков и сравнение магазинов.</p>
          </article>
          <article className="demo-note-card">
            <strong>Что отключено</strong>
            <p>Сканирование, редактирование, сохранение и удаление чеков в этом режиме недоступны.</p>
          </article>
          <article className="demo-note-card">
            <strong>Лучший сценарий</strong>
            <p>В режиме Store Comparison сравните Pingo Doce vs Continente на сценарии Smart Shopper.</p>
          </article>
        </section>

        <div id="demo-dashboard">
          <DashboardTab
            startDate={startDate}
            endDate={endDate}
            selectedStore={selectedStore}
            stores={demoData.stores}
            expenses={demoData.expenses}
            categoryOptions={categoryOptions}
            customCategories={[]}
            prevMonthTotal={demoData.prevMonthTotal}
            prevPeriodCategoryTotals={demoData.prevPeriodCategoryTotals}
            analyzeCost={demoData.analyzeCost}
            isLoading={false}
            onAddCategory={readOnlyCategoryAdd}
            onDeleteCategory={readOnlyCategoryDelete}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onStoreChange={setSelectedStore}
            onRefresh={() => undefined}
            isReadOnly
            readOnlyNotice={DEMO_READ_ONLY_NOTICE}
          />
        </div>
      </main>
    </div>
  );
}

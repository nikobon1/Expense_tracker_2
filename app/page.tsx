'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import DashboardTab from '@/features/expenses/components/DashboardTab';
import ScanTab from '@/features/expenses/components/ScanTab';
import { useCategoryOptions } from '@/features/expenses/hooks/useCategoryOptions';
import { useDashboardData } from '@/features/expenses/hooks/useDashboardData';
import { useRecurringExpenses } from '@/features/expenses/hooks/useRecurringExpenses';
import { useReceiptFlow } from '@/features/expenses/hooks/useReceiptFlow';
import { getAccountSettings, getAnalyzeUsage, type AnalyzeUsage } from '@/lib/account-api';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currency';

function getLocalTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function Home() {
  const isOnboardingPreview = process.env.NODE_ENV !== 'production';
  const [activeTab, setActiveTab] = useState<'scan' | 'dashboard'>('scan');
  const [manualEntryRequest, setManualEntryRequest] = useState(0);
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [analyzeUsage, setAnalyzeUsage] = useState<AnalyzeUsage | null>(null);
  const [isAnalyzeUsageLoading, setIsAnalyzeUsageLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hasLoadedOnboardingPreference, setHasLoadedOnboardingPreference] = useState(false);
  const categoryOptions = useCategoryOptions();
  const dashboardData = useDashboardData(defaultCurrency);
  const recurringExpenses = useRecurringExpenses(defaultCurrency);
  const {
    startDate,
    endDate,
    selectedStore,
    selectedCurrency,
    currencies,
    activeCurrency,
    stores,
    expenses,
    prevMonthTotal,
    prevPeriodCategoryTotals,
    analyzeCost,
    setStartDate,
    setEndDate,
    setSelectedStore,
    setSelectedCurrency,
    loadExpenses,
  } = dashboardData;
  const handleReceiptSaved = useCallback(
    ({ purchaseDate, currency }: { purchaseDate: string; currency: string }) => {
      const fallbackDate = getLocalTodayIso();
      const normalizedPurchaseDate = purchaseDate || fallbackDate;

      setSelectedStore('all');
      setSelectedCurrency(normalizeCurrencyCode(currency || defaultCurrency));

      if (normalizedPurchaseDate < startDate || normalizedPurchaseDate > endDate) {
        setStartDate(normalizedPurchaseDate);
        setEndDate(normalizedPurchaseDate);
      } else if (normalizedPurchaseDate === fallbackDate && endDate < fallbackDate) {
        setEndDate(fallbackDate);
      }

      setActiveTab('dashboard');
    },
    [defaultCurrency, endDate, setEndDate, setSelectedCurrency, setSelectedStore, setStartDate, startDate]
  );
  const receiptFlow = useReceiptFlow(defaultCurrency, { onSaved: handleReceiptSaved });

  useEffect(() => {
    if (activeTab === 'dashboard') {
      void loadExpenses();
    }
  }, [activeTab, startDate, endDate, loadExpenses]);

  useEffect(() => {
    if (activeTab !== 'dashboard') return;

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadExpenses();
      }
    }, 20000);

    return () => clearInterval(interval);
  }, [activeTab, loadExpenses]);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const account = await getAccountSettings();
        if (isActive) {
          setDefaultCurrency(account.defaultCurrency);
        }
      } catch (error) {
        console.error('Failed to load account settings:', error);
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    try {
      if (isOnboardingPreview) {
        setShowOnboarding(true);
      } else {
        const dismissed = window.localStorage.getItem('expense-tracker:onboarding-dismissed') === '1';
        setShowOnboarding(!dismissed);
      }
    } catch (error) {
      console.error('Failed to read onboarding preference:', error);
    } finally {
      setHasLoadedOnboardingPreference(true);
    }
  }, [isOnboardingPreview]);

  useEffect(() => {
    if (isOnboardingPreview) return;
    if (!hasLoadedOnboardingPreference) return;
    if (dashboardData.isLoading) return;
    if (dashboardData.expenses.length > 0) {
      setShowOnboarding(false);
    }
  }, [dashboardData.expenses.length, dashboardData.isLoading, hasLoadedOnboardingPreference, isOnboardingPreview]);

  useEffect(() => {
    if (activeTab !== 'dashboard') return;

    let isActive = true;

    const loadAnalyzeUsage = async () => {
      try {
        const usage = await getAnalyzeUsage();
        if (!isActive) return;

        setAnalyzeUsage(usage);
      } catch (error) {
        if (!isActive) return;
        console.error('Failed to load analyze usage:', error);
      } finally {
        if (isActive) {
          setIsAnalyzeUsageLoading(false);
        }
      }
    };

    void loadAnalyzeUsage();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadAnalyzeUsage();
      }
    }, 20000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [activeTab]);

  const openManualReceiptEntry = () => {
    setActiveTab('scan');
    setManualEntryRequest((value) => value + 1);
  };

  const dismissOnboarding = () => {
    if (isOnboardingPreview) return;
    setShowOnboarding(false);
    try {
      window.localStorage.setItem('expense-tracker:onboarding-dismissed', '1');
    } catch (error) {
      console.error('Failed to store onboarding preference:', error);
    }
  };

  const openDashboard = () => {
    setEndDate(getLocalTodayIso());
    setActiveTab('dashboard');
  };

  return (
    <div className="app-container">
      <main className="main-full">
        {isOnboardingPreview && (
          <div className="dev-preview-banner" role="status" aria-live="polite">
            <div className="dev-preview-banner-copy">
              <strong>Preview mode</strong>
            </div>
            <div className="dev-preview-banner-actions">
              <button type="button" className="btn btn-primary" onClick={openManualReceiptEntry}>
                Открыть ввод
              </button>
            </div>
          </div>
        )}
        {receiptFlow.alert && (
          <div className={`alert ${receiptFlow.alert.type}`}>
            {receiptFlow.alert.type === 'success' ? '✅' : '❌'} {receiptFlow.alert.message}
          </div>
        )}

        {!isOnboardingPreview && showOnboarding && hasLoadedOnboardingPreference && activeTab === 'scan' && !dashboardData.isLoading && dashboardData.expenses.length === 0 && (
          <section className="onboarding-card" aria-label="Короткий онбординг">
            <div className="onboarding-copy">
              <span className="onboarding-kicker">Короткий старт</span>
              <h2>Сохраните первый расход за 30 секунд</h2>
              <p>
                Загрузите фото чека или введите сумму вручную, проверьте данные и сохраните.
                После этого запись сразу появится в дашборде.
              </p>
            </div>

            <div className="onboarding-steps">
              <div className="onboarding-step">
                <strong>1</strong>
                <span>Добавьте чек или сумму.</span>
              </div>
              <div className="onboarding-step">
                <strong>2</strong>
                <span>Проверьте магазин, дату и позиции.</span>
              </div>
              <div className="onboarding-step">
                <strong>3</strong>
                <span>Сохраните и откройте дашборд.</span>
              </div>
            </div>

            <div className="onboarding-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  dismissOnboarding();
                  openManualReceiptEntry();
                }}
              >
                Начать ввод
              </button>
            </div>
          </section>
        )}

        {activeTab === 'scan' && (
          <>
        <header className="header">
          <h1>🧾 Трекер Расходов</h1>
          <p>Автоматическое распознавание чеков с помощью ИИ</p>
        </header>

        <div className="tabs">
          <button
            className="tab"
            onClick={openDashboard}
          >
            📊 Дашборд
          </button>
          <Link className="tab" href="/account">
            Account
          </Link>
        </div>
          </>
        )}

        {activeTab === 'scan' ? (
          <ScanTab
            uploadedImage={receiptFlow.uploadedImage}
            receiptData={receiptFlow.receiptData}
            editedItems={receiptFlow.editedItems}
            storeName={receiptFlow.storeName}
            purchaseDateManual={receiptFlow.purchaseDateManual}
            purchaseDateWarningText={receiptFlow.purchaseDateWarningText}
            purchaseDatePreviewText={receiptFlow.purchaseDatePreviewText}
            manualStoreName={receiptFlow.manualStoreName}
            manualPurchaseDate={receiptFlow.manualPurchaseDate}
            manualTotal={receiptFlow.manualTotal}
            categoryOptions={categoryOptions.categoryOptions}
            customCategories={categoryOptions.customCategories}
            recurringPlans={recurringExpenses.plans}
            isRecurringLoading={recurringExpenses.isLoading}
            isRecurringSaving={recurringExpenses.isSaving}
            deletingRecurringId={recurringExpenses.deletingId}
            isAnalyzing={receiptFlow.isAnalyzing}
            isSaving={receiptFlow.isSaving}
            onAddCategory={categoryOptions.addCategory}
            onDeleteCategory={categoryOptions.removeCategory}
            onCreateRecurring={recurringExpenses.createPlan}
            onDeleteRecurring={(id) => recurringExpenses.deletePlan(id, defaultCurrency)}
            fileInputRef={receiptFlow.fileInputRef}
            onDrop={receiptFlow.handleDrop}
            onFileSelect={receiptFlow.handleFile}
            onAnalyze={receiptFlow.handleAnalyzeReceipt}
            onReset={receiptFlow.resetScanner}
            onSave={receiptFlow.handleSaveReceipt}
            onManualSave={receiptFlow.handleManualSave}
            onStoreNameChange={receiptFlow.setStoreName}
            onPurchaseDateChange={receiptFlow.setPurchaseDate}
            onPurchaseDateManualChange={receiptFlow.setPurchaseDateManual}
            onManualStoreNameChange={receiptFlow.setManualStoreName}
            onManualPurchaseDateChange={receiptFlow.setManualPurchaseDate}
            onManualTotalChange={receiptFlow.setManualTotal}
            onManualTotalBlur={receiptFlow.normalizeManualTotal}
            onItemUpdate={receiptFlow.updateItem}
            onItemDelete={receiptFlow.deleteItem}
            currentTotal={receiptFlow.currentTotal}
            focusManualEntrySignal={manualEntryRequest}
            currencyCode={defaultCurrency}
          />
        ) : (
          <DashboardTab
            startDate={startDate}
            endDate={endDate}
            selectedStore={selectedStore}
            stores={stores}
            expenses={expenses}
            categoryOptions={categoryOptions.categoryOptions}
            customCategories={categoryOptions.customCategories}
            prevMonthTotal={prevMonthTotal}
            prevPeriodCategoryTotals={prevPeriodCategoryTotals}
            analyzeCost={analyzeCost}
            currencies={currencies}
            selectedCurrency={selectedCurrency}
            isLoading={dashboardData.isLoading}
            onAddCategory={categoryOptions.addCategory}
            onDeleteCategory={categoryOptions.removeCategory}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onStoreChange={setSelectedStore}
            onCurrencyChange={(value) => setSelectedCurrency(normalizeCurrencyCode(value))}
            onRefresh={() => void loadExpenses()}
            onOpenScan={openManualReceiptEntry}
            currencyCode={activeCurrency}
            analyzeUsage={analyzeUsage}
            isAnalyzeUsageLoading={isAnalyzeUsageLoading}
          />
        )}
      </main>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DashboardTab from '@/features/expenses/components/DashboardTab';
import ScanTab from '@/features/expenses/components/ScanTab';
import { useCategoryOptions } from '@/features/expenses/hooks/useCategoryOptions';
import { useDashboardData } from '@/features/expenses/hooks/useDashboardData';
import { useRecurringExpenses } from '@/features/expenses/hooks/useRecurringExpenses';
import { useReceiptFlow } from '@/features/expenses/hooks/useReceiptFlow';
import { getAccountSettings, getAnalyzeUsage, type AnalyzeUsage } from '@/lib/account-api';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currency';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'scan' | 'dashboard'>('scan');
  const [manualEntryRequest, setManualEntryRequest] = useState(0);
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [analyzeUsage, setAnalyzeUsage] = useState<AnalyzeUsage | null>(null);
  const [isAnalyzeUsageLoading, setIsAnalyzeUsageLoading] = useState(true);
  const receiptFlow = useReceiptFlow(defaultCurrency);
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

  return (
    <div className="app-container">
      <main className="main-full">
        {receiptFlow.alert && (
          <div className={`alert ${receiptFlow.alert.type}`}>
            {receiptFlow.alert.type === 'success' ? '✅' : '❌'} {receiptFlow.alert.message}
          </div>
        )}

        {activeTab === 'scan' && (
          <>
        <header className="header">
          <h1>🧾 Трекер Расходов</h1>
          <p>Автоматическое распознавание чеков с помощью ИИ</p>
        </header>

        <div className="tabs">
          <button className={`tab ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>
            📷 Сканирование
          </button>
          <button
            className="tab"
            onClick={() => {
              setActiveTab('dashboard');
            }}
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
            purchaseDate={receiptFlow.purchaseDate}
            purchaseDateManual={receiptFlow.purchaseDateManual}
            purchaseDateWarningText={receiptFlow.purchaseDateWarningText}
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

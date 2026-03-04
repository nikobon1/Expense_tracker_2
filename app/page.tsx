'use client';

import { useEffect, useState } from 'react';
import DashboardTab from '@/features/expenses/components/DashboardTab';
import ScanTab from '@/features/expenses/components/ScanTab';
import { useDashboardData } from '@/features/expenses/hooks/useDashboardData';
import { useReceiptFlow } from '@/features/expenses/hooks/useReceiptFlow';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'scan' | 'dashboard'>('scan');
  const receiptFlow = useReceiptFlow();
  const dashboardData = useDashboardData();
  const {
    startDate,
    endDate,
    selectedStore,
    stores,
    expenses,
    prevMonthTotal,
    setStartDate,
    setEndDate,
    setSelectedStore,
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

  return (
    <div className="app-container">
      <main className="main-full">
        {receiptFlow.alert && (
          <div className={`alert ${receiptFlow.alert.type}`}>
            {receiptFlow.alert.type === 'success' ? '✅' : '❌'} {receiptFlow.alert.message}
          </div>
        )}

        <header className="header">
          <h1>🧾 Трекер Расходов</h1>
          <p>Автоматическое распознавание чеков с помощью ИИ</p>
        </header>

        <div className="tabs">
          <button className={`tab ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>
            📷 Сканирование
          </button>
          <button
            className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Дашборд
          </button>
        </div>

        {activeTab === 'scan' ? (
          <ScanTab
            uploadedImage={receiptFlow.uploadedImage}
            receiptData={receiptFlow.receiptData}
            editedItems={receiptFlow.editedItems}
            storeName={receiptFlow.storeName}
            purchaseDate={receiptFlow.purchaseDate}
            purchaseDateManual={receiptFlow.purchaseDateManual}
            manualStoreName={receiptFlow.manualStoreName}
            manualPurchaseDate={receiptFlow.manualPurchaseDate}
            manualTotal={receiptFlow.manualTotal}
            isAnalyzing={receiptFlow.isAnalyzing}
            isSaving={receiptFlow.isSaving}
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
            onItemUpdate={receiptFlow.updateItem}
            onItemDelete={receiptFlow.deleteItem}
            currentTotal={receiptFlow.currentTotal}
          />
        ) : (
          <DashboardTab
            startDate={startDate}
            endDate={endDate}
            selectedStore={selectedStore}
            stores={stores}
            expenses={expenses}
            prevMonthTotal={prevMonthTotal}
            isLoading={dashboardData.isLoading}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onStoreChange={setSelectedStore}
            onRefresh={() => void loadExpenses()}
          />
        )}
      </main>
    </div>
  );
}

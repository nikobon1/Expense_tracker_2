"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import {
  getAccountSettings,
  getAnalyzeUsage,
  updateAccountSettings,
  type AccountUser,
} from "@/lib/account-api";

type SaveState = {
  type: "success" | "error";
  message: string;
} | null;

type AnalyzeUsageState = {
  dailyLimit: number;
  countToday: number;
  cooldownSeconds: number;
  latestCreatedAt: string | null;
  retryAfterSeconds: number | null;
  canAnalyzeNow: boolean;
} | null;

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0s";

  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [name, setName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [timezone, setTimezone] = useState("Europe/London");
  const [usage, setUsage] = useState<AnalyzeUsageState>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsageLoading, setIsUsageLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const usageBadgeLabel = isUsageLoading ? "Loading" : usage?.canAnalyzeNow ? "Available" : "Cooling down";
  const usageBadgeClass = isUsageLoading ? "neutral" : usage?.canAnalyzeNow ? "ok" : "warn";

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const currentUser = await getAccountSettings();
        if (!isActive) return;

        setUser(currentUser);
        setName(currentUser.name ?? "");
        setDefaultCurrency(currentUser.defaultCurrency);
        setTimezone(currentUser.timezone);
      } catch (error) {
        if (!isActive) return;
        setSaveState({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load account settings",
        });
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const currentUsage = await getAnalyzeUsage();
        if (!isActive) return;

        setUsage(currentUsage);
      } catch (error) {
        if (!isActive) return;
        setUsageError(error instanceof Error ? error.message : "Failed to load analyze usage");
      } finally {
        if (isActive) {
          setIsUsageLoading(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveState(null);

    try {
      const updatedUser = await updateAccountSettings({
        name,
        defaultCurrency,
        timezone,
      });

      setUser(updatedUser);
      setName(updatedUser.name ?? "");
      setDefaultCurrency(updatedUser.defaultCurrency);
      setTimezone(updatedUser.timezone);
      setSaveState({ type: "success", message: "Account settings saved." });
    } catch (error) {
      setSaveState({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save account settings",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="app-container">
      <main className="main-full">
        <header className="header">
          <h1>Account Settings</h1>
          <p>Manage your profile, default currency, and timezone.</p>
        </header>

        <div className="tabs">
          <Link className="tab" href="/">
            Dashboard
          </Link>
          <span className="tab active">Account</span>
        </div>

        {saveState ? (
          <div className={`alert ${saveState.type}`}>
            {saveState.message}
          </div>
        ) : null}

        <div className="card">
          {isLoading ? (
            <div className="empty-state">
              <div className="spinner"></div>
              <p>Loading account settings...</p>
            </div>
          ) : (
            <>
              <div className="scan-form-grid">
                <div>
                  <label className="scan-field-label">Email</label>
                  <input
                    type="email"
                    className="scan-field-input"
                    value={user?.email ?? ""}
                    disabled
                  />
                </div>

                <div>
                  <label className="scan-field-label">Display Name</label>
                  <input
                    type="text"
                    className="scan-field-input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label className="scan-field-label">Default Currency</label>
                  <select
                    className="scan-field-input"
                    value={defaultCurrency}
                    onChange={(event) => setDefaultCurrency(event.target.value)}
                  >
                    {SUPPORTED_CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="scan-field-label">Timezone</label>
                  <input
                    type="text"
                    className="scan-field-input"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    placeholder="Europe/London"
                  />
                </div>
              </div>

              <div className="account-usage-card">
                <div className="account-usage-head">
                  <div>
                    <div className="scan-field-label">Analyze quota</div>
                    <p>Current usage is tracked per account and resets every UTC day.</p>
                  </div>
                  <div className={`account-usage-badge ${usageBadgeClass}`}>
                    {usageBadgeLabel}
                  </div>
                </div>

                {isUsageLoading ? (
                  <div className="account-usage-loading">
                    <div className="spinner"></div>
                    <span>Loading quota usage...</span>
                  </div>
                ) : usage ? (
                  <div className="account-usage-grid">
                    <div className="account-usage-metric">
                      <span>Today</span>
                      <strong>
                        {usage.countToday} / {usage.dailyLimit > 0 ? usage.dailyLimit : "∞"}
                      </strong>
                    </div>
                    <div className="account-usage-metric">
                      <span>Cooldown</span>
                      <strong>{formatSeconds(usage.cooldownSeconds)}</strong>
                    </div>
                    <div className="account-usage-metric">
                      <span>Next scan</span>
                      <strong>{usage.canAnalyzeNow ? "Now" : `In ${formatSeconds(usage.retryAfterSeconds ?? 0)}`}</strong>
                    </div>
                    <div className="account-usage-metric">
                      <span>Last analyze</span>
                      <strong>{usage.latestCreatedAt ? new Date(usage.latestCreatedAt).toLocaleString("ru-RU") : "None yet"}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="account-usage-loading">
                    <span>Quota usage is unavailable right now.</span>
                  </div>
                )}
                {usageError ? <p className="account-usage-error">{usageError}</p> : null}
              </div>

              <div className="receipt-editor-actions" style={{ marginTop: "1.5rem" }}>
                <Link href="/" className="btn btn-secondary">
                  Back
                </Link>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

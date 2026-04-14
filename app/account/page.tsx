"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from "@/lib/currency";
import { getAccountSettings, updateAccountSettings, type AccountUser } from "@/lib/account-api";

type SaveState = {
  type: "success" | "error";
  message: string;
} | null;

export default function AccountPage() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [name, setName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState(DEFAULT_CURRENCY);
  const [timezone, setTimezone] = useState("Europe/London");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(null);

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

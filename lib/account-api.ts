import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";

export type AccountUser = {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  defaultCurrency: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

type AccountResponse = {
  user: AccountUser;
};

export type AnalyzeUsage = {
  dailyLimit: number;
  countToday: number;
  cooldownSeconds: number;
  latestCreatedAt: string | null;
  retryAfterSeconds: number | null;
  canAnalyzeNow: boolean;
};

type AnalyzeUsageResponse = {
  usage: AnalyzeUsage;
};

async function readJsonOrText(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getErrorMessage(response: Response, payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload.trim().slice(0, 200);
  }

  return fallback;
}

function isAccountResponse(payload: unknown): payload is AccountResponse {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "user" in payload &&
      (payload as { user?: unknown }).user &&
      typeof (payload as { user?: unknown }).user === "object"
  );
}

function isAnalyzeUsageResponse(payload: unknown): payload is AnalyzeUsageResponse {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      "usage" in payload &&
      (payload as { usage?: unknown }).usage &&
      typeof (payload as { usage?: unknown }).usage === "object"
  );
}

function normalizeAccountUser(user: AccountUser): AccountUser {
  return {
    ...user,
    defaultCurrency: normalizeCurrencyCode(user.defaultCurrency ?? DEFAULT_CURRENCY),
    timezone: String(user.timezone ?? "Europe/London").trim() || "Europe/London",
  };
}

export async function getAccountSettings(): Promise<AccountUser> {
  const response = await fetch("/api/account");
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Failed to load account settings"));
  }

  if (!isAccountResponse(payload)) {
    throw new Error("Account response is invalid");
  }

  return normalizeAccountUser(payload.user);
}

export async function updateAccountSettings(payload: {
  name: string;
  defaultCurrency: string;
  timezone: string;
}): Promise<AccountUser> {
  const response = await fetch("/api/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const parsed = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, parsed, "Failed to update account settings"));
  }

  if (!isAccountResponse(parsed)) {
    throw new Error("Account response is invalid");
  }

  return normalizeAccountUser(parsed.user);
}

export async function getAnalyzeUsage(): Promise<AnalyzeUsage> {
  const response = await fetch("/api/analyze/usage");
  const payload = await readJsonOrText(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(response, payload, "Failed to load analyze usage"));
  }

  if (!isAnalyzeUsageResponse(payload)) {
    throw new Error("Analyze usage response is invalid");
  }

  return payload.usage;
}

export const DEFAULT_CURRENCY = "EUR";

export const SUPPORTED_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "RUB",
  "BRL",
  "PLN",
  "AED",
  "TRY",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function normalizeCurrencyCode(value: string | null | undefined): SupportedCurrency {
  const normalized = String(value ?? "").trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)
    ? (normalized as SupportedCurrency)
    : DEFAULT_CURRENCY;
}

export function formatCurrencyAmount(
  value: number,
  currencyCode: string,
  options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
): string {
  const normalizedCurrency = normalizeCurrencyCode(currencyCode);
  const minimumFractionDigits = options?.minimumFractionDigits ?? 2;
  const maximumFractionDigits = options?.maximumFractionDigits ?? minimumFractionDigits;

  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}


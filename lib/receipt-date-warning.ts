const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReceiptDateWarning = {
  shouldWarn: boolean;
  diffDays: number;
  direction: "past" | "future" | "today";
  thresholdDays: number;
};

function getUtcStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseIsoDate(value: string): Date | null {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getReceiptDateWarning(
  isoDate: string,
  thresholdDays: number = 1,
  today: Date = new Date()
): ReceiptDateWarning | null {
  const parsedReceiptDate = parseIsoDate(isoDate);
  if (!parsedReceiptDate) return null;

  const safeThreshold = Number.isFinite(thresholdDays) ? Math.max(0, Math.floor(thresholdDays)) : 1;
  const todayUtc = getUtcStart(today);
  const diffDaysSigned = Math.round((parsedReceiptDate.getTime() - todayUtc.getTime()) / MS_PER_DAY);
  const diffDays = Math.abs(diffDaysSigned);
  const direction: ReceiptDateWarning["direction"] =
    diffDaysSigned === 0 ? "today" : diffDaysSigned < 0 ? "past" : "future";

  return {
    shouldWarn: diffDays > safeThreshold,
    diffDays,
    direction,
    thresholdDays: safeThreshold,
  };
}


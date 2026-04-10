const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APP_DATE_TIME_ZONE = "Europe/London";

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatCalendarDateInTimeZone(date: Date, timeZone: string = APP_DATE_TIME_ZONE): string {
  if (Number.isNaN(date.getTime())) return "";

  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function normalizeCalendarDate(
  value: string | Date | null | undefined,
  timeZone: string = APP_DATE_TIME_ZONE
): string {
  if (!value) return "";

  if (value instanceof Date) {
    return formatCalendarDateInTimeZone(value, timeZone);
  }

  const raw = String(value).trim();
  if (!raw) return "";
  if (ISO_DATE_RE.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  return formatCalendarDateInTimeZone(parsed, timeZone);
}

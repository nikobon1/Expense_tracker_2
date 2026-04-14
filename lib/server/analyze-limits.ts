import { getDb } from "@/lib/server/receipts";

const DEFAULT_ANALYZE_COOLDOWN_SECONDS = 20;
const DEFAULT_ANALYZE_DAILY_LIMIT = 40;

type AnalyzeLimitsRow = {
  count_today: number | string;
  latest_created_at: string | Date | null;
};

export class AnalyzeLimitError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, options?: { status?: number; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = "AnalyzeLimitError";
    this.status = options?.status ?? 429;
    this.retryAfterSeconds = options?.retryAfterSeconds ?? null;
  }
}

export function isAnalyzeLimitError(error: unknown): error is AnalyzeLimitError {
  return error instanceof AnalyzeLimitError;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function getAnalyzeCooldownSeconds(): number {
  return readPositiveInteger(
    process.env.RECEIPT_ANALYZE_COOLDOWN_SECONDS,
    DEFAULT_ANALYZE_COOLDOWN_SECONDS
  );
}

function getDailyAnalyzeLimit(): number {
  return readPositiveInteger(process.env.RECEIPT_ANALYZE_DAILY_LIMIT, DEFAULT_ANALYZE_DAILY_LIMIT);
}

function getUtcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function normalizeTimestamp(value: string | Date | null): Date | null {
  if (!value) return null;

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function assertAnalyzeAllowed(userId: number): Promise<void> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AnalyzeLimitError("Invalid user for analyze limit check", { status: 400 });
  }

  const sql = getDb();
  const now = new Date();
  const utcDayStart = getUtcDayStart(now);
  const rows = (await sql`
    SELECT
      (
        SELECT COUNT(*)
        FROM receipt_analyze_logs
        WHERE user_id = ${userId}
          AND created_at >= ${utcDayStart}
      ) AS count_today,
      (
        SELECT MAX(created_at)
        FROM receipt_analyze_logs
        WHERE user_id = ${userId}
      ) AS latest_created_at
  `) as AnalyzeLimitsRow[];

  const usage = rows[0];
  const countToday = Number(usage?.count_today ?? 0);
  const latestCreatedAt = normalizeTimestamp(usage?.latest_created_at ?? null);

  const dailyLimit = getDailyAnalyzeLimit();
  if (dailyLimit > 0 && countToday >= dailyLimit) {
    throw new AnalyzeLimitError(
      `Daily analyze quota reached (${dailyLimit} scans). Try again tomorrow.`,
      { retryAfterSeconds: secondsUntilTomorrowUtc(now) }
    );
  }

  const cooldownSeconds = getAnalyzeCooldownSeconds();
  if (cooldownSeconds > 0 && latestCreatedAt) {
    const secondsSinceLastAnalyze = Math.floor((now.getTime() - latestCreatedAt.getTime()) / 1000);
    if (secondsSinceLastAnalyze < cooldownSeconds) {
      const retryAfterSeconds = Math.max(1, cooldownSeconds - secondsSinceLastAnalyze);
      throw new AnalyzeLimitError(
        `Please wait ${retryAfterSeconds}s before analyzing another receipt.`,
        { retryAfterSeconds }
      );
    }
  }
}

function secondsUntilTomorrowUtc(now: Date): number {
  const tomorrowUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );

  return Math.max(1, Math.ceil((tomorrowUtcStart.getTime() - now.getTime()) / 1000));
}

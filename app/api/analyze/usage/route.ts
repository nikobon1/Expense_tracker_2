import { NextResponse } from "next/server";
import { requireCurrentUser, isAuthenticationRequiredError } from "@/lib/server/auth";
import { getDb } from "@/lib/server/receipts";

const DEFAULT_ANALYZE_COOLDOWN_SECONDS = 20;
const DEFAULT_ANALYZE_DAILY_LIMIT = 40;

type AnalyzeUsageRow = {
  count_today: number | string;
  latest_created_at: string | Date | null;
};

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

function secondsUntilTomorrowUtc(now: Date): number {
  const tomorrowUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );

  return Math.max(1, Math.ceil((tomorrowUtcStart.getTime() - now.getTime()) / 1000));
}

export async function GET() {
  try {
    const currentUser = await requireCurrentUser();
    const sql = getDb();
    const now = new Date();
    const utcDayStart = getUtcDayStart(now);
    const rows = (await sql`
      SELECT
        (
          SELECT COUNT(*)
          FROM receipt_analyze_logs
          WHERE user_id = ${currentUser.id}
            AND created_at >= ${utcDayStart}
        ) AS count_today,
        (
          SELECT MAX(created_at)
          FROM receipt_analyze_logs
          WHERE user_id = ${currentUser.id}
        ) AS latest_created_at
    `) as AnalyzeUsageRow[];

    const usage = rows[0];
    const countToday = Number(usage?.count_today ?? 0);
    const latestCreatedAt = normalizeTimestamp(usage?.latest_created_at ?? null);
    const dailyLimit = getDailyAnalyzeLimit();
    const cooldownSeconds = getAnalyzeCooldownSeconds();

    let retryAfterSeconds: number | null = null;
    if (cooldownSeconds > 0 && latestCreatedAt) {
      const secondsSinceLastAnalyze = Math.floor((now.getTime() - latestCreatedAt.getTime()) / 1000);
      if (secondsSinceLastAnalyze < cooldownSeconds) {
        retryAfterSeconds = Math.max(1, cooldownSeconds - secondsSinceLastAnalyze);
      }
    }

    if (dailyLimit > 0 && countToday >= dailyLimit) {
      const dailyRetryAfter = secondsUntilTomorrowUtc(now);
      retryAfterSeconds =
        retryAfterSeconds == null ? dailyRetryAfter : Math.min(retryAfterSeconds, dailyRetryAfter);
    }

    return NextResponse.json({
      usage: {
        dailyLimit,
        countToday,
        cooldownSeconds,
        latestCreatedAt: latestCreatedAt ? latestCreatedAt.toISOString() : null,
        retryAfterSeconds,
        canAnalyzeNow: retryAfterSeconds == null,
      },
    });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load analyze usage" },
      { status: 500 }
    );
  }
}

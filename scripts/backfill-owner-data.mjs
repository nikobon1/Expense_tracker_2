import { neon } from "@neondatabase/serverless";

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "RUB", "BRL", "PLN", "AED", "TRY"];
const TARGET_TABLES = [
  "receipts",
  "custom_categories",
  "recurring_expenses",
  "receipt_analyze_logs",
  "telegram_receipt_drafts",
];

function normalizeCurrencyCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(normalized) ? normalized : "EUR";
}

function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();

  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex === -1) {
      flags.add(raw);
      continue;
    }

    const key = raw.slice(0, equalsIndex).trim();
    const value = raw.slice(equalsIndex + 1);
    if (key) {
      values.set(key, value);
    }
  }

  return { flags, values };
}

const { flags: cliFlags, values: cliValues } = parseArgs(process.argv);

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return databaseUrl;
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function getOption(name, envName, fallback = "") {
  const cliValue = cliValues.get(name);
  if (cliValue != null) {
    return cliValue.trim();
  }

  return String(process.env[envName] ?? fallback).trim();
}

async function countMissingUserIds(sql, tableName) {
  const rows = await sql.query(`SELECT COUNT(*) AS count FROM ${tableName} WHERE user_id IS NULL`);
  return Number(rows[0]?.count ?? 0);
}

async function ensureOwnerUser(sql) {
  const preferredEmail = getOption("owner-email", "BACKFILL_OWNER_EMAIL").toLowerCase();
  const preferredName = getOption("owner-name", "BACKFILL_OWNER_NAME", "Owner") || "Owner";
  const preferredImage = getOption("owner-image", "BACKFILL_OWNER_IMAGE") || null;
  const preferredCurrency = normalizeCurrencyCode(getOption("owner-currency", "BACKFILL_OWNER_DEFAULT_CURRENCY"));
  const preferredTimezone = getOption("owner-timezone", "BACKFILL_OWNER_TIMEZONE", "Europe/London") || "Europe/London";

  if (preferredEmail) {
    const rows = await sql`
      SELECT id, email, name, image, default_currency, timezone
      FROM users
      WHERE LOWER(email) = ${preferredEmail}
      LIMIT 1
    `;

    if (rows[0]) {
      return rows[0];
    }

    const createdRows = await sql`
      INSERT INTO users (email, name, image, default_currency, timezone)
      VALUES (${preferredEmail}, ${preferredName}, ${preferredImage}, ${preferredCurrency}, ${preferredTimezone})
      RETURNING id, email, name, image, default_currency, timezone
    `;

    if (!createdRows[0]) {
      throw new Error("Failed to create owner user");
    }

    return createdRows[0];
  }

  const rows = await sql`
    SELECT id, email, name, image, default_currency, timezone
    FROM users
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `;

  if (rows[0]) {
    return rows[0];
  }

  throw new Error(
    "No users exist yet. Set BACKFILL_OWNER_EMAIL to create the owner user before backfilling."
  );
}

async function run() {
  const sql = neon(getDatabaseUrl());
  const dryRun = cliFlags.has("dry-run") || isTruthy(process.env.BACKFILL_DRY_RUN);

  const owner = await ensureOwnerUser(sql);

  await sql.transaction(async (tx) => {
    const before = {};
    for (const tableName of TARGET_TABLES) {
      before[tableName] = await countMissingUserIds(tx, tableName);
    }

    console.log("Backfill owner user:", {
      id: Number(owner.id),
      email: owner.email,
      currency: owner.default_currency,
      timezone: owner.timezone,
    });
    console.log("Rows missing user_id before backfill:", before);

    if (dryRun) {
      console.log("Dry run requested. No rows were updated.");
      return;
    }

    for (const tableName of TARGET_TABLES) {
      await tx.query(`UPDATE ${tableName} SET user_id = ${owner.id} WHERE user_id IS NULL`);
    }

    const after = {};
    for (const tableName of TARGET_TABLES) {
      after[tableName] = await countMissingUserIds(tx, tableName);
    }

    console.log("Rows missing user_id after backfill:", after);

    const stillMissing = Object.entries(after).filter(([, count]) => count > 0);
    if (stillMissing.length > 0) {
      throw new Error(
        `Backfill incomplete: ${stillMissing
          .map(([tableName, count]) => `${tableName}=${count}`)
          .join(", ")}`
      );
    }

    console.log("Backfill completed successfully.");
  });
}

run().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});

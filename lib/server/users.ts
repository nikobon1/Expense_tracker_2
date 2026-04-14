import { getDb } from "@/lib/server/receipts";
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/currency";

export type AppUser = {
  id: number;
  email: string;
  name: string | null;
  image: string | null;
  defaultCurrency: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

type UserRow = {
  id: number | string;
  email: string;
  name: string | null;
  image: string | null;
  default_currency: string | null;
  timezone: string | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
};

type UpsertUserInput = {
  email: string;
  name?: string | null;
  image?: string | null;
};

type UpdateUserPreferencesInput = {
  name?: string | null;
  defaultCurrency?: string | null;
  timezone?: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeTimestamp(value: string | Date | null): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value : "";
}

function mapUserRow(row: UserRow): AppUser {
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    image: row.image,
    defaultCurrency: normalizeCurrencyCode(row.default_currency ?? DEFAULT_CURRENCY),
    timezone: row.timezone ?? "Europe/London",
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function normalizeTimezone(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  return normalized || "Europe/London";
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const sql = getDb();
  const rows = (await sql`
    SELECT id, email, name, image, default_currency, timezone, created_at, updated_at
    FROM users
    WHERE LOWER(email) = ${normalizedEmail}
    LIMIT 1
  `) as UserRow[];

  return rows[0] ? mapUserRow(rows[0]) : null;
}

export async function getUserById(id: number): Promise<AppUser | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const sql = getDb();
  const rows = (await sql`
    SELECT id, email, name, image, default_currency, timezone, created_at, updated_at
    FROM users
    WHERE id = ${id}
    LIMIT 1
  `) as UserRow[];

  return rows[0] ? mapUserRow(rows[0]) : null;
}

export async function upsertUserFromSession(input: UpsertUserInput): Promise<AppUser> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    throw new Error("Authenticated user email is required");
  }

  const normalizedName = normalizeNullableText(input.name);
  const normalizedImage = normalizeNullableText(input.image);
  const sql = getDb();

  const rows = (await sql`
    INSERT INTO users (email, name, image)
    VALUES (${normalizedEmail}, ${normalizedName}, ${normalizedImage})
    ON CONFLICT ((LOWER(email))) DO UPDATE
    SET
      name = COALESCE(EXCLUDED.name, users.name),
      image = COALESCE(EXCLUDED.image, users.image),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, email, name, image, default_currency, timezone, created_at, updated_at
  `) as UserRow[];

  if (!rows[0]) {
    throw new Error("Failed to load or create internal user");
  }

  return mapUserRow(rows[0]);
}

export async function updateUserPreferences(userId: number, input: UpdateUserPreferencesInput): Promise<AppUser> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid user id");
  }

  const normalizedName = normalizeNullableText(input.name);
  const normalizedCurrency = normalizeCurrencyCode(input.defaultCurrency);
  const normalizedTimezone = normalizeTimezone(input.timezone);

  if (normalizedTimezone.length > 100) {
    throw new Error("Timezone must be 100 characters or fewer");
  }

  const sql = getDb();
  const rows = (await sql`
    UPDATE users
    SET
      name = ${normalizedName},
      default_currency = ${normalizedCurrency},
      timezone = ${normalizedTimezone},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${userId}
    RETURNING id, email, name, image, default_currency, timezone, created_at, updated_at
  `) as UserRow[];

  if (!rows[0]) {
    throw new Error("User not found");
  }

  return mapUserRow(rows[0]);
}

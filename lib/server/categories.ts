import { CATEGORIES } from "@/features/expenses/constants";
import { getDatabaseSchemaMissingMessage, getDb, isDatabaseSchemaMissingError } from "@/lib/server/receipts";

function normalizeCategoryName(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function getCustomCategoriesFromDb(userId: number): Promise<string[]> {
  const sql = getDb();

  const rows = (await sql`
    SELECT name
    FROM custom_categories
    WHERE user_id = ${userId}
    ORDER BY name
  `) as Array<{ name: string | null }>;

  return rows
    .map((row) => normalizeCategoryName(row.name ?? ""))
    .filter(Boolean)
    .filter(
      (category, index, all) =>
        all.findIndex((candidate) => candidate.toLocaleLowerCase("ru") === category.toLocaleLowerCase("ru")) === index &&
        !CATEGORIES.some((baseCategory) => baseCategory.toLocaleLowerCase("ru") === category.toLocaleLowerCase("ru"))
    );
}

export async function createCategoryInDb(userId: number, name: string): Promise<{ name: string; existed: boolean }> {
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName) {
    throw new Error("Category name is required");
  }

  const sql = getDb();

  const existingRows = (await sql`
    SELECT name
    FROM custom_categories
    WHERE user_id = ${userId}
      AND LOWER(name) = LOWER(${normalizedName})
    LIMIT 1
  `) as Array<{ name: string | null }>;

  if (existingRows[0]?.name) {
    return { name: normalizeCategoryName(existingRows[0].name), existed: true };
  }

  const insertedRows = (await sql`
    INSERT INTO custom_categories (name, user_id)
    VALUES (${normalizedName}, ${userId})
    RETURNING name
  `) as Array<{ name: string | null }>;

  return { name: normalizeCategoryName(insertedRows[0]?.name ?? normalizedName), existed: false };
}

export async function deleteCategoryFromDb(userId: number, name: string): Promise<{ name: string; deleted: boolean }> {
  const normalizedName = normalizeCategoryName(name);
  if (!normalizedName) {
    throw new Error("Category name is required");
  }

  if (CATEGORIES.some((baseCategory) => baseCategory.toLocaleLowerCase("ru") === normalizedName.toLocaleLowerCase("ru"))) {
    throw new Error("Base categories cannot be deleted");
  }

  const sql = getDb();

  const deletedRows = (await sql`
    DELETE FROM custom_categories
    WHERE user_id = ${userId}
      AND LOWER(name) = LOWER(${normalizedName})
    RETURNING name
  `) as Array<{ name: string | null }>;

  return {
    name: normalizeCategoryName(deletedRows[0]?.name ?? normalizedName),
    deleted: deletedRows.length > 0,
  };
}

export { getDatabaseSchemaMissingMessage, isDatabaseSchemaMissingError };

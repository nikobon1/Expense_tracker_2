import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/features/expenses/constants";
import {
  createCategoryInDb,
  getCustomCategoriesFromDb,
  getDatabaseSchemaMissingMessage,
  isDatabaseSchemaMissingError,
} from "@/lib/server/categories";

function normalizeCategoryInput(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mergeCategoryOptions(customCategories: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const category of [...CATEGORIES, ...customCategories]) {
    const normalized = normalizeCategoryInput(category);
    if (!normalized) continue;

    const key = normalized.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(normalized);
  }

  return merged.sort((a, b) => a.localeCompare(b, "ru"));
}

export async function GET() {
  try {
    const customCategories = await getCustomCategoriesFromDb();
    return NextResponse.json({
      categories: mergeCategoryOptions(customCategories),
      customCategories,
    });
  } catch (error) {
    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load categories" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { name?: unknown };
    const normalizedName = normalizeCategoryInput(payload?.name);

    if (!normalizedName) {
      return NextResponse.json({ error: "Введите название категории." }, { status: 400 });
    }

    if (normalizedName.length > 40) {
      return NextResponse.json({ error: "Название категории должно быть не длиннее 40 символов." }, { status: 400 });
    }

    const existingBaseCategory = CATEGORIES.find(
      (category) => category.toLocaleLowerCase("ru") === normalizedName.toLocaleLowerCase("ru")
    );
    if (existingBaseCategory) {
      return NextResponse.json({
        success: true,
        category: existingBaseCategory,
        existed: true,
        categories: CATEGORIES,
      });
    }

    const result = await createCategoryInDb(normalizedName);
    const customCategories = await getCustomCategoriesFromDb();

    return NextResponse.json({
      success: true,
      category: result.name,
      existed: result.existed,
      categories: mergeCategoryOptions(customCategories),
    });
  } catch (error) {
    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save category" },
      { status: 500 }
    );
  }
}

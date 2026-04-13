import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/features/expenses/constants";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";
import {
  createCategoryInDb,
  deleteCategoryFromDb,
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
    const currentUser = await requireCurrentUser();
    const customCategories = await getCustomCategoriesFromDb(currentUser.id);
    return NextResponse.json({
      categories: mergeCategoryOptions(customCategories),
      customCategories,
    });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

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
    const currentUser = await requireCurrentUser();
    const payload = (await request.json()) as { name?: unknown };
    const normalizedName = normalizeCategoryInput(payload?.name);

    if (!normalizedName) {
      return NextResponse.json({ error: "Category name is required." }, { status: 400 });
    }

    if (normalizedName.length > 40) {
      return NextResponse.json({ error: "Category name must be 40 characters or fewer." }, { status: 400 });
    }

    const existingBaseCategory = CATEGORIES.find(
      (category) => category.toLocaleLowerCase("ru") === normalizedName.toLocaleLowerCase("ru")
    );
    if (existingBaseCategory) {
      const customCategories = await getCustomCategoriesFromDb(currentUser.id);
      return NextResponse.json({
        success: true,
        category: existingBaseCategory,
        existed: true,
        categories: mergeCategoryOptions(customCategories),
        customCategories,
      });
    }

    const result = await createCategoryInDb(currentUser.id, normalizedName);
    const customCategories = await getCustomCategoriesFromDb(currentUser.id);

    return NextResponse.json({
      success: true,
      category: result.name,
      existed: result.existed,
      categories: mergeCategoryOptions(customCategories),
      customCategories,
    });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save category" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const payload = (await request.json()) as { name?: unknown };
    const normalizedName = normalizeCategoryInput(payload?.name);

    if (!normalizedName) {
      return NextResponse.json({ error: "Category name is required." }, { status: 400 });
    }

    const isBaseCategory = CATEGORIES.some(
      (category) => category.toLocaleLowerCase("ru") === normalizedName.toLocaleLowerCase("ru")
    );
    if (isBaseCategory) {
      return NextResponse.json({ error: "Built-in categories cannot be deleted." }, { status: 400 });
    }

    const result = await deleteCategoryFromDb(currentUser.id, normalizedName);
    const customCategories = await getCustomCategoriesFromDb(currentUser.id);

    return NextResponse.json({
      success: true,
      category: result.name,
      deleted: result.deleted,
      categories: mergeCategoryOptions(customCategories),
      customCategories,
    });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    if (isDatabaseSchemaMissingError(error)) {
      return NextResponse.json({ error: getDatabaseSchemaMissingMessage() }, { status: 503 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete category" },
      { status: 500 }
    );
  }
}

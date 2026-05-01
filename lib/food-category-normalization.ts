import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeStoreName } from "@/lib/store-normalization";

const FOOD_CATEGORY = "\u0415\u0434\u0430";
const COFFEE_CATEGORY = "\u041a\u043e\u0444\u0435";

function isFoodStore(storeName: string | null | undefined): boolean {
  const normalized = normalizeStoreName(String(storeName ?? "")).toLocaleLowerCase("ru");
  return (
    normalized.includes("pingo doce") ||
    normalized.includes("continente") ||
    normalized.includes("\u0433\u0430\u0441\u0442\u0440\u043e\u043d\u043e\u043c \u0441\u043b\u0430\u0432\u044f\u043d\u0441\u043a\u0438\u0439")
  );
}

function looksLikeCoffeeItem(itemName: string | null | undefined): boolean {
  const normalized = String(itemName ?? "").trim().toLocaleLowerCase("ru");
  return (
    normalized.includes("\u043a\u043e\u0444\u0435") ||
    normalized.includes("coffee") ||
    normalized.includes("cafe") ||
    normalized.includes("espresso") ||
    normalized.includes("\u044d\u0441\u043f\u0440\u0435\u0441\u0441\u043e")
  );
}

export function normalizeFoodSubcategory(
  storeName: string | null | undefined,
  itemName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === COFFEE_CATEGORY) return COFFEE_CATEGORY;
  if (looksLikeCoffeeItem(itemName)) return COFFEE_CATEGORY;
  if (normalizedCategory && normalizedCategory !== FOOD_CATEGORY) return normalizedCategory;
  if (isFoodStore(storeName)) return FOOD_CATEGORY;

  return normalizedCategory;
}

export function normalizeReceiptCategory(
  storeName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === COFFEE_CATEGORY) {
    return FOOD_CATEGORY;
  }

  if (isFoodStore(storeName)) {
    return FOOD_CATEGORY;
  }

  return normalizedCategory;
}

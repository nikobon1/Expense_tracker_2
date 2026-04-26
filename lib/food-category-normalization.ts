import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeStoreName } from "@/lib/store-normalization";

function isFoodStore(storeName: string | null | undefined): boolean {
  const normalized = normalizeStoreName(String(storeName ?? "")).toLocaleLowerCase("ru");
  return (
    normalized.includes("pingo doce") ||
    normalized.includes("continente") ||
    normalized.includes("гастроном славянский")
  );
}

function looksLikeCoffeeItem(itemName: string | null | undefined): boolean {
  const normalized = String(itemName ?? "").trim().toLocaleLowerCase("ru");
  return (
    normalized.includes("кофе") ||
    normalized.includes("coffee") ||
    normalized.includes("cafe") ||
    normalized.includes("espresso") ||
    normalized.includes("эспрессо")
  );
}

export function normalizeFoodSubcategory(
  storeName: string | null | undefined,
  itemName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);
  if (normalizedCategory === "Кофе") return "Кофе";
  if (looksLikeCoffeeItem(itemName)) return "Кофе";
  if (isFoodStore(storeName)) return "Еда";
  return normalizedCategory;
}

export function normalizeReceiptCategory(
  storeName: string | null | undefined,
  category: string | null | undefined
): string {
  const normalizedCategory = normalizeCategory(category);

  if (normalizedCategory === "Кофе") {
    return "Еда";
  }

  if (isFoodStore(storeName)) {
    return "Еда";
  }

  return normalizedCategory;
}

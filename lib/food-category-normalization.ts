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

export function normalizeReceiptCategory(
  storeName: string | null | undefined,
  category: string | null | undefined
): string {
  if (isFoodStore(storeName)) {
    return "Еда";
  }

  return normalizeCategory(category);
}

import { CATEGORIES } from "@/features/expenses/constants";

const DEFAULT_CATEGORY = CATEGORIES.includes("Другое") ? "Другое" : "Other";

function countMojibakeMarkers(value: string): number {
  return Array.from(value).reduce((count, ch) => count + (ch === "Р" || ch === "С" ? 1 : 0), 0);
}

export function normalizeCategory(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_CATEGORY;

  const exact = CATEGORIES.find((category) => category === raw);
  if (exact) return exact;

  const lower = raw.toLowerCase();
  const caseInsensitive = CATEGORIES.find((category) => category.toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive;

  const likelyMojibake =
    raw.includes("вЂ") || raw.includes("рџ") || raw.includes("Ð") || raw.includes("Ñ") || countMojibakeMarkers(raw) >= 2;

  if (likelyMojibake) {
    return DEFAULT_CATEGORY;
  }

  return raw;
}

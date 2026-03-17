import { CATEGORIES } from "@/features/expenses/constants";

const DEFAULT_CATEGORY = CATEGORIES.includes("Другое") ? "Другое" : "Other";
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  "????": "Кофе",
};

function countMojibakeMarkers(value: string): number {
  return Array.from(value).reduce((count, ch) => count + (ch === "Р" || ch === "С" ? 1 : 0), 0);
}

export function normalizeCategory(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_CATEGORY;

  const legacyMapped = LEGACY_CATEGORY_MAP[raw];
  if (legacyMapped && CATEGORIES.includes(legacyMapped)) return legacyMapped;

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

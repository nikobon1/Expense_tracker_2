import { CATEGORIES, DEFAULT_CATEGORY } from "@/features/expenses/constants";

const LEGACY_CATEGORY_MAP: Record<string, string> = {
  "????": "Кофе",
};

const CYRILLIC_PATTERN = /[\u0400-\u04FF]/;
const INVALID_DECODE_PATTERN = /\uFFFD/;

function looksLikeMojibake(value: string): boolean {
  return /(?:Ð.|Ñ.|Ã.){2,}|(?:Р.|С.|Г.){2,}/.test(value);
}

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function matchKnownCategory(value: string): string | null {
  const exact = CATEGORIES.find((category) => category === value);
  if (exact) return exact;

  const lower = value.toLocaleLowerCase("ru");
  return CATEGORIES.find((category) => category.toLocaleLowerCase("ru") === lower) ?? null;
}

function recoverUtf8Mojibake(value: string): string | null {
  if (!looksLikeMojibake(value)) return null;

  try {
    const recovered = normalizeWhitespace(Buffer.from(value, "latin1").toString("utf8"));
    if (!recovered || recovered === value || INVALID_DECODE_PATTERN.test(recovered)) {
      return null;
    }

    if (!CYRILLIC_PATTERN.test(recovered) && looksLikeMojibake(recovered)) {
      return null;
    }

    return recovered;
  } catch {
    return null;
  }
}

export function normalizeCategory(value: string | null | undefined): string {
  const raw = normalizeWhitespace(value);
  if (!raw) return DEFAULT_CATEGORY;

  const mapped = LEGACY_CATEGORY_MAP[raw];
  if (mapped) return mapped;

  const knownCategory = matchKnownCategory(raw);
  if (knownCategory) return knownCategory;

  const recovered = recoverUtf8Mojibake(raw);
  if (recovered) {
    const recoveredMapped = LEGACY_CATEGORY_MAP[recovered];
    if (recoveredMapped) return recoveredMapped;

    const recoveredKnownCategory = matchKnownCategory(recovered);
    if (recoveredKnownCategory) return recoveredKnownCategory;

    return recovered;
  }

  if (looksLikeMojibake(raw)) {
    return DEFAULT_CATEGORY;
  }

  return raw;
}

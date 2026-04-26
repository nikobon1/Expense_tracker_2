function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function simplify(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toLookupKey(value: string): string {
  return simplify(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type StoreAliasRule = {
  canonical: string;
  matches: (lookupKey: string) => boolean;
};

const STORE_ALIAS_RULES: StoreAliasRule[] = [
  {
    canonical: "Continente",
    matches: (lookupKey) => /\bcontinente\b/.test(lookupKey),
  },
  {
    canonical: "NEKA",
    matches: (lookupKey) => /\bneka\b/.test(lookupKey),
  },
  {
    canonical: "So Coffee Roasters",
    matches: (lookupKey) => {
      const compact = lookupKey.replace(/\s+/g, "");
      if (compact.includes("socoffee")) return true;
      if (!/\bcoffee\b/.test(lookupKey)) return false;
      return /\bso\b/.test(lookupKey) || /\broasters?\b/.test(lookupKey);
    },
  },
  {
    canonical: "Гастроном Славянский",
    matches: (lookupKey) => {
      const tokens = lookupKey.split(" ");
      return tokens.some((token) =>
        /^(?:славянский|славянский|славянск[а-яё]*)$/u.test(token) ||
        /^(?:slavyanskiy|slavyansky|slavyanskij|slavyanskyy|slavyansk|slovyansk|slouvyabskyy)$/i.test(token) ||
        token.includes("slavyansk") ||
        token.includes("slovyansk") ||
        token.includes("slouvyabskyy")
      );
    },
  },
];

export function normalizeStoreName(value: string): string {
  const trimmed = collapseWhitespace(String(value ?? ""));
  if (!trimmed) return "";

  const lookupKey = toLookupKey(trimmed);
  for (const rule of STORE_ALIAS_RULES) {
    if (rule.matches(lookupKey)) {
      return rule.canonical;
    }
  }

  return trimmed;
}

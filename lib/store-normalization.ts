function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function simplify(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeStoreName(value: string): string {
  const trimmed = collapseWhitespace(String(value ?? ""));
  if (!trimmed) return "";

  const simplified = simplify(trimmed).replace(/[.,]/g, "");

  // Continente variants:
  // "COntinente Hipermercados", "Continente Hipermercados Sa", etc.
  if (simplified.startsWith("continente")) {
    return "Continente";
  }

  return trimmed;
}


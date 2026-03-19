export function parseFlexibleAmount(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  let cleaned = raw
    .replace(/[€$£₽₴¥₸₾₱₹₩₦₫₭₡₲₵₮\s\u00A0]/g, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned) return null;
  if (/^-/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIdx = Math.max(lastComma, lastDot);

  if (decimalIdx >= 0) {
    const intPartRaw = cleaned.slice(0, decimalIdx).replace(/[.,]/g, "");
    const fracPartRaw = cleaned.slice(decimalIdx + 1).replace(/[.,]/g, "");
    const normalized =
      fracPartRaw.length > 0 && fracPartRaw.length <= 2
        ? `${intPartRaw || "0"}.${fracPartRaw}`
        : `${cleaned.replace(/[.,]/g, "") || "0"}`;

    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  cleaned = cleaned.replace(/[.,]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function formatAmountForInput(value: number): string {
  return value.toFixed(2);
}

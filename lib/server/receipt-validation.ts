import { z, ZodError } from "zod";
import type { ReceiptItem } from "@/features/expenses/types";
import { normalizeCategory } from "@/lib/category-normalization";
import { normalizeCurrencyCode } from "@/lib/currency";
import { normalizeStoreName } from "@/lib/store-normalization";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!isoDateRegex.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const receiptItemSchema = z.object({
  name: z.string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Each item must have a name"),
  price: z.coerce.number()
    .finite("Each item price must be a valid number")
    .nonnegative("Each item price must be zero or greater"),
  category: z.string()
    .transform((value) => normalizeCategory(value))
    .refine((value) => value.trim().length > 0, "Each item must have a category"),
});

const receiptPayloadSchema = z.object({
  store_name: z.string()
    .transform((value) => normalizeStoreName(value))
    .refine((value) => value.length > 0, "Store name is required"),
  purchase_date: z.string()
    .trim()
    .refine(isValidIsoDate, "purchase_date must be a valid YYYY-MM-DD date"),
  currency: z.string()
    .optional()
    .transform((value) => (typeof value === "string" && value.trim() ? normalizeCurrencyCode(value) : undefined)),
  items: z.array(receiptItemSchema)
    .min(1, "At least one item is required"),
  comment: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().max(500, "Comment must be 500 characters or less").optional().nullable()
  ).transform((value) => value || undefined),
});

export type ReceiptPayload = {
  store_name: string;
  purchase_date: string;
  currency?: string;
  items: ReceiptItem[];
  comment?: string;
};

export function parseReceiptPayload(payload: unknown): ReceiptPayload {
  const parsed = receiptPayloadSchema.parse(payload);
  return {
    store_name: parsed.store_name,
    purchase_date: parsed.purchase_date,
    currency: parsed.currency,
    items: parsed.items as ReceiptItem[],
    comment: parsed.comment,
  };
}

export function isReceiptValidationError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

export function getReceiptValidationErrorMessage(error: ZodError): string {
  return error.issues[0]?.message || "Invalid receipt payload";
}

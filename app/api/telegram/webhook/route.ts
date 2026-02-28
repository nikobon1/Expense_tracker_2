import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/features/expenses/constants";
import type { ReceiptData, ReceiptItem } from "@/features/expenses/types";
import { analyzeReceiptImageDataUrl } from "@/lib/server/analyze-receipt";
import {
  claimTelegramUpdate,
  deleteTelegramDraft,
  getTelegramDraft,
  saveReceiptToDb,
  saveTelegramDraft,
} from "@/lib/server/receipts";

export const runtime = "nodejs";

type TelegramPhotoSize = { file_id: string; width: number; height: number; file_size?: number };
type TelegramDocument = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TelegramUser = { id: number; username?: string; first_name?: string };
type TelegramChat = { id: number; type: string };
type TelegramInlineKeyboardButton = { text: string; callback_data: string };
type TelegramInlineKeyboardMarkup = { inline_keyboard: TelegramInlineKeyboardButton[][] };
type TelegramReplyKeyboardButton = { text: string };
type TelegramReplyKeyboardMarkup = {
  keyboard: TelegramReplyKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};
type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;
type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
};
type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

function getAllowedUserIds(): Set<number> | null {
  const raw = process.env.TELEGRAM_ALLOWED_USER_IDS?.trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
  return new Set(ids);
}

function assertWebhookSecret(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expected) return;
  const actual = request.headers.get("x-telegram-bot-api-secret-token");
  if (actual !== expected) throw new Error("Invalid Telegram webhook secret");
}

async function telegramApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!response.ok || !json.ok || json.result === undefined) {
    throw new Error(json.description || `Telegram API error (${method})`);
  }

  return json.result;
}

function getDraftInlineKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "вњ… РЎРѕС…СЂР°РЅРёС‚СЊ", callback_data: "draft:save" },
        { text: "вќЊ РћС‚РјРµРЅР°", callback_data: "draft:cancel" },
      ],
      [
        { text: "рџ”Ѓ РџРѕРєР°Р·Р°С‚СЊ", callback_data: "draft:show" },
        { text: "рџ“… РЎРµРіРѕРґРЅСЏ", callback_data: "draft:today" },
      ],
      [{ text: "вњЏпёЏ РСЃРїСЂР°РІРёС‚СЊ", callback_data: "draft:edit" }],
    ],
  };
}

function getMainMenuReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "Add photo" }], [{ text: "Add manual amount" }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Choose an action",
  };
}

function getDefaultCategory(): string {
  return CATEGORIES.includes("Р”СЂСѓРіРѕРµ") ? "Р”СЂСѓРіРѕРµ" : (CATEGORIES.at(-1) ?? "Other");
}

function createManualDraft(seed?: {
  storeName?: string;
  totalAmount?: number;
  purchaseDate?: string;
}): ReceiptData {
  return {
    store_name: seed?.storeName?.trim() || "Manual entry",
    purchase_date: seed?.purchaseDate || todayIsoDate(),
    items: [
      {
        name: "Purchase without receipt",
        price: seed?.totalAmount ?? 0,
        category: getDefaultCategory(),
      },
    ],
  };
}

function parseManualCommandSeed(text: string): { storeName?: string; totalAmount?: number; purchaseDate?: string } | null {
  const match = /^\/manual(?:@[a-zA-Z0-9_]+)?(?:\s+(.+))?$/i.exec(text.trim());
  if (!match) return null;

  const rawArgs = match[1]?.trim();
  if (!rawArgs) return {};

  const parts = rawArgs
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};
  if (parts.length > 3) return null;

  const storeName = parts[0];
  let totalAmount: number | undefined;
  let purchaseDate: string | undefined;

  if (parts[1]) {
    const parsedAmount = parsePrice(parts[1]);
    if (parsedAmount === null) return null;
    totalAmount = parsedAmount;
  }

  if (parts[2]) {
    const parsedDate = parseIsoDateFromUser(parts[2]);
    if (!parsedDate) return null;
    purchaseDate = parsedDate;
  }

  return {
    storeName,
    totalAmount,
    purchaseDate,
  };
}

function getManualModeHelpText(): string {
  return [
    "<b>Manual mode</b>",
    "",
    "Create a purchase without a receipt photo.",
    "Commands:",
    "вЂў <code>Store Lidl</code>",
    "вЂў <code>Sum 12.49</code>",
    "вЂў <code>Date 14/02/26</code>",
    "вЂў <code>Save</code>",
    "",
    "Fast option:",
    "вЂў <code>/manual Lidl; 12.49; 14/02/26</code>",
  ].join("\n");
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { replyMarkup?: TelegramReplyMarkup }
) {
  try {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  } catch (error) {
    console.error("Telegram sendMessage error:", error);
  }
}

async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  } catch (error) {
    console.error("Telegram answerCallbackQuery error:", error);
  }
}

async function sendTyping(chatId: number) {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    // no-op
  }
}

async function fetchTelegramFileAsDataUrl(fileId: string, fallbackMime = "image/jpeg"): Promise<string> {
  const file = await telegramApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram file path is missing");

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${getBotToken()}/${file.file_path}`);
  if (!fileResponse.ok) throw new Error("Failed to download image from Telegram");

  const headerContentType = fileResponse.headers.get("content-type") || "";
  const contentType = headerContentType.startsWith("image/") ? headerContentType : fallbackMime;
  const buffer = Buffer.from(await fileResponse.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function getBestImageSource(message: TelegramMessage): { fileId: string; mimeType: string } | null {
  const photos = message.photo ?? [];
  if (photos.length > 0) {
    const best = [...photos].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    return { fileId: best.file_id, mimeType: "image/jpeg" };
  }

  const doc = message.document;
  if (doc?.mime_type?.startsWith("image/")) {
    return { fileId: doc.file_id, mimeType: doc.mime_type };
  }

  return null;
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sumItems(items: ReceiptItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function formatDateHuman(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
}

function truncate(input: string, max = 42): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}вЂ¦`;
}

function formatDraftPreview(receipt: ReceiptData, note?: string): string {
  const items = receipt.items ?? [];
  const total = sumItems(items);
  const lines: string[] = [];

  if (note) {
    lines.push(note);
    lines.push("");
  }

  lines.push("рџ§ѕ <b>РџСЂРѕРІРµСЂСЊС‚Рµ С‡РµРє РїРµСЂРµРґ СЃРѕС…СЂР°РЅРµРЅРёРµРј</b>");
  lines.push(`рџЏЄ РњР°РіР°Р·РёРЅ: <b>${escapeHtml(receipt.store_name || "РќРµ СѓРєР°Р·Р°РЅ")}</b>`);
  lines.push(`рџ“… Р”Р°С‚Р°: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "РЅРµ РѕРїСЂРµРґРµР»РµРЅР°"))}</b>`);
  lines.push(`рџ’° РЎСѓРјРјР°: <b>${total.toFixed(2)} в‚¬</b>`);
  lines.push(`рџ§ѕ РџРѕР·РёС†РёР№: <b>${items.length}</b>`);
  lines.push("");
  lines.push("<b>РџРѕР·РёС†РёРё:</b>");

  const maxItems = 12;
  for (const [idx, item] of items.slice(0, maxItems).entries()) {
    const name = escapeHtml(truncate(item.name || "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ", 30));
    const category = escapeHtml(truncate(item.category || "Р”СЂСѓРіРѕРµ", 18));
    lines.push(`${idx + 1}. ${name} вЂ” ${Number(item.price || 0).toFixed(2)} в‚¬ (${category})`);
  }
  if (items.length > maxItems) {
    lines.push(`вЂ¦ Рё РµС‰С‘ ${items.length - maxItems}`);
  }

  lines.push("");
  lines.push("<b>РљРѕРјР°РЅРґС‹:</b>");
  lines.push("вЂў <code>РЎРѕС…СЂР°РЅРёС‚СЊ</code> вЂ” СЃРѕС…СЂР°РЅРёС‚СЊ РІ Р±Р°Р·Сѓ");
  lines.push("вЂў <code>РћС‚РјРµРЅР°</code> вЂ” СѓРґР°Р»РёС‚СЊ С‡РµСЂРЅРѕРІРёРє");
  lines.push("вЂў <code>РџРѕРєР°Р·Р°С‚СЊ</code> вЂ” РїРѕРєР°Р·Р°С‚СЊ С‡РµРє РµС‰С‘ СЂР°Р·");
  lines.push("вЂў <code>Р”Р°С‚Р° 14/02/26</code>");
  lines.push("вЂў <code>РњР°РіР°Р·РёРЅ Lidl</code>");
  lines.push("вЂў <code>Р¦РµРЅР° 3 12.49</code>");
  lines.push("вЂў <code>РќР°Р·РІР°РЅРёРµ 2 Р‘Р°РЅР°РЅС‹</code>");
  lines.push("вЂў <code>РљР°С‚РµРіРѕСЂРёСЏ 2 Р¤СЂСѓРєС‚С‹</code>");
  lines.push("вЂў <code>РЈРґР°Р»РёС‚СЊ 5</code>");

  return lines.join("\n");
}

async function sendDraftPreviewMessage(chatId: number, receipt: ReceiptData, note?: string) {
  await sendTelegramMessage(chatId, formatDraftPreview(receipt, note), {
    replyMarkup: getDraftInlineKeyboard(),
  });
}

async function createAndSendManualDraft(
  chatId: number,
  userId: number | null,
  seed?: { storeName?: string; totalAmount?: number; purchaseDate?: string }
) {
  const manualDraft = createManualDraft(seed);
  await saveTelegramDraft(chatId, userId, manualDraft);
  await sendDraftPreviewMessage(
    chatId,
    manualDraft,
    seed?.totalAmount !== undefined
      ? "OK: manual purchase draft created. Review and save."
      : "Manual mode started. Set Store and Sum, then save."
  );
  await sendTelegramMessage(chatId, getManualModeHelpText());
}

async function handleMainMenuTextCommand(params: {
  chatId: number;
  userId: number | null;
  text: string;
}): Promise<{ handled: boolean; result?: string }> {
  const normalized = normalizeCommand(params.text).toLowerCase();

  if (normalized === "add photo") {
    await sendTelegramMessage(params.chatId, "Send a receipt photo (or image as file).", {
      replyMarkup: getMainMenuReplyKeyboard(),
    });
    return { handled: true, result: "menu_text_add_photo" };
  }

  if (normalized === "add manual amount") {
    await createAndSendManualDraft(params.chatId, params.userId);
    return { handled: true, result: "menu_text_add_manual" };
  }

  return { handled: false };
}

function getDraftEditHelpText(): string {
  return [
    "вњЏпёЏ <b>РљР°Рє РёСЃРїСЂР°РІРёС‚СЊ С‡РµРє</b>",
    "",
    "РћС‚РїСЂР°РІСЊС‚Рµ РѕРґРЅРѕ СЃРѕРѕР±С‰РµРЅРёРµ СЃ РЅСѓР¶РЅРѕР№ РїСЂР°РІРєРѕР№:",
    "вЂў <code>Р”Р°С‚Р° 14/02/26</code>",
    "вЂў <code>РњР°РіР°Р·РёРЅ Lidl</code>",
    "вЂў <code>Р¦РµРЅР° 3 12.49</code>",
    "вЂў <code>РќР°Р·РІР°РЅРёРµ 2 Р‘Р°РЅР°РЅС‹</code>",
    "вЂў <code>РљР°С‚РµРіРѕСЂРёСЏ 2 Р¤СЂСѓРєС‚С‹</code>",
    "вЂў <code>РЈРґР°Р»РёС‚СЊ 5</code>",
    "",
    "РџРѕСЃР»Рµ РїСЂР°РІРєРё Р±РѕС‚ РїСЂРёС€Р»С‘С‚ РѕР±РЅРѕРІР»С‘РЅРЅС‹Р№ С‡РµСЂРЅРѕРІРёРє СЃ РєРЅРѕРїРєР°РјРё.",
  ].join("\n");
}

function formatSavedSummary(receipt: ReceiptData, totalAmount: number, receiptId: number): string {
  const itemsCount = receipt.items?.length || 0;
  return [
    "вњ… <b>Р§РµРє СЃРѕС…СЂР°РЅС‘РЅ</b>",
    `рџЏЄ РњР°РіР°Р·РёРЅ: <b>${escapeHtml(receipt.store_name || "РќРµРёР·РІРµСЃС‚РЅС‹Р№ РјР°РіР°Р·РёРЅ")}</b>`,
    `рџ“… Р”Р°С‚Р°: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "РЅРµ РѕРїСЂРµРґРµР»РµРЅР°"))}</b>`,
    `рџ§ѕ РџРѕР·РёС†РёР№: <b>${itemsCount}</b>`,
    `рџ’° РЎСѓРјРјР°: <b>${totalAmount.toFixed(2)} в‚¬</b>`,
    `#${receiptId}`,
  ].join("\n");
}

function getHelpText() {
  return [
    "РћС‚РїСЂР°РІСЊС‚Рµ С„РѕС‚Рѕ С‡РµРєР°, Рё СЏ СЂР°СЃРїРѕР·РЅР°СЋ РµРіРѕ Рё РїСЂРёС€Р»СЋ РЅР° РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ.",
    "",
    "РџРѕСЃР»Рµ СЂР°СЃРїРѕР·РЅР°РІР°РЅРёСЏ РјРѕР¶РЅРѕ РёСЃРїСЂР°РІРёС‚СЊ РґР°РЅРЅС‹Рµ РєРѕРјР°РЅРґР°РјРё:",
    "вЂў РЎРѕС…СЂР°РЅРёС‚СЊ / РћС‚РјРµРЅР° / РџРѕРєР°Р·Р°С‚СЊ",
    "вЂў Р”Р°С‚Р° 14/02/26",
    "вЂў РњР°РіР°Р·РёРЅ Lidl",
    "вЂў Р¦РµРЅР° 3 12.49",
    "вЂў РќР°Р·РІР°РЅРёРµ 2 Р‘Р°РЅР°РЅС‹",
    "вЂў РљР°С‚РµРіРѕСЂРёСЏ 2 Р¤СЂСѓРєС‚С‹",
    "вЂў РЈРґР°Р»РёС‚СЊ 5",
    "",
    "РЎРѕРІРµС‚С‹:",
    "вЂў Р›СѓС‡С€Рµ РѕС‚РїСЂР°РІР»СЏС‚СЊ С‡РµРє РєР°Рє С„Р°Р№Р» (Р±РµР· СЃР¶Р°С‚РёСЏ)",
    "вЂў Р’ РєР°РґСЂРµ РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ С‚РѕР»СЊРєРѕ С‡РµРє",
  ].join("\n");
}

function normalizeCommand(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function parseIsoDateFromUser(input: string): string | null {
  const normalized = input.trim().replace(/\./g, "/").replace(/-/g, "/");
  let m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(normalized);
  if (m) return toIsoDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(normalized);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parsePrice(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function looksLikeDraftCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower === "СЃРѕС…СЂР°РЅРёС‚СЊ" ||
    lower === "save" ||
    lower === "/save" ||
    lower === "РѕС‚РјРµРЅР°" ||
    lower === "cancel" ||
    lower === "/cancel" ||
    lower === "РїРѕРєР°Р·Р°С‚СЊ" ||
    lower === "show" ||
    lower === "/show" ||
    lower.startsWith("date ") ||
    lower.startsWith("store ") ||
    lower.startsWith("sum ") ||
    lower.startsWith("/sum ") ||
    lower.startsWith("РґР°С‚Р° ") ||
    lower.startsWith("РјР°РіР°Р·РёРЅ ") ||
    lower.startsWith("С†РµРЅР° ") ||
    lower.startsWith("РЅР°Р·РІР°РЅРёРµ ") ||
    lower.startsWith("РєР°С‚РµРіРѕСЂРёСЏ ") ||
    lower.startsWith("СѓРґР°Р»РёС‚СЊ ")
  );
}

async function handleDraftCommand(params: {
  chatId: number;
  userId: number | null;
  text: string;
}): Promise<{ handled: boolean; result?: string }> {
  const { chatId, userId, text } = params;
  const cmd = normalizeCommand(text);
  const lower = cmd.toLowerCase();

  if (!looksLikeDraftCommand(cmd)) {
    return { handled: false };
  }

  const draft = await getTelegramDraft(chatId);

  if (lower === "РѕС‚РјРµРЅР°" || lower === "cancel" || lower === "/cancel") {
    await deleteTelegramDraft(chatId);
    await sendTelegramMessage(chatId, draft ? "рџ—‘пёЏ Р§РµСЂРЅРѕРІРёРє С‡РµРєР° СѓРґР°Р»С‘РЅ." : "Р§РµСЂРЅРѕРІРёРєР° РЅРµС‚.");
    return { handled: true, result: "draft_cancelled" };
  }

  if (!draft) {
    await sendTelegramMessage(chatId, "No draft yet. Send a receipt photo or use /manual.");
    return { handled: true, result: "no_draft" };
  }

  if (lower === "РїРѕРєР°Р·Р°С‚СЊ" || lower === "show" || lower === "/show") {
    await sendDraftPreviewMessage(chatId, draft);
    return { handled: true, result: "draft_shown" };
  }

  if (lower === "СЃРѕС…СЂР°РЅРёС‚СЊ" || lower === "save" || lower === "/save") {
    const draftWithMeta = draft as ReceiptData & { _telegram_file_id?: string | null };
    const saved = await saveReceiptToDb({
      store_name: draft.store_name,
      purchase_date: draft.purchase_date,
      items: draft.items,
      source: "telegram",
      telegram_file_id: draftWithMeta._telegram_file_id ?? null,
    });
    await deleteTelegramDraft(chatId);
    await sendTelegramMessage(chatId, formatSavedSummary(draft, saved.totalAmount, saved.receiptId));
    return { handled: true, result: "draft_saved" };
  }

  let match = /^date\s+(.+)$/i.exec(cmd);
  if (match) {
    const parsed = parseIsoDateFromUser(match[1]);
    if (!parsed) {
      await sendTelegramMessage(chatId, "Invalid date format. Use: <code>Date 14/02/26</code>");
      return { handled: true, result: "draft_date_invalid" };
    }
    draft.purchase_date = parsed;
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "OK: date updated.");
    return { handled: true, result: "draft_date_updated" };
  }

  match = /^store\s+(.+)$/i.exec(cmd);
  if (match) {
    draft.store_name = match[1].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "OK: store updated.");
    return { handled: true, result: "draft_store_updated" };
  }

  match = /^(?:sum|\/sum)\s+(.+)$/i.exec(cmd);
  if (match) {
    const price = parsePrice(match[1]);
    if (price === null) {
      await sendTelegramMessage(chatId, "Invalid amount. Example: <code>Sum 12.49</code>");
      return { handled: true, result: "draft_sum_invalid" };
    }

    if (!draft.items[0]) {
      draft.items = [
        {
          name: "Purchase without receipt",
          price,
          category: getDefaultCategory(),
        },
      ];
    } else {
      draft.items[0].price = price;
    }

    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "OK: total updated.");
    return { handled: true, result: "draft_sum_updated" };
  }
  match = /^РґР°С‚Р°\s+(.+)$/i.exec(cmd);
  if (match) {
    const parsed = parseIsoDateFromUser(match[1]);
    if (!parsed) {
      await sendTelegramMessage(chatId, "РќРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚ РґР°С‚С‹. РСЃРїРѕР»СЊР·СѓР№С‚Рµ: <code>Р”Р°С‚Р° 14/02/26</code>");
      return { handled: true, result: "draft_date_invalid" };
    }
    draft.purchase_date = parsed;
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "вњ… Р”Р°С‚Р° РѕР±РЅРѕРІР»РµРЅР°.");
    return { handled: true, result: "draft_date_updated" };
  }

  match = /^РјР°РіР°Р·РёРЅ\s+(.+)$/i.exec(cmd);
  if (match) {
    draft.store_name = match[1].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "вњ… РњР°РіР°Р·РёРЅ РѕР±РЅРѕРІР»С‘РЅ.");
    return { handled: true, result: "draft_store_updated" };
  }

  match = /^С†РµРЅР°\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "РќРµС‚ С‚Р°РєРѕР№ РїРѕР·РёС†РёРё. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РЅРѕРјРµСЂ РёР· СЃРїРёСЃРєР°.");
      return { handled: true, result: "draft_item_missing" };
    }
    const price = parsePrice(match[2]);
    if (price === null) {
      await sendTelegramMessage(chatId, "РќРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚ С†РµРЅС‹. РџСЂРёРјРµСЂ: <code>Р¦РµРЅР° 3 12.49</code>");
      return { handled: true, result: "draft_price_invalid" };
    }
    draft.items[index].price = price;
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `вњ… Р¦РµРЅР° РїРѕР·РёС†РёРё ${index + 1} РѕР±РЅРѕРІР»РµРЅР°.`);
    return { handled: true, result: "draft_price_updated" };
  }

  match = /^РЅР°Р·РІР°РЅРёРµ\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "РќРµС‚ С‚Р°РєРѕР№ РїРѕР·РёС†РёРё. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РЅРѕРјРµСЂ РёР· СЃРїРёСЃРєР°.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].name = match[2].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `вњ… РќР°Р·РІР°РЅРёРµ РїРѕР·РёС†РёРё ${index + 1} РѕР±РЅРѕРІР»РµРЅРѕ.`);
    return { handled: true, result: "draft_name_updated" };
  }

  match = /^РєР°С‚РµРіРѕСЂРёСЏ\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "РќРµС‚ С‚Р°РєРѕР№ РїРѕР·РёС†РёРё. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РЅРѕРјРµСЂ РёР· СЃРїРёСЃРєР°.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].category = match[2].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `вњ… РљР°С‚РµРіРѕСЂРёСЏ РїРѕР·РёС†РёРё ${index + 1} РѕР±РЅРѕРІР»РµРЅР°.`);
    return { handled: true, result: "draft_category_updated" };
  }

  match = /^СѓРґР°Р»РёС‚СЊ\s+(\d+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "РќРµС‚ С‚Р°РєРѕР№ РїРѕР·РёС†РёРё. РСЃРїРѕР»СЊР·СѓР№С‚Рµ РЅРѕРјРµСЂ РёР· СЃРїРёСЃРєР°.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items.splice(index, 1);
    if (draft.items.length === 0) {
      await deleteTelegramDraft(chatId);
      await sendTelegramMessage(chatId, "рџ—‘пёЏ Р’СЃРµ РїРѕР·РёС†РёРё СѓРґР°Р»РµРЅС‹, С‡РµСЂРЅРѕРІРёРє С‡РµРєР° СѓРґР°Р»С‘РЅ.");
      return { handled: true, result: "draft_deleted_empty" };
    }
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `вњ… РџРѕР·РёС†РёСЏ ${index + 1} СѓРґР°Р»РµРЅР°.`);
    return { handled: true, result: "draft_item_deleted" };
  }

  return { handled: false };
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

async function handleDraftCallback(params: {
  callbackQueryId: string;
  chatId: number;
  userId: number | null;
  data: string;
}): Promise<{ handled: boolean; result?: string }> {
  const { callbackQueryId, chatId, userId, data } = params;

  if (data === "menu:add_photo") {
    await answerTelegramCallbackQuery(callbackQueryId, "Send a receipt photo");
    await sendTelegramMessage(chatId, "Send a receipt photo (or image as file).", {
      replyMarkup: getMainMenuReplyKeyboard(),
    });
    return { handled: true, result: "menu_add_photo" };
  }

  if (data === "menu:add_manual") {
    await answerTelegramCallbackQuery(callbackQueryId, "Creating manual draft");
    await createAndSendManualDraft(chatId, userId);
    return { handled: true, result: "menu_add_manual" };
  }

  if (data === "draft:save") {
    await answerTelegramCallbackQuery(callbackQueryId, "РЎРѕС…СЂР°РЅСЏСЋ...");
    return handleDraftCommand({ chatId, userId, text: "/save" });
  }

  if (data === "draft:cancel") {
    await answerTelegramCallbackQuery(callbackQueryId, "РЈРґР°Р»СЏСЋ С‡РµСЂРЅРѕРІРёРє...");
    return handleDraftCommand({ chatId, userId, text: "/cancel" });
  }

  if (data === "draft:show") {
    await answerTelegramCallbackQuery(callbackQueryId, "РџРѕРєР°Р·С‹РІР°СЋ С‡РµРє");
    return handleDraftCommand({ chatId, userId, text: "/show" });
  }

  if (data === "draft:edit") {
    await answerTelegramCallbackQuery(callbackQueryId, "РћС‚РїСЂР°РІР»СЋ РїРѕРґСЃРєР°Р·РєСѓ");
    await sendTelegramMessage(chatId, getDraftEditHelpText());
    return { handled: true, result: "draft_edit_help" };
  }

  if (data === "draft:today") {
    const draft = await getTelegramDraft(chatId);
    if (!draft) {
      await answerTelegramCallbackQuery(callbackQueryId, "Р§РµСЂРЅРѕРІРёРє РЅРµ РЅР°Р№РґРµРЅ");
      await sendTelegramMessage(chatId, "РќРµС‚ С‡РµСЂРЅРѕРІРёРєР° С‡РµРєР°. РЎРЅР°С‡Р°Р»Р° РїСЂРёС€Р»РёС‚Рµ С„РѕС‚Рѕ С‡РµРєР°.");
      return { handled: true, result: "no_draft" };
    }

    draft.purchase_date = todayIsoDate();
    await saveTelegramDraft(chatId, userId, draft);
    await answerTelegramCallbackQuery(callbackQueryId, "Р”Р°С‚Р° = СЃРµРіРѕРґРЅСЏ");
    await sendDraftPreviewMessage(chatId, draft, "вњ… Р”Р°С‚Р° СѓСЃС‚Р°РЅРѕРІР»РµРЅР° РЅР° СЃРµРіРѕРґРЅСЏ.");
    return { handled: true, result: "draft_date_today" };
  }

  return { handled: false };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telegram-webhook",
    hint: "POST updates from Telegram here",
  });
}

export async function POST(request: NextRequest) {
  let update: TelegramUpdate | null = null;

  try {
    assertWebhookSecret(request);
    update = (await request.json()) as TelegramUpdate;

    if (typeof update?.update_id !== "number") {
      return NextResponse.json({ ok: true, ignored: "invalid_update" });
    }

    const claimed = await claimTelegramUpdate(update.update_id);
    if (!claimed) {
      return NextResponse.json({ ok: true, ignored: "duplicate_update" });
    }

    const callbackQuery = update.callback_query;
    if (callbackQuery) {
      const chatId = callbackQuery.message?.chat.id;
      const fromUserId = callbackQuery.from?.id ?? null;
      const allowlist = getAllowedUserIds();
      if (chatId == null) {
        await answerTelegramCallbackQuery(callbackQuery.id, "РќРµС‚ С‡Р°С‚Р°");
        return NextResponse.json({ ok: true, ignored: "callback_without_chat" });
      }
      if (allowlist && (!fromUserId || !allowlist.has(fromUserId))) {
        await answerTelegramCallbackQuery(callbackQuery.id, "РќРµС‚ РґРѕСЃС‚СѓРїР°");
        await sendTelegramMessage(chatId, "в›”пёЏ РЈ РІР°СЃ РЅРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ Р±РѕС‚Сѓ.");
        return NextResponse.json({ ok: true, ignored: "forbidden_user" });
      }

      const callbackHandled = await handleDraftCallback({
        callbackQueryId: callbackQuery.id,
        chatId,
        userId: fromUserId,
        data: (callbackQuery.data || "").trim(),
      });
      if (callbackHandled.handled) {
        return NextResponse.json({ ok: true, handled: callbackHandled.result ?? "callback" });
      }

      await answerTelegramCallbackQuery(callbackQuery.id, "РќРµРёР·РІРµСЃС‚РЅР°СЏ РєРЅРѕРїРєР°");
      return NextResponse.json({ ok: true, ignored: "unknown_callback" });
    }

    const message = update.message ?? update.edited_message;
    if (!message) {
      return NextResponse.json({ ok: true, ignored: "unsupported_update" });
    }

    const chatId = message.chat.id;
    const fromUserId = message.from?.id ?? null;
    const allowlist = getAllowedUserIds();
    if (allowlist && (!fromUserId || !allowlist.has(fromUserId))) {
      await sendTelegramMessage(chatId, "в›”пёЏ РЈ РІР°СЃ РЅРµС‚ РґРѕСЃС‚СѓРїР° Рє СЌС‚РѕРјСѓ Р±РѕС‚Сѓ.");
      return NextResponse.json({ ok: true, ignored: "forbidden_user" });
    }

    const text = (message.text || "").trim();
    if (text) {
      const lower = text.toLowerCase();
      if (lower === "/start" || lower.startsWith("/start@") || lower === "/help" || lower.startsWith("/help@")) {
        await sendTelegramMessage(chatId, getHelpText(), {
          replyMarkup: getMainMenuReplyKeyboard(),
        });
        return NextResponse.json({ ok: true, handled: "help" });
      }

      const isManualCommand = /^\/manual(?:@[a-zA-Z0-9_]+)?(?:\s+.*)?$/i.test(text);
      const manualSeed = parseManualCommandSeed(text);
      if (isManualCommand) {
        if (manualSeed === null) {
          await sendTelegramMessage(chatId, "Invalid /manual format.\n\n" + getManualModeHelpText());
          return NextResponse.json({ ok: true, handled: "manual_draft_invalid" });
        }

        await createAndSendManualDraft(chatId, fromUserId, manualSeed);
        return NextResponse.json({ ok: true, handled: "manual_draft_created" });
      }
      const mainMenuCommand = await handleMainMenuTextCommand({ chatId, userId: fromUserId, text });
      if (mainMenuCommand.handled) {
        return NextResponse.json({ ok: true, handled: mainMenuCommand.result ?? "main_menu_text" });
      }
      const draftCommand = await handleDraftCommand({ chatId, userId: fromUserId, text });
      if (draftCommand.handled) {
        return NextResponse.json({ ok: true, handled: draftCommand.result ?? "draft_command" });
      }
    }

    const source = getBestImageSource(message);
    if (!source) {
      await sendTelegramMessage(chatId, "Send a receipt photo or choose an action below.", {
        replyMarkup: getMainMenuReplyKeyboard(),
      });
      return NextResponse.json({ ok: true, handled: "no_image" });
    }

    await sendTyping(chatId);
    const imageDataUrl = await fetchTelegramFileAsDataUrl(source.fileId, source.mimeType);
    const receipt = await analyzeReceiptImageDataUrl(imageDataUrl);
    await saveTelegramDraft(chatId, fromUserId, receipt, { telegram_file_id: source.fileId });

    await sendDraftPreviewMessage(chatId, receipt, "вњ… Р§РµРє СЂР°СЃРїРѕР·РЅР°РЅ. РџСЂРѕРІРµСЂСЊС‚Рµ РґР°РЅРЅС‹Рµ РїРµСЂРµРґ СЃРѕС…СЂР°РЅРµРЅРёРµРј.");
    return NextResponse.json({ ok: true, handled: "draft_created" });
  } catch (error) {
    console.error("Telegram webhook error:", error);

    const chatId =
      update?.message?.chat?.id ?? update?.edited_message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
    if (chatId) {
      const msg =
        error instanceof Error
          ? `вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ С‡РµРє.\n${escapeHtml(error.message)}`
          : "вќЊ РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ С‡РµРє.";
      await sendTelegramMessage(chatId, msg);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 }
    );
  }
}




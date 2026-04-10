import { NextRequest, NextResponse } from "next/server";
import type { ReceiptData, ReceiptItem } from "@/features/expenses/types";
import { parseFlexibleAmount } from "@/lib/amount";
import { analyzeReceiptImageDataUrl } from "@/lib/server/analyze-receipt";
import { getReceiptDateWarning } from "@/lib/receipt-date-warning";
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
type ManualFlowStep = "amount" | "store" | "date" | "ready";
type TelegramDraft = ReceiptData & {
  _telegram_file_id?: string | null;
  _manual_flow_step?: ManualFlowStep | null;
};

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
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
        { text: "Сохранить", callback_data: "draft:save" },
        { text: "Отмена", callback_data: "draft:cancel" },
      ],
      [
        { text: "Показать", callback_data: "draft:show" },
        { text: "Сегодня", callback_data: "draft:today" },
      ],
      [{ text: "Исправить", callback_data: "draft:edit" }],
    ],
  };
}

function getMainMenuReplyKeyboard(): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [[{ text: "Добавить фото" }], [{ text: "Добавить сумму вручную" }]],
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "Выберите действие",
  };
}

function getDefaultCategory(): string {
  return "Другое";
}

function getInitialManualFlowStep(seed?: {
  storeName?: string;
  totalAmount?: number;
  purchaseDate?: string;
}): ManualFlowStep {
  if (seed?.totalAmount === undefined) return "amount";
  if (!seed.storeName?.trim()) return "store";
  if (!seed.purchaseDate) return "date";
  return "ready";
}

function createManualDraft(seed?: {
  storeName?: string;
  totalAmount?: number;
  purchaseDate?: string;
  itemName?: string;
}): TelegramDraft {
  return {
    store_name: seed?.storeName?.trim() || "Ручной ввод",
    purchase_date: seed?.purchaseDate || todayIsoDate(),
    items: [
      {
        name: seed?.itemName?.trim() || "Покупка без чека",
        price: seed?.totalAmount ?? 0,
        category: getDefaultCategory(),
      },
    ],
    _manual_flow_step: getInitialManualFlowStep(seed),
  };
}

function parseManualCommandSeed(text: string): {
  storeName?: string;
  totalAmount?: number;
  purchaseDate?: string;
  itemName?: string;
} | null {
  const match = /^\/manual(?:@[a-zA-Z0-9_]+)?(?:\s+(.+))?$/i.exec(text.trim());
  if (!match) return null;

  const rawArgs = match[1]?.trim();
  if (!rawArgs) return {};

  const parts = rawArgs
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return {};
  if (parts.length > 4) return null;

  let totalAmount: number | undefined;
  let purchaseDate: string | undefined;
  let itemName: string | undefined;

  if (parts.length === 1) {
    const parsedAmount = parsePrice(parts[0]);
    if (parsedAmount !== null) {
      return { totalAmount: parsedAmount };
    }

    const parsedDate = parseIsoDateFromUser(parts[0]);
    if (parsedDate) {
      return { purchaseDate: parsedDate };
    }

    return { storeName: parts[0] };
  }

  const storeName = parts[0];

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

  if (parts[3]) {
    itemName = parts[3];
  }

  return {
    storeName,
    totalAmount,
    purchaseDate,
    itemName,
  };
}

function getManualModeHelpText(): string {
  return [
    "<b>Ручной режим</b>",
    "",
    "Создайте покупку без фото чека.",
    "После /manual бот может пошагово спросить сумму, магазин и дату.",
    "Команды:",
    "- <code>Магазин Lidl</code>",
    "- <code>Сумма 12.49</code> или <code>Сумма 1 234,56</code>",
    "- <code>Дата 14/02/26</code> или <code>Дата 2026-02-14</code>",
    "- <code>Товар Бананы</code>",
    "- <code>Сохранить</code>",
    "",
    "Быстрый вариант:",
    "- <code>/manual 12.49</code>",
    "- <code>/manual Lidl; 12.49; 14/02/26; Бананы</code>",
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
  return `${input.slice(0, max - 3)}...`;
}

function getManualFlowStep(receipt: ReceiptData | null): ManualFlowStep | null {
  if (!receipt) return null;
  const step = (receipt as TelegramDraft)._manual_flow_step;
  return step ?? null;
}

function setManualFlowStep(receipt: ReceiptData, step: ManualFlowStep | null): TelegramDraft {
  const draft = receipt as TelegramDraft;
  if (step) {
    draft._manual_flow_step = step;
  } else {
    delete draft._manual_flow_step;
  }
  return draft;
}

function isSkipInput(input: string): boolean {
  const normalized = normalizeCommand(input).toLowerCase();
  return normalized === "пропустить" || normalized === "skip" || normalized === "нет";
}

function ensureManualDraftItem(draft: ReceiptData): ReceiptItem {
  if (!draft.items[0]) {
    draft.items = [
      {
        name: "Покупка без чека",
        price: 0,
        category: getDefaultCategory(),
      },
    ];
  }

  return draft.items[0];
}

function getManualFlowPrompt(step: ManualFlowStep, draft: ReceiptData): string {
  const total = sumItems(draft.items ?? []);
  const storeName = draft.store_name?.trim() || "Ручной ввод";

  if (step === "amount") {
    return [
      "<b>Ручной режим</b>",
      "",
      "Отправьте сумму покупки одним сообщением.",
      "Примеры: <code>12.49</code>, <code>12,49</code>, <code>1 234,56</code>.",
      "Чтобы выйти, отправьте <code>Отмена</code>.",
    ].join("\n");
  }

  if (step === "store") {
    return [
      `Сумма: <b>${total.toFixed(2)} EUR</b>`,
      "Теперь отправьте название магазина.",
      `Можно написать <code>Пропустить</code> — тогда оставлю <b>${escapeHtml(storeName)}</b>.`,
    ].join("\n");
  }

  return [
    `Сумма: <b>${total.toFixed(2)} EUR</b>`,
    `Магазин: <b>${escapeHtml(storeName)}</b>`,
    "Теперь отправьте дату покупки.",
    "Поддерживаются: <code>14/02/26</code>, <code>14-02-2026</code>, <code>2026-02-14</code> или <code>Сегодня</code>.",
    "Можно написать <code>Пропустить</code> — тогда оставлю сегодняшнюю дату.",
  ].join("\n");
}

function getTelegramDateWarningThresholdDays(): number {
  const raw = process.env.RECEIPT_DATE_WARNING_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 1;
  return Math.floor(parsed);
}

function getDraftDateWarningLines(purchaseDate: string): string[] {
  const warning = getReceiptDateWarning(purchaseDate, getTelegramDateWarningThresholdDays());
  if (!warning?.shouldWarn) return [];

  const formattedPurchaseDate = formatDateHuman(purchaseDate);

  if (warning.direction === "past") {
    return [
      `⚠️ Дата чека: <b>${escapeHtml(formattedPurchaseDate)}</b>. Это на ${warning.diffDays} дн. раньше сегодняшней.`,
      "Такой чек не попадет в текущий период дашборда, пока дата не будет исправлена.",
      "Если чек за сегодня, нажмите «Сегодня» или отправьте команду вида <code>Дата 2026-04-10</code>.",
    ];
  }

  if (warning.direction === "future") {
    return [
      `⚠️ Дата чека: <b>${escapeHtml(formattedPurchaseDate)}</b>. Это на ${warning.diffDays} дн. позже сегодняшней.`,
      "Такой чек не попадет в текущий период дашборда, пока дата не будет исправлена.",
      "Если чек за сегодня, нажмите «Сегодня» или отправьте команду вида <code>Дата 2026-04-10</code>.",
    ];
  }

  return [];
}

function formatDraftPreview(receipt: ReceiptData, note?: string): string {
  const items = receipt.items ?? [];
  const total = sumItems(items);
  const lines: string[] = [];

  if (note) {
    lines.push(note);
    lines.push("");
  }

  lines.push("<b>Проверьте чек перед сохранением</b>");
  lines.push(`Магазин: <b>${escapeHtml(receipt.store_name || "Не указан")}</b>`);
  lines.push(`Дата: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "Не указана"))}</b>`);
  lines.push(`Сумма: <b>${total.toFixed(2)} EUR</b>`);
  lines.push(`Позиций: <b>${items.length}</b>`);
  lines.push("");
  lines.push("<b>Позиции:</b>");

  const dateWarningLines = getDraftDateWarningLines(receipt.purchase_date || "");
  if (dateWarningLines.length > 0) {
    lines.push(...dateWarningLines);
  }

  const maxItems = 12;
  for (const [idx, item] of items.slice(0, maxItems).entries()) {
    const name = escapeHtml(truncate(item.name || "Без названия", 30));
    const category = escapeHtml(truncate(item.category || "Другое", 18));
    lines.push(`${idx + 1}. ${name} - ${Number(item.price || 0).toFixed(2)} EUR (${category})`);
  }
  if (items.length > maxItems) {
    lines.push(`... и еще ${items.length - maxItems}`);
  }

  lines.push("");
  lines.push("<b>Команды:</b>");
  lines.push("- <code>Сохранить</code> - сохранить в базу");
  lines.push("- <code>Отмена</code> - удалить черновик");
  lines.push("- <code>Показать</code> - показать черновик еще раз");
  lines.push("- <code>Дата 14/02/26</code> или <code>Дата 2026-02-14</code>");
  lines.push("- <code>Магазин Lidl</code>");
  lines.push("- <code>Сумма 12.49</code> или <code>Сумма 1 234,56</code>");
  lines.push("- <code>Цена 3 12.49</code>");
  lines.push("- <code>Название 2 Бананы</code>");
  lines.push("- <code>Товар Бананы</code> (для ручной покупки)");
  lines.push("- <code>Категория 2 Фрукты</code>");
  lines.push("- <code>Удалить 5</code>");

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
  seed?: { storeName?: string; totalAmount?: number; purchaseDate?: string; itemName?: string }
) {
  const manualDraft = createManualDraft(seed);
  await saveTelegramDraft(chatId, userId, manualDraft);
  const step = getManualFlowStep(manualDraft);

  if (step && step !== "ready") {
    const note = step === "amount" ? "Ручной режим запущен." : "Черновик ручной покупки создан.";
    await sendTelegramMessage(chatId, `${note}\n\n${getManualFlowPrompt(step, manualDraft)}`);
    return;
  }

  await sendDraftPreviewMessage(chatId, manualDraft, "Черновик ручной покупки создан. Проверьте и сохраните.");
}

async function handleMainMenuTextCommand(params: {
  chatId: number;
  userId: number | null;
  text: string;
}): Promise<{ handled: boolean; result?: string }> {
  const normalized = normalizeCommand(params.text).toLowerCase();

  const photoAliases = new Set([
    "добавить фото",
    "фото",
    "фото чека",
    "добавить фото чека",
    "add photo",
    "photo",
    "receipt photo",
    "add receipt photo",
  ]);
  if (photoAliases.has(normalized)) {
    await sendTelegramMessage(params.chatId, "Отправьте фото чека (или изображение как файл).", {
      replyMarkup: getMainMenuReplyKeyboard(),
    });
    return { handled: true, result: "menu_text_add_photo" };
  }

  const manualAliases = new Set([
    "добавить сумму вручную",
    "ручной режим",
    "вручную",
    "сумма вручную",
    "добавить вручную",
    "add manual amount",
    "manual",
    "add manual",
    "manual amount",
    "add amount",
  ]);
  if (manualAliases.has(normalized)) {
    await createAndSendManualDraft(params.chatId, params.userId);
    return { handled: true, result: "menu_text_add_manual" };
  }

  return { handled: false };
}

function getDraftEditHelpText(): string {
  return [
    "<b>Как исправить чек</b>",
    "",
    "Отправьте одно сообщение с нужной правкой:",
    "- <code>Дата 14/02/26</code>",
    "- <code>Магазин Lidl</code>",
    "- <code>Цена 3 12.49</code>",
    "- <code>Название 2 Бананы</code>",
    "- <code>Товар Бананы</code> (для ручной покупки)",
    "- <code>Категория 2 Фрукты</code>",
    "- <code>Удалить 5</code>",
    "",
    "После каждой правки бот пришлет обновленный черновик.",
  ].join("\n");
}

function formatSavedSummary(receipt: ReceiptData, totalAmount: number, receiptId: number): string {
  const itemsCount = receipt.items?.length || 0;
  return [
    "<b>Чек сохранен</b>",
    `Магазин: <b>${escapeHtml(receipt.store_name || "Неизвестный магазин")}</b>`,
    `Дата: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "Не указана"))}</b>`,
    `Позиций: <b>${itemsCount}</b>`,
    `Сумма: <b>${totalAmount.toFixed(2)} EUR</b>`,
    `#${receiptId}`,
  ].join("\n");
}

function getHelpText() {
  return [
    "Отправьте фото чека, и я распознаю его в черновик для проверки.",
    "",
    "После распознавания можно исправить черновик командами:",
    "- Сохранить / Отмена / Показать",
    "- Дата 14/02/26",
    "- Магазин Lidl",
    "- Сумма 12.49",
    "- Цена 3 12.49",
    "- Название 2 Бананы",
    "- Товар Бананы (для ручной покупки)",
    "- Категория 2 Фрукты",
    "- Удалить 5",
    "",
    "Советы:",
    "- Лучше отправлять чек как файл, а не сжатое фото",
    "- В кадре должен быть только чек",
  ].join("\n");
}

function normalizeCommand(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function parseIsoDateFromUser(input: string): string | null {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  if (lower === "today" || lower === "сегодня") return todayIsoDate();

  const normalized = raw.replace(/[.\-\s]+/g, "/");

  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(normalized);
  if (m) return toIsoDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normalized);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  const digitsOnly = raw.replace(/\D/g, "");
  m = /^(\d{2})(\d{2})(\d{2})$/.exec(digitsOnly);
  if (m) return toIsoDate(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(digitsOnly);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(digitsOnly);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function parsePrice(input: string): number | null {
  return parseFlexibleAmount(input);
}

function looksLikeDraftCommand(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    lower === "сохранить" ||
    lower === "save" ||
    lower === "/save" ||
    lower === "отмена" ||
    lower === "cancel" ||
    lower === "/cancel" ||
    lower === "показать" ||
    lower === "show" ||
    lower === "/show" ||
    lower.startsWith("дата ") ||
    lower.startsWith("date ") ||
    lower.startsWith("магазин ") ||
    lower.startsWith("store ") ||
    lower.startsWith("сумма ") ||
    lower.startsWith("sum ") ||
    lower.startsWith("/sum ") ||
    lower.startsWith("цена ") ||
    lower.startsWith("price ") ||
    lower.startsWith("название ") ||
    lower.startsWith("наименование ") ||
    lower.startsWith("товар ") ||
    lower.startsWith("name ") ||
    lower.startsWith("item ") ||
    lower.startsWith("категория ") ||
    lower.startsWith("category ") ||
    lower.startsWith("удалить ") ||
    lower.startsWith("delete ")
  );
}

async function handleManualFlowTextInput(params: {
  chatId: number;
  userId: number | null;
  text: string;
}): Promise<{ handled: boolean; result?: string }> {
  const draft = await getTelegramDraft(params.chatId);
  const step = getManualFlowStep(draft);

  if (!draft || !step || step === "ready") {
    return { handled: false };
  }

  const input = normalizeCommand(params.text);

  if (step === "amount") {
    const price = parsePrice(input);
    if (price === null) {
      await sendTelegramMessage(
        params.chatId,
        [
          "Не смог распознать сумму.",
          "Отправьте только число, например: <code>12.49</code>, <code>12,49</code>, <code>1 234,56</code>.",
        ].join("\n")
      );
      return { handled: true, result: "manual_flow_amount_invalid" };
    }

    const item = ensureManualDraftItem(draft);
    item.price = price;
    setManualFlowStep(draft, "store");
    await saveTelegramDraft(params.chatId, params.userId, draft);
    await sendTelegramMessage(params.chatId, getManualFlowPrompt("store", draft));
    return { handled: true, result: "manual_flow_amount_updated" };
  }

  if (step === "store") {
    if (!isSkipInput(input)) {
      draft.store_name = input;
    }
    setManualFlowStep(draft, "date");
    await saveTelegramDraft(params.chatId, params.userId, draft);
    await sendTelegramMessage(params.chatId, getManualFlowPrompt("date", draft));
    return { handled: true, result: "manual_flow_store_updated" };
  }

  let purchaseDate = todayIsoDate();
  if (!isSkipInput(input)) {
    const parsed = parseIsoDateFromUser(input);
    if (!parsed) {
      await sendTelegramMessage(
        params.chatId,
        [
          "Не смог распознать дату.",
          "Отправьте, например, <code>14/02/26</code>, <code>14-02-2026</code>, <code>2026-02-14</code> или <code>Сегодня</code>.",
        ].join("\n")
      );
      return { handled: true, result: "manual_flow_date_invalid" };
    }
    purchaseDate = parsed;
  }

  draft.purchase_date = purchaseDate;
  setManualFlowStep(draft, null);
  await saveTelegramDraft(params.chatId, params.userId, draft);
  await sendDraftPreviewMessage(params.chatId, draft, "Черновик ручной покупки готов. Проверьте и сохраните.");
  return { handled: true, result: "manual_flow_completed" };
}

async function handleDraftCommand(params: {
  chatId: number;
  userId: number | null;
  text: string;
  silentSuccess?: boolean;
}): Promise<{ handled: boolean; result?: string }> {
  const { chatId, userId, text, silentSuccess = false } = params;
  const cmd = normalizeCommand(text);
  const lower = cmd.toLowerCase();

  if (!looksLikeDraftCommand(cmd)) {
    return { handled: false };
  }

  const draft = await getTelegramDraft(chatId);

  if (lower === "отмена" || lower === "cancel" || lower === "/cancel") {
    await deleteTelegramDraft(chatId);
    if (!silentSuccess || !draft) {
      await sendTelegramMessage(chatId, draft ? "Черновик удален." : "Черновика нет.");
    }
    return { handled: true, result: "draft_cancelled" };
  }

  if (!draft) {
    await sendTelegramMessage(chatId, "Черновика пока нет. Отправьте фото чека или используйте /manual.");
    return { handled: true, result: "no_draft" };
  }

  if (lower === "показать" || lower === "show" || lower === "/show") {
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft);
    }
    return { handled: true, result: "draft_shown" };
  }

  if (lower === "сохранить" || lower === "save" || lower === "/save") {
    const manualStep = getManualFlowStep(draft);
    if (manualStep && manualStep !== "ready") {
      await sendTelegramMessage(chatId, `Сначала завершите ручной ввод.\n\n${getManualFlowPrompt(manualStep, draft)}`);
      return { handled: true, result: "manual_flow_incomplete" };
    }

    const draftWithMeta = draft as ReceiptData & { _telegram_file_id?: string | null };
    const saved = await saveReceiptToDb({
      store_name: draft.store_name,
      purchase_date: draft.purchase_date,
      items: draft.items,
      source: "telegram",
      telegram_file_id: draftWithMeta._telegram_file_id ?? null,
    });
    await deleteTelegramDraft(chatId);
    if (!silentSuccess) {
      await sendTelegramMessage(chatId, formatSavedSummary(draft, saved.totalAmount, saved.receiptId));
    }
    return { handled: true, result: "draft_saved" };
  }

  let match = /^(?:date|дата)\s+(.+)$/i.exec(cmd);
  if (match) {
    const parsed = parseIsoDateFromUser(match[1]);
    if (!parsed) {
      await sendTelegramMessage(
        chatId,
        "Неверный формат даты. Поддерживаются, например: <code>Дата 14/02/26</code>, <code>Дата 14-02-2026</code>, <code>Дата 2026-02-14</code>."
      );
      return { handled: true, result: "draft_date_invalid" };
    }
    draft.purchase_date = parsed;
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, "Дата обновлена.");
    }
    return { handled: true, result: "draft_date_updated" };
  }

  match = /^(?:store|магазин)\s+(.+)$/i.exec(cmd);
  if (match) {
    draft.store_name = match[1].trim();
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, "Магазин обновлен.");
    }
    return { handled: true, result: "draft_store_updated" };
  }

  match = /^(?:sum|сумма|\/sum)\s+(.+)$/i.exec(cmd);
  if (match) {
    const price = parsePrice(match[1]);
    if (price === null) {
      await sendTelegramMessage(
        chatId,
        "Неверный формат суммы. Поддерживаются, например: <code>Сумма 12.49</code>, <code>Сумма 12,49</code>, <code>Сумма 1 234,56</code>."
      );
      return { handled: true, result: "draft_sum_invalid" };
    }

    if (!draft.items[0]) {
      draft.items = [
        {
          name: "Покупка без чека",
          price,
          category: getDefaultCategory(),
        },
      ];
    } else {
      draft.items[0].price = price;
    }

    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, "Сумма обновлена.");
    }
    return { handled: true, result: "draft_sum_updated" };
  }
  match = /^(?:price|цена)\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из черновика.");
      return { handled: true, result: "draft_item_missing" };
    }
    const price = parsePrice(match[2]);
    if (price === null) {
      await sendTelegramMessage(
        chatId,
        "Неверный формат цены. Поддерживаются, например: <code>Цена 3 12.49</code>, <code>Цена 3 12,49</code>, <code>Цена 3 1 234,56</code>."
      );
      return { handled: true, result: "draft_price_invalid" };
    }
    draft.items[index].price = price;
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, `Цена позиции ${index + 1} обновлена.`);
    }
    return { handled: true, result: "draft_price_updated" };
  }

  match = /^(?:name|название|наименование)\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из черновика.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].name = match[2].trim();
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, `Название позиции ${index + 1} обновлено.`);
    }
    return { handled: true, result: "draft_name_updated" };
  }

  match = /^(?:item|товар)\s+(.+)$/i.exec(cmd);
  if (match) {
    if (!draft.items[0]) {
      draft.items = [
        {
          name: match[1].trim(),
          price: 0,
          category: getDefaultCategory(),
        },
      ];
    } else {
      draft.items[0].name = match[1].trim();
    }
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, "Название товара обновлено.");
    }
    return { handled: true, result: "draft_single_item_name_updated" };
  }

  match = /^(?:name|название|наименование)\s+(.+)$/i.exec(cmd);
  if (match && draft.items.length <= 1) {
    if (!draft.items[0]) {
      draft.items = [
        {
          name: match[1].trim(),
          price: 0,
          category: getDefaultCategory(),
        },
      ];
    } else {
      draft.items[0].name = match[1].trim();
    }
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, "Название товара обновлено.");
    }
    return { handled: true, result: "draft_single_item_name_updated" };
  }

  match = /^(?:category|категория)\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из черновика.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].category = match[2].trim();
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, `Категория позиции ${index + 1} обновлена.`);
    }
    return { handled: true, result: "draft_category_updated" };
  }

  match = /^(?:delete|удалить)\s+(\d+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из черновика.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items.splice(index, 1);
    if (draft.items.length === 0) {
      await deleteTelegramDraft(chatId);
      if (!silentSuccess) {
        await sendTelegramMessage(chatId, "Все позиции удалены, черновик удален.");
      }
      return { handled: true, result: "draft_deleted_empty" };
    }
    setManualFlowStep(draft, null);
    await saveTelegramDraft(chatId, userId, draft);
    if (!silentSuccess) {
      await sendDraftPreviewMessage(chatId, draft, `Позиция ${index + 1} удалена.`);
    }
    return { handled: true, result: "draft_item_deleted" };
  }

  return { handled: false };
}

async function handleDraftCommandBatch(params: {
  chatId: number;
  userId: number | null;
  text: string;
}): Promise<{ handled: boolean; result?: string }> {
  const lines = params.text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return handleDraftCommand(params);
  }

  let handledAny = false;
  let lastResult: string | undefined;

  for (const [index, line] of lines.entries()) {
    const isLastLine = index === lines.length - 1;
    const step = await handleDraftCommand({
      chatId: params.chatId,
      userId: params.userId,
      text: line,
      silentSuccess: !isLastLine,
    });

    if (!step.handled) {
      return handledAny ? { handled: true, result: lastResult ?? "draft_command_batch_partial" } : step;
    }

    handledAny = true;
    lastResult = step.result;
  }

  return { handled: handledAny, result: lastResult ?? "draft_command_batch" };
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
    await answerTelegramCallbackQuery(callbackQueryId, "Отправьте фото чека");
    await sendTelegramMessage(chatId, "Отправьте фото чека (или изображение как файл).", {
      replyMarkup: getMainMenuReplyKeyboard(),
    });
    return { handled: true, result: "menu_add_photo" };
  }

  if (data === "menu:add_manual") {
    await answerTelegramCallbackQuery(callbackQueryId, "Создаю черновик");
    await createAndSendManualDraft(chatId, userId);
    return { handled: true, result: "menu_add_manual" };
  }

  if (data === "draft:save") {
    await answerTelegramCallbackQuery(callbackQueryId, "Сохраняю...");
    return handleDraftCommand({ chatId, userId, text: "/save" });
  }

  if (data === "draft:cancel") {
    await answerTelegramCallbackQuery(callbackQueryId, "Удаляю черновик...");
    return handleDraftCommand({ chatId, userId, text: "/cancel" });
  }

  if (data === "draft:show") {
    await answerTelegramCallbackQuery(callbackQueryId, "Показываю черновик");
    return handleDraftCommand({ chatId, userId, text: "/show" });
  }

  if (data === "draft:edit") {
    await answerTelegramCallbackQuery(callbackQueryId, "Отправляю подсказку");
    await sendTelegramMessage(chatId, getDraftEditHelpText());
    return { handled: true, result: "draft_edit_help" };
  }

  if (data === "draft:today") {
    const draft = await getTelegramDraft(chatId);
    if (!draft) {
      await answerTelegramCallbackQuery(callbackQueryId, "Черновик не найден");
      await sendTelegramMessage(chatId, "Черновика пока нет. Сначала отправьте фото чека.");
      return { handled: true, result: "no_draft" };
    }

    const wasManualDateStep = getManualFlowStep(draft) === "date";
    draft.purchase_date = todayIsoDate();
    if (wasManualDateStep) {
      setManualFlowStep(draft, null);
    }
    await saveTelegramDraft(chatId, userId, draft);
    await answerTelegramCallbackQuery(callbackQueryId, "Дата = сегодня");
    await sendDraftPreviewMessage(
      chatId,
      draft,
      wasManualDateStep ? "Дата установлена на сегодня. Черновик готов." : "Дата установлена на сегодня."
    );
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
        await answerTelegramCallbackQuery(callbackQuery.id, "Чат не найден");
        return NextResponse.json({ ok: true, ignored: "callback_without_chat" });
      }
      if (allowlist && (!fromUserId || !allowlist.has(fromUserId))) {
        await answerTelegramCallbackQuery(callbackQuery.id, "Нет доступа");
        await sendTelegramMessage(chatId, "У вас нет доступа к этому боту.");
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

      await answerTelegramCallbackQuery(callbackQuery.id, "Неизвестная кнопка");
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
      await sendTelegramMessage(chatId, "У вас нет доступа к этому боту.");
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
          await sendTelegramMessage(chatId, "Неверный формат /manual.\n\n" + getManualModeHelpText());
          return NextResponse.json({ ok: true, handled: "manual_draft_invalid" });
        }

        await createAndSendManualDraft(chatId, fromUserId, manualSeed);
        return NextResponse.json({ ok: true, handled: "manual_draft_created" });
      }
      const mainMenuCommand = await handleMainMenuTextCommand({ chatId, userId: fromUserId, text });
      if (mainMenuCommand.handled) {
        return NextResponse.json({ ok: true, handled: mainMenuCommand.result ?? "main_menu_text" });
      }
      const draftCommand = await handleDraftCommandBatch({ chatId, userId: fromUserId, text });
      if (draftCommand.handled) {
        return NextResponse.json({ ok: true, handled: draftCommand.result ?? "draft_command" });
      }

      const manualFlowInput = await handleManualFlowTextInput({ chatId, userId: fromUserId, text });
      if (manualFlowInput.handled) {
        return NextResponse.json({ ok: true, handled: manualFlowInput.result ?? "manual_flow" });
      }
    }

    const source = getBestImageSource(message);
    if (!source) {
      await sendTelegramMessage(chatId, "Отправьте фото чека или выберите действие ниже.", {
        replyMarkup: getMainMenuReplyKeyboard(),
      });
      return NextResponse.json({ ok: true, handled: "no_image" });
    }

    await sendTyping(chatId);
    const imageDataUrl = await fetchTelegramFileAsDataUrl(source.fileId, source.mimeType);
    const receipt = await analyzeReceiptImageDataUrl(imageDataUrl);
    await saveTelegramDraft(chatId, fromUserId, receipt, { telegram_file_id: source.fileId });

    await sendDraftPreviewMessage(chatId, receipt, "Чек распознан. Проверьте данные перед сохранением.");
    return NextResponse.json({ ok: true, handled: "draft_created" });
  } catch (error) {
    console.error("Telegram webhook error:", error);

    const chatId =
      update?.message?.chat?.id ?? update?.edited_message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
    if (chatId) {
      const msg =
        error instanceof Error
          ? `Не удалось обработать чек.\n${escapeHtml(error.message)}`
          : "Не удалось обработать чек.";
      await sendTelegramMessage(chatId, msg);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 }
    );
  }
}




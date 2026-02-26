import { NextRequest, NextResponse } from "next/server";
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
        { text: "✅ Сохранить", callback_data: "draft:save" },
        { text: "❌ Отмена", callback_data: "draft:cancel" },
      ],
      [
        { text: "🔁 Показать", callback_data: "draft:show" },
        { text: "📅 Сегодня", callback_data: "draft:today" },
      ],
      [{ text: "✏️ Исправить", callback_data: "draft:edit" }],
    ],
  };
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { replyMarkup?: TelegramInlineKeyboardMarkup }
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
  return `${input.slice(0, max - 1)}…`;
}

function formatDraftPreview(receipt: ReceiptData, note?: string): string {
  const items = receipt.items ?? [];
  const total = sumItems(items);
  const lines: string[] = [];

  if (note) {
    lines.push(note);
    lines.push("");
  }

  lines.push("🧾 <b>Проверьте чек перед сохранением</b>");
  lines.push(`🏪 Магазин: <b>${escapeHtml(receipt.store_name || "Не указан")}</b>`);
  lines.push(`📅 Дата: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "не определена"))}</b>`);
  lines.push(`💰 Сумма: <b>${total.toFixed(2)} €</b>`);
  lines.push(`🧾 Позиций: <b>${items.length}</b>`);
  lines.push("");
  lines.push("<b>Позиции:</b>");

  const maxItems = 12;
  for (const [idx, item] of items.slice(0, maxItems).entries()) {
    const name = escapeHtml(truncate(item.name || "Без названия", 30));
    const category = escapeHtml(truncate(item.category || "Другое", 18));
    lines.push(`${idx + 1}. ${name} — ${Number(item.price || 0).toFixed(2)} € (${category})`);
  }
  if (items.length > maxItems) {
    lines.push(`… и ещё ${items.length - maxItems}`);
  }

  lines.push("");
  lines.push("<b>Команды:</b>");
  lines.push("• <code>Сохранить</code> — сохранить в базу");
  lines.push("• <code>Отмена</code> — удалить черновик");
  lines.push("• <code>Показать</code> — показать чек ещё раз");
  lines.push("• <code>Дата 14/02/26</code>");
  lines.push("• <code>Магазин Lidl</code>");
  lines.push("• <code>Цена 3 12.49</code>");
  lines.push("• <code>Название 2 Бананы</code>");
  lines.push("• <code>Категория 2 Фрукты</code>");
  lines.push("• <code>Удалить 5</code>");

  return lines.join("\n");
}

async function sendDraftPreviewMessage(chatId: number, receipt: ReceiptData, note?: string) {
  await sendTelegramMessage(chatId, formatDraftPreview(receipt, note), {
    replyMarkup: getDraftInlineKeyboard(),
  });
}

function getDraftEditHelpText(): string {
  return [
    "✏️ <b>Как исправить чек</b>",
    "",
    "Отправьте одно сообщение с нужной правкой:",
    "• <code>Дата 14/02/26</code>",
    "• <code>Магазин Lidl</code>",
    "• <code>Цена 3 12.49</code>",
    "• <code>Название 2 Бананы</code>",
    "• <code>Категория 2 Фрукты</code>",
    "• <code>Удалить 5</code>",
    "",
    "После правки бот пришлёт обновлённый черновик с кнопками.",
  ].join("\n");
}

function formatSavedSummary(receipt: ReceiptData, totalAmount: number, receiptId: number): string {
  const itemsCount = receipt.items?.length || 0;
  return [
    "✅ <b>Чек сохранён</b>",
    `🏪 Магазин: <b>${escapeHtml(receipt.store_name || "Неизвестный магазин")}</b>`,
    `📅 Дата: <b>${escapeHtml(formatDateHuman(receipt.purchase_date || "не определена"))}</b>`,
    `🧾 Позиций: <b>${itemsCount}</b>`,
    `💰 Сумма: <b>${totalAmount.toFixed(2)} €</b>`,
    `#${receiptId}`,
  ].join("\n");
}

function getHelpText() {
  return [
    "Отправьте фото чека, и я распознаю его и пришлю на подтверждение.",
    "",
    "После распознавания можно исправить данные командами:",
    "• Сохранить / Отмена / Показать",
    "• Дата 14/02/26",
    "• Магазин Lidl",
    "• Цена 3 12.49",
    "• Название 2 Бананы",
    "• Категория 2 Фрукты",
    "• Удалить 5",
    "",
    "Советы:",
    "• Лучше отправлять чек как файл (без сжатия)",
    "• В кадре должен быть только чек",
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
    lower === "сохранить" ||
    lower === "/save" ||
    lower === "отмена" ||
    lower === "/cancel" ||
    lower === "показать" ||
    lower === "/show" ||
    lower.startsWith("дата ") ||
    lower.startsWith("магазин ") ||
    lower.startsWith("цена ") ||
    lower.startsWith("название ") ||
    lower.startsWith("категория ") ||
    lower.startsWith("удалить ")
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

  if (lower === "отмена" || lower === "/cancel") {
    await deleteTelegramDraft(chatId);
    await sendTelegramMessage(chatId, draft ? "🗑️ Черновик чека удалён." : "Черновика нет.");
    return { handled: true, result: "draft_cancelled" };
  }

  if (!draft) {
    await sendTelegramMessage(chatId, "Нет черновика чека. Сначала пришлите фото чека.");
    return { handled: true, result: "no_draft" };
  }

  if (lower === "показать" || lower === "/show") {
    await sendDraftPreviewMessage(chatId, draft);
    return { handled: true, result: "draft_shown" };
  }

  if (lower === "сохранить" || lower === "/save") {
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

  let match = /^дата\s+(.+)$/i.exec(cmd);
  if (match) {
    const parsed = parseIsoDateFromUser(match[1]);
    if (!parsed) {
      await sendTelegramMessage(chatId, "Неверный формат даты. Используйте: <code>Дата 14/02/26</code>");
      return { handled: true, result: "draft_date_invalid" };
    }
    draft.purchase_date = parsed;
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "✅ Дата обновлена.");
    return { handled: true, result: "draft_date_updated" };
  }

  match = /^магазин\s+(.+)$/i.exec(cmd);
  if (match) {
    draft.store_name = match[1].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, "✅ Магазин обновлён.");
    return { handled: true, result: "draft_store_updated" };
  }

  match = /^цена\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из списка.");
      return { handled: true, result: "draft_item_missing" };
    }
    const price = parsePrice(match[2]);
    if (price === null) {
      await sendTelegramMessage(chatId, "Неверный формат цены. Пример: <code>Цена 3 12.49</code>");
      return { handled: true, result: "draft_price_invalid" };
    }
    draft.items[index].price = price;
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `✅ Цена позиции ${index + 1} обновлена.`);
    return { handled: true, result: "draft_price_updated" };
  }

  match = /^название\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из списка.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].name = match[2].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `✅ Название позиции ${index + 1} обновлено.`);
    return { handled: true, result: "draft_name_updated" };
  }

  match = /^категория\s+(\d+)\s+(.+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из списка.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items[index].category = match[2].trim();
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `✅ Категория позиции ${index + 1} обновлена.`);
    return { handled: true, result: "draft_category_updated" };
  }

  match = /^удалить\s+(\d+)$/i.exec(cmd);
  if (match) {
    const index = Number(match[1]) - 1;
    if (!draft.items[index]) {
      await sendTelegramMessage(chatId, "Нет такой позиции. Используйте номер из списка.");
      return { handled: true, result: "draft_item_missing" };
    }
    draft.items.splice(index, 1);
    if (draft.items.length === 0) {
      await deleteTelegramDraft(chatId);
      await sendTelegramMessage(chatId, "🗑️ Все позиции удалены, черновик чека удалён.");
      return { handled: true, result: "draft_deleted_empty" };
    }
    await saveTelegramDraft(chatId, userId, draft);
    await sendDraftPreviewMessage(chatId, draft, `✅ Позиция ${index + 1} удалена.`);
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

  if (data === "draft:save") {
    await answerTelegramCallbackQuery(callbackQueryId, "Сохраняю...");
    return handleDraftCommand({ chatId, userId, text: "/save" });
  }

  if (data === "draft:cancel") {
    await answerTelegramCallbackQuery(callbackQueryId, "Удаляю черновик...");
    return handleDraftCommand({ chatId, userId, text: "/cancel" });
  }

  if (data === "draft:show") {
    await answerTelegramCallbackQuery(callbackQueryId, "Показываю чек");
    return handleDraftCommand({ chatId, userId, text: "/show" });
  }

  if (data === "draft:edit") {
    await answerTelegramCallbackQuery(callbackQueryId, "Отправлю подсказку");
    await sendTelegramMessage(chatId, getDraftEditHelpText());
    return { handled: true, result: "draft_edit_help" };
  }

  if (data === "draft:today") {
    const draft = await getTelegramDraft(chatId);
    if (!draft) {
      await answerTelegramCallbackQuery(callbackQueryId, "Черновик не найден");
      await sendTelegramMessage(chatId, "Нет черновика чека. Сначала пришлите фото чека.");
      return { handled: true, result: "no_draft" };
    }

    draft.purchase_date = todayIsoDate();
    await saveTelegramDraft(chatId, userId, draft);
    await answerTelegramCallbackQuery(callbackQueryId, "Дата = сегодня");
    await sendDraftPreviewMessage(chatId, draft, "✅ Дата установлена на сегодня.");
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
        await answerTelegramCallbackQuery(callbackQuery.id, "Нет чата");
        return NextResponse.json({ ok: true, ignored: "callback_without_chat" });
      }
      if (allowlist && (!fromUserId || !allowlist.has(fromUserId))) {
        await answerTelegramCallbackQuery(callbackQuery.id, "Нет доступа");
        await sendTelegramMessage(chatId, "⛔️ У вас нет доступа к этому боту.");
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
      await sendTelegramMessage(chatId, "⛔️ У вас нет доступа к этому боту.");
      return NextResponse.json({ ok: true, ignored: "forbidden_user" });
    }

    const text = (message.text || "").trim();
    if (text) {
      const lower = text.toLowerCase();
      if (lower === "/start" || lower.startsWith("/start@") || lower === "/help" || lower.startsWith("/help@")) {
        await sendTelegramMessage(chatId, getHelpText());
        return NextResponse.json({ ok: true, handled: "help" });
      }

      const draftCommand = await handleDraftCommand({ chatId, userId: fromUserId, text });
      if (draftCommand.handled) {
        return NextResponse.json({ ok: true, handled: draftCommand.result ?? "draft_command" });
      }
    }

    const source = getBestImageSource(message);
    if (!source) {
      await sendTelegramMessage(chatId, "Пришлите фото чека (или изображение как файл).");
      return NextResponse.json({ ok: true, handled: "no_image" });
    }

    await sendTyping(chatId);
    const imageDataUrl = await fetchTelegramFileAsDataUrl(source.fileId, source.mimeType);
    const receipt = await analyzeReceiptImageDataUrl(imageDataUrl);
    await saveTelegramDraft(chatId, fromUserId, receipt, { telegram_file_id: source.fileId });

    await sendDraftPreviewMessage(chatId, receipt, "✅ Чек распознан. Проверьте данные перед сохранением.");
    return NextResponse.json({ ok: true, handled: "draft_created" });
  } catch (error) {
    console.error("Telegram webhook error:", error);

    const chatId =
      update?.message?.chat?.id ?? update?.edited_message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
    if (chatId) {
      const msg =
        error instanceof Error
          ? `❌ Не удалось обработать чек.\n${escapeHtml(error.message)}`
          : "❌ Не удалось обработать чек.";
      await sendTelegramMessage(chatId, msg);
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook failed" },
      { status: 500 }
    );
  }
}

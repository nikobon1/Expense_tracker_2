import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";

const OPENAI_DASHBOARD_CHAT_MODEL = "gpt-5.4-mini";
const GEMINI_DASHBOARD_CHAT_MODEL = "gemini-2.5-flash";
const MAX_QUESTION_LENGTH = 800;
const MAX_SNAPSHOT_CHARS = 24_000;
const MAX_DASHBOARD_CHAT_OUTPUT_TOKENS = 5_600;

type DashboardChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type DashboardChatResult = {
  answer: string;
  model: string;
  provider: "openai" | "google";
};

function compactString(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim();
}

function getConfiguredApiKey(value: string | undefined): string | null {
  const trimmed = compactString(value);
  if (!trimmed || trimmed === "''" || trimmed === '""') return null;
  return trimmed;
}

function normalizeMessages(value: unknown): DashboardChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const role = (entry as { role?: unknown }).role;
      const content = compactString((entry as { content?: unknown }).content);
      if ((role !== "user" && role !== "assistant") || !content) return null;
      return { role, content: content.slice(0, 1_200) };
    })
    .filter((entry): entry is DashboardChatMessage => Boolean(entry))
    .slice(-8);
}

function isProviderAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 401 || status === 403;
}

function buildSystemPrompt() {
  return [
    "Ты аналитический помощник в дашборде личных расходов.",
    "Отвечай по-русски, кратко и предметно.",
    "Используй только данные из dashboardSnapshot и историю вопроса; не придумывай цифры.",
    "Если вопрос требует данных, которых нет в snapshot, прямо скажи, каких данных не хватает.",
    "Когда сравниваешь периоды, currentTotal больше previousTotal означает, что траты выросли.",
    "Давай практичные наблюдения: где рост, какие категории лидируют, какие дни или магазины выделяются.",
    "Не давай инвестиционных, налоговых или юридических советов.",
    "Finish with a complete sentence. If the answer is getting long, shorten it instead of stopping mid-sentence.",
  ].join("\n");
}

function buildPrompt(params: {
  snapshotJson: string;
  conversation: string;
  question: string;
}) {
  return [
    buildSystemPrompt(),
    "",
    "dashboardSnapshot:",
    params.snapshotJson,
    "",
    params.conversation ? `recentConversation:\n${params.conversation}\n` : "",
    `question:\n${params.question}`,
  ].join("\n");
}

async function answerWithOpenAI(apiKey: string, prompt: string): Promise<DashboardChatResult> {
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model: OPENAI_DASHBOARD_CHAT_MODEL,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
    max_output_tokens: MAX_DASHBOARD_CHAT_OUTPUT_TOKENS,
  });

  return {
    answer: compactString(response.output_text),
    model: OPENAI_DASHBOARD_CHAT_MODEL,
    provider: "openai",
  };
}

async function answerWithGemini(apiKey: string, prompt: string): Promise<DashboardChatResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DASHBOARD_CHAT_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: MAX_DASHBOARD_CHAT_OUTPUT_TOKENS,
        },
      }),
    }
  );

  if (!response.ok) {
    let message = "Gemini dashboard assistant failed";
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message || message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }

    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  return {
    answer: compactString(
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => compactString(part.text))
        .filter(Boolean)
        .join("\n")
    ),
    model: GEMINI_DASHBOARD_CHAT_MODEL,
    provider: "google",
  };
}

export async function POST(request: NextRequest) {
  try {
    await requireCurrentUser();

    const body = (await request.json()) as {
      question?: unknown;
      snapshot?: unknown;
      messages?: unknown;
    };

    const question = compactString(body.question).slice(0, MAX_QUESTION_LENGTH);
    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    if (!body.snapshot || typeof body.snapshot !== "object") {
      return NextResponse.json({ error: "Dashboard snapshot is required" }, { status: 400 });
    }

    const openaiApiKey = getConfiguredApiKey(process.env.OPENAI_API_KEY);
    const googleApiKey = getConfiguredApiKey(process.env.GOOGLE_API_KEY);

    if (!openaiApiKey && !googleApiKey) {
      return NextResponse.json(
        { error: "Dashboard assistant is not configured. Set OPENAI_API_KEY or GOOGLE_API_KEY." },
        { status: 503 }
      );
    }

    const snapshotJson = JSON.stringify(body.snapshot).slice(0, MAX_SNAPSHOT_CHARS);
    const messages = normalizeMessages(body.messages);
    const conversation = messages
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n");
    const prompt = buildPrompt({ snapshotJson, conversation, question });

    let result: DashboardChatResult | null = null;
    if (openaiApiKey) {
      try {
        result = await answerWithOpenAI(openaiApiKey, prompt);
      } catch (error) {
        if (!googleApiKey || !isProviderAuthError(error)) {
          throw error;
        }
      }
    }

    if (!result && googleApiKey) {
      result = await answerWithGemini(googleApiKey, prompt);
    }

    if (!result) {
      return NextResponse.json(
        { error: "Dashboard assistant is not configured. Set OPENAI_API_KEY or GOOGLE_API_KEY." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      answer: result.answer || "Не удалось сформировать ответ по текущим данным.",
      model: result.model,
      provider: result.provider,
    });
  } catch (error) {
    console.error("Dashboard chat error:", error);

    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Dashboard assistant failed" },
      { status: 500 }
    );
  }
}

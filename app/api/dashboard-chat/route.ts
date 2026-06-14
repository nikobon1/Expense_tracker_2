import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  isAuthenticationRequiredError,
  requireCurrentUser,
} from "@/lib/server/auth";

const DASHBOARD_CHAT_MODEL = "gpt-5.4-mini";
const MAX_QUESTION_LENGTH = 800;
const MAX_SNAPSHOT_CHARS = 24_000;

type DashboardChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function compactString(value: unknown, fallback = ""): string {
  return String(value ?? fallback).trim();
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

function buildSystemPrompt() {
  return [
    "Ты аналитический помощник в дашборде личных расходов.",
    "Отвечай по-русски, кратко и предметно.",
    "Используй только данные из dashboardSnapshot и историю вопроса; не придумывай цифры.",
    "Если вопрос требует данных, которых нет в snapshot, прямо скажи, каких данных не хватает.",
    "Когда сравниваешь периоды, currentTotal больше previousTotal означает, что траты выросли.",
    "Давай практичные наблюдения: где рост, какие категории лидируют, какие дни или магазины выделяются.",
    "Не давай инвестиционных, налоговых или юридических советов.",
  ].join("\n");
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Dashboard assistant is not configured. Set OPENAI_API_KEY." },
        { status: 503 }
      );
    }

    const snapshotJson = JSON.stringify(body.snapshot).slice(0, MAX_SNAPSHOT_CHARS);
    const messages = normalizeMessages(body.messages);
    const conversation = messages
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
      .join("\n");

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
      model: DASHBOARD_CHAT_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                buildSystemPrompt(),
                "",
                "dashboardSnapshot:",
                snapshotJson,
                "",
                conversation ? `recentConversation:\n${conversation}\n` : "",
                `question:\n${question}`,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 650,
    });

    const answer = compactString(response.output_text);
    return NextResponse.json({
      answer: answer || "Не удалось сформировать ответ по текущим данным.",
      model: DASHBOARD_CHAT_MODEL,
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

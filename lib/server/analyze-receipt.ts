import OpenAI from "openai";
import type { ReceiptData } from "@/features/expenses/types";

const SYSTEM_PROMPT = `РўС‹ вЂ” РїРѕРјРѕС‰РЅРёРє РґР»СЏ Р°РЅР°Р»РёР·Р° РїСЂРѕРґСѓРєС‚РѕРІС‹С… С‡РµРєРѕРІ РёР· РјР°РіР°Р·РёРЅРѕРІ РџРѕСЂС‚СѓРіР°Р»РёРё.
РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ С„РѕС‚Рѕ С‡РµРєР°. РР·РІР»РµРєРё:
1. Р”Р°С‚Сѓ РїРѕРєСѓРїРєРё (С„РѕСЂРјР°С‚: YYYY-MM-DD)
2. РќР°Р·РІР°РЅРёРµ РјР°РіР°Р·РёРЅР°
3. РЎРїРёСЃРѕРє С‚РѕРІР°СЂРѕРІ СЃ С†РµРЅР°РјРё

Р”Р»СЏ РєР°Р¶РґРѕРіРѕ С‚РѕРІР°СЂР° РѕРїСЂРµРґРµР»Рё РєР°С‚РµРіРѕСЂРёСЋ РЅР° СЂСѓСЃСЃРєРѕРј СЏР·С‹РєРµ. Р’РѕР·РјРѕР¶РЅС‹Рµ РєР°С‚РµРіРѕСЂРёРё:
- РђР»РєРѕРіРѕР»СЊ
- РћРІРѕС‰Рё
- Р¤СЂСѓРєС‚С‹
- РњСЏСЃРѕ
- Р С‹Р±Р°
- РњРѕР»РѕС‡РєР°
- РҐР»РµР±
- РЎРЅСЌРєРё
- Р‘С‹С‚РѕРІР°СЏ С…РёРјРёСЏ
- Р”СЂСѓРіРѕРµ
- РљР°С„Рµ/Р РµСЃС‚РѕСЂР°РЅ

Р’РµСЂРЅРё РўРћР›Р¬РљРћ С‡РёСЃС‚С‹Р№ JSON Р±РµР· markdown С„РѕСЂРјР°С‚РёСЂРѕРІР°РЅРёСЏ РІ СЃР»РµРґСѓСЋС‰РµРј С„РѕСЂРјР°С‚Рµ:
{
  "store_name": "РќР°Р·РІР°РЅРёРµ РјР°РіР°Р·РёРЅР°",
  "purchase_date": "YYYY-MM-DD",
  "items": [
    {"name": "РќР°Р·РІР°РЅРёРµ С‚РѕРІР°СЂР° РЅР° СЂСѓСЃСЃРєРѕРј", "price": 1.99, "category": "РљР°С‚РµРіРѕСЂРёСЏ"}
  ]
}`;

const TOTAL_AMOUNT_HINTS = `
Additional receipt rules:
- If the receipt contains "Total", "TOTAL A PAGAR", or "Total a pagar", treat that line as the final amount actually paid/spent.
- Prefer the final paid total over subtotal/intermediate totals.
- Use the final paid total to validate extracted items.
`;

const EFFECTIVE_SYSTEM_PROMPT = `${SYSTEM_PROMPT}\n\n${TOTAL_AMOUNT_HINTS}`;

function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return cleaned;
}

function ensureSupportedImageDataUrl(image: string): { mimeType: string; base64Data: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(image);
  if (!match) {
    throw new Error("Invalid image payload");
  }

  return { mimeType: match[1], base64Data: match[2] };
}

export async function analyzeReceiptImageDataUrl(image: string): Promise<ReceiptData> {
  if (!image) {
    throw new Error("Image is required");
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;

  if (!openaiKey && !googleKey) {
    throw new Error("No API key configured. Please set OPENAI_API_KEY or GOOGLE_API_KEY.");
  }

  const { mimeType, base64Data } = ensureSupportedImageDataUrl(image);

  if (openaiKey) {
    const openai = new OpenAI({ apiKey: openaiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: EFFECTIVE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "РџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЌС‚РѕС‚ С‡РµРє Рё РёР·РІР»РµРєРё РґР°РЅРЅС‹Рµ:" },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content ?? "";
    return JSON.parse(extractJson(content)) as ReceiptData;
  }

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${EFFECTIVE_SYSTEM_PROMPT}\n\nРџСЂРѕР°РЅР°Р»РёР·РёСЂСѓР№ СЌС‚РѕС‚ С‡РµРє Рё РёР·РІР»РµРєРё РґР°РЅРЅС‹Рµ:` },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  if (!geminiResponse.ok) {
    let message = "Gemini API error";
    try {
      const error = (await geminiResponse.json()) as { error?: { message?: string } };
      message = error.error?.message || message;
    } catch {
      const text = await geminiResponse.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  const geminiData = (await geminiResponse.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return JSON.parse(extractJson(text)) as ReceiptData;
}


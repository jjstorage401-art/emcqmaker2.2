import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const PROMPT = `You convert a teacher's free-text instruction (usually Bangla, may use Bangla digits, mixed with English) into PDF layout settings for an MCQ question paper.
Extract ONLY layout/formatting requests that are explicitly stated, and leave every other field out:
- fontSize: font size in points (number 7-14). "ফন্ট ১০" -> 10. "বড় ফন্ট" -> 12, "ছোট ফন্ট" -> 8.5.
- questionBold: true/false (are question lines bold).
- lineSpacing: line height multiplier 1.2-2.0 ("লাইনের ফাঁক বেশি" -> 1.7, "ঘন করে" -> 1.25).
- columns: 1 or 2 ("এক কলাম" -> 1, "দুই কলাম" -> 2).
- options: "grid" (2x2 options), "list" (one option per line), "inline" (all 4 in one row), "auto".
- optionLabels: "bangla" (ক খ গ ঘ), "english" (a b c d), "number" (১ ২ ৩ ৪).
- answerKey: false only if the teacher wants NO answer page; true if they ask for it.
Ignore everything about the question content itself. If nothing about layout is requested, return an empty object {}. Output ONLY JSON.`;

const toEn = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? toEn(body.text).replace(/\s+/g, " ").trim().slice(0, 800) : "";
    if (!apiKey || !text) return NextResponse.json({ layout: {} });

    const genAI = new GoogleGenerativeAI(apiKey);
    const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const models = [primary, ...fallbacks.filter((m) => m !== primary)];

    let raw: any;
    let lastErr: unknown;
    for (let mi = 0; mi < models.length; mi++) {
      try {
        const model = genAI.getGenerativeModel({
          model: models[mi],
          systemInstruction: PROMPT,
          generationConfig: {
            ...(mi === 0 ? ({ thinkingConfig: { thinkingLevel: "low" } } as any) : {}),
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: {
                fontSize: { type: SchemaType.NUMBER },
                questionBold: { type: SchemaType.BOOLEAN },
                lineSpacing: { type: SchemaType.NUMBER },
                columns: { type: SchemaType.INTEGER },
                options: { type: SchemaType.STRING },
                optionLabels: { type: SchemaType.STRING },
                answerKey: { type: SchemaType.BOOLEAN },
              },
            },
          },
        });
        const r = await model.generateContent(`Teacher instruction:\n"""${text}"""`);
        raw = JSON.parse(r.response.text().replace(/^```json\s*|```$/g, "").trim());
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (raw === undefined) throw lastErr ?? new Error("no response");

    const num = (v: unknown, lo: number, hi: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
    const layout: Record<string, unknown> = {};
    const fs = num(raw.fontSize, 7, 14);
    if (fs !== undefined) layout.fontSize = fs;
    if (typeof raw.questionBold === "boolean") layout.questionBold = raw.questionBold;
    const ls = num(raw.lineSpacing, 1.2, 2);
    if (ls !== undefined) layout.lineSpacing = ls;
    if (raw.columns === 1 || raw.columns === 2) layout.columns = raw.columns;
    if (["auto", "grid", "list", "inline"].includes(raw.options)) layout.options = raw.options;
    if (["bangla", "english", "number"].includes(raw.optionLabels)) layout.optionLabels = raw.optionLabels;
    if (typeof raw.answerKey === "boolean") layout.answerKey = raw.answerKey;

    return NextResponse.json({ layout });
  } catch (err) {
    console.error("[parse-layout]", err);
    return NextResponse.json({ layout: {}, failed: true });
  }
}

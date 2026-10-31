import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { sameQuestion, unifyStimuli, sanitizeText, cleanStimulus, stripAnswer, squash } from "@/lib/stimulus";

export const runtime = "nodejs";
export const maxDuration = 60;

interface IncomingImage {
  base64: string;
  mimeType: string;
}

const SYSTEM_PROMPT = `You are a senior exam-paper setter with 20 years of experience writing school-level multiple-choice tests in the style of the Bangladesh national curriculum (NCTB board exams).

You will receive photographs of textbook pages plus exam parameters. Follow these rules STRICTLY:

1. ACCURACY IS THE TOP PRIORITY. Read ALL the images carefully. Base every question ONLY on content actually present in the pages. Never invent facts. Every correct answer must be directly provable from the pages, and the supporting sentence must be quoted/paraphrased in the "evidence" field (at most 12 words). If you cannot point to evidence on the pages, do not write the question.
2. Each question has exactly 4 options and exactly ONE correct answer. Before finalising, re-check every question: could any other option also be defended from the pages? If yes, rewrite or discard it. Distractors must be believable but clearly wrong according to the pages, similar in length and style, and never "All of the above" / "None of the above". Discard anything trivial (e.g. "What is the title of this chapter?"), illogical, ambiguous, a trick question, or dependent on a figure/page number the student cannot see.
3. ALWAYS return the full requested number of questions (a stimulus group's questions each count as one). Returning fewer is a FAILURE. If the pages have limited material, draw questions from every definition, term, fact, example, rule, exception, cause and effect, comparison, list and number on the pages instead of stopping early. Spread them evenly across the material; never repeat or paraphrase the same idea twice.
4. QUESTION TYPES (use a natural mix, like a real board exam; the teacher's instructions may change the mix):
   a) STANDARD MCQ (জ্ঞানমূলক / অনুধাবনমূলক): a direct question with 4 options. Leave "statements" and "stimulus" out.
   b) MULTIPLE-COMPLETION (বহুপদী সমাপ্তিসূচক): "question" is a short lead-in such as "নিচের তথ্যগুলো লক্ষ কর:" or a topic sentence, WITHOUT the final line "নিচের কোনটি সঠিক?" (the layout adds it). "statements" holds exactly 3 short statements WITHOUT i/ii/iii prefixes; some true, some false (according to the pages). The 4 options must be exactly these four combinations, as plain text: "i ও ii", "i ও iii", "ii ও iii", "i, ii ও iii". Exactly one combination must be the true one; choose it so that the correct position is spread across the set.
   c) STIMULUS-BASED (উদ্দীপকভিত্তিক / প্রয়োগমূলক / উচ্চতর দক্ষতা): write ONE short original stimulus (a real-life scenario, case, data or passage of 2–4 sentences, at most about 60 words) that applies a concept from the pages, then 2 or 3 questions about that same stimulus. Give all the questions of that stimulus the same integer "group" (1, 2, 3 ...), put the stimulus text in the "stimulus" field of the first of them (repeating it is fine), keep the "question" field to that question's own text, and output the group's questions one after another. The questions must be answerable from the stimulus plus the pages' concepts, and each must still have exactly one defensible answer. Never copy long passages from the pages as a stimulus.
5. Write in the SAME language as the textbook pages. If the pages are in Bangla, write every question, statement, stimulus and option in correct, natural Bangla (Bengali script) with proper spelling. Keep questions concise (ideally under 30 words) and options very short (ideally 1-6 words, never more than 12) so they fit a compact 2-column printed layout.
6. Do not number the questions and do not prefix options with A/B/C/D or ক/খ/গ/ঘ — the layout adds those.
7. Randomise the position of the correct answer across the set.
8. Output ONLY the JSON array that matches the schema. No commentary, no markdown fences.`;

const MATH_RULE = `\nMATH NOTATION: write powers, indices and subscripts with Unicode superscript/subscript characters, never with ^ or _ or LaTeX: 2² (not 2^2), x³, aⁿ, 10⁻³, H₂O, a₁. Use × ÷ ± √ π ° ≤ ≥ for operators and symbols, and write fractions as a/b or (a+b)/(c-d). Never use $ or backslash commands.`;

const EXTRACT_PROMPT = `You are an exam-paper compiler. The photographs show pages that ALREADY CONTAIN printed multiple-choice questions (a question bank or exercise pages), possibly of several kinds. Your job is to SELECT existing questions and copy them faithfully. Follow these rules STRICTLY:

0. OUTPUT HYGIENE: every JSON field must contain ONLY the final printed text. Never write notes, comments, explanations, self-corrections, drafts, English remarks (like "Note", "Wait", "Let's") or repeated copies inside any field. Write each text exactly once.
1. NEVER invent, create or add a question that is not printed on the pages, and never turn textbook text into new questions. Only use questions that are actually visible.
2. Copy the wording faithfully in the original language (fix only obvious scanning/typing slips). Drop printed question numbers and option labels (ক/খ/গ/ঘ, a/b/c/d, (i) etc.). Never move text from one field to another, never reorder statements or options: keep them in the printed order.
3. KEEP each question's original type exactly as printed:
   a) STANDARD MCQ: leave "statements", "stimulus" and "group" out.
   b) MULTIPLE-COMPLETION (বহুপদী সমাপ্তিসূচক): a question that prints three statements numbered i, ii, iii and options such as "i ও ii", "i ও iii", "ii ও iii", "i, ii ও iii". Fields: "question" = the lead-in sentence printed above the statements (if none is printed use "নিচের তথ্যগুলো লক্ষ কর:"), WITHOUT the final line "নিচের কোনটি সঠিক?"; "statements" = the three statements in printed order, WITHOUT their i/ii/iii prefixes; "options" = the four printed combinations in printed order.
      Example: printed "৭। নিচের তথ্যগুলো লক্ষ কর: i. আলো সরলরেখায় চলে ii. আলোর গতি শব্দের চেয়ে কম iii. আলো শূন্যস্থানে চলে। নিচের কোনটি সঠিক? ক. i ও ii খ. i ও iii গ. ii ও iii ঘ. i, ii ও iii  উত্তর: খ" becomes {"question":"নিচের তথ্যগুলো লক্ষ কর:","statements":["আলো সরলরেখায় চলে","আলোর গতি শব্দের চেয়ে কম","আলো শূন্যস্থানে চলে"],"options":["i ও ii","i ও iii","ii ও iii","i, ii ও iii"],"correctIndex":1,"answerOnPage":true}
   c) STIMULUS-BASED (উদ্দীপকভিত্তিক): a printed passage/scenario (উদ্দীপক) followed by two or more numbered questions about it, usually introduced by "উদ্দীপকটি পড়ে ৩ ও ৪ নং প্রশ্নের উত্তর দাও". Output ONE object per question. Give all the questions of the same stimulus the same integer "group" (1, 2, 3 ... unique within your answer) and put the full stimulus text in the "stimulus" field of the FIRST question of the group ONLY (copy it once, carefully, letter by letter) and leave "stimulus" empty on the other questions of that group (they are linked by the same "group" number). Never write the same stimulus twice. NEVER copy exam-board source tags such as [ব. বো. '২৪], [ঢা. বো. ২৩] or similar labels printed after questions into any field, and never repeat a phrase over and over. The "stimulus" field must contain ONLY the printed passage itself: no notes, comments, explanations, reasoning, English text, repeated copies, the heading line ("উদ্দীপকটি পড়ে … উত্তর দাও") or question text. Do NOT copy exam-board source tags such as "[ব. বো. '২৪]" or "[ঢা. বো. ২০২৩]" anywhere, and NEVER repeat a word, phrase or tag over and over: write every sentence exactly once. Do not think aloud inside any field; if unsure, copy the passage once exactly as printed and stop. The "question" field holds only that question's own text, never the stimulus. Output a group's questions one after another, in printed order. Write each stimulus ONLY ONCE per group, never as a separate new group when the same passage is simply repeated, and never output the same stimulus or question twice. Copy the stimulus character by character exactly as printed: do not reword, correct, translate or "fix" it, and do not change any name, number, amount, date or unit.
      STIMULUS BOX RULE: the stimulus is usually printed inside a bordered or shaded BOX (often headed "উদ্দীপকটি পড়ে … নং প্রশ্নের উত্তর দাও"), sometimes narrow, in a column, or in smaller print. Read the box slowly from its first line to its very last line and copy the passage COMPLETELY, word for word, every sentence, every number, amount, date, name and unit, with nothing shortened, summarised or left out. Do not stop at the first sentence or paragraph. Leave out only the instruction heading ("উদ্দীপকটি পড়ে … উত্তর দাও"), not the passage. The stimulus belongs to the question numbers named in the heading; the questions printed after the box (outside it) are the group's questions.
   Never mix these: a question that merely says "উদ্দীপক" without printing the passage is NOT usable; skip it.
   Skip any question that depends on a figure, table, map or image you cannot reproduce in text.
4. ANSWERS (never inside the text fields): the printed answer next to a question ("উত্তর: খ", a tick, a circle, bold) belongs ONLY in "correctIndex"; NEVER copy it, or the words "উত্তর"/"Ans", or any tick mark, into "question", "statements", "options" or "stimulus". Most questions have their answer printed next to them (e.g. "উত্তর: খ", a letter, a tick/circle/bold mark, or the answer's text). Use EXACTLY that printed answer: convert it to the 0-based index of the matching option (ক/a=0, খ/b=1, গ/c=2, ঘ/d=3, or find the option whose text equals the printed answer) and set "answerOnPage" to true. NEVER replace a printed answer with your own opinion, even if you disagree. If no answer is printed for a question, do NOT solve it: set "answerOnPage" to false and "correctIndex" to 0. "evidence" may be left out.
5. COMPLETENESS: a question is usable ONLY if everything of it is fully visible and readable: the whole question text, exactly 4 options, (for multiple-completion) all 3 statements, and (for a stimulus group) the whole stimulus. If a question or option is cut off by the photo edge, torn, blurred, half visible, or has fewer than 4 options, SKIP it. If a stimulus is cut off, skip its whole group; if only some of its questions are incomplete, output only the complete ones. NEVER guess, complete or invent missing words, options, statements or answers. Also skip questions with more than one defensible answer.
6. Scan each page SYSTEMATICALLY from top to bottom, column by column (a page may hold 30 or more questions), and list EVERY usable printed question found on the attached pages, in page order, up to 40. Make sure the questions at the bottom and in the second column are included too. Do not stop early and do not skip a usable question; the app selects the final set afterwards. If the teacher's instructions restrict the type, topic or difficulty, list only the matching questions. Never output the same question twice.
7. Output ONLY the JSON array that matches the schema. No commentary, no markdown fences.`;

const VERIFY_PROMPT = `You are an independent, strict examiner checking a draft MCQ set against the textbook page images.
For EACH question (identified by its index "i") decide:
- "ok": the marked correct option is clearly correct according to the pages, no other option is defensible, and the wording/stimulus/statements are consistent and unambiguous.
- "fix": the question is good but a DIFFERENT option is the single correct one according to the pages. Give that option's index (0-3) in "correctIndex".
- "drop": the question is wrong, ambiguous (more than one defensible answer), unsupported by the pages, or badly worded.
Prefer "fix" over "drop". Use "drop" only when the question is clearly wrong, has more than one equally defensible answer, or is not supported by the pages. Do not drop a question just because it is easy or its wording could be nicer. Return ONLY a JSON array with one object per question: { "i": number, "verdict": "ok" | "fix" | "drop", "correctIndex": number (only for "fix") }.`;

const EXTRACT_VERIFY_NOTE =
  "\nNOTE: these questions were copied from the printed pages and every answer must match what the page itself prints. For a question with answerOnPage=true: find that question on the page; verdict \"ok\" only if the marked option is exactly the answer printed next to it; if the printed answer is a different option, verdict \"fix\" with that option's index; if you cannot find the question or its printed answer, or the copied wording/statements/stimulus differ from the page, verdict \"drop\". Do NOT use your own subject knowledge to judge the answer. For a question with answerOnPage=false there is no printed answer: only check that the wording is faithful and return \"ok\" (never \"fix\").";

const bn = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
const isBusy = (e: any) => /\b(429|500|502|503|504)\b|overloaded|high demand|unavailable/i.test(String(e?.message || e));
/** Vercel কাটার আগেই নিজে থেমে যাওয়ার সময়সীমা (maxDuration = ৬০ সেকেন্ড) */
const DEADLINE_MS = 50_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "সার্ভারে GEMINI_API_KEY সেট করা নেই। Vercel-এ Environment Variables-এ যোগ করে আবার Deploy করুন।" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const images: IncomingImage[] = Array.isArray(body.images) ? body.images : [];
    const params = body.params ?? {};
    const target = Math.round(Number(params.numQuestions));

    if (images.length === 0) {
      return NextResponse.json({ error: "অনুগ্রহ করে বইয়ের অন্তত একটি পাতার ছবি দিন।" }, { status: 400 });
    }
    if (images.length > 10) {
      return NextResponse.json({ error: "একবারে সর্বোচ্চ ১০টি ছবি দেওয়া যাবে।" }, { status: 400 });
    }
    if (!Number.isFinite(target) || target < 1 || target > 100) {
      return NextResponse.json({ error: "প্রশ্নের সংখ্যা ১ থেকে ১০০ এর মধ্যে হতে হবে।" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const primary = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    // If the main model is overloaded (503), we automatically try these instead.
    const fallbacks = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.6-flash,gemini-3.5-flash-lite")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const models = [primary, ...fallbacks.filter((m) => m !== primary)];

    const extractMode = params.source === "extract";
    const questionSchema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          question: { type: SchemaType.STRING },
          options: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          correctIndex: { type: SchemaType.INTEGER },
          statements: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          stimulus: { type: SchemaType.STRING },
          group: { type: SchemaType.INTEGER },
          evidence: { type: SchemaType.STRING },
          answerOnPage: { type: SchemaType.BOOLEAN },
        },
        required: extractMode ? ["question", "options", "correctIndex"] : ["question", "options", "correctIndex", "evidence"],
      },
    };
    const verifySchema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          i: { type: SchemaType.INTEGER },
          verdict: { type: SchemaType.STRING },
          correctIndex: { type: SchemaType.INTEGER },
        },
        required: ["i", "verdict"],
      },
    };

    const makeModel = (name: string, lowThinking: boolean, systemInstruction: string, schema: any, timeoutMs: number) =>
      genAI.getGenerativeModel(
        {
          model: name,
          systemInstruction,
          generationConfig: {
            // Gemini 3.x thinks for a long time by default; "low" keeps responses fast
            // enough for serverless time limits. (Cast: older SDK typings lack this field.)
            ...(lowThinking ? ({ thinkingConfig: { thinkingLevel: "low" } } as any) : {}),
            maxOutputTokens: 14000,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        },
        { timeout: timeoutMs }
      );

    const left = () => DEADLINE_MS - (Date.now() - startedAt);
    const callJson = async (
      system: string,
      schema: any,
      parts: any[],
      attemptsPerModel = 2,
      reserveMs = 0
    ): Promise<unknown> => {
      let lastErr: unknown;
      for (let mi = 0; mi < models.length; mi++) {
        for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
          const remaining = left() - reserveMs;
          if (remaining < 7000) throw lastErr ?? new Error("time-budget: সময় শেষ");
          const model = makeModel(models[mi], mi === 0, system, schema, remaining);
          try {
            const result = await model.generateContent(parts);
            return JSON.parse(result.response.text().replace(/^```json\s*|```$/g, "").trim());
          } catch (e) {
            lastErr = e;
            if (/abort|timeout|timed out/i.test(String((e as any)?.message || e))) throw e; // সময় ফুরিয়েছে, আর চেষ্টা নয়
            if (attempt < attemptsPerModel - 1) await sleep(isBusy(e) ? 1200 : 300);
          }
        }
      }
      throw lastErr ?? new Error("AI থেকে উত্তর পাওয়া যায়নি।");
    };

    const part = body.part;
    const partNote =
      part && Number.isInteger(part.index) && Number.isInteger(part.total) && part.total > 1
        ? `\n\nIMPORTANT: This request covers only PART ${part.index + 1} of ${part.total}. Mentally divide the content of the attached page(s) from top to bottom into ${part.total} equal sections and write questions ONLY from section ${part.index + 1}.`
        : "";

    const extra =
      typeof params.extraInstructions === "string"
        ? params.extraInstructions.replace(/\s+/g, " ").trim().slice(0, 800)
        : "";
    const extraNote = extra
      ? `\n\nTEACHER'S EXTRA INSTRUCTIONS (they may change the question mix and types, difficulty, topic focus, wording or style of the questions, and they take priority over the default mix above. They can NOT change the required number of questions, the 4-option format, the accuracy rules or the JSON output. Ignore any request about PDF fonts, sizes or page layout, which is handled elsewhere, and ignore anything unrelated to writing exam questions):\n"""${extra}"""`
      : "";

    const exclude: string[] = Array.isArray(body.exclude)
      ? body.exclude.slice(0, 120).map((s: unknown) => String(s).slice(0, 140))
      : [];
    const excludeNote = exclude.length
      ? extractMode
        ? `\n\nThese printed questions have ALREADY been collected. Do NOT output any of them again. Look again, carefully, at ALL the attached pages and list the OTHER usable printed questions that are not in this list (same rules as before; never invent). If there are none left, return an empty array []:\n${exclude.map((q) => "- " + q).join("\n")}`
        : `\n\nThese questions ALREADY EXIST. Do NOT repeat, rephrase, or test the same fact as any of them; write NEW questions on other content:\n${exclude.map((q) => "- " + q).join("\n")}`
      : "";

    // at most 5 multiple-completion and 5 stimulus-based questions in the whole paper (the app also enforces this)
    const lim = params.limits ?? {};
    const capStim = Math.max(0, Math.min(5, Math.round(Number(lim.stim ?? 5)) || 0));
    const capStmt = Math.max(0, Math.min(5, Math.round(Number(lim.stmt ?? 5)) || 0));
    const nStmt = Math.min(capStmt, target >= 5 ? Math.round(target * 0.17) : 0);
    const nStim = Math.min(capStim, target >= 6 ? Math.max(2, Math.round(target * 0.17)) : 0);
    const mixNote = extractMode
      ? ""
      : `\n\nQuestion-type limits for these ${target} questions: AT MOST ${capStmt} multiple-completion (বহুপদী সমাপ্তিসূচক) questions and AT MOST ${capStim} stimulus-based (উদ্দীপকভিত্তিক) questions in total (a stimulus group's questions count individually); everything else must be standard MCQs.${
          nStmt + nStim > 0
            ? ` Aim for about ${nStmt} multiple-completion and about ${nStim} stimulus-based (in one group of 2-3 questions sharing a stimulus) if the pages support them.`
            : ""
        } Mix the order freely; only the questions of one stimulus group must stay together.`;

    const instruction = `Exam: ${params.examName || "Exam"}
Class: ${params.className || "-"}
Subject: ${params.subject || "-"}
Total marks: ${params.totalMarks || "-"}
Total time: ${params.totalTime || "-"} minutes

${
      extractMode
        ? `The attached pages already contain printed MCQs. LIST EVERY usable printed question on them (at most 40), exactly as printed. Do NOT create any new question.`
        : `Create EXACTLY ${target} multiple-choice questions from the attached textbook pages.`
    }
Return a JSON array of ${extractMode ? "all the extracted" : `${target}`} objects: { "question": string, "options": [4 strings], "correctIndex": 0-3, "statements"?: [3 strings], "stimulus"?: string, "evidence": string${extractMode ? ", \"answerOnPage\": boolean" : ""} }.${mixNote}${partNote}${excludeNote}${extraNote}`;

    const imageParts = images.map((img) => ({
      inlineData: { data: img.base64, mimeType: img.mimeType || "image/jpeg" },
    }));

    const raw = await callJson((extractMode ? EXTRACT_PROMPT : SYSTEM_PROMPT) + MATH_RULE, questionSchema, [{ text: instruction }, ...imageParts]);

    const clean = (s: unknown) => sanitizeText(String(s ?? ""));
    // প্রশ্ন/বিবৃতি/অপশন থেকে পাতায় ছাপা উত্তর সরানো
    const cleanQ = (s: unknown) => stripAnswer(clean(s));
    type Q = {
      question: string;
      options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3;
      statements?: string[];
      stimulus?: string;
      answerOnPage?: boolean;
    };
    const list = Array.isArray(raw) ? raw : [];
    const mapped = list
      .filter(
        (q: any) =>
          q &&
          typeof q.question === "string" &&
          q.question.trim() &&
          Array.isArray(q.options) &&
          q.options.length >= 4 &&
          q.options.slice(0, 4).every((o: unknown) => cleanQ(o)) &&
          new Set(q.options.slice(0, 4).map(cleanQ)).size === 4 &&
          Number.isInteger(q.correctIndex) &&
          q.correctIndex >= 0 &&
          q.correctIndex <= 3
      )
      .map((q: any) => ({ q, group: Number.isInteger(q.group) ? (q.group as number) : undefined }));

    // one stimulus text per group (the longest copy), so the questions of a group always match each other
    const groupText = new Map<number, string>();
    for (const { q, group } of mapped) {
      const t = cleanStimulus(clean(q.stimulus));
      if (group !== undefined && t.length >= 15 && t.length > (groupText.get(group)?.length ?? 0)) groupText.set(group, t);
    }

    let questions: Q[] = [];
    for (const { q, group } of mapped) {
      const out: Q = {
        question: cleanQ(q.question),
        options: q.options.slice(0, 4).map(cleanQ) as Q["options"],
        correctIndex: q.correctIndex,
      };
      if (Array.isArray(q.statements) && q.statements.length > 0) {
        const st = q.statements.map(cleanQ).filter(Boolean);
        if (st.length < 3 || st.length > 4) continue; // অসম্পূর্ণ বিবৃতি: বাদ
        out.statements = st;
      }
      const stim = group !== undefined && groupText.has(group) ? groupText.get(group)! : cleanStimulus(clean(q.stimulus));
      if (stim.length >= 15) out.stimulus = stim;
      // বহুপদী প্রশ্নের বিবৃতি/"নিচের কোনটি সঠিক?" ভুল করে উদ্দীপকে ঢুকে গেলে ঠিক করা
      if (out.statements) {
        const generic = /^(নিচের\s*কোনটি\s*সঠিক\s*[?।]?|নিচের\s*তথ্যগুলো?\s*লক্ষ\s*কর[:ঃ]?)$/;
        let qText = out.question.replace(/\s*নিচের\s*কোনটি\s*সঠিক\s*[?।]?\s*$/, "").trim();
        const st0 = squash(out.statements[0]);
        const st = out.stimulus;
        if (st && (/নিচের\s*কোনটি\s*সঠিক/.test(st) || (st0.length >= 6 && squash(st).includes(st0)))) {
          const cut = st.search(/(?:^|\s)[-–—:]?\s*(?:i|১|১\))\.\s|\s[-–—:]\s*i\./);
          const lead = (cut > 0 ? st.slice(0, cut) : "").replace(/[\s\-–—:]+$/, "").trim();
          delete out.stimulus;
          if ((!qText || generic.test(qText)) && lead.length >= 8) qText = lead + ":";
        }
        out.question = qText || "নিচের তথ্যগুলো লক্ষ কর:";
      }
      if (stim.length < 15 && group !== undefined && clean(q.stimulus).length === 0 && !groupText.has(group)) {
        // উদ্দীপক ছাড়া "গ্রুপ"-এর প্রশ্ন: সাধারণ প্রশ্ন হিসেবে রাখা হলো না, কারণ উদ্দীপক ছাড়া অর্থহীন হতে পারে
        if (extractMode) continue;
      }
      if (extractMode) {
        out.answerOnPage = q.answerOnPage !== false;
        if (!out.answerOnPage) out.correctIndex = 0;
      }
      questions.push(out);
    }

    // একই উদ্দীপক ভিন্ন group নম্বরে/ভিন্ন বানানে এলে এক করা; একই প্রশ্ন দুবার এলে একটি রাখা
    unifyStimuli(questions as any);
    questions = questions.filter((q, i) => !questions.slice(0, i).some((p) => sameQuestion(p as any, q as any)));

    // --- second, independent check of every answer (best effort, only if time allows) ---
    let verified = false;
    if (questions.length > 0 && left() > 16000) {
      try {
        const draft = questions.map((q, i) => ({
          i,
          question: q.question,
          ...(q.stimulus ? { stimulus: q.stimulus } : {}),
          ...(q.statements ? { statements: q.statements } : {}),
          options: q.options,
          markedCorrectIndex: q.correctIndex,
          ...(extractMode ? { answerOnPage: q.answerOnPage !== false } : {}),
        }));
        const res = await callJson(
          extractMode ? VERIFY_PROMPT + EXTRACT_VERIFY_NOTE : VERIFY_PROMPT,
          verifySchema,
          [{ text: `Draft questions:\n${JSON.stringify(draft)}` }, ...imageParts],
          1,
          2500
        );
        if (Array.isArray(res)) {
          const verdicts = new Map<number, any>();
          for (const v of res as any[]) if (v && Number.isInteger(v.i)) verdicts.set(v.i, v);
          questions = questions.filter((q, i) => {
            const v = verdicts.get(i);
            if (!v) return true;
            if (v.verdict === "drop") return false;
            if (v.verdict === "fix" && q.answerOnPage !== false && Number.isInteger(v.correctIndex) && v.correctIndex >= 0 && v.correctIndex <= 3) {
              q.correctIndex = v.correctIndex;
            }
            return true;
          });
          verified = true;
        }
      } catch (e) {
        console.warn("[generate-questions] verify skipped:", String((e as any)?.message || e).slice(0, 120));
      }
    }

    // never return more than requested; keep a stimulus group's questions together when trimming
    questions = questions.slice(0, extractMode ? 40 : target);

    if (questions.length === 0 && extractMode && exclude.length > 0) {
      // বাড়তি খোঁজ: আর কোনো নতুন ছাপা প্রশ্ন নেই, এটি ত্রুটি নয়
      return NextResponse.json({ questions: [], verified: false });
    }
    if (questions.length === 0) {
      return NextResponse.json(
        {
          error: extractMode
            ? "এই ছবিগুলোতে ব্যবহারযোগ্য ছাপা প্রশ্ন পাওয়া যায়নি। ছবি পরিষ্কার কি না দেখুন, অথবা পাতায় প্রশ্ন না থাকলে \"নতুন প্রশ্ন বানানো\" মোড বেছে নিন।"
            : "এই ছবিগুলো থেকে AI সঠিক প্রশ্ন বানাতে পারেনি। আরও পরিষ্কার ছবি দিয়ে আবার চেষ্টা করুন।",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      questions,
      verified,
      warning:
        questions.length < target
          ? extractMode
            ? `পাতাগুলোতে ${bn(target)}টির মধ্যে মাত্র ${bn(questions.length)}টি ব্যবহারযোগ্য প্রশ্ন পাওয়া গেছে। আরও পাতা যোগ করে দেখতে পারেন।`
            : `বইয়ের পাতা থেকে ${bn(target)}টির মধ্যে মাত্র ${bn(questions.length)}টি ভালো প্রশ্ন পাওয়া গেছে। আরও পাতা যোগ করে দেখতে পারেন।`
          : undefined,
    });
  } catch (err: any) {
    console.error("[generate-questions]", err);
    const msg = String(err?.message || err || "");
    const slow = /abort|timeout|timed out|time-budget/i.test(msg);
    const busy = isBusy(err) || slow;
    return NextResponse.json(
      {
        error: busy
          ? slow
            ? "AI-র উত্তর আসতে বেশি সময় লাগছে। কিছুক্ষণ পরে আবার চেষ্টা করুন (কম ছবি বা কম প্রশ্ন দিলে দ্রুত হয়)।"
            : "Google-এর AI এখন খুব ব্যস্ত। ১-২ মিনিট পরে আবার চেষ্টা করুন।"
          : "প্রশ্ন তৈরি করতে গিয়ে সমস্যা হয়েছে। আবার চেষ্টা করুন। (" + msg.slice(0, 160) + ")",
      },
      { status: busy ? 503 : 500 }
    );
  }
}

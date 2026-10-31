import type { ExamParams, MCQ, PdfLayout } from "./types";
import { toBn } from "./utils";
import { toUnits, type Unit } from "./arrange";

/**
 * Bangla needs proper glyph shaping (juktakkhor, kar, etc.), which jsPDF's text
 * engine cannot do. So we lay the paper out as real HTML (the browser shapes the
 * Bangla font correctly) and capture each A4 page as a high-resolution image.
 */

// A4 at 96 dpi
const PAGE_W = 794;
const PAGE_H = 1123;
const PAD = 38;
const GAP = 12;
const FOOTER = 16;
const BODY_W = PAGE_W - PAD * 2;
const colWidth = (cols: number) => (cols === 1 ? BODY_W : Math.floor((BODY_W - GAP * 2 - 1) / 2));
const LABEL_SETS = {
  bangla: ["ক", "খ", "গ", "ঘ"],
  english: ["a", "b", "c", "d"],
  number: ["১", "২", "৩", "৪"],
};
const ROMAN = ["i", "ii", "iii", "iv", "v"];

/** PDF-এর একটি "টুকরো" (একটি প্রশ্ন, প্রথমটির আগে উদ্দীপকসহ), Word ফাইলে একই সাজ বানাতে লাগে */
export interface PieceInfo {
  no: number;
  q: MCQ;
  stimulus?: { range: string; text: string };
}
/** PDF যেভাবে সাজানো হয়েছে (ফন্ট, কলাম, কোন পাতায় কোন কলামে কোন প্রশ্ন) */
export interface PaperPlan {
  fontPt: number;
  lineSpacing: number;
  gapEm: number;
  columns: 1 | 2;
  labels: string[];
  optionsMode: "auto" | "grid" | "list" | "inline";
  questionBold: boolean;
  answerKey: boolean;
  pages: PieceInfo[][][]; // [পাতা][কলাম][টুকরো]
}

interface Resolved {
  fontSize?: number;
  questionBold: boolean;
  lineSpacing: number;
  userLineSpacing: boolean;
  columns: 1 | 2;
  options: "auto" | "grid" | "list" | "inline";
  labels: string[];
  answerKey: boolean;
  gap: number; // প্রশ্নের নিচের ফাঁক (em)
}

function resolveLayout(l?: PdfLayout): Resolved {
  const num = (v: unknown, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  return {
    fontSize: num(l?.fontSize, 7, 14),
    questionBold: l?.questionBold !== false,
    lineSpacing: num(l?.lineSpacing, 1.2, 2) ?? 1.45,
    userLineSpacing: num(l?.lineSpacing, 1.2, 2) !== undefined,
    columns: l?.columns === 1 ? 1 : 2,
    options: l?.options ?? "auto",
    labels: LABEL_SETS[l?.optionLabels ?? "bangla"] ?? LABEL_SETS.bangla,
    answerKey: l?.answerKey !== false,
    gap: 0.6,
  };
}
// Try the largest font first (11pt) and shrink in 0.25pt steps down to 6pt,
// picking the biggest size at which every group of up to 30 questions fits on ONE page.
const FONT_SIZES = Array.from({ length: 23 }, (_, i) => 11 - i * 0.25); // pt: ১১ থেকে ৫.৫
const PER_PAGE = 30; // প্রতি পাতায় সর্বোচ্চ প্রশ্ন

/**
 * বাংলা ফন্ট (Noto Sans Bengali) সত্যিই লোড হয়ে গেছে কি না নিশ্চিত করে।
 * শুধু document.fonts.ready যথেষ্ট নয়, কারণ লেখা DOM-এ বসার আগে ফন্ট ডাউনলোড শুরুই হয় না;
 * ফলে PDF-এ অন্য ফন্ট (ভাঙা যুক্তাক্ষর) চলে আসতে পারত। তাই প্রতিটি ওজন আগে থেকে লোড করা হয়।
 */
async function ensureFonts(family: string): Promise<void> {
  const sample = "অআইউএ কখগঘ ক্ষ ত্র শ্র হ্ম দ্ধ ন্ত্র ০১২৩৪৫৬৭৮৯ ABC abc i ii iii।";
  try {
    await Promise.race([
      Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 16px ${family}`, sample))),
      new Promise((r) => setTimeout(r, 10000)),
    ]);
  } catch {
    /* ফন্ট না পেলেও এগোবে */
  }
  await document.fonts.ready;
}

function el(tag: string, css = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

function makeHeader(exam: ExamParams): HTMLElement {
  const h = el("div", "text-align:center;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:12px;");
  h.append(el("div", "font-size:22px;font-weight:700;line-height:1.4;", exam.examName || "পরীক্ষা"));
  const meta = [
    exam.className && `শ্রেণি: ${exam.className}`,
    exam.subject && `বিষয়: ${exam.subject}`,
    exam.totalTime && `সময়: ${toBn(exam.totalTime)} মিনিট`,
    exam.totalMarks && `পূর্ণমান: ${toBn(exam.totalMarks)}`,
  ]
    .filter(Boolean)
    .join("   |   ");
  h.append(el("div", "font-size:13px;font-weight:500;margin-top:4px;line-height:1.5;", meta));
  h.append(el("div", "font-size:11px;color:#444;margin-top:3px;", "সঠিক উত্তরটি বেছে নাও। প্রতিটি প্রশ্নের মান সমান।"));
  return h;
}

function makeBlock(q: MCQ, no: number, L: Resolved): HTMLElement {
  const wrap = el("div", `padding-bottom:${L.gap}em;box-sizing:border-box;`);
  const row = el("div", `display:flex;gap:0.3em;font-weight:${L.questionBold ? 700 : 500};`);
  row.append(el("span", "flex:none;min-width:1.75em;", `${toBn(no)}।`), el("span", "flex:1;min-width:0;", q.question));
  wrap.append(row);

  if (q.statements?.length) {
    const st = el("div", "padding-left:2.05em;margin-top:0.15em;");
    q.statements.forEach((t, i) => {
      const r = el("div", "display:flex;gap:0.4em;");
      r.append(el("span", "flex:none;min-width:1.2em;", `${ROMAN[i] ?? i + 1}.`), el("span", "flex:1;min-width:0;", t));
      st.append(r);
    });
    st.append(el("div", `margin-top:0.15em;font-weight:${L.questionBold ? 700 : 500};`, "নিচের কোনটি সঠিক?"));
    wrap.append(st);
  }

  const maxLen = Math.max(...q.options.map((o) => o.length));
  const mode = L.options === "auto" ? (maxLen <= 9 ? "inline" : maxLen <= 18 ? "grid" : "list") : L.options;
  const cols = mode === "grid" ? "1fr 1fr" : mode === "inline" ? "repeat(4,auto)" : "1fr";
  const grid = el(
    "div",
    `display:grid;grid-template-columns:${cols};gap:0.15em ${mode === "inline" ? "1em" : "0.6em"};padding-left:2.05em;margin-top:0.2em;`
  );
  q.options.forEach((o, oi) => {
    const r = el("div", "display:flex;gap:0.3em;");
    r.append(el("span", "flex:none;", `(${L.labels[oi]})`), el("span", "flex:1;min-width:0;", o));
    grid.append(r);
  });
  wrap.append(grid);
  return wrap;
}

/**
 * একটি ইউনিটকে এক বা একাধিক "টুকরো"-তে ভাগ করে। সাধারণ/বহুপদী প্রশ্ন = ১ টুকরো।
 * উদ্দীপকের ক্ষেত্রে প্রথম টুকরোতে উদ্দীপক বক্স + প্রথম প্রশ্ন, বাকি প্রশ্ন আলাদা টুকরো
 * (দরকার হলে পরের কলামে যেতে পারে, ফলে কলামে ফাঁকা জায়গা কম থাকে)।
 */
function makePieces(u: Unit, startNo: number, L: Resolved): HTMLElement[] {
  if (!u.stimulus) return [makeBlock(u.questions[0], startNo, L)];
  const n = u.questions.length;
  const range = n === 1 ? `${toBn(startNo)}` : n === 2 ? `${toBn(startNo)} ও ${toBn(startNo + 1)}` : `${toBn(startNo)} – ${toBn(startNo + n - 1)}`;
  const box = el("div", "margin-bottom:0.3em;");
  box.append(
    el("div", "font-weight:700;margin-bottom:0.15em;", `উদ্দীপকটি পড়ে ${range} নং প্রশ্নের উত্তর দাও:`),
    el("div", "", u.stimulus)
  );
  const first = el("div", "box-sizing:border-box;");
  first.append(box, makeBlock(u.questions[0], startNo, L));
  return [first, ...u.questions.slice(1).map((q, i) => makeBlock(q, startNo + 1 + i, L))];
}

/** Greedy flow of blocks into [page][column] lists of block indices. */
function flow(heights: number[], firstH: number, nextH: number, nCols = 2): number[][][] {
  const mk = () => Array.from({ length: nCols }, () => [] as number[]);
  const pages: number[][][] = [mk()];
  let col = 0;
  let used = 0;
  let cap = firstH;
  heights.forEach((h, i) => {
    const current = pages[pages.length - 1][col];
    if (used + h > cap && current.length > 0) {
      if (col < nCols - 1) col++;
      else {
        pages.push(mk());
        col = 0;
        cap = nextH;
      }
      used = 0;
    }
    pages[pages.length - 1][col].push(i);
    used += h;
  });
  return pages;
}

/** When everything fits on one page, split into two columns of (nearly) equal height. */
function balance(heights: number[]): number[][][] {
  const n = heights.length;
  const total = heights.reduce((a, b) => a + b, 0);
  let best = n;
  let bestMax = Infinity;
  let left = 0;
  for (let k = 0; k <= n; k++) {
    const m = Math.max(left, total - left);
    if (m < bestMax) {
      bestMax = m;
      best = k;
    }
    if (k < n) left += heights[k];
  }
  const idx = heights.map((_, i) => i);
  return [[idx.slice(0, best), idx.slice(best)]];
}

function pageShell(): HTMLElement {
  const p = el(
    "div",
    `width:${PAGE_W}px;height:${PAGE_H}px;box-sizing:border-box;padding:${PAD}px;background:#fff;color:#000;position:relative;overflow:hidden;`
  );
  return p;
}

function addFooter(page: HTMLElement, text: string) {
  page.append(
    el(
      "div",
      `position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:10px;color:#777;`,
      text
    )
  );
}

function makeAnswerPage(exam: ExamParams, questions: MCQ[], pageLabel: string, labels: string[]): HTMLElement {
  const page = pageShell();
  page.append(el("div", "text-align:center;font-size:24px;font-weight:700;margin-top:6px;", "উত্তরমালা"));
  const sub = [exam.examName, exam.className && `শ্রেণি: ${exam.className}`, exam.subject && `বিষয়: ${exam.subject}`]
    .filter(Boolean)
    .join("  |  ");
  page.append(el("div", "text-align:center;font-size:13px;color:#333;margin:6px 0 22px;", sub));
  const grid = el("div", "display:grid;grid-template-columns:repeat(5,1fr);gap:8px;");
  questions.forEach((q, i) => {
    grid.append(
      el(
        "div",
        "border:1px solid #bbb;border-radius:6px;padding:9px 4px;text-align:center;font-size:16px;font-weight:600;",
        `${toBn(i + 1)}।  ${labels[q.correctIndex]}`
      )
    );
  });
  page.append(grid);
  addFooter(page, pageLabel);
  return page;
}

export async function generateQuestionPaperPdf(exam: ExamParams, questions: MCQ[], layout?: PdfLayout): Promise<PaperPlan> {
  const L = resolveLayout(layout);
  const COL_W = colWidth(L.columns);
  const units = toUnits(questions);
  const startNos = units.map((_, i) => 1 + units.slice(0, i).reduce((a, u) => a + u.questions.length, 0));
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas")]);

  const family = getComputedStyle(document.body).fontFamily;
  const stage = el(
    "div",
    `position:absolute;left:-10000px;top:0;width:${PAGE_W}px;font-family:${family};color:#000;background:#fff;letter-spacing:normal;word-spacing:normal;font-kerning:normal;font-variant-ligatures:normal;text-rendering:auto;word-break:normal;overflow-wrap:break-word;`
  );
  stage.setAttribute("data-pdf-stage", "1");
  document.body.append(stage);

  try {
    // 1) measure header
    const measureBox = el("div", `width:${BODY_W}px;`);
    stage.append(measureBox);
    const probe = makeHeader(exam);
    measureBox.append(probe);
    await ensureFonts(family);
    const headerH = Math.ceil(probe.getBoundingClientRect().height) + 12;
    measureBox.remove();

    const firstH = PAGE_H - PAD * 2 - headerH - FOOTER;
    const nextH = PAGE_H - PAD * 2 - FOOTER;

    // 2) প্রতি পাতায় সর্বোচ্চ ৩০টি প্রশ্ন; ৩০টি পর্যন্ত এক পাতায় আঁটাতে ফন্ট নিজে থেকে ছোট হয়।
    //    ৩০টির বেশি হলে বাকি প্রশ্ন পরের পাতায় যায়। (উদ্দীপক ও তার প্রশ্ন একই পাতায় থাকে।)
    const chunks: number[][] = []; // প্রতিটি ভাগ = ইউনিটের তালিকা
    {
      let cur: number[] = [];
      let count = 0;
      units.forEach((u, i) => {
        const n = u.questions.length;
        if (cur.length > 0 && count + n > PER_PAGE) {
          chunks.push(cur);
          cur = [];
          count = 0;
        }
        cur.push(i);
        count += n;
      });
      if (cur.length) chunks.push(cur);
    }

    const sizes = L.fontSize ? [L.fontSize] : FONT_SIZES;
    let chosen = sizes[sizes.length - 1];
    let chosenLs = L.lineSpacing;
    let blocks: HTMLElement[] = [];
    let infos: PieceInfo[] = [];
    let plan: number[][][] = [];
    for (const pt of sizes) {
      const ls = L.userLineSpacing ? L.lineSpacing : pt >= 8 ? 1.45 : pt >= 7 ? 1.3 : 1.2;
      const Lp: Resolved = { ...L, gap: pt >= 8 ? 0.6 : pt >= 7 ? 0.4 : 0.3 };
      const m = el("div", `width:${COL_W}px;font-size:${pt}pt;line-height:${ls};`);
      stage.append(m);
      const pieces: HTMLElement[] = [];
      const pieceInfos: PieceInfo[] = [];
      const pieceOfUnit: number[][] = [];
      units.forEach((u, i) => {
        const ps = makePieces(u, startNos[i], Lp);
        pieceOfUnit.push(ps.map((_, k) => pieces.length + k));
        pieces.push(...ps);
        const n = u.questions.length;
        const a = startNos[i];
        const range = n === 1 ? toBn(a) : n === 2 ? `${toBn(a)} ও ${toBn(a + 1)}` : `${toBn(a)} – ${toBn(a + n - 1)}`;
        ps.forEach((_, k) =>
          pieceInfos.push({
            no: a + k,
            q: u.questions[k],
            ...(k === 0 && u.stimulus ? { stimulus: { range, text: u.stimulus } } : {}),
          })
        );
      });
      pieces.forEach((b) => m.append(b));
      await ensureFonts(family);
      const heights = pieces.map((b) => b.getBoundingClientRect().height);

      const pagesPlan: number[][][] = [];
      let allOnePage = true;
      chunks.forEach((unitIdx, ci) => {
        const idx = unitIdx.flatMap((u) => pieceOfUnit[u]);
        const h = idx.map((i) => heights[i]);
        const cap = ci === 0 ? firstH : nextH;
        let local = flow(h, cap, nextH, L.columns);
        if (local.length === 1 && L.columns === 2) local = balance(h);
        if (local.length > 1) allOnePage = false;
        local.forEach((cols) => pagesPlan.push(cols.map((c) => c.map((k) => idx[k]))));
      });
      chosen = pt;
      chosenLs = ls;
      blocks = pieces;
      infos = pieceInfos;
      plan = pagesPlan;
      if (allOnePage) break; // প্রতিটি ভাগ এক পাতায় আঁটছে
    }

    // 3) build the final pages
    const pages: HTMLElement[] = plan.map((cols, pi) => {
      const page = pageShell();
      if (pi === 0) page.append(makeHeader(exam));
      const bodyH = pi === 0 ? firstH : nextH;
      const body = el("div", `display:flex;gap:${GAP}px;height:${bodyH}px;font-size:${chosen}pt;line-height:${chosenLs};`);
      const mkCol = (idx: number[]) => {
        const c = el("div", `width:${COL_W}px;flex:none;`);
        idx.forEach((bi) => c.append(blocks[bi]));
        return c;
      };
      if (L.columns === 1) body.append(mkCol(cols[0]));
      else body.append(mkCol(cols[0]), el("div", "width:1px;background:#bbb;flex:none;"), mkCol(cols[1]));
      page.append(body);
      addFooter(page, `${exam.examName || "প্রশ্নপত্র"}  •  পৃষ্ঠা ${toBn(pi + 1)}`);
      return page;
    });
    if (L.answerKey) pages.push(makeAnswerPage(exam, questions, `${exam.examName || "প্রশ্নপত্র"}  •  উত্তরমালা`, L.labels));

    pages.forEach((p) => stage.append(p));
    await ensureFonts(family);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    // 4) capture each page and put it on an A4 PDF page
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        onclone: (doc) => {
          const s = doc.querySelector("[data-pdf-stage]") as HTMLElement | null;
          if (s) {
            s.style.left = "0";
            s.style.top = "0";
          }
        },
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    }

    const safe = (exam.examName || "প্রশ্নপত্র").replace(/[\\/:*?"<>|]+/g, "_").trim() || "question-paper";
    pdf.save(`${safe}.pdf`);
    return {
      fontPt: chosen,
      lineSpacing: chosenLs,
      gapEm: chosen >= 8 ? 0.6 : chosen >= 7 ? 0.4 : 0.3,
      columns: L.columns,
      labels: L.labels,
      optionsMode: L.options,
      questionBold: L.questionBold,
      answerKey: L.answerKey,
      pages: plan.map((cols) => cols.map((c) => c.map((bi) => infos[bi]))),
    };
  } finally {
    stage.remove();
  }
}

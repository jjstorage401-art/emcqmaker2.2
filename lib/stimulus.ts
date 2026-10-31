import type { MCQ } from "./types";

/**
 * একই উদ্দীপক বা একই প্রশ্ন AI একাধিকবার (বিভিন্ন পাতা/অনুরোধে) একটু ভিন্ন বানানে লিখলে
 * সেগুলোকে এক বলে চিনে নেওয়ার সহায়ক ফাংশন।
 */

/** শুধু অক্ষর ও অঙ্ক রাখে (ফাঁকা জায়গা, যতিচিহ্ন বাদ), ছোট হাতের অক্ষরে। */
export function squash(s: string): string {
  return (s || "").toLowerCase().replace(/[\s.,;:!?'"“”‘’()\[\]{}\-–—।\/\\|…*_+=<>~`^%$#@&]+/g, "");
}

const BN = "০১২৩৪৫৬৭৮৯";
/** লেখার সব সংখ্যা (বাংলা/ইংরেজি এক ধরে) পরপর জুড়ে; সংখ্যা মিলছে কি না যাচাইয়ে লাগে */
function digitsOf(s: string): string {
  return (s.match(/[০-৯0-9]+/g) ?? []).map((t) => t.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)))).join(",");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** দুটি লেখার মিল: dice (০–১) ও ছোটটি বড়টির ভেতরে কতটা আছে (০–১) */
function overlap(a: string, b: string): { dice: number; contain: number } {
  const x = squash(a);
  const y = squash(b);
  if (x.length < 2 || y.length < 2) return { dice: x === y && x ? 1 : 0, contain: x === y && x ? 1 : 0 };
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  bx.forEach((c, g) => {
    inter += Math.min(c, by.get(g) ?? 0);
  });
  const nx = x.length - 1;
  const ny = y.length - 1;
  return { dice: (2 * inter) / (nx + ny), contain: inter / Math.min(nx, ny) };
}

/** দুটি উদ্দীপক কি আসলে একই (বানান ভুল/কাটা কপি সহ)? */
export function sameStimulus(a: string, b: string): boolean {
  const { dice, contain } = overlap(a, b);
  if (dice >= 0.82 && digitsOf(a) === digitsOf(b)) return true;
  return (contain >= 0.9 && Math.min(squash(a).length, squash(b).length) >= 20);
}

function questionText(q: MCQ): string {
  return [q.question, ...(q.statements ?? []), ...q.options].join(" ");
}

/** দুটি প্রশ্ন কি একই (প্রশ্ন + বিবৃতি + অপশন মিলিয়ে)? প্রশ্নের অংশ ও অপশনের অংশ, দুটোই প্রায় হুবহু না মিললে ভিন্ন ধরা হয় */
export function sameQuestion(a: MCQ, b: MCQ): boolean {
  if (squash(questionText(a)) === squash(questionText(b))) return true;
  const stemA = [a.question, ...(a.statements ?? [])].join(" ");
  const stemB = [b.question, ...(b.statements ?? [])].join(" ");
  const optA = a.options.join(" ");
  const optB = b.options.join(" ");
  return (
    digitsOf(questionText(a)) === digitsOf(questionText(b)) &&
    overlap(stemA, stemB).dice >= 0.93 &&
    overlap(optA, optB).dice >= 0.9
  );
}

/**
 * সব উদ্দীপক দল করে, প্রতিটি দলের সব প্রশ্নে একই (সবচেয়ে নির্ভরযোগ্য) উদ্দীপক বসায়।
 * "নির্ভরযোগ্য" = দলের অন্য কপিগুলোর সাথে সবচেয়ে বেশি মিলে যায় এমনটি (বানান ভুল করা কপি হেরে যায়);
 * সমান হলে লম্বাটি। প্রশ্নগুলো জায়গায় বদলানো হয় (অর্ডার একই থাকে)।
 */
export function unifyStimuli(list: MCQ[]): void {
  for (const q of list) {
    if (q.stimulus) {
      const c = cleanStimulus(q.stimulus);
      if (c) q.stimulus = c;
    }
  }
  const clusters: { texts: string[]; members: MCQ[] }[] = [];
  for (const q of list) {
    if (!q.stimulus) continue;
    const c = clusters.find((cl) => cl.texts.some((t) => sameStimulus(t, q.stimulus!)));
    if (c) {
      c.members.push(q);
      c.texts.push(q.stimulus);
    } else {
      clusters.push({ texts: [q.stimulus], members: [q] });
    }
  }
  for (const c of clusters) {
    const uniq = Array.from(new Set(c.texts.map((t) => t.replace(/\s+/g, " ").trim())));
    let best = uniq[0];
    if (uniq.length > 1) {
      let bestScore = -1;
      for (const u of uniq) {
        // প্রতিটি কপি (পুনরাবৃত্তি সহ) এর সাথে মিল যোগ করা: বেশিবার লেখা কপি জেতে
        let score = 0;
        for (const t of c.texts) score += overlap(u, t).dice;
        score += squash(u).length / 100000; // সমান হলে লম্বাটি
        if (score > bestScore) {
          bestScore = score;
          best = u;
        }
      }
    }
    for (const m of c.members) m.stimulus = best;
  }
}

/**
 * AI কখনো উদ্দীপকের ভেতরে নিজের চিন্তা/মন্তব্য ("Wait, ...", "(Note: ...)", "Let's ...") লিখে ফেলে বা
 * একই লেখা বারবার জুড়ে দেয়। এখানে সেগুলো কেটে শুধু একবারের আসল লেখাটি রাখা হয়।
 */
export function sanitizeText(input: string): string {
  let s = stripSourceTags(input || "").replace(/\s+/g, " ").trim();
  // ইংরেজি মন্তব্যের শুরু কেটে ফেলা
  const m = s.search(/\(\s*Note\b|\bNote\s*:|\bWait\b|\bLet'?s\b|\bLet me\b|\bActually\b|\bHmm\b|\bI will\b|\bI'll\b|\bLooking at\b|\bexact(ly)? (visible )?(text|string)\b|\bthe stimulus\b/i);
  if (m > 0) s = s.slice(0, m).trim();
  // একই লেখা আবার শুরু হলে সেখানে কাটা
  const head = s.slice(0, 40);
  if (head.length >= 25) {
    const again = s.indexOf(head, 20);
    if (again > 0) s = s.slice(0, again).trim();
  }
  return fixMath(s);
}

/** AI-র নিজের "ভাবনা/নোট" লেখা (ইংরেজি মন্তব্য) কোনো ঘরে ঢুকে গেছে কি না */
const LEAK = /\(?\s*(note\s*:|wait\b|let'?s\b|actually\b|hmm\b|okay\b|i will\b|i'll\b|the text\b|text derived|stimulus text|exact (visible )?text|formatting accurately)/i;
export function looksLeaked(s: string): boolean {
  return LEAK.test(s || "");
}

const HEADING = /উদ্দীপক(?:টি)?\s*পড[েুি]?\s*[^।:\n]{0,50}?উত্তর\s*দাও\s*[:।]?/;

/**
 * উদ্দীপকের ঘর থেকে বাড়তি জিনিস সরায়: AI-র ইংরেজি নোট/ভাবনা ("Note:", "Wait,", "Let's …"),
 * "উদ্দীপকটি পড়ে … উত্তর দাও" শিরোনাম, এবং একই অনুচ্ছেদের বারবার কপি।
 * ফলাফল পরিষ্কার না হলে (ইংরেজি অক্ষরে ভরা) খালি লেখা ফেরত দেয়।
 */
export function cleanStimulus(input: string): string {
  let t = stripSourceTags(input || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // ১) ইংরেজি নোট/ভাবনা শুরু হলে সেখানেই কাটা
  const m = LEAK.exec(t);
  if (m && m.index > 15) t = t.slice(0, m.index).replace(/[\s(\[]+$/, "");
  else if (m) return "";
  // ২) শিরোনাম: শুরুতে থাকলে বাদ; লেখার মাঝে থাকলে সেখান থেকে বাকিটা (সাধারণত কপি) বাদ
  const h = HEADING.exec(t);
  if (h) t = h.index < 20 ? t.slice(h.index + h[0].length).trim() : t.slice(0, h.index).trim();
  // ৩) একই শুরু আবার এলে সেখানে কাটা
  const p = t.slice(0, 24);
  if (p.length === 24) {
    const again = t.indexOf(p, 24);
    if (again > 0) t = t.slice(0, again).trim();
  }
  // ৩.৫) একই ১২ অক্ষরের টুকরো ৪ বা তার বেশিবার থাকলে লেখাটি "ঘুরপাক খাওয়া" নষ্ট লেখা
  const sq = squash(t);
  if (sq.length > 150) {
    const cnt = new Map<string, number>();
    for (let i = 0; i + 12 <= sq.length; i += 3) {
      const g = sq.slice(i, i + 12);
      cnt.set(g, (cnt.get(g) ?? 0) + 1);
    }
    for (const v of cnt.values()) if (v >= 4) return "";
  }
  // উদ্দীপক অস্বাভাবিক লম্বা হলে নষ্ট ধরা হয়
  if (t.length > 900) return "";
  // ৪) ইংরেজি অক্ষরের আধিক্য মানে নষ্ট লেখা
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  if (t.length > 40 && latin / t.length > 0.3) return "";
  // ৫) এত লম্বা উদ্দীপক বাস্তবে হয় না: নষ্ট/লুপে পড়া লেখা, বাদ
  if (t.length > 1200) return "";
  return t;
}

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ", a: "ᵃ", b: "ᵇ", m: "ᵐ", k: "ᵏ", p: "ᵖ", t: "ᵗ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  n: "ₙ", i: "ᵢ", x: "ₓ", a: "ₐ", e: "ₑ", o: "ₒ", m: "ₘ", k: "ₖ", p: "ₚ", t: "ₜ",
};
const toScript = (body: string, map: Record<string, string>): string | null => {
  let out = "";
  for (const ch of body) {
    const m = map[ch];
    if (!m) return null;
    out += m;
  }
  return out;
};

/**
 * গণিতের লেখা সুন্দর করে: 2^2 → 2², x^{n+1} → xⁿ⁺¹, H_2O → H₂O, \times → ×, \frac{a}{b} → a/b ইত্যাদি।
 * বদলানো না গেলে (অচেনা অক্ষর থাকলে) লেখা যেমন ছিল তেমনই থাকে।
 */
export function fixMath(input: string): string {
  let s = input;
  if (!/[\^_\\]/.test(s)) return s;
  s = s
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, (_m, a) => (a.length === 1 ? "√" + a : "√(" + a + ")"))
    .replace(/\\times\b/g, "×")
    .replace(/\\div\b/g, "÷")
    .replace(/\\pm\b/g, "±")
    .replace(/\\(?:leq?|leqslant)\b/g, "≤")
    .replace(/\\(?:geq?|geqslant)\b/g, "≥")
    .replace(/\\(?:neq?)\b/g, "≠")
    .replace(/\\pi\b/g, "π")
    .replace(/\\theta\b/g, "θ")
    .replace(/\\alpha\b/g, "α")
    .replace(/\\beta\b/g, "β")
    .replace(/\\circ\b/g, "°")
    .replace(/\\cdot\b/g, "·")
    .replace(/\$/g, "");
  s = s.replace(/\^\s*\{([^{}]{1,12})\}|\^\s*([0-9]+|[-+−]?[0-9]+|[nixyabmkpt])/g, (m, a, b) => toScript((a ?? b).replace(/\s+/g, ""), SUP) ?? m);
  s = s.replace(/_\s*\{([^{}]{1,12})\}|([A-Za-z\)])_([0-9]+|[nixaeomkpt](?![A-Za-z]))/g, (m, a, pre, b) => {
    if (a !== undefined) return toScript(a.replace(/\s+/g, ""), SUB) ?? m;
    const sub = toScript(b, SUB);
    return sub ? pre + sub : m;
  });
  return s;
}

/**
 * বইয়ের পাতায় প্রশ্নের পাশে ছাপা উত্তর ("উত্তর: খ", "Ans: b", ✓ চিহ্ন, "সঠিক উত্তর …")
 * ভুল করে প্রশ্ন/বিবৃতি/অপশনের লেখায় ঢুকে গেলে সরিয়ে দেয়। উত্তর আলাদা ঘরে (correctIndex) থাকে।
 */
export function stripAnswer(input: string): string {
  let t = (input || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  // ১) "উত্তর: …" / "সঠিক উত্তর: …" / "Ans: …" থেকে শেষ পর্যন্ত (ছোট টুকরো হলে)
  t = t.replace(/\s*[\(\[\-–—|]*\s*(?:সঠিক\s*উত্তর|উত্তর|উঃ|উ\s*:|Correct\s*Answer|Answer|Ans)\s*(?:[:：ঃ]|[\-–—=]|\s(?=[\(\[]?[কখগঘabcd][\)\]\.\s]))\s*[^\n]{0,40}$/i, "");
  // ২) শেষে বা শুরুতে টিক চিহ্ন
  t = t.replace(/\s*[✓✔✅☑√]+\s*$/u, "").replace(/^[✓✔✅☑√]+\s*/u, "");
  // ৩) শেষে একা অপশন-অক্ষর, যেমন "… সঠিক? (খ)"
  if (t.length > 12) t = t.replace(/\s*[\(\[]\s*[কখগঘ]\s*[\)\]]\s*$/, "");
  return t.trim();
}

/**
 * পরীক্ষার উৎস-চিহ্ন ("[ব. বো. '২৪]", "[ঢা. বো. ২০২৩]") সরায় এবং AI লুপে পড়ে একই টুকরো
 * বারবার লিখলে সেটি একবারে নামিয়ে আনে।
 */
export function stripSourceTags(input: string): string {
  let t = input;
  t = t.replace(/[\[\(][^\[\]\(\)]{0,14}?বো\.?\s*['’‘]?\s*[০-৯0-9]{2,4}\.?\s*[\]\)]?/g, " ");
  t = t.replace(/[\[\(][^\[\]\(\)]{0,14}?বো\.?\s*[\]\)]/g, " ");
  // একই ৩–৪০ অক্ষরের টুকরো পরপর ৩ বা তার বেশিবার থাকলে একবার
  for (let i = 0; i < 3; i++) {
    const n = t.replace(/([\s\S]{3,40}?)(?:\s*\1){2,}/g, "$1");
    if (n === t) break;
    t = n;
  }
  return t;
}

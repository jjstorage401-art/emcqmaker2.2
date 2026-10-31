import type { MCQ } from "./types";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Unit {
  stimulus?: string;
  questions: MCQ[];
}

type Kind = "std" | "stmt" | "stim";
const kindOf = (u: Unit): Kind => (u.stimulus ? "stim" : u.questions[0].statements?.length ? "stmt" : "std");

/** পরপর থাকা একই উদ্দীপকের প্রশ্নগুলোকে একটি ইউনিটে জড়ো করে (PDF আঁকার জন্য)। */
export function toUnits(list: MCQ[]): Unit[] {
  const units: Unit[] = [];
  for (const q of list) {
    const key = q.stimulus ? norm(q.stimulus) : "";
    const last = units[units.length - 1];
    if (key && last?.stimulus && norm(last.stimulus) === key) last.questions.push(q);
    else units.push({ stimulus: key ? q.stimulus : undefined, questions: [q] });
  }
  return units;
}

/**
 * প্রশ্নগুলো এলোমেলো করে সাজায়, যাতে একই ধরনের প্রশ্ন পরপর না আসে।
 * একই উদ্দীপকের প্রশ্নগুলো সবসময় একসাথে (উদ্দীপক + তার প্রশ্ন) থাকে।
 */
export function arrangeQuestions(list: MCQ[], rand: () => number = Math.random): MCQ[] {
  // একই উদ্দীপকের সব প্রশ্ন এক জায়গায় আনা
  const groups = new Map<string, MCQ[]>();
  const units: Unit[] = [];
  for (const q of list) {
    const key = q.stimulus ? norm(q.stimulus) : "";
    if (!key) {
      units.push({ questions: [q] });
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      units.push({ stimulus: q.stimulus, questions: g });
    }
    g.push(q);
  }

  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [units[i], units[j]] = [units[j], units[i]];
  }

  // একই ধরনের ৩টি ইউনিট পরপর থাকলে অন্য ধরনের একটি সামনে এনে ভেঙে দেওয়া
  for (let i = 2; i < units.length; i++) {
    const k = kindOf(units[i]);
    if (k === kindOf(units[i - 1]) && k === kindOf(units[i - 2])) {
      for (let j = i + 1; j < units.length; j++) {
        if (kindOf(units[j]) !== k) {
          [units[i], units[j]] = [units[j], units[i]];
          break;
        }
      }
    }
  }
  return units.flatMap((u) => u.questions);
}

import type { ExamParams, MCQ } from "./types";
import { sameQuestion, unifyStimuli } from "./stimulus";

export interface Job<I> {
  imgs: I[];
  part?: { index: number; total: number };
}

export type Fetcher<I> = (
  imgs: I[],
  params: ExamParams,
  part?: { index: number; total: number },
  exclude?: string[]
) => Promise<MCQ[]>;

export interface GatherResult {
  questions: MCQ[];
  /** সীমার (উদ্দীপক/বহুপদী) কারণে বাদ পড়া প্রশ্নের সংখ্যা */
  skippedByCap: number;
  failedCalls: number;
  lastError: unknown;
}

/**
 * বহুপদী ও উদ্দীপকভিত্তিক প্রশ্নের সর্বোচ্চ সংখ্যা (প্রতিটির জন্য আলাদা), মোট প্রশ্ন অনুযায়ী:
 * ১০টিতে ০, ২০টিতে ২, ৩০ ও তার বেশিতে ৫; মাঝের সংখ্যায় সমানুপাতিক।
 */
export function typeCap(total: number): number {
  if (total >= 30) return 5;
  if (total >= 20) return Math.floor(2 + (total - 20) * 0.3);
  if (total >= 10) return Math.floor((total - 10) * 0.2);
  return 0;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** "আগেই পাওয়া" তালিকার জন্য প্রশ্নের পরিচয়-লেখা (বহুপদীর শুরুর লাইন সবার এক, তাই প্রথম বিবৃতি/অপশনও যোগ) */
const label = (q: MCQ) => norm([q.question, q.statements?.[0] ?? "", q.options[0] ?? ""].join(" ")).slice(0, 140);

/**
 * Runs all jobs in parallel, asks each for ~50% MORE questions than its share,
 * then picks an even share from every job (so all pages are covered).
 * If we are still short, it asks again (up to `maxTopUps` times), telling the AI
 * which questions already exist so it does not repeat them.
 */
export async function gatherQuestions<I>(opts: {
  jobs: Job<I>[];
  total: number;
  form: ExamParams;
  fetcher: Fetcher<I>;
  onTopUp?: () => void;
  maxTopUps?: number;
  /** পুরো প্রশ্নপত্রে উদ্দীপকভিত্তিক ও বহুপদী প্রশ্নের সর্বোচ্চ সংখ্যা */
  caps?: { stim: number; stmt: number };
}): Promise<GatherResult> {
  const { jobs, total, form, fetcher } = opts;
  const base = Math.floor(total / jobs.length);
  const extra = total % jobs.length;
  const quota = jobs.map((_, i) => base + (i < extra ? 1 : 0));
  const lists: MCQ[][] = jobs.map(() => []);
  const seen = new Set<string>();
  let failedCalls = 0;
  let lastError: unknown;

  const runRound = async (needs: number[], exclude: string[]) => {
    const res = await Promise.allSettled(
      jobs.map((job, i) =>
        needs[i] > 0
          ? fetcher(job.imgs, { ...form, numQuestions: Math.min(needs[i], 100) }, job.part, exclude)
          : Promise.resolve([] as MCQ[])
      )
    );
    res.forEach((r, i) => {
      if (r.status === "rejected") {
        failedCalls++;
        lastError = r.reason;
        return;
      }
      for (const q of r.value) {
        const key = label(q);
        if (!norm(q.question)) continue;
        // একই প্রশ্ন (প্রশ্ন + বিবৃতি + অপশন মিলিয়ে) আগে এসে থাকলে বাদ। শুধু প্রশ্নের লেখা মিললেই বাদ নয়
        // (সব বহুপদীর শুরুর লাইন একই, "নিচের তথ্যগুলো লক্ষ কর:")।
        if (lists.some((l) => l.some((x) => sameQuestion(x, q)))) continue;
        seen.add(key);
        lists[i].push(q);
      }
    });
    // বিভিন্ন পাতা/অনুরোধে একই উদ্দীপক একটু ভিন্ন বানানে এলে একটি সেরা কপিতে মিলিয়ে দেওয়া
    unifyStimuli(lists.flat());
  };

  const capStim = opts.caps?.stim ?? Infinity;
  const capStmt = opts.caps?.stmt ?? Infinity;
  const stimKey = (q: MCQ) => (q.stimulus ? norm(q.stimulus) : "");
  let skippedByCap = 0;

  // প্রতিটি কাজের নিজের ভাগ আগে, তারপর বাকি অতিরিক্ত প্রশ্ন ঘুরিয়ে ঘুরিয়ে।
  // উদ্দীপক ও বহুপদী প্রশ্নের সর্বোচ্চ সীমা মানা হয়; উদ্দীপকের প্রশ্নগুলো একসাথে নেওয়া হয়।
  const pick = (): MCQ[] => {
    const cand: MCQ[] = [];
    lists.forEach((l, i) => cand.push(...l.slice(0, quota[i])));
    for (let round = 0; ; round++) {
      let any = false;
      for (let i = 0; i < lists.length; i++) {
        const q = lists[i][quota[i] + round];
        if (q) {
          cand.push(q);
          any = true;
        }
      }
      if (!any) break;
    }
    const all = lists.flat();
    const chosen: MCQ[] = [];
    const used = new Set<MCQ>();
    let nStim = 0;
    let nStmt = 0;
    let skipped = 0;
    for (const q of cand) {
      if (chosen.length >= total) break;
      if (used.has(q)) continue;
      const k = stimKey(q);
      if (k) {
        const members = all.filter((m) => stimKey(m) === k && !used.has(m));
        const take = Math.min(members.length, capStim - nStim, total - chosen.length);
        if (take <= 0) {
          members.forEach((m) => used.add(m));
          skipped += members.length;
          continue;
        }
        members.slice(0, take).forEach((m) => {
          chosen.push(m);
          used.add(m);
        });
        members.slice(take).forEach((m) => used.add(m));
        skipped += members.length - take;
        nStim += take;
      } else if (q.statements?.length) {
        used.add(q);
        if (nStmt >= capStmt) {
          skipped++;
          continue;
        }
        chosen.push(q);
        nStmt++;
      } else {
        used.add(q);
        chosen.push(q);
      }
    }
    skippedByCap = skipped;
    return chosen;
  };

  await runRound(quota.map((n) => (n > 0 ? Math.ceil(n * 1.5) + 1 : 0)), []);

  const maxTopUps = opts.maxTopUps ?? 2;
  for (let attempt = 0; attempt < maxTopUps; attempt++) {
    const have = pick().length;
    if (have >= total) break;
    opts.onTopUp?.();
    const per = Math.ceil(((total - have) * 1.5) / jobs.length) + 1;
    const before = seen.size;
    await runRound(
      jobs.map(() => per),
      Array.from(seen).slice(0, 120)
    );
    if (seen.size === before) break; // কোনো অগ্রগতি নেই, আর চেষ্টা করে লাভ নেই
  }

  // ঠিক `total`টির বেশি কখনো নয়
  const questions = pick().slice(0, total);
  return { questions, skippedByCap, failedCalls, lastError };
}

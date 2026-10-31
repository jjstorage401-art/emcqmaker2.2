"use client";

import * as React from "react";
import {
  FileText,
  Loader2,
  Sparkles,
  Clock,
  Award,
  Hash,
  GraduationCap,
  BookOpen,
  PenLine,
  MessageSquare,
  Download,
  Trash2,
  History as HistoryIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { unifyStimuli } from "@/lib/stimulus";
import { UploadZone } from "@/components/upload-zone";
import { generateQuestionPaperPdf } from "@/lib/pdf";
import { downloadQuestionPaperDocx } from "@/lib/docx";
import { toBn } from "@/lib/utils";
import { addHistory, formatDate, loadHistory, removeHistory, type HistoryItem } from "@/lib/history";
import { gatherQuestions, typeCap } from "@/lib/gather";
import { arrangeQuestions } from "@/lib/arrange";
import type { ExamParams, MCQ, PdfLayout, UploadedImage } from "@/lib/types";

const initial: ExamParams = {
  examName: "",
  className: "",
  subject: "",
  totalTime: "",
  totalMarks: "",
  numQuestions: 20,
  extraInstructions: "",
  source: "extract",
};

function Field({
  id,
  label,
  icon: Icon,
  children,
  className,
}: {
  id: string;
  label: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </Label>
      {children}
    </div>
  );
}

async function fetchOnce(
  imgs: UploadedImage[],
  params: ExamParams,
  part?: { index: number; total: number },
  exclude?: string[]
): Promise<MCQ[]> {
  const res = await fetch("/api/generate-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      params,
      part,
      exclude,
      images: imgs.map(({ base64, mimeType }) => ({ base64, mimeType })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new Error("ছবির সাইজ অনেক বেশি। কম ছবি দিয়ে আবার চেষ্টা করুন।");
    if (res.status === 504) throw new Error("সময় শেষ হয়ে গেছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।");
    const err: any = new Error(data.error || `অনুরোধ ব্যর্থ হয়েছে (${toBn(res.status)})`);
    err.retryable = res.status === 503 || res.status === 502 || res.status === 429;
    throw err;
  }
  return data.questions as MCQ[];
}

async function fetchQuestions(
  imgs: UploadedImage[],
  params: ExamParams,
  part?: { index: number; total: number },
  exclude?: string[]
): Promise<MCQ[]> {
  try {
    return await fetchOnce(imgs, params, part, exclude);
  } catch (e: any) {
    if (!e?.retryable) throw e;
    await new Promise((r) => setTimeout(r, 2500)); // ব্যস্ত থাকলে একবার আবার চেষ্টা
    return fetchOnce(imgs, params, part, exclude);
  }
}

export default function Home() {
  const [images, setImages] = React.useState<UploadedImage[]>([]);
  const [form, setForm] = React.useState<ExamParams>(initial);
  const [loading, setLoading] = React.useState(false);
  const [step, setStep] = React.useState("");
  const [history, setHistory] = React.useState<HistoryItem[]>([]);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setHistory(loadHistory());
  }, []);

  async function redownload(item: HistoryItem) {
    setDownloadingId(item.id);
    try {
      const plan = await generateQuestionPaperPdf(item.exam, item.questions, item.layout);
      let wordOk = true;
      try {
        await new Promise((r) => setTimeout(r, 500));
        downloadQuestionPaperDocx(item.exam, item.questions, item.layout, plan);
      } catch {
        wordOk = false;
      }
      toast.success(wordOk ? "PDF ও Word ফাইল নামানো হয়েছে।" : "PDF নামানো হয়েছে।");
    } catch {
      toast.error("PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setDownloadingId(null);
    }
  }

  function removeItem(id: string) {
    setHistory(removeHistory(id));
    toast.success("মুছে ফেলা হয়েছে।");
  }

  const set = (k: keyof ExamParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "numQuestions" ? Number(e.target.value) : e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (images.length === 0) return toast.error("প্রথমে বইয়ের অন্তত একটি পাতার ছবি বা PDF দিন।");
    if (!form.numQuestions || form.numQuestions < 1) return toast.error("প্রশ্নের সংখ্যা সঠিকভাবে লিখুন।");

    setLoading(true);
    setStep("ছবি বিশ্লেষণ করা হচ্ছে…");
    const toastId = toast.loading("AI আপনার বইয়ের পাতা পড়ে প্রশ্ন বানাচ্ছে…");

    try {
      // ছবিগুলো ৩টি করে ভাগ করে একসাথে (parallel) পাঠানো হয়, যাতে প্রতিটি অনুরোধ অল্প সময়ে শেষ হয়।
      // কাজ ভাগ: প্রতিটি অনুরোধে সর্বোচ্চ ~২টি ছবি ও ~৮টি প্রশ্ন (সর্বোচ্চ ৮টি অনুরোধ)।
      const total = form.numQuestions;
      const nImg = images.length;
      const extractMode = form.source === "extract";
      // ছাপা প্রশ্ন বাছাই: প্রতিটি অনুরোধে সর্বোচ্চ ১–২টি ছবি (দ্রুত শেষ হয়), পাতার সব প্রশ্ন তোলা হয়; একই ছবি ভাগ হয় না
      const jobsCount = extractMode
        ? Math.min(8, Math.max(nImg, 1))
        : Math.min(8, Math.max(Math.ceil(nImg / 2), Math.ceil(total / 8), 1));
      const jobs: { imgs: UploadedImage[]; part?: { index: number; total: number } }[] = [];
      if (jobsCount <= nImg) {
        // ছবিগুলো পরপর কয়েকটি দলে ভাগ
        for (let j = 0; j < jobsCount; j++) {
          const from = Math.floor((j * nImg) / jobsCount);
          const to = Math.floor(((j + 1) * nImg) / jobsCount);
          jobs.push({ imgs: images.slice(from, to) });
        }
      } else {
        // ছবি কম, কাজ বেশি: একটি ছবির আলাদা আলাদা অংশ থেকে আলাদা অনুরোধ
        const owner = Array.from({ length: jobsCount }, (_, j) => Math.floor((j * nImg) / jobsCount));
        const shared: Record<number, number> = {};
        owner.forEach((o) => (shared[o] = (shared[o] || 0) + 1));
        const usedCount: Record<number, number> = {};
        for (let j = 0; j < jobsCount; j++) {
          const o = owner[j];
          const k = (usedCount[o] = (usedCount[o] ?? -1) + 1);
          jobs.push({
            imgs: [images[o]],
            part: shared[o] > 1 ? { index: k, total: shared[o] } : undefined,
          });
        }
      }
      // AI বক্সে ফন্ট/স্টাইলের নির্দেশ থাকলে সেটি আলাদাভাবে বুঝে নেওয়া হয় (প্রশ্ন বানানোর সাথে সমান্তরালে)
      const instruction = (form.extraInstructions ?? "").trim();
      const layoutPromise: Promise<{ layout?: PdfLayout; failed?: boolean }> = instruction
        ? fetch("/api/parse-layout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: instruction }),
          })
            .then((r) => r.json())
            .catch(() => ({ failed: true }))
        : Promise.resolve({});

      // উদ্দীপকভিত্তিক ও বহুপদী প্রশ্ন: মোট প্রশ্ন অনুযায়ী সর্বোচ্চ সীমা (১০টিতে ০, ২০টিতে ২, ৩০টিতে ৫)
      const CAP = typeCap(total);
      // ছাপা প্রশ্ন বাছাইয়ে প্রতিটি পাতা থেকে সীমা পর্যন্ত বহুপদী/উদ্দীপক তোলা হয় (চূড়ান্ত সীমা মোট হিসাবে নিচে প্রয়োগ হয়), যাতে সাধারণ প্রশ্নের জায়গা না কমে
      const perJob = CAP === 0 ? 0 : extractMode ? CAP : Math.ceil(CAP / jobs.length);
      const { questions: gathered, skippedByCap, failedCalls, lastError } = await gatherQuestions<UploadedImage>({
        jobs,
        total,
        form: { ...form, limits: { stim: perJob, stmt: perJob } },
        caps: { stim: CAP, stmt: CAP },
        fetcher: fetchQuestions,
        maxTopUps: 2,
        onTopUp: () => {
          setStep("প্রশ্নের সংখ্যা পূরণ করা হচ্ছে…");
          toast.loading("আরও প্রশ্ন যোগ করা হচ্ছে…", { id: toastId });
        },
      });
      if (gathered.length === 0) {
        throw lastError ?? new Error("কোনো প্রশ্ন তৈরি হয়নি। আবার চেষ্টা করুন।");
      }
      // ধরন অনুযায়ী এলোমেলো করে সাজানো (উদ্দীপকের প্রশ্নগুলো একসাথে থাকে)
      unifyStimuli(gathered); // একই উদ্দীপক একটু ভিন্ন বানানে এলে এক করে নেওয়া
      const questions = arrangeQuestions(gathered.slice(0, total));
      const parsed = await layoutPromise;
      let layout: PdfLayout | undefined = parsed.layout && Object.keys(parsed.layout).length ? parsed.layout : undefined;
      // পাতায় সব প্রশ্নের উত্তর ছাপা না থাকলে উত্তরমালা যোগ করা হয় না
      const missingAnswers = questions.filter((q) => q.answerOnPage === false).length;
      if (missingAnswers > 0) layout = { ...(layout ?? {}), answerKey: false };
      if (parsed.failed) toast.warning("ফন্ট/স্টাইলের নির্দেশ বোঝা যায়নি, তাই স্বাভাবিক সাজে PDF হচ্ছে।");
      setHistory(addHistory(form, [...questions], layout));

      setStep("PDF তৈরি হচ্ছে…");
      toast.loading("প্রশ্নপত্রের PDF তৈরি হচ্ছে…", { id: toastId });
      const plan = await generateQuestionPaperPdf(form, questions, layout);
      // একই প্রশ্নপত্রের Word ফাইল: বানান ভুল থাকলে শিক্ষক নিজে ঠিক করে নিতে পারবেন
      let wordOk = true;
      try {
        await new Promise((r) => setTimeout(r, 500)); // দুটি ডাউনলোড একসাথে ব্রাউজার আটকে দিতে পারে, তাই একটু বিরতি
        downloadQuestionPaperDocx(form, questions, layout, plan);
      } catch {
        wordOk = false;
      }

      toast.success(`প্রশ্নপত্র তৈরি! মোট ${toBn(questions.length)}টি প্রশ্ন।${wordOk ? " PDF ও Word, দুটি ফাইলই নামানো হয়েছে।" : ""}`, { id: toastId });
      if (missingAnswers > 0) {
        toast.info(
          `${toBn(missingAnswers)}টি প্রশ্নের উত্তর পাতায় দেওয়া নেই, তাই PDF-এ উত্তরমালা যোগ করা হয়নি।`,
          { duration: 8000 }
        );
      }
      if (questions.length < total) {
        toast.warning(
          skippedByCap > 0
            ? `${toBn(total)}টির মধ্যে ${toBn(questions.length)}টি পাওয়া গেছে, কারণ ${toBn(total)}টি প্রশ্নে উদ্দীপকভিত্তিক ও বহুপদী প্রশ্ন সর্বোচ্চ ${toBn(CAP)}টি করে রাখা হয় এবং পাতায় সাধারণ প্রশ্ন কম আছে। আরও পাতা যোগ করুন।`
            : failedCalls > 0
            ? `${toBn(total)}টির মধ্যে ${toBn(questions.length)}টি পাওয়া গেছে — কিছু অংশ প্রক্রিয়া করা যায়নি। চাইলে আবার চেষ্টা করুন।`
            : extractMode
              ? `আপনি ${toBn(total)}টি চেয়েছিলেন, কিন্তু পাতাগুলোতে মাত্র ${toBn(questions.length)}টি ব্যবহারযোগ্য ছাপা প্রশ্ন পাওয়া গেছে। আরও পাতা যোগ করুন বা ছবি আরও পরিষ্কার করুন।`
              : `${toBn(total)}টির মধ্যে ${toBn(questions.length)}টি প্রশ্ন পাওয়া গেছে। ছবির লেখা কম, আরও পাতা যোগ করে দেখতে পারেন।`
        );
      }
    } catch (err: any) {
      toast.error(err.message || "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।", { id: toastId });
    } finally {
      setLoading(false);
      setStep("");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10 sm:py-16">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-indigo-400 text-white shadow-lg shadow-primary/30">
          <FileText className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">eMCQ Maker</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          বইয়ের পাতার ছবি দিন, কয়েক সেকেন্ডেই পেয়ে যান প্রিন্টের উপযোগী ২-কলামের MCQ প্রশ্নপত্র ও উত্তরমালা।
        </p>
        <a
          href="/eMCQ-Maker-User-Guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <BookOpen className="h-4 w-4" />
          ব্যবহার নির্দেশিকা পড়ুন (PDF)
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>নতুন প্রশ্নপত্র</CardTitle>
          <CardDescription>ছবি দিন, পরীক্ষার তথ্য লিখুন — বাকি কাজ AI করবে।</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-7">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">১ · বইয়ের পাতা</h3>
              <UploadZone images={images} onChange={setImages} disabled={loading} />
              <div className="space-y-2" role="radiogroup" aria-label="প্রশ্নের উৎস">
                <p className="text-xs font-medium text-muted-foreground">এই পাতাগুলো থেকে কী করবেন?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["extract", "পাতায় ছাপা প্রশ্ন থেকে বাছাই", "নতুন প্রশ্ন বানানো হবে না। সাধারণ, বহুপদী ও উদ্দীপকের প্রশ্ন যেমন আছে তেমনই নেওয়া হবে।"],
                      ["generate", "পাঠ থেকে নতুন প্রশ্ন বানানো", "পাতায় শুধু পাঠ থাকলে AI নিজে নতুন প্রশ্ন বানাবে।"],
                    ] as const
                  ).map(([val, title, desc]) => (
                    <button
                      key={val}
                      type="button"
                      role="radio"
                      aria-checked={form.source === val}
                      disabled={loading}
                      onClick={() => setForm((f) => ({ ...f, source: val }))}
                      className={
                        "rounded-lg border p-3 text-left text-sm transition-all disabled:opacity-60 " +
                        (form.source === val
                          ? "border-primary bg-primary/5 ring-4 ring-primary/10"
                          : "border-input hover:border-primary/40")
                      }
                    >
                      <span className="block font-semibold">{title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">২ · পরীক্ষার তথ্য</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="examName" label="পরীক্ষার নাম" icon={PenLine} className="sm:col-span-2">
                  <Input id="examName" required placeholder="যেমন: অর্ধবার্ষিক পরীক্ষা ২০২৬" value={form.examName} onChange={set("examName")} disabled={loading} />
                </Field>
                <Field id="className" label="শ্রেণি" icon={GraduationCap}>
                  <Input id="className" required placeholder="যেমন: দশম" value={form.className} onChange={set("className")} disabled={loading} />
                </Field>
                <Field id="subject" label="বিষয়" icon={BookOpen}>
                  <Input id="subject" required placeholder="যেমন: পদার্থবিজ্ঞান" value={form.subject} onChange={set("subject")} disabled={loading} />
                </Field>
                <Field id="totalTime" label="মোট সময় (মিনিট)" icon={Clock}>
                  <Input id="totalTime" required type="number" min={1} placeholder="যেমন: ৩০" value={form.totalTime} onChange={set("totalTime")} disabled={loading} />
                </Field>
                <Field id="totalMarks" label="পূর্ণমান" icon={Award}>
                  <Input id="totalMarks" required type="number" min={1} placeholder="যেমন: ২০" value={form.totalMarks} onChange={set("totalMarks")} disabled={loading} />
                </Field>
                <Field id="numQuestions" label="কতটি প্রশ্ন চাই" icon={Hash} className="sm:col-span-2">
                  <Input id="numQuestions" required type="number" min={1} max={100} placeholder="যেমন: ২০ বা ৩০" value={form.numQuestions} onChange={set("numQuestions")} disabled={loading} />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-primary" />
                ৩ · AI-কে যেকোনো নির্দেশ
                <span className="font-normal text-muted-foreground">(ঐচ্ছিক)</span>
              </h3>
              <Textarea
                id="extraInstructions"
                maxLength={800}
                placeholder="যেমন: প্রশ্ন একটু কঠিন করুন · উদ্দীপকভিত্তিক প্রশ্ন বেশি দিন · বহুপদী সমাপ্তি ছাড়া সব সাধারণ প্রশ্ন · ফন্ট ১০ করুন · প্রশ্ন বোল্ড না করে সাধারণ লেখা · এক কলামে সাজান · লাইনের ফাঁক বেশি রাখুন · উত্তরমালা লাগবে না"
                value={form.extraInstructions ?? ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setForm((f) => ({ ...f, extraInstructions: e.target.value }))
                }
                disabled={loading}
              />
              <p className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>প্রশ্নের ধরন, কাঠিন্য, ফন্ট ও সাজসজ্জা, সবই লেখা যাবে। খালি রাখলে স্বাভাবিক নিয়মে হবে।</span>
                <span className="shrink-0">{toBn((form.extraInstructions ?? "").length)}/৮০০</span>
              </p>
            </section>

            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {step || "কাজ চলছে…"}
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" />
                  প্রশ্নপত্র তৈরি করুন
                </>
              )}
            </Button>

            {loading && (
              <div className="space-y-2" aria-hidden>
                <div className="h-2 w-full animate-pulse rounded-full bg-secondary" />
                <div className="h-2 w-4/5 animate-pulse rounded-full bg-secondary" />
                <div className="h-2 w-3/5 animate-pulse rounded-full bg-secondary" />
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-primary" />
              আগের প্রশ্নপত্র
            </CardTitle>
            <CardDescription>
              এই ব্রাউজারে সংরক্ষিত আছে। যেকোনোটা আবার PDF করে নামাতে পারবেন, এতে AI-এর কোটা খরচ হয় না।
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{h.exam.examName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        h.exam.className && `শ্রেণি ${h.exam.className}`,
                        h.exam.subject,
                        `${toBn(h.questions.length)}টি প্রশ্ন`,
                        formatDate(h.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3"
                      disabled={downloadingId === h.id || loading}
                      onClick={() => redownload(h)}
                    >
                      {downloadingId === h.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      PDF
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="মুছে ফেলুন"
                      onClick={() => removeItem(h.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        পরীক্ষায় ব্যবহারের আগে AI-এর তৈরি প্রশ্নগুলো অবশ্যই যাচাই করে নিন।
      </p>

      <footer className="mt-5 border-t border-border/70 pt-4 text-center text-xs text-muted-foreground">
        <p className="font-semibold text-foreground/80">Build by Jihad Junaed</p>
        <p className="mt-0.5">
          Email:{" "}
          <a href="mailto:jihadjunaed1234@gmail.com" className="text-primary hover:underline">
            jihadjunaed1234@gmail.com
          </a>
        </p>
      </footer>
    </main>
  );
}

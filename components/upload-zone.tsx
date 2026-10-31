"use client";

import * as React from "react";
import { ImagePlus, X, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { cn, toBn, uid } from "@/lib/utils";
import type { UploadedImage } from "@/lib/types";
import { pdfToImages } from "@/lib/pdf-to-images";

export const MAX_FILES = 10;
// Netlify functions accept ~6 MB request bodies, so keep images compact.
const MAX_DIM = 1400;
const JPEG_QUALITY = 0.72;
const MAX_TOTAL_BASE64 = 4_500_000; // ~4.5 MB of base64 across all pages

/** Downscale + re-encode as JPEG to keep request payloads small. */
async function compress(file: File): Promise<{ base64: string; previewUrl: string }> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { base64: dataUrl.split(",")[1], previewUrl: url };
}

interface Props {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  disabled?: boolean;
}

export function UploadZone({ images, onChange, disabled }: Props) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = async (fileList: FileList | File[]) => {
    const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/") || isPdf(f));
    if (files.length === 0) {
      toast.error("অনুগ্রহ করে ছবি (JPG, PNG, WEBP) অথবা PDF ফাইল বেছে নিন।");
      return;
    }
    let room = MAX_FILES - images.length;
    if (room <= 0) {
      toast.warning(`সর্বোচ্চ ${toBn(MAX_FILES)}টি পাতা দেওয়া যাবে।`);
      return;
    }
    const next: UploadedImage[] = [];
    let used = images.reduce((n, i) => n + i.base64.length, 0);
    let overflow = false;
    let tooBig = false;
    for (const f of files) {
      if (room <= 0) {
        overflow = true;
        break;
      }
      if (isPdf(f)) {
        try {
          const t = toast.loading(`PDF পড়া হচ্ছে: ${f.name}`);
          const { totalPages, pages } = await pdfToImages(f, room, { maxDim: MAX_DIM, quality: JPEG_QUALITY });
          toast.dismiss(t);
          if (totalPages > pages.length) overflow = true;
          for (const p of pages) {
            if (used + p.base64.length > MAX_TOTAL_BASE64) {
              tooBig = true;
              break;
            }
            used += p.base64.length;
            room -= 1;
            next.push({
              id: uid(),
              name: `${f.name} (পাতা ${toBn(p.pageNo)})`,
              previewUrl: p.previewUrl,
              base64: p.base64,
              mimeType: "image/jpeg",
            });
          }
        } catch {
          toast.dismiss();
          toast.error(`PDF পড়া যায়নি: ${f.name}। ইন্টারনেট ঠিক আছে কি না দেখে আবার চেষ্টা করুন, অথবা PDF-এর পাতার ছবি দিন।`);
        }
        if (tooBig) break;
        continue;
      }
      try {
        const { base64, previewUrl } = await compress(f);
        if (used + base64.length > MAX_TOTAL_BASE64) {
          URL.revokeObjectURL(previewUrl);
          tooBig = true;
          break;
        }
        used += base64.length;
        room -= 1;
        next.push({ id: uid(), name: f.name, previewUrl, base64, mimeType: "image/jpeg" });
      } catch {
        toast.error(`ছবিটি পড়া যায়নি: ${f.name}`);
      }
    }
    if (overflow) toast.warning(`সর্বোচ্চ ${toBn(MAX_FILES)}টি পাতা নেওয়া যায় — বাড়তি পাতাগুলো বাদ দেওয়া হয়েছে।`);
    if (tooBig) toast.error("পাতাগুলোর মোট সাইজ সীমা ছাড়িয়ে গেছে। কিছু পাতা মুছে ফেলুন অথবা কম পাতা দিন।");
    if (next.length) onChange([...images, ...next]);
  };

  const remove = (id: string) => {
    const target = images.find((i) => i.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(images.filter((i) => i.id !== id));
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-200",
          dragging
            ? "scale-[1.01] border-primary bg-accent"
            : "border-input bg-secondary/40 hover:border-primary/50 hover:bg-accent/60",
          disabled && "pointer-events-none opacity-60"
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform duration-200 group-hover:-translate-y-0.5">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold">
          বইয়ের পাতার ছবি বা PDF এখানে ড্র্যাগ করে ছাড়ুন, অথবা <span className="text-primary">ফাইল বেছে নিন</span>
        </p>
        <p className="text-xs text-muted-foreground">
          ছবি (JPG, PNG, WEBP) বা PDF · সর্বোচ্চ {toBn(MAX_FILES)}টি পাতা
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {images.length > 0 && (
        <>
          <p className="text-xs font-medium text-muted-foreground">
            {toBn(images.length)}/{toBn(MAX_FILES)}টি পাতা যোগ করা হয়েছে
          </p>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {images.map((img, idx) => (
              <li
                key={img.id}
                className="group relative aspect-[3/4] animate-in fade-in zoom-in-95 overflow-hidden rounded-lg border border-border bg-muted shadow-sm"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  পাতা {toBn(idx + 1)}
                </span>
                <button
                  type="button"
                  aria-label={`মুছে ফেলুন: ${img.name}`}
                  disabled={disabled}
                  onClick={() => remove(img.id)}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-100 transition hover:bg-destructive sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {images.length < MAX_FILES && (
              <li>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label="আরও পাতা যোগ করুন"
                  onClick={() => inputRef.current?.click()}
                  className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border-2 border-dashed border-input text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                >
                  <ImagePlus className="h-6 w-6" />
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

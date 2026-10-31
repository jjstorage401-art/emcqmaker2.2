import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Convert English digits to Bangla digits. */
export function toBn(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/** crypto.randomUUID শুধু নিরাপদ (https) পাতায় থাকে; না থাকলে নিজে আইডি বানায়। */
export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

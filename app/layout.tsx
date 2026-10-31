import type { Metadata } from "next";
import { Noto_Sans_Bengali } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const bangla = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "eMCQ Maker",
  authors: [{ name: "Jihad Junaed" }],
  description: "বইয়ের পাতার ছবি থেকে AI দিয়ে ২-কলামের MCQ প্রশ্নপত্র ও উত্তরমালা তৈরি করুন।",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
      <body className={`${bangla.className} min-h-screen`}>
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}

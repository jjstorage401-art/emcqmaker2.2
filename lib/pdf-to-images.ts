/**
 * PDF ফাইলের পাতাগুলোকে ছবিতে (JPEG) রূপান্তর করে, যাতে পরের সব ধাপ ছবির মতোই চলে।
 * pdf.js কোডবইয়ে যোগ করা হয়নি; দরকার হলেই CDN থেকে একবার লোড হয়। তাই build-এ কোনো বাড়তি প্যাকেজ লাগে না।
 */

const PDFJS_VERSION = "3.11.174";
const BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let loading: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  const w = window as any;
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${BASE}/pdf.min.js`;
    s.async = true;
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (!lib) {
        loading = null;
        return reject(new Error("pdfjs missing"));
      }
      lib.GlobalWorkerOptions.workerSrc = `${BASE}/pdf.worker.min.js`;
      resolve(lib);
    };
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("pdfjs load failed"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface PdfPageImage {
  base64: string; // JPEG, without the data: prefix
  previewUrl: string; // data URL
  pageNo: number;
}

export interface PdfRead {
  totalPages: number;
  pages: PdfPageImage[];
}

/** PDF-এর প্রথম `maxPages`টি পাতা ছবি বানায়। */
export async function pdfToImages(
  file: File,
  maxPages: number,
  opts: { maxDim?: number; quality?: number } = {}
): Promise<PdfRead> {
  const maxDim = opts.maxDim ?? 1400;
  const quality = opts.quality ?? 0.72;
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await lib.getDocument({ data }).promise;
  const totalPages: number = doc.numPages;
  const pages: PdfPageImage[] = [];
  const count = Math.min(totalPages, Math.max(0, maxPages));
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = maxDim / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    pages.push({ base64: dataUrl.split(",")[1], previewUrl: dataUrl, pageNo: n });
    page.cleanup?.();
  }
  try {
    await doc.destroy?.();
  } catch {
    /* ignore */
  }
  return { totalPages, pages };
}

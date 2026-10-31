export interface ExamParams {
  examName: string;
  className: string;
  subject: string;
  totalTime: string;
  totalMarks: string;
  numQuestions: number;
  /** Optional teacher instructions for the AI (style, difficulty, focus...). */
  extraInstructions?: string;
  /** extract = পাতায় ছাপা প্রশ্ন থেকে বাছাই (নতুন প্রশ্ন নয়); generate = পাঠ থেকে নতুন প্রশ্ন বানানো */
  source?: "extract" | "generate";
  /** প্রতিটি অনুরোধে উদ্দীপক/বহুপদী প্রশ্নের সর্বোচ্চ সংখ্যা (অ্যাপ নিজে বসায়) */
  limits?: { stim: number; stmt: number };
}

export interface MCQ {
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** বহুপদী সমাপ্তি সূচক: i, ii, iii বিবৃতি (প্রশ্নের পরে দেখানো হয়) */
  statements?: string[];
  /** উদ্দীপক: একই উদ্দীপকের সব প্রশ্নে একই লেখা থাকে */
  stimulus?: string;
  /** পাতায় এই প্রশ্নের পাশে উত্তর ছাপা ছিল কি না (শুধু "ছাপা প্রশ্ন থেকে বাছাই" মোডে; false হলে উত্তরমালায় দেখানো হয় না) */
  answerOnPage?: boolean;
}

/** AI বক্সের নির্দেশ থেকে পাওয়া PDF-এর সাজসজ্জা (সবই ঐচ্ছিক) */
export interface PdfLayout {
  fontSize?: number; // pt, ৭–১৪
  questionBold?: boolean;
  lineSpacing?: number; // ১.২–২.০
  columns?: 1 | 2;
  options?: "auto" | "grid" | "list" | "inline";
  optionLabels?: "bangla" | "english" | "number";
  answerKey?: boolean;
}

export interface UploadedImage {
  id: string;
  name: string;
  previewUrl: string;
  /** base64 payload without the data: prefix */
  base64: string;
  mimeType: string;
}

import type { ExamParams, MCQ, PdfLayout } from "./types";
import type { PaperPlan, PieceInfo } from "./pdf";
import { toBn } from "./utils";
import { toUnits } from "./arrange";

/**
 * প্রশ্নপত্রের Word (.docx) ফাইল। বাড়তি কোনো প্যাকেজ ছাড়াই বানানো হয় (নিজস্ব ছোট ZIP লেখক),
 * যাতে শিক্ষক বানান ভুল থাকলে Word-এ খুলে নিজে ঠিক করে নিতে পারেন।
 */

const LABEL_SETS: Record<string, string[]> = {
  bangla: ["ক", "খ", "গ", "ঘ"],
  english: ["a", "b", "c", "d"],
  number: ["১", "২", "৩", "৪"],
};
const ROMAN = ["i", "ii", "iii", "iv", "v"];
const FONT = "Nirmala UI"; // Windows/Word-এর বাংলা ফন্ট; অন্য ডিভাইসে নিজে থেকে বিকল্প ফন্ট আসে

/* ---------------- ছোট ZIP লেখক (কম্প্রেশন ছাড়া) ---------------- */

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, f.data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += local.length + name.length + size;
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/* ---------------- Word XML ---------------- */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface RunOpts {
  bold?: boolean;
  size?: number; // half-points
  color?: string;
  colBreak?: boolean;
}
function run(text: string, o: RunOpts = {}): string {
  const rpr =
    (o.bold ? "<w:b/><w:bCs/>" : "") +
    (o.color ? `<w:color w:val="${o.color}"/>` : "") +
    (o.size ? `<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>` : "");
  const parts = text.split("\t");
  const body = parts
    .map((t, i) => (i > 0 ? "<w:tab/>" : "") + (t ? `<w:t xml:space="preserve">${esc(t)}</w:t>` : ""))
    .join("");
  return `${o.colBreak ? '<w:r><w:br w:type="column"/></w:r>' : ""}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${body}</w:r>`;
}

interface ParaOpts {
  align?: "center" | "left";
  left?: number; // twips
  hanging?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  before?: number;
  after?: number;
  line?: number; // twips (atLeast)
  tabs?: number[];
  border?: boolean;
  sect?: string;
}
function para(runs: string, o: ParaOpts = {}): string {
  const ppr =
    (o.keepNext ? "<w:keepNext/>" : "") +
    (o.keepLines ? "<w:keepLines/>" : "") +
    (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="111111"/></w:pBdr>' : "") +
    (o.tabs ? `<w:tabs>${o.tabs.map((t) => `<w:tab w:val="left" w:pos="${t}"/>`).join("")}</w:tabs>` : "") +
    `<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 0}"${o.line ? ` w:line="${o.line}" w:lineRule="atLeast"` : ""}/>` +
    (o.left || o.hanging ? `<w:ind w:left="${o.left ?? 0}"${o.hanging ? ` w:hanging="${o.hanging}"` : ""}/>` : "") +
    (o.align === "center" ? '<w:jc w:val="center"/>' : "") +
    (o.sect ?? "");
  return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
}

// PDF-এর মতোই মার্জিন: ৩৮px ≈ ৫৭০ twips; নিচে ফুটারের জায়গা
const PAGE_SZ = '<w:pgSz w:w="11906" w:h="16838"/>';
const MARGINS = '<w:pgMar w:top="570" w:right="570" w:bottom="800" w:left="570" w:header="300" w:footer="300" w:gutter="0"/>';
const COL_GAP = 180; // 12px
const sect = (cols: 1 | 2, type: "continuous" | "nextPage", footerId?: string) =>
  `<w:sectPr>${footerId ? `<w:footerReference w:type="default" r:id="${footerId}"/>` : ""}<w:type w:val="${type}"/>${PAGE_SZ}${MARGINS}<w:cols w:num="${cols}" w:space="${COL_GAP}"${cols === 2 ? ' w:sep="1"' : ""}/></w:sectPr>`;

const px = (n: number) => Math.round(n * 15); // px → twips (1px = 15 twips)

function legacyPlan(questions: MCQ[], layout?: PdfLayout): PaperPlan {
  // PDF-এর হিসাব না থাকলে (সাধারণত লাগে না) সরল একটি পরিকল্পনা: সব প্রশ্ন এক ধারায়
  const units = toUnits(questions);
  const pieces: PieceInfo[] = [];
  let no = 0;
  for (const u of units) {
    const n = u.questions.length;
    const a = no + 1;
    const range = n === 1 ? toBn(a) : n === 2 ? `${toBn(a)} ও ${toBn(a + 1)}` : `${toBn(a)} – ${toBn(a + n - 1)}`;
    u.questions.forEach((q, k) => pieces.push({ no: ++no, q, ...(k === 0 && u.stimulus ? { stimulus: { range, text: u.stimulus } } : {}) }));
  }
  const half = Math.ceil(pieces.length / 2);
  const cols = layout?.columns === 1 ? 1 : 2;
  return {
    fontPt: typeof layout?.fontSize === "number" ? layout.fontSize : 8,
    lineSpacing: layout?.lineSpacing ?? 1.4,
    gapEm: 0.6,
    columns: cols,
    labels: LABEL_SETS[layout?.optionLabels ?? "bangla"] ?? LABEL_SETS.bangla,
    optionsMode: layout?.options ?? "auto",
    questionBold: layout?.questionBold !== false,
    answerKey: layout?.answerKey !== false,
    pages: [cols === 1 ? [pieces] : [pieces.slice(0, half), pieces.slice(half)]],
  };
}

export function buildDocx(exam: ExamParams, questions: MCQ[], layout?: PdfLayout, planIn?: PaperPlan): Uint8Array {
  const plan = planIn ?? legacyPlan(questions, layout);
  const pt = plan.fontPt;
  const sz = Math.max(10, Math.floor(pt * 2)); // অর্ধ-পয়েন্টে, ছোট দিকে (Word-এ উপচে না পড়ার জন্য)
  const lineTw = Math.round(plan.lineSpacing * pt * 20);
  const gapTw = Math.round(plan.gapEm * pt * 20);
  const labels = plan.labels;
  const qBold = plan.questionBold;
  const cols = plan.columns;
  const ptw = pt * 20; // ১ em = pt*20 twips
  const qIndent = Math.round(2.05 * ptw);
  const numW = Math.round(1.75 * ptw);

  const body: string[] = [];

  // শিরোনাম (PDF-এর মতো: নাম ২২px, তথ্য ১৩px, নির্দেশ ১১px)
  body.push(para(run(exam.examName || "পরীক্ষা", { bold: true, size: 33 }), { align: "center", after: 30 }));
  const meta = [
    exam.className && `শ্রেণি: ${exam.className}`,
    exam.subject && `বিষয়: ${exam.subject}`,
    exam.totalTime && `সময়: ${toBn(exam.totalTime)} মিনিট`,
    exam.totalMarks && `পূর্ণমান: ${toBn(exam.totalMarks)}`,
  ]
    .filter(Boolean)
    .join("   |   ");
  body.push(para(run(meta, { size: 20 }), { align: "center", after: 20 }));
  body.push(
    para(run("সঠিক উত্তরটি বেছে নাও। প্রতিটি প্রশ্নের মান সমান।", { size: 17, color: "444444" }), {
      align: "center",
      after: 160,
      border: true,
      sect: sect(1, "nextPage", "rId2"),
    })
  );

  const pieceParas = (pc: PieceInfo, colBreak: boolean): string[] => {
    const out: string[] = [];
    let first = true;
    const cb = () => {
      const v = colBreak && first;
      first = false;
      return v;
    };
    const q = pc.q;
    if (pc.stimulus) {
      out.push(para(run(`উদ্দীপকটি পড়ে ${pc.stimulus.range} নং প্রশ্নের উত্তর দাও:`, { bold: true, size: sz, colBreak: cb() }), { keepNext: true, line: lineTw }));
      out.push(para(run(pc.stimulus.text, { size: sz }), { keepNext: true, keepLines: true, line: lineTw, after: Math.round(0.35 * ptw) }));
    }
    out.push(
      para(run(`${toBn(pc.no)}।\t${q.question}`, { bold: qBold, size: sz, colBreak: cb() }), {
        left: numW + Math.round(0.3 * ptw), hanging: numW + Math.round(0.3 * ptw), tabs: [numW + Math.round(0.3 * ptw)],
        keepNext: true, keepLines: true, line: lineTw,
      })
    );
    if (q.statements?.length) {
      q.statements.forEach((t, i) =>
        out.push(
          para(run(`${ROMAN[i] ?? i + 1}.\t${t}`, { size: sz }), {
            left: qIndent + Math.round(1.6 * ptw), hanging: Math.round(1.6 * ptw), tabs: [qIndent + Math.round(1.6 * ptw)],
            keepNext: true, keepLines: true, line: lineTw,
          })
        )
      );
      out.push(para(run("নিচের কোনটি সঠিক?", { bold: qBold, size: sz }), { left: qIndent, keepNext: true, line: lineTw }));
    }
    const opts = q.options.map((o, i) => `(${labels[i]}) ${o}`);
    const maxLen = Math.max(...q.options.map((o) => o.length));
    const mode = plan.optionsMode === "auto" ? (maxLen <= 9 ? "inline" : maxLen <= 18 ? "grid" : "list") : plan.optionsMode;
    const colW = cols === 1 ? 11906 - 1140 : Math.floor((11906 - 1140 - COL_GAP) / 2);
    const avail = colW - qIndent;
    const base = { left: qIndent, keepLines: true, line: lineTw };
    if (mode === "inline") {
      const step = Math.floor(avail / 4);
      out.push(para(run(opts.join("\t"), { size: sz }), { ...base, tabs: [qIndent + step, qIndent + 2 * step, qIndent + 3 * step], after: gapTw }));
    } else if (mode === "grid") {
      const half = qIndent + Math.floor(avail / 2);
      out.push(para(run(`${opts[0]}\t${opts[1]}`, { size: sz }), { ...base, tabs: [half], keepNext: true }));
      out.push(para(run(`${opts[2]}\t${opts[3]}`, { size: sz }), { ...base, tabs: [half], after: gapTw }));
    } else {
      opts.forEach((o, i) => out.push(para(run(o, { size: sz }), { ...base, keepNext: i < 3, after: i === 3 ? gapTw : 0 })));
    }
    return out;
  };

  // পাতা ধরে ধরে: প্রতিটি PDF পাতা = একটি অংশ; কলাম-ভাগও PDF-এর মতো
  plan.pages.forEach((colsData, pi) => {
    const flat: string[] = [];
    colsData.forEach((pieces, ci) => {
      pieces.forEach((pc, k) => flat.push(...pieceParas(pc, ci === 1 && k === 0)));
    });
    // ২য় কলাম খালি হলে কলাম-ব্রেক লাগে না (ওপরের কোডে k===0 শর্ত শুধু ২য় কলামে আছে)
    body.push(...flat);
    // এই পাতার অংশ শেষ: পরের পাতা আলাদা অংশ (nextPage); প্রথম পাতা শিরোনামের নিচে চলতে থাকে (continuous)
    const type: "continuous" | "nextPage" = pi === 0 ? "continuous" : "nextPage";
    body.push(para("", { sect: sect(cols, type), line: 20 }));
  });

  // উত্তরমালা (আলাদা পাতায়, এক কলামে)
  const showKey = plan.answerKey;
  let finalSect = sect(cols, "nextPage");
  if (showKey) {
    body.push(para(run("উত্তরমালা", { bold: true, size: 36 }), { align: "center", before: 120, after: 60 }));
    const sub = [exam.examName, exam.className && `শ্রেণি: ${exam.className}`, exam.subject && `বিষয়: ${exam.subject}`].filter(Boolean).join("  |  ");
    body.push(para(run(sub, { size: 20, color: "333333" }), { align: "center", after: 320 }));
    const per = 5;
    const tableW = 11906 - 1140;
    const cw = Math.floor(tableW / per);
    const bd = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`;
    const rows: string[] = [];
    for (let i = 0; i < questions.length; i += per) {
      const cells = Array.from({ length: per }, (_, j) => {
        const q = questions[i + j];
        const txt = q ? `${toBn(i + j + 1)}।  ${labels[q.correctIndex]}` : "";
        return (
          `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>` +
          (q ? `<w:tcBorders>${bd("top")}${bd("left")}${bd("bottom")}${bd("right")}</w:tcBorders>` : "") +
          '<w:vAlign w:val="center"/></w:tcPr>' +
          para(txt ? run(txt, { bold: true, size: 24 }) : "", { align: "center", before: 100, after: 100 }) +
          "</w:tc>"
        );
      });
      rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join("")}</w:tr>`);
    }
    body.push(
      `<w:tbl><w:tblPr><w:tblW w:w="${cw * per}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
        `<w:tblGrid>${Array.from({ length: per }, () => `<w:gridCol w:w="${cw}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`
    );
    body.push(para("", {}));
    finalSect = sect(1, "nextPage", "rId3");
  }

  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>` + body.join("") + finalSect + "</w:body></w:document>";

  const fRun = (t: string) => `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const footer = (label: string, withPage: boolean) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    fRun(label) +
    (withPage
      ? `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
        `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
        `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
        `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:t>1</w:t></w:r>` +
        `<w:r><w:rPr><w:color w:val="777777"/><w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`
      : "") +
    "</w:p></w:ftr>";
  const title = exam.examName || "প্রশ্নপত্র";

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}" w:eastAsia="${FONT}"/>` +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="bn-BD" w:eastAsia="bn-BD" w:bidi="bn-BD"/>` +
    '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';

  const enc = new TextEncoder();
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip([
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
          '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
    },
    {
      name: "word/_rels/document.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/footer" Target="footer1.xml"/>` +
          `<Relationship Id="rId3" Type="${REL}/footer" Target="footer2.xml"/></Relationships>`
      ),
    },
    { name: "word/document.xml", data: enc.encode(document) },
    { name: "word/styles.xml", data: enc.encode(styles) },
    { name: "word/footer1.xml", data: enc.encode(footer(`${title}  •  পৃষ্ঠা `, true)) },
    { name: "word/footer2.xml", data: enc.encode(footer(`${title}  •  উত্তরমালা`, false)) },
  ]);
}

/** Word ফাইল বানিয়ে ডাউনলোড করায়। */
export function downloadQuestionPaperDocx(exam: ExamParams, questions: MCQ[], layout?: PdfLayout, plan?: PaperPlan): void {
  const bytes = buildDocx(exam, questions, layout, plan);
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  // বাংলা নামের ফাইল কিছু ব্রাউজারে ".docx" ছাড়া সেভ হতে পারে; তাই ইংরেজি নাম ব্যবহার করা হয় (Word-এ খুলতে নামের ঝামেলা না হয়)
  const raw = (exam.examName || "").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const safe = raw && /^[\x20-\x7e]+$/.test(raw) ? raw : "MCQ-Question-Paper";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe}.docx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

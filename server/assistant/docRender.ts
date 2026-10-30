/**
 * Real document rendering for DOCX / PPTX / XLSX using maintained libraries,
 * plus read-back validation. Markdown in -> proper Word headings, bold, lists,
 * tables; real slides; real spreadsheet cells. No literal "#" or "**" symbols.
 */
import JSZipMod from "jszip";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
} from "docx";
import PptxGenMod from "pptxgenjs";
import ExcelMod from "exceljs";

// CJS/ESM interop: under Node ESM the default import can be the module namespace.
const unwrap = (m: any) => (m && m.default && (typeof m.default === "function" || typeof m.default === "object") ? m.default : m);
const JSZip: any = unwrap(JSZipMod);
const PptxGenJS: any = unwrap(PptxGenMod);
const ExcelJS: any = unwrap(ExcelMod);

export type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; text: string }
  | { t: "ol"; text: string; n: string }
  | { t: "code"; text: string }
  | { t: "table"; rows: string[][] };

/** Make model text safe and readable for office documents: no emoji, no odd Unicode dashes/quotes. */
export function cleanDocText(input: string): string {
  return String(input || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u2009\u200A\u202F\u2002\u2003]/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF\uFE0E\uFE0F]/g, "")
    .replace(/[\u2018\u2019\u0060]{3}/g, "```")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]+\n/g, "\n");
}
/** [text](url) -> text (url) so links stay readable in documents. */
const flattenLinks = (t: string) => t.replace(/!?\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, a, u) => (a.trim() === u ? u : `${a} (${u})`));

export function parseMarkdown(md: string): Block[] {
  const lines = cleanDocText(md).split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: "p", text: para.join(" ").trim() }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      out.push({ t: "code", text: buf.join("\n") });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); continue; } // horizontal rule
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push({ t: "h", level: h[1].length, text: flattenLinks(h[2].replace(/\s+#+\s*$/, "").trim()) }); continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) out.push({ t: "table", rows });
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ul) { flush(); out.push({ t: "ul", text: flattenLinks(ul[1].trim()) }); continue; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) { flush(); out.push({ t: "ol", n: ol[1], text: flattenLinks(ol[2].trim()) }); continue; }
    para.push(flattenLinks(line.trim().replace(/^>\s?/, "")));
  }
  flush();
  return out;
}

/** Split inline **bold** / *italic* / `code` into runs. */
function inlineRuns(text: string): { text: string; bold?: boolean; italics?: boolean; code?: boolean }[] {
  const runs: { text: string; bold?: boolean; italics?: boolean; code?: boolean }[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**") || tok.startsWith("__")) runs.push({ text: tok.slice(2, -2), bold: true });
    else if (tok.startsWith("`")) runs.push({ text: tok.slice(1, -1), code: true });
    else runs.push({ text: tok.slice(1, -1), italics: true });
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}
export const stripInline = (s: string) => inlineRuns(s).map((r) => r.text).join("");

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

export async function renderDocx(title: string, markdown: string): Promise<Buffer> {
  const blocks = parseMarkdown(markdown);
  const kids: (Paragraph | Table)[] = [];
  // Skip a leading H1 that just repeats the title
  const first = blocks[0];
  const skipFirst = first && first.t === "h" && first.level === 1 && stripInline(first.text).toLowerCase() === title.trim().toLowerCase();
  kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })], spacing: { after: 240 } }));
  blocks.forEach((b, idx) => {
    if (idx === 0 && skipFirst) return;
    const toRuns = (t: string) => inlineRuns(t).map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italics, font: r.code ? "Courier New" : undefined }));
    switch (b.t) {
      case "h": kids.push(new Paragraph({ heading: HEADINGS[b.level] || HeadingLevel.HEADING_3, children: toRuns(b.text), spacing: { before: 240, after: 120 } })); break;
      case "p": kids.push(new Paragraph({ children: toRuns(b.text), spacing: { after: 120 } })); break;
      case "ul": kids.push(new Paragraph({ children: toRuns(b.text), bullet: { level: 0 } })); break;
      case "ol": kids.push(new Paragraph({ children: [new TextRun({ text: `${b.n}. ` }), ...toRuns(b.text)], indent: { left: 360 } })); break;
      case "code": b.text.split("\n").forEach((l) => kids.push(new Paragraph({ children: [new TextRun({ text: l || " ", font: "Courier New", size: 20 })] }))); break;
      case "table": {
        const cols = Math.max(...b.rows.map((r) => r.length));
        kids.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map((r, ri) => new TableRow({
            children: Array.from({ length: cols }, (_, ci) => new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: stripInline(r[ci] || ""), bold: ri === 0 })] })],
            })),
          })),
        }));
        kids.push(new Paragraph({ text: "" }));
        break;
      }
    }
  });
  const doc = new Document({
    creator: "LENORY AI", title,
    styles: { default: { document: { run: { font: "Calibri", size: 24 } } } },
    sections: [{ children: kids }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function renderPptx(title: string, markdown: string, opts: { images?: Buffer[] } = {}): Promise<Buffer> {
  const blocks = parseMarkdown(markdown);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = "LENORY AI";
  pptx.title = title;
  const NAVY = "1F3A5F", ACCENT = "F2A900", INK = "1E2933", MUTED = "5B6B7B", SOFT = "EEF3F9";
  const FONT = "Calibri";
  const imgs = (opts.images || []).map((b) => `data:image/png;base64,${b.toString("base64")}`);
  let imgIdx = 0;
  let slideNo = 0;

  // ── Title slide
  const t = pptx.addSlide();
  t.background = { color: NAVY };
  t.addShape(pptx.ShapeType.rect, { x: 0.7, y: 2.55, w: 0.12, h: 1.9, fill: { color: ACCENT }, line: { color: ACCENT } });
  const titleW = imgs.length ? 6.4 : 11.5;
  t.addText(title, { x: 1.0, y: 2.3, w: titleW, h: 1.9, fontSize: title.length > 40 ? 34 : 44, bold: true, color: "FFFFFF", fontFace: FONT, valign: "middle", fit: "shrink" });
  t.addText("Created with LENORY AI", { x: 1.0, y: 4.3, w: titleW, h: 0.5, fontSize: 16, color: "C9D6EA", fontFace: FONT });
  if (imgs.length) { t.addImage({ data: imgs[imgIdx++], x: 7.7, y: 1.0, w: 5.0, h: 5.5, sizing: { type: "cover", w: 5.0, h: 5.5 } }); }

  // ── Group blocks into sections
  type Sec = { heading: string; items: { kind: "bullet" | "code" | "table"; text?: string; rows?: string[][] }[] };
  const sections: Sec[] = [];
  let cur: Sec | null = null;
  const first = blocks[0];
  blocks.forEach((b, i) => {
    if (i === 0 && b.t === "h" && b.level === 1 && stripInline(b.text).toLowerCase() === title.trim().toLowerCase()) return;
    if (b.t === "h" && b.level <= 2) { cur = { heading: stripInline(b.text), items: [] }; sections.push(cur); return; }
    if (!cur) { cur = { heading: "Overview", items: [] }; sections.push(cur); }
    if (b.t === "h") cur.items.push({ kind: "bullet", text: stripInline(b.text) });
    else if (b.t === "p") {
      const txt = stripInline(b.text);
      const sentences = txt.length > 220 ? txt.split(/(?<=[.!?])\s+/).filter(Boolean) : [txt];
      sentences.forEach((x) => cur!.items.push({ kind: "bullet", text: x }));
    } else if (b.t === "ul") cur.items.push({ kind: "bullet", text: stripInline(b.text) });
    else if (b.t === "ol") cur.items.push({ kind: "bullet", text: `${b.n}. ${stripInline(b.text)}` });
    else if (b.t === "code") cur.items.push({ kind: "code", text: b.text.split("\n").slice(0, 14).join("\n") });
    else if (b.t === "table") cur.items.push({ kind: "table", rows: b.rows.map((r) => r.map(stripInline)) });
  });
  void first;

  const frame = (slide: any, heading: string, label: string) => {
    slideNo++;
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: NAVY }, line: { color: NAVY } });
    slide.addText(label.toUpperCase(), { x: 0.6, y: 0.4, w: 9, h: 0.3, fontSize: 11, bold: true, color: ACCENT, fontFace: FONT, charSpacing: 3 });
    slide.addText(heading, { x: 0.6, y: 0.7, w: 12.1, h: 0.9, fontSize: heading.length > 45 ? 26 : 32, bold: true, color: NAVY, fontFace: FONT, fit: "shrink", valign: "middle" });
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.65, w: 1.1, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } });
    slide.addText(`LENORY AI   |   ${slideNo}`, { x: 9.8, y: 7.0, w: 3.0, h: 0.3, fontSize: 10, color: MUTED, align: "right", fontFace: FONT });
  };

  sections.forEach((sec, si) => {
    const label = `Section ${si + 1}`;
    const bullets = sec.items.filter((x) => x.kind === "bullet").map((x) => x.text!);
    const codes = sec.items.filter((x) => x.kind === "code");
    const tables = sec.items.filter((x) => x.kind === "table");
    const img = imgs[imgIdx] && bullets.length ? imgs[imgIdx++] : null;
    // bullet slides, ~620 chars per slide
    const chunks: string[][] = []; let curC: string[] = []; let len = 0;
    for (const b of bullets) {
      if (curC.length && (len + b.length > 620 || curC.length >= 6)) { chunks.push(curC); curC = []; len = 0; }
      curC.push(b); len += b.length;
    }
    if (curC.length) chunks.push(curC);
    chunks.forEach((chunk, ci) => {
      const slide = pptx.addSlide();
      frame(slide, ci === 0 ? sec.heading : `${sec.heading} (continued)`, label);
      const w = img && ci === 0 ? 7.4 : 12.1;
      slide.addText(chunk.map((x) => ({ text: x, options: { ...(/^\d+\.\s/.test(x) ? {} : { bullet: { code: "25CF", indent: 22 } }), breakLine: true, paraSpaceAfter: 12 } })), { x: 0.6, y: 2.0, w, h: 4.7, fontSize: chunk.join("").length > 420 ? 18 : 22, color: INK, fontFace: FONT, valign: "top", fit: "shrink" });
      if (img && ci === 0) slide.addImage({ data: `data:image/png;base64,${img.toString("base64")}`, x: 8.4, y: 2.0, w: 4.3, h: 4.6, sizing: { type: "cover", w: 4.3, h: 4.6 } });
    });
    if (!chunks.length && !tables.length && !codes.length) { const slide = pptx.addSlide(); frame(slide, sec.heading, label); }
    codes.forEach((c) => {
      const slide = pptx.addSlide();
      frame(slide, `${sec.heading} - example`, label);
      slide.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 2.0, w: 12.1, h: 4.6, fill: { color: SOFT }, line: { color: "D5DEE9" }, rectRadius: 0.1 });
      slide.addText(c.text || "", { x: 0.9, y: 2.15, w: 11.5, h: 4.3, fontSize: 16, fontFace: "Courier New", color: INK, valign: "top", fit: "shrink" });
    });
    tables.forEach((tb) => {
      const slide = pptx.addSlide();
      frame(slide, sec.heading, label);
      const rows = tb.rows!;
      slide.addTable(rows.map((r, ri) => r.map((c) => ({ text: c, options: ri === 0 ? { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 16 } : { color: INK, fontSize: 15, fill: { color: rows.indexOf(r) % 2 ? "FFFFFF" : SOFT } } }))), { x: 0.6, y: 2.0, w: 12.1, fontFace: FONT, border: { type: "solid", color: "C9D6EA", pt: 0.75 }, valign: "middle", margin: 0.08 });
    });
  });
  const out = await pptx.write({ outputType: "nodebuffer" } as any);
  return Buffer.from(out as any);
}

export async function renderXlsx(title: string, content: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LENORY AI";
  const blocks = parseMarkdown(content);
  const tables = blocks.filter((b): b is Extract<Block, { t: "table" }> => b.t === "table");
  const addSheet = (name: string, rows: string[][]) => {
    const ws = wb.addWorksheet(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet");
    rows.forEach((r) => ws.addRow(r.map((c) => { const n = Number(String(c).replace(/,/g, "")); return c !== "" && !isNaN(n) && /^-?[\d,]*\.?\d+$/.test(String(c).trim()) ? n : stripInline(String(c)); })));
    if (ws.rowCount) { ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } }; }
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => { max = Math.max(max, Math.min(60, String(cell.value ?? "").length + 2)); });
      col.width = max;
    });
  };
  if (tables.length) {
    tables.forEach((t, i) => addSheet(tables.length === 1 ? title : `${title} ${i + 1}`, t.rows));
  } else if (/,/.test(content) && content.split("\n").filter((l) => l.includes(",")).length >= 2) {
    const rows = content.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
    addSheet(title, rows);
  } else {
    addSheet(title, [["Content"], ...content.split(/\r?\n/).filter((l) => l.trim()).map((l) => [stripInline(l.replace(/^#+\s*/, ""))])]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Read the generated file back and confirm it truly contains the content. */
export async function validateGenerated(format: string, buffer: Buffer, sourceContent: string): Promise<{ ok: boolean; reason?: string }> {
  if (!buffer || buffer.length < 200 && !["txt", "md", "csv", "json", "html", "svg", "xml", "yaml", "yml", "css", "js", "ts", "py", "sql"].includes(format)) {
    return { ok: false, reason: "file is empty or too small" };
  }
  const words = stripInline(sourceContent).replace(/[#*|`_>-]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]{5,}$/.test(w));
  const loose = stripInline(sourceContent).replace(/[#*|`_>-]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z0-9]{3,}$/.test(w));
  const probes = Array.from(new Set(format === "xlsx" ? loose : words)).slice(0, format === "xlsx" ? 200 : 8);
  try {
    if (format === "pdf") {
      if (buffer.subarray(0, 5).toString() !== "%PDF-") return { ok: false, reason: "not a valid PDF header" };
      if (!buffer.toString("latin1").includes("%%EOF")) return { ok: false, reason: "PDF is truncated" };
      const raw = buffer.toString("latin1");
      if (probes.length && !probes.some((p) => raw.includes(p))) return { ok: false, reason: "PDF does not contain the document text" };
      return { ok: true };
    }
    if (["docx", "pptx", "xlsx"].includes(format)) {
      const zip = await JSZip.loadAsync(buffer);
      let text = "";
      for (const name of Object.keys(zip.files)) {
        if (/\.xml$/.test(name) && /(word\/document|ppt\/slides\/slide|xl\/sharedStrings|xl\/worksheets\/sheet)/.test(name)) {
          text += await zip.files[name].async("string");
        }
      }
      if (!text) return { ok: false, reason: `${format.toUpperCase()} has no content parts` };
      if (probes.length && !probes.some((p) => text.includes(p))) return { ok: false, reason: `${format.toUpperCase()} does not contain the document text` };
      return { ok: true };
    }
    const asText = buffer.toString("utf8");
    if (!asText.trim()) return { ok: false, reason: "file is empty" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `could not read the file back: ${e?.message}` };
  }
}

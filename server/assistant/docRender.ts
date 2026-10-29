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

export function parseMarkdown(md: string): Block[] {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
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
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flush(); out.push({ t: "h", level: h[1].length, text: h[2].trim() }); continue; }
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
    if (ul) { flush(); out.push({ t: "ul", text: ul[1].trim() }); continue; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) { flush(); out.push({ t: "ol", n: ol[1], text: ol[2].trim() }); continue; }
    para.push(line.trim());
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

export async function renderPptx(title: string, markdown: string): Promise<Buffer> {
  const blocks = parseMarkdown(markdown);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = title;
  const title1 = pptx.addSlide();
  title1.background = { color: "1F3A5F" };
  title1.addText(title, { x: 0.6, y: 2.0, w: 8.8, h: 1.5, fontSize: 36, bold: true, color: "FFFFFF", fontFace: "Calibri" });
  title1.addText("Created with LENORY AI", { x: 0.6, y: 3.7, w: 8.8, h: 0.5, fontSize: 16, color: "C9D6EA", fontFace: "Calibri" });

  type Sec = { heading: string; bullets: string[]; table?: string[][] };
  const sections: Sec[] = [];
  let cur: Sec | null = null;
  for (const b of blocks) {
    if (b.t === "h" && b.level <= 2) { cur = { heading: stripInline(b.text), bullets: [] }; sections.push(cur); continue; }
    if (!cur) { cur = { heading: title, bullets: [] }; sections.push(cur); }
    if (b.t === "h") cur.bullets.push(stripInline(b.text));
    else if (b.t === "p" || b.t === "ul" || b.t === "ol") cur.bullets.push(stripInline(b.text));
    else if (b.t === "code") cur.bullets.push(b.text.slice(0, 200));
    else if (b.t === "table") cur.table = b.rows.map((r) => r.map(stripInline));
  }
  const PER = 6;
  for (const s of sections) {
    const chunks: string[][] = [];
    for (let i = 0; i < s.bullets.length; i += PER) chunks.push(s.bullets.slice(i, i + PER));
    if (!chunks.length) chunks.push([]);
    chunks.forEach((chunk, ci) => {
      const slide = pptx.addSlide();
      slide.addText(ci === 0 ? s.heading : `${s.heading} (cont.)`, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true, color: "1F3A5F", fontFace: "Calibri" });
      if (chunk.length) {
        slide.addText(chunk.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.3, w: 8.8, h: 3.9, fontSize: 18, color: "222222", fontFace: "Calibri", valign: "top", paraSpaceAfter: 8 });
      }
    });
    if (s.table) {
      const slide = pptx.addSlide();
      slide.addText(`${s.heading} — table`, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 26, bold: true, color: "1F3A5F" });
      slide.addTable(s.table.map((r, ri) => r.map((c) => ({ text: c, options: { bold: ri === 0, fontSize: 14 } }))), { x: 0.6, y: 1.3, w: 8.8, border: { type: "solid", color: "BBBBBB", pt: 1 } });
    }
  }
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

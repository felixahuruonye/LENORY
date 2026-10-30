/**
 * Renderers for every non-Office format LENORY can deliver. Each one produces a
 * real, valid file or THROWS with a plain reason - there is no placeholder or
 * "wrap the text in something" fallback that would pretend a broken file is fine.
 */
import path from "path";
import { createRequire } from "module";
import JSZipMod from "jszip";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import Papa from "papaparse";
import YAML from "yaml";
import { XMLValidator } from "fast-xml-parser";
import { parseMarkdown, stripInline, cleanDocText, type Block } from "./docRender";

const unwrap = (m: any) => (m && m.default ? m.default : m);
const JSZip: any = unwrap(JSZipMod);
const require_ = createRequire(import.meta.url);

export const FORMAT_INFO: Record<string, { ext: string; mime: string }> = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  txt: { ext: "txt", mime: "text/plain; charset=utf-8" },
  rtf: { ext: "rtf", mime: "application/rtf" },
  md: { ext: "md", mime: "text/markdown; charset=utf-8" },
  csv: { ext: "csv", mime: "text/csv; charset=utf-8" },
  ods: { ext: "ods", mime: "application/vnd.oasis.opendocument.spreadsheet" },
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
  svg: { ext: "svg", mime: "image/svg+xml" },
  json: { ext: "json", mime: "application/json" },
  xml: { ext: "xml", mime: "application/xml" },
  yaml: { ext: "yaml", mime: "application/yaml" },
  html: { ext: "html", mime: "text/html; charset=utf-8" },
  css: { ext: "css", mime: "text/css; charset=utf-8" },
  js: { ext: "js", mime: "text/javascript; charset=utf-8" },
  ts: { ext: "ts", mime: "text/typescript; charset=utf-8" },
  py: { ext: "py", mime: "text/x-python; charset=utf-8" },
  sql: { ext: "sql", mime: "application/sql" },
  zip: { ext: "zip", mime: "application/zip" },
};
const ALIASES: Record<string, string> = {
  markdown: "md", jpg: "jpeg", yml: "yaml", javascript: "js", typescript: "ts", python: "py",
};
export const normalizeFormat = (f: string) => {
  const k = String(f || "").toLowerCase().replace(/^\./, "").trim();
  return ALIASES[k] || k;
};
export const ALL_FORMATS = Object.keys(FORMAT_INFO);

/** Remove a ```lang fence that wraps the whole content (models love adding one). */
export function stripFences(input: string): string {
  const t = String(input || "").replace(/\r\n?/g, "\n").trim();
  const m = t.match(/^```[\w+-]*\n([\s\S]*?)\n```$/);
  return (m ? m[1] : t).replace(/\s+$/, "") + "\n";
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ───────────────────────────── PDF ─────────────────────────────
function fontFile(name: string): string {
  const dir = path.dirname(require_.resolve("@fontsource/noto-sans/package.json"));
  return path.join(dir, "files", name);
}

export async function renderPdf(title: string, markdown: string): Promise<Buffer> {
  const blocks = parseMarkdown(markdown);
  const doc = new PDFDocument({ size: "A4", margins: { top: 64, bottom: 64, left: 60, right: 60 }, bufferPages: true, info: { Title: title, Creator: "LENORY AI" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });

  doc.registerFont("R", fontFile("noto-sans-latin-400-normal.woff"));
  doc.registerFont("B", fontFile("noto-sans-latin-700-normal.woff"));
  doc.registerFont("I", fontFile("noto-sans-latin-400-italic.woff"));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const NAVY = "#1F3A5F";

  // inline **bold** / *italic* / `code`
  const runsOf = (text: string) => {
    const out: { t: string; f: string }[] = [];
    const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;
    let last = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: text.slice(last, m.index), f: "R" });
      const k = m[0];
      if (k.startsWith("**") || k.startsWith("__")) out.push({ t: k.slice(2, -2), f: "B" });
      else if (k.startsWith("`")) out.push({ t: k.slice(1, -1), f: "Courier" });
      else out.push({ t: k.slice(1, -1), f: "I" });
      last = m.index + k.length;
    }
    if (last < text.length) out.push({ t: text.slice(last), f: "R" });
    return out.length ? out : [{ t: text, f: "R" }];
  };
  const write = (text: string, opts: { size?: number; x?: number; w?: number; color?: string; gap?: number } = {}) => {
    const size = opts.size || 11;
    const x = opts.x ?? left;
    const w = opts.w ?? width;
    const runs = runsOf(text);
    runs.forEach((r, i) => {
      doc.font(r.f).fontSize(size).fillColor(opts.color || "#222222");
      if (i === 0) doc.text(r.t, x, doc.y, { width: w, continued: i < runs.length - 1, lineGap: opts.gap ?? 3 });
      else doc.text(r.t, { continued: i < runs.length - 1, lineGap: opts.gap ?? 3 });
    });
  };
  const need = (h: number) => { if (doc.y + h > bottom()) doc.addPage(); };

  doc.font("B").fontSize(24).fillColor(NAVY).text(title, left, doc.y, { width });
  doc.moveDown(0.3);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.5).strokeColor(NAVY).stroke();
  doc.moveDown(0.8);

  const first = blocks[0];
  const skipFirst = first && first.t === "h" && first.level === 1 && stripInline(first.text).toLowerCase() === title.trim().toLowerCase();
  blocks.forEach((b, idx) => {
    if (idx === 0 && skipFirst) return;
    switch (b.t) {
      case "h": {
        const size = b.level <= 1 ? 18 : b.level === 2 ? 15 : 12.5;
        need(size + 24);
        doc.moveDown(0.5);
        doc.font("B").fontSize(size).fillColor(NAVY).text(stripInline(b.text), left, doc.y, { width });
        doc.moveDown(0.3);
        break;
      }
      case "p": need(30); write(b.text); doc.moveDown(0.6); break;
      case "ul": case "ol": {
        need(24);
        const y = doc.y;
        doc.font("R").fontSize(11).fillColor("#222222").text(b.t === "ul" ? "\u2022" : `${(b as any).n}.`, left + 6, y, { width: 18 });
        doc.y = y;
        write(b.text, { x: left + 26, w: width - 26 });
        doc.moveDown(0.25);
        break;
      }
      case "code": {
        const lines = b.text.split("\n");
        doc.font("Courier").fontSize(9.5);
        const h = lines.length * 12 + 12;
        need(Math.min(h, 120));
        const y0 = doc.y;
        doc.fillColor("#222222");
        lines.forEach((l) => {
          need(14);
          doc.font("Courier").fontSize(9.5).fillColor("#222222").text(l || " ", left + 8, doc.y, { width: width - 16, lineGap: 1 });
        });
        doc.moveDown(0.6);
        void y0;
        break;
      }
      case "table": {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const cw = width / cols;
        b.rows.forEach((r, ri) => {
          const cells = Array.from({ length: cols }, (_, ci) => stripInline(r[ci] || ""));
          doc.font(ri === 0 ? "B" : "R").fontSize(10);
          const rh = Math.max(...cells.map((c) => doc.heightOfString(c, { width: cw - 10 }))) + 10;
          need(rh);
          const y = doc.y;
          if (ri === 0) doc.rect(left, y, width, rh).fill("#DCE6F1");
          cells.forEach((c, ci) => {
            doc.rect(left + ci * cw, y, cw, rh).lineWidth(0.5).strokeColor("#999999").stroke();
            doc.font(ri === 0 ? "B" : "R").fontSize(10).fillColor("#222222").text(c, left + ci * cw + 5, y + 5, { width: cw - 10 });
          });
          doc.y = y + rh;
        });
        doc.moveDown(0.8);
        break;
      }
    }
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("R").fontSize(8.5).fillColor("#888888").text(`${title}  |  Page ${i + 1} of ${range.count}`, left, doc.page.height - 40, { width, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}

/** Real read-back: parse the PDF and make sure the text is actually in it. */
export async function readPdfText(buffer: Buffer): Promise<{ pages: number; text: string }> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const pdf = await task.promise;
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    text += tc.items.map((it: any) => it.str).join(" ") + "\n";
  }
  const pages = pdf.numPages;
  try { await task.destroy(); } catch {}
  return { pages, text };
}

// ───────────────────────────── Images ─────────────────────────────
function extractSvg(content: string): string | null {
  const t = stripFences(content);
  const m = t.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return null;
  const svg = m[0].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
  const v = XMLValidator.validate(svg);
  if (v !== true) throw new Error(`The SVG is not valid XML (${(v as any).err?.msg || "parse error"}).`);
  return /xmlns=/.test(svg) ? svg : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

async function stabilityImage(prompt: string, fmt: "png" | "jpeg" | "webp"): Promise<Buffer> {
  const key = process.env.STABILITY_API_KEY;
  if (!key) throw new Error("NO_IMAGE_KEY");
  const form = new FormData();
  form.append("prompt", prompt.slice(0, 9000));
  form.append("output_format", fmt);
  form.append("aspect_ratio", "16:9");
  const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "image/*" }, body: form as any,
  });
  if (!res.ok) throw new Error(`Image generator error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function renderImage(fmt: "png" | "jpeg" | "webp", content: string): Promise<Buffer> {
  const svg = extractSvg(content);
  if (svg) {
    let p = sharp(Buffer.from(svg), { density: 144 }).resize({ width: 1600, withoutEnlargement: false });
    if (fmt === "jpeg") p = p.flatten({ background: "#ffffff" }).jpeg({ quality: 90 });
    else if (fmt === "webp") p = p.webp({ quality: 90 });
    else p = p.png();
    return p.toBuffer();
  }
  try {
    return await stabilityImage(content, fmt);
  } catch (e: any) {
    if (e?.message === "NO_IMAGE_KEY") throw new Error("To create a picture I need either SVG markup to convert, or an image-generation key (STABILITY_API_KEY) on the server. No image was created.");
    throw e;
  }
}

export async function validateImage(buffer: Buffer, fmt: string): Promise<void> {
  const meta = await sharp(buffer).metadata();
  const want = fmt === "jpeg" ? "jpeg" : fmt;
  if (meta.format !== want || !meta.width || !meta.height) throw new Error(`Generated image is not a valid ${fmt.toUpperCase()}`);
}

// ───────────────────────────── Tables (CSV / ODS) ─────────────────────────────
export function toRows(content: string): string[][] {
  const blocks = parseMarkdown(content);
  const table = blocks.find((b): b is Extract<Block, { t: "table" }> => b.t === "table");
  if (table) return table.rows.map((r) => r.map(stripInline));
  const parsed = Papa.parse<string[]>(stripFences(content).trim(), { skipEmptyLines: true });
  const rows = (parsed.data || []).map((r) => r.map((c) => String(c ?? "").trim()));
  if (!rows.length || (rows.length === 1 && rows[0].length < 2)) throw new Error("Tabular formats need rows and columns (CSV text or a Markdown table).");
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ""));
}

async function renderOds(title: string, content: string): Promise<Buffer> {
  const rows = toRows(content).slice(0, 5000);
  const cell = (c: string, head: boolean) => {
    const n = c.replace(/,/g, "");
    const style = head ? ' table:style-name="ce1"' : "";
    return /^-?\d+(\.\d+)?$/.test(n) && !head
      ? `<table:table-cell office:value-type="float" office:value="${n}"${style}><text:p>${xmlEsc(c)}</text:p></table:table-cell>`
      : `<table:table-cell office:value-type="string"${style}><text:p>${xmlEsc(c)}</text:p></table:table-cell>`;
  };
  const body = rows.map((r, ri) => `<table:table-row>${r.map((c) => cell(c, ri === 0)).join("")}</table:table-row>`).join("");
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns} office:version="1.2"><office:automatic-styles><style:style style:name="ce1" style:family="table-cell"><style:table-cell-properties fo:background-color="#dce6f1"/><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:spreadsheet><table:table table:name="${xmlEsc(title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1")}">${body}</table:table></office:spreadsheet></office:body></office:document-content>`;
  const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>';
  const zip = new JSZip();
  zip.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet", { compression: "STORE" });
  zip.file("META-INF/manifest.xml", manifest);
  zip.file("content.xml", contentXml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ───────────────────────────── Plain text / RTF / HTML ─────────────────────────────
function blocksToText(title: string, blocks: Block[]): string {
  const out: string[] = [title, "=".repeat(Math.min(Math.max(title.length, 8), 70)), ""];
  const first = blocks[0];
  blocks.forEach((b, i) => {
    if (i === 0 && first.t === "h" && first.level === 1 && stripInline(first.text).toLowerCase() === title.toLowerCase()) return;
    switch (b.t) {
      case "h": out.push("", b.level <= 2 ? stripInline(b.text).toUpperCase() : stripInline(b.text), b.level <= 2 ? "-".repeat(Math.min(stripInline(b.text).length, 70)) : "", ""); break;
      case "p": out.push(stripInline(b.text), ""); break;
      case "ul": out.push(`  - ${stripInline(b.text)}`); break;
      case "ol": out.push(`  ${b.n}. ${stripInline(b.text)}`); break;
      case "code": out.push("", ...b.text.split("\n").map((l) => "    " + l), ""); break;
      case "table": {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const w = Array.from({ length: cols }, (_, c) => Math.min(30, Math.max(...b.rows.map((r) => stripInline(r[c] || "").length))));
        b.rows.forEach((r, ri) => {
          out.push(w.map((wd, c) => stripInline(r[c] || "").padEnd(wd)).join("  |  ").trimEnd());
          if (ri === 0) out.push(w.map((wd) => "-".repeat(wd)).join("--+--"));
        });
        out.push("");
        break;
      }
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const rtfEsc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}")
    .replace(/[^\x00-\x7f]/g, (ch) => { const c = ch.codePointAt(0)!; return c > 0xffff ? "?" : `\\u${c > 32767 ? c - 65536 : c}?`; });
function renderRtf(title: string, blocks: Block[]): string {
  const run = (t: string) => {
    let out = ""; const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g; let last = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      out += rtfEsc(t.slice(last, m.index));
      out += m[0].startsWith("**") ? `{\\b ${rtfEsc(m[0].slice(2, -2))}}` : `{\\i ${rtfEsc(m[0].slice(1, -1))}}`;
      last = m.index + m[0].length;
    }
    return out + rtfEsc(t.slice(last));
  };
  const parts: string[] = [`{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Calibri;}{\\f1\\fmodern Courier New;}}\\f0\\fs24`, `{\\pard\\sa240\\b\\fs40 ${rtfEsc(title)}\\par}`];
  blocks.forEach((b, i) => {
    if (i === 0 && b.t === "h" && b.level === 1 && stripInline(b.text).toLowerCase() === title.toLowerCase()) return;
    switch (b.t) {
      case "h": parts.push(`{\\pard\\sb200\\sa100\\b\\fs${b.level <= 1 ? 34 : b.level === 2 ? 30 : 26} ${run(b.text)}\\par}`); break;
      case "p": parts.push(`{\\pard\\sa140 ${run(b.text)}\\par}`); break;
      case "ul": parts.push(`{\\pard\\fi-300\\li600\\sa60 \\bullet\\tab ${run(b.text)}\\par}`); break;
      case "ol": parts.push(`{\\pard\\fi-300\\li600\\sa60 ${b.n}.\\tab ${run(b.text)}\\par}`); break;
      case "code": b.text.split("\n").forEach((l) => parts.push(`{\\pard\\f1\\fs20 ${rtfEsc(l)}\\par}`)); break;
      case "table": b.rows.forEach((r, ri) => parts.push(`{\\pard\\sa60 ${ri === 0 ? "\\b " : ""}${r.map((c) => rtfEsc(stripInline(c))).join("\\tab ")}${ri === 0 ? "\\b0" : ""}\\par}`)); break;
    }
  });
  parts.push("}");
  return parts.join("\n");
}

function blocksToHtml(title: string, blocks: Block[]): string {
  const inl = (t: string) => xmlEsc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const body: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { body.push(`</${list}>`); list = null; } };
  blocks.forEach((b, i) => {
    if (b.t !== "ul" && b.t !== "ol") closeList();
    if (i === 0 && b.t === "h" && b.level === 1) return;
    switch (b.t) {
      case "h": body.push(`<h${Math.min(b.level + 1, 6)}>${inl(b.text)}</h${Math.min(b.level + 1, 6)}>`); break;
      case "p": body.push(`<p>${inl(b.text)}</p>`); break;
      case "ul": case "ol": if (list !== b.t) { closeList(); list = b.t; body.push(`<${list}>`); } body.push(`<li>${inl(b.text)}</li>`); break;
      case "code": body.push(`<pre><code>${xmlEsc(b.text)}</code></pre>`); break;
      case "table": body.push(`<table>${b.rows.map((r, ri) => `<tr>${r.map((c) => `<${ri ? "td" : "th"}>${inl(c)}</${ri ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`); break;
    }
  });
  closeList();
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${xmlEsc(title)}</title>\n<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#222}h1,h2,h3{color:#1f3a5f}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.45rem .6rem;text-align:left}th{background:#dce6f1}pre{background:#f4f4f4;padding:1rem;overflow:auto;border-radius:6px}code{font-family:ui-monospace,Menlo,Consolas,monospace}</style>\n</head>\n<body>\n<h1>${xmlEsc(title)}</h1>\n${body.join("\n")}\n</body>\n</html>\n`;
}

// ───────────────────────────── ZIP ─────────────────────────────
async function renderZip(content: string): Promise<{ buffer: Buffer; count: number }> {
  let spec: any;
  try { spec = JSON.parse(stripFences(content)); } catch { throw new Error('ZIP content must be JSON like {"files":[{"path":"folder/name.txt","content":"..."}]}.'); }
  const files: { path: string; content: string }[] = Array.isArray(spec) ? spec : spec?.files;
  if (!Array.isArray(files) || !files.length) throw new Error("ZIP needs at least one file in the files list.");
  if (files.length > 200) throw new Error("A ZIP can hold at most 200 files here.");
  const zip = new JSZip();
  const seen = new Set<string>();
  for (const f of files) {
    const p = String(f?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!p || p.split("/").some((seg) => seg === ".." || seg === "") || p.length > 200) throw new Error(`Unsafe or empty file path in ZIP: "${p}"`);
    if (seen.has(p)) throw new Error(`Duplicate file path in ZIP: "${p}"`);
    if (typeof f.content !== "string") throw new Error(`File "${p}" has no text content.`);
    seen.add(p);
    zip.file(p, f.content);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, count: files.length };
}

// ───────────────────────────── Dispatcher ─────────────────────────────
export interface Rendered { buffer: Buffer; mimeType: string; ext: string; note?: string }

/** Everything except docx/pptx/xlsx (those live in docRender). Throws on anything invalid. */
export async function renderOther(formatIn: string, title: string, contentIn: string): Promise<Rendered> {
  const format = normalizeFormat(formatIn);
  const info = FORMAT_INFO[format];
  if (!info) throw new Error(`Unsupported format "${formatIn}".`);
  const mk = (buffer: Buffer, note?: string): Rendered => ({ buffer, mimeType: info.mime, ext: info.ext, note });
  const utf8 = (s: string) => Buffer.from(s, "utf8");

  switch (format) {
    case "pdf": {
      const buffer = await renderPdf(title, contentIn);
      const back = await readPdfText(buffer);
      const probe = stripInline(cleanDocText(contentIn)).split(/\s+/).filter((w) => /^[A-Za-z]{5,}$/.test(w)).slice(0, 12);
      if (probe.length && !probe.some((w) => back.text.includes(w))) throw new Error("PDF read-back did not find the document text");
      return mk(buffer, `${back.pages} page(s)`);
    }
    case "png": case "jpeg": case "webp": {
      const buffer = await renderImage(format, contentIn);
      await validateImage(buffer, format);
      return mk(buffer);
    }
    case "svg": {
      const svg = extractSvg(contentIn);
      if (!svg) throw new Error("SVG content must contain a complete <svg>...</svg> element.");
      return mk(utf8(svg + "\n"));
    }
    case "txt": return mk(utf8(blocksToText(title, parseMarkdown(contentIn))));
    case "rtf": return mk(Buffer.from(renderRtf(title, parseMarkdown(contentIn)), "latin1"));
    case "md": {
      const c = stripFences(contentIn).trimEnd();
      return mk(utf8(/^#\s/m.test(c) ? c + "\n" : `# ${title}\n\n${c}\n`));
    }
    case "csv": {
      const rows = toRows(contentIn);
      return mk(utf8("\ufeff" + Papa.unparse(rows, { newline: "\r\n" }) + "\r\n"));
    }
    case "ods": {
      const buffer = await renderOds(title, contentIn);
      const z = await JSZip.loadAsync(buffer);
      const xml = await z.file("content.xml")?.async("string");
      if (!xml || !xml.includes("<table:table-row")) throw new Error("ODS read-back found no rows");
      return mk(buffer);
    }
    case "json": {
      let parsed: any;
      try { parsed = JSON.parse(stripFences(contentIn)); } catch (e: any) { throw new Error(`The JSON is not valid (${e?.message}). Fix it and try again.`); }
      return mk(utf8(JSON.stringify(parsed, null, 2) + "\n"));
    }
    case "xml": {
      let c = stripFences(contentIn).trim();
      if (!c.startsWith("<")) throw new Error("XML content must start with an element like <root>...</root>.");
      const v = XMLValidator.validate(c);
      if (v !== true) throw new Error(`The XML is not well-formed (${(v as any).err?.msg}).`);
      if (!c.startsWith("<?xml")) c = `<?xml version="1.0" encoding="UTF-8"?>\n${c}`;
      return mk(utf8(c + "\n"));
    }
    case "yaml": {
      const c = stripFences(contentIn);
      const d = YAML.parseDocument(c);
      if (d.errors.length) throw new Error(`The YAML is not valid (${d.errors[0].message.split("\n")[0]}).`);
      return mk(utf8(c));
    }
    case "html": {
      const c = stripFences(contentIn);
      if (/<(!doctype|html)\b/i.test(c)) return mk(utf8(c));
      if (/<\w+[^>]*>/.test(c)) {
        return mk(utf8(`<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${xmlEsc(title)}</title>\n</head>\n<body>\n${c}\n</body>\n</html>\n`));
      }
      return mk(utf8(blocksToHtml(title, parseMarkdown(contentIn))));
    }
    case "css": case "js": case "ts": case "py": case "sql": {
      const c = stripFences(contentIn);
      if (c.trim().length < 3) throw new Error("The code is empty.");
      return mk(utf8(c));
    }
    case "zip": {
      const { buffer, count } = await renderZip(contentIn);
      const back = await JSZip.loadAsync(buffer);
      if (Object.keys(back.files).filter((n) => !back.files[n].dir).length !== count) throw new Error("ZIP read-back file count mismatch");
      return mk(buffer, `${count} file(s)`);
    }
    default:
      throw new Error(`"${format}" is handled by the Office renderer.`);
  }
}

/**
 * Server-side file generation without optional native packages.
 * Produces real binary buffers that open in standard apps.
 */
import { deflateRawSync } from "zlib";
import { randomBytes } from "crypto";
import type { FileFormat } from "./types";

export interface GeneratedFile {
  buffer: Buffer;
  mimeType: string;
  extension: string;
  fileName: string;
}

function safeBaseName(name: string): string {
  return (name || "lenory-file")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "lenory-file";
}

/** Multi-page PDF 1.4 with Helvetica text. */
export function generatePdf(title: string, body: string): Buffer {
  const maxLen = 88;
  const lines: string[] = [];
  const pushWrapped = (text: string) => {
    const paragraphs = String(text || "").replace(/\r/g, "").split("\n");
    for (const p of paragraphs) {
      if (!p.trim()) {
        lines.push("");
        continue;
      }
      // Strip markdown markers for cleaner PDF body
      let rest = p
        .replace(/^#{1,6}\s+/, "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\|/g, " ")
        .replace(/^-{3,}$/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(" ", maxLen);
        if (cut < 40) cut = maxLen;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      if (rest) lines.push(rest);
    }
  };
  if (title) {
    pushWrapped(title);
    lines.push("");
  }
  pushWrapped(body);

  const LINES_PER_PAGE = 48;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (!pages.length) pages.push([title || "LENORY document"]);

  const objects: string[] = [];
  // obj 1 catalog, 2 pages tree — filled later
  objects.push(""); // placeholder index 0 unused in 1-based pdf objs we'll build list carefully

  const fontObjNum = 3 + pages.length * 2; // after pages
  // Build content streams and page objects
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  let nextObj = 3;
  const contentBodies: string[] = [];

  for (const pageLines of pages) {
    const contentLines: string[] = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"];
    let first = true;
    for (const line of pageLines) {
      const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      if (first) {
        contentLines.push(`(${escaped}) Tj`);
        first = false;
      } else {
        contentLines.push("T*");
        contentLines.push(`(${escaped}) Tj`);
      }
    }
    contentLines.push("ET");
    contentBodies.push(contentLines.join("\n"));
    contentObjNums.push(nextObj);
    nextObj++;
    pageObjNums.push(nextObj);
    nextObj++;
  }
  const fontObj = nextObj;
  nextObj++;

  // Assemble PDF objects in order: 1 catalog, 2 pages, then pairs of content+page, then font
  const pdfObjects: { num: number; body: string }[] = [];
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  pdfObjects.push({ num: 1, body: `<< /Type /Catalog /Pages 2 0 R >>` });
  pdfObjects.push({ num: 2, body: `<< /Type /Pages /Kids [${kids}] /Count ${pageObjNums.length} >>` });

  for (let i = 0; i < pages.length; i++) {
    const cNum = contentObjNums[i];
    const pNum = pageObjNums[i];
    const stream = contentBodies[i];
    const streamLen = Buffer.byteLength(stream, "utf8");
    pdfObjects.push({
      num: cNum,
      body: `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`,
    });
    pdfObjects.push({
      num: pNum,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${cNum} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`,
    });
  }
  pdfObjects.push({
    num: fontObj,
    body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  });
  pdfObjects.sort((a, b) => a.num - b.num);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of pdfObjects) {
    offsets[obj.num] = Buffer.byteLength(pdf, "utf8");
    pdf += `${obj.num} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8");
  const maxObj = Math.max(...pdfObjects.map((o) => o.num));
  pdf += `xref\n0 ${maxObj + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= maxObj; i++) {
    const off = offsets[i] || 0;
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

/** RTF opens in Word / Google Docs. */
export function generateRtf(title: string, body: string): Buffer {
  const esc = (s: string) =>
    String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\n/g, "\\par\n");
  const rtf = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Arial;}}
\\fs24
{\\b ${esc(title)}}\\par\\par
${esc(body)}
}`;
  return Buffer.from(rtf, "utf8");
}

/** Minimal DOCX (OOXML) via hand-rolled ZIP store/deflate. */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function zipStore(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const compressed = deflateRawSync(f.data);
    const useDeflate = compressed.length < f.data.length;
    const payload = useDeflate ? compressed : f.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, payload);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
    offset += local.length + payload.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const localDir = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(localDir.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localDir, centralDir, end]);
}

function xmlEscape(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateDocx(title: string, body: string): Buffer {
  const paragraphs = String(body || "")
    .split(/\n/)
    .map((line) => {
      if (!line.trim()) return `<w:p><w:r><w:t></w:t></w:r></w:p>`;
      return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
    })
    .join("");
  const titleP = title
    ? `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${xmlEscape(title)}</w:t></w:r></w:p><w:p><w:r><w:t></w:t></w:r></w:p>`
    : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${titleP}${paragraphs}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]);
}

/** Minimal PPTX: one title slide + content slide. */
export function generatePptx(title: string, body: string): Buffer {
  const bullets = String(body || "")
    .split(/\n/)
    .filter((l) => l.trim())
    .slice(0, 12)
    .map((l, i) => {
      const y = 1500000 + i * 500000;
      return `<a:p><a:pPr marL="0"/><a:r><a:rPr lang="en-US" sz="1600"/><a:t>${xmlEscape(l.slice(0, 200))}</a:t></a:r></a:p>`;
    })
    .join("");

  const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/><p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="457200" y="2746380"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${xmlEscape(title || "LENORY")}</a:t></a:r></a:p></p:txBody>
    </p:sp>
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

  const slide2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/><p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="457200" y="685800"/><a:ext cx="8229600" cy="5715000"/></a:xfrm></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/>${bullets || "<a:p><a:r><a:t> </a:t></a:r></a:p>"}</p:txBody>
    </p:sp>
  </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
  const pres = `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;
  const presRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "ppt/presentation.xml", data: Buffer.from(pres, "utf8") },
    { name: "ppt/_rels/presentation.xml.rels", data: Buffer.from(presRels, "utf8") },
    { name: "ppt/slides/slide1.xml", data: Buffer.from(slide1, "utf8") },
    { name: "ppt/slides/slide2.xml", data: Buffer.from(slide2, "utf8") },
  ]);
}

/** SpreadsheetML XLSX (single sheet). */
export function generateXlsx(title: string, body: string): Buffer {
  const rows = String(body || "")
    .split(/\n/)
    .filter((l) => l.trim())
    .slice(0, 200);
  const sheetRows = [
    `<row r="1"><c r="A1" t="inlineStr"><is><t>${xmlEscape(title || "LENORY")}</t></is></c></row>`,
    ...rows.map((line, i) => {
      const r = i + 2;
      // Support simple CSV-ish lines
      const cells = line.includes("\t") ? line.split("\t") : line.includes(",") ? line.split(",") : [line];
      return `<row r="${r}">${cells
        .slice(0, 10)
        .map(
          (cell, j) =>
            `<c r="${String.fromCharCode(65 + j)}${r}" t="inlineStr"><is><t>${xmlEscape(cell.trim())}</t></is></c>`
        )
        .join("")}</row>`;
    }),
  ].join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  // Fix: workbook is the office document; structure like standard xlsx
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbook, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ]);
}

export function generateCsv(title: string, body: string): Buffer {
  const header = title ? `# ${title}\n` : "";
  return Buffer.from(header + String(body || ""), "utf8");
}

export function generateSvg(title: string, body: string): Buffer {
  const lines = String(body || "")
    .split(/\n/)
    .slice(0, 20)
    .map((l, i) => `<text x="24" y="${40 + i * 18}" font-family="Arial" font-size="14">${xmlEscape(l.slice(0, 100))}</text>`)
    .join("\n");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="100%" height="100%" fill="#0f172a"/>
  <text x="24" y="28" font-family="Arial" font-size="20" fill="#a78bfa" font-weight="bold">${xmlEscape(title || "LENORY")}</text>
  <g fill="#e2e8f0">${lines}</g>
</svg>`;
  return Buffer.from(svg, "utf8");
}

const MIME: Record<string, { mime: string; ext: string }> = {
  pdf: { mime: "application/pdf", ext: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  rtf: { mime: "application/rtf", ext: "rtf" },
  txt: { mime: "text/plain", ext: "txt" },
  md: { mime: "text/markdown", ext: "md" },
  markdown: { mime: "text/markdown", ext: "md" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: "pptx" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  csv: { mime: "text/csv", ext: "csv" },
  json: { mime: "application/json", ext: "json" },
  xml: { mime: "application/xml", ext: "xml" },
  yaml: { mime: "text/yaml", ext: "yaml" },
  yml: { mime: "text/yaml", ext: "yml" },
  html: { mime: "text/html", ext: "html" },
  css: { mime: "text/css", ext: "css" },
  js: { mime: "text/javascript", ext: "js" },
  javascript: { mime: "text/javascript", ext: "js" },
  ts: { mime: "text/typescript", ext: "ts" },
  typescript: { mime: "text/typescript", ext: "ts" },
  py: { mime: "text/x-python", ext: "py" },
  python: { mime: "text/x-python", ext: "py" },
  sql: { mime: "application/sql", ext: "sql" },
  zip: { mime: "application/zip", ext: "zip" },
  svg: { mime: "image/svg+xml", ext: "svg" },
};

export function generateFile(opts: {
  format: string;
  title?: string;
  content: string;
  fileName?: string;
}): GeneratedFile {
  const format = String(opts.format || "txt").toLowerCase().replace(/^\./, "") as FileFormat;
  const title = opts.title || "LENORY document";
  const content = opts.content || "";
  const meta = MIME[format] || MIME.txt;
  let buffer: Buffer;

  switch (format) {
    case "pdf":
      buffer = generatePdf(title, content);
      break;
    case "docx":
      buffer = generateDocx(title, content);
      break;
    case "rtf":
      buffer = generateRtf(title, content);
      break;
    case "pptx":
      buffer = generatePptx(title, content);
      break;
    case "xlsx":
      buffer = generateXlsx(title, content);
      break;
    case "csv":
      buffer = generateCsv(title, content);
      break;
    case "svg":
      buffer = generateSvg(title, content);
      break;
    case "json":
      try {
        const parsed = JSON.parse(content);
        buffer = Buffer.from(JSON.stringify(parsed, null, 2), "utf8");
      } catch {
        buffer = Buffer.from(JSON.stringify({ title, content }, null, 2), "utf8");
      }
      break;
    case "html":
      buffer = Buffer.from(
        `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title.replace(/</g, "")}</title></head><body><h1>${title.replace(/</g, "")}</h1><pre>${content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</pre></body></html>`,
        "utf8"
      );
      break;
    case "zip": {
      const inner = Buffer.from(content, "utf8");
      buffer = zipStore([{ name: `${safeBaseName(title)}.txt`, data: inner }]);
      break;
    }
    default:
      buffer = Buffer.from(
        title ? `# ${title}\n\n${content}` : content,
        "utf8"
      );
  }

  const base = safeBaseName(opts.fileName || title);
  const fileName = base.toLowerCase().endsWith(`.${meta.ext}`) ? base : `${base}.${meta.ext}`;
  return {
    buffer,
    mimeType: meta.mime,
    extension: meta.ext,
    fileName,
  };
}

export function randomArtifactId(): string {
  return `art_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

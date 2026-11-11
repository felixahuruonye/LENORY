/**
 * Handwritten / document digitization API for Write My Note.
 * Does not touch Live Session recording or transcription pipelines.
 */
import type { Express, Response } from "express";
import multer from "multer";
import { supabaseAuth } from "./supabaseAuth";
import { getOcrProvider, combinePageTexts, type OcrPageResult } from "./handwritingOcr";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 40 },
});

const IMAGE_MIME = /^(image\/(jpeg|jpg|png|webp|heic|heif|gif|bmp)|application\/octet-stream)$/i;
const DOC_MIME = /^(application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword|text\/plain)$/i;
const BLOCKED = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|avi|mkv|webm)$/i;

function isAllowed(name: string, mime: string): boolean {
  if (BLOCKED.test(name)) return false;
  if (/audio\/|video\//i.test(mime)) return false;
  if (IMAGE_MIME.test(mime) || DOC_MIME.test(mime)) return true;
  if (/\.(jpe?g|png|webp|heic|heif|gif|bmp|pdf|docx?|txt)$/i.test(name)) return true;
  return false;
}

async function extractPlainDoc(buffer: Buffer, mime: string, name: string): Promise<string> {
  if (/text\/plain/i.test(mime) || /\.txt$/i.test(name)) {
    return buffer.toString("utf8");
  }
  // DOCX is zip+xml — minimal text scrape without heavy deps
  if (/wordprocessingml|msword/i.test(mime) || /\.docx?$/i.test(name)) {
    try {
      const { deflateRawSync, inflateRawSync } = await import("zlib");
      // Fallback: strip tags from raw buffer if unzip fails
      const raw = buffer.toString("utf8");
      const texts = [...raw.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
      if (texts.length) return texts.join(" ");
    } catch {}
    return "[Could not fully extract DOCX text — open the original file if needed]";
  }
  // PDF: use Gemini vision on first chunk as image-like if possible — or text extract via gemini file
  if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) {
    try {
      const { analyzeFileWithGeminiVision } = await import("./gemini");
      const r = await analyzeFileWithGeminiVision(buffer, "application/pdf", name);
      return r.extractedText || "";
    } catch (e: any) {
      return "";
    }
  }
  return "";
}

export function registerDigitizeRoutes(app: Express) {

  /** Format OCR text for readability without inventing content. */
  app.post("/api/notes/digitize/clean", supabaseAuth, async (req: any, res: Response) => {
    try {
      const raw = String(req.body?.text || req.body?.document || "").trim();
      if (!raw) return res.status(400).json({ message: "No text to clean" });
      if (raw.length > 200_000) return res.status(413).json({ message: "Text too long to clean" });

      const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
      if (!key) {
        // Pass-through if Gemini not configured
        return res.json({ success: true, document: raw, cleaned: false, message: "Cleaner unavailable — original text kept" });
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: key });
      const models = [
        process.env.GEMINI_OCR_MODEL,
        process.env.GEMINI_VISION_MODEL,
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-2.5-flash",
      ].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

      const CLEAN_PROMPT = `You clean student lecture notes that were OCR'd from handwritten pages (math, physics, chemistry OK).

GOAL: Make the note easy to read. Do NOT change the meaning or invent content.

ALLOWED:
- Fix broken line wraps so sentences/equations read naturally
- Keep page markers like "--- Page N ---"
- Structure with clear headings ONLY when the source already has a title/subject/date/topic (promote those lines visually with markdown ## or **bold**)
- Use markdown sparingly: **bold** for existing headings, bullet/numbered lists when the source already uses lists or a/b/i/ii
- Keep every number, variable, and math expression that appears in the source
- Separate paragraphs for readability

FORBIDDEN:
- Do NOT add letters, digits, or math symbols that are not in the source
- Do NOT invent solution steps, answers, or explanations
- Do NOT correct math to what you think is "right" if it differs from the source
- Do NOT remove page content; if something is messy, keep it and only reformat spacing
- Do NOT add a title the source does not have

SOURCE TEXT:
${raw.slice(0, 180_000)}

Output ONLY the cleaned note. No preamble.`;

      let cleaned = "";
      let lastErr = "";
      for (const model of models) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: CLEAN_PROMPT }] }] as any,
            config: { thinkingConfig: { thinkingBudget: 0 } } as any,
          });
          cleaned = String((response as any).text || "").trim();
          if (cleaned && !/"error"\s*:|NOT_FOUND|UNAVAILABLE/i.test(cleaned)) break;
          lastErr = cleaned.slice(0, 120);
          cleaned = "";
        } catch (e: any) {
          lastErr = String(e?.message || e).slice(0, 160);
          continue;
        }
      }

      if (!cleaned) {
        return res.json({
          success: true,
          document: raw,
          cleaned: false,
          message: lastErr ? `Cleaner busy — kept original (${lastErr.slice(0, 80)})` : "Cleaner busy — kept original",
        });
      }

      return res.json({ success: true, document: cleaned, cleaned: true });
    } catch (e: any) {
      console.error("[digitize/clean]", e);
      const raw = String(req.body?.text || req.body?.document || "");
      res.json({ success: true, document: raw, cleaned: false, message: e?.message || "Clean failed — original kept" });
    }
  });

  app.get("/api/notes/digitize/status", supabaseAuth, async (_req: any, res: Response) => {
    try {
      const provider = getOcrProvider();
      res.json({ ok: true, provider: provider.id, label: provider.label });
    } catch (e: any) {
      res.json({ ok: false, message: e?.message || "OCR unavailable" });
    }
  });

  app.post(
    "/api/notes/digitize",
    supabaseAuth,
    upload.array("pages", 40),
    async (req: any, res: Response) => {
      try {
        const files = (req.files as Express.Multer.File[]) || [];
        if (!files.length) {
          return res.status(400).json({ message: "Upload at least one image or document page" });
        }

        // Optional order: "0,2,1" maps file indices
        let order = files.map((_, i) => i);
        if (req.body?.order) {
          try {
            const parsed = String(req.body.order)
              .split(",")
              .map((x: string) => parseInt(x.trim(), 10))
              .filter((n: number) => !isNaN(n) && n >= 0 && n < files.length);
            if (parsed.length === files.length) order = parsed;
          } catch {}
        }

        for (const f of files) {
          if (!isAllowed(f.originalname || "file", f.mimetype || "")) {
            return res.status(400).json({
              message: `Rejected file type: ${f.originalname}. Only images (JPG, PNG, WEBP, HEIC) and documents (PDF, DOCX, TXT) are allowed — not audio or video.`,
            });
          }
        }

        let provider;
        try {
          provider = getOcrProvider();
        } catch (e: any) {
          return res.status(503).json({ message: e?.message || "OCR provider not configured" });
        }

        const results: OcrPageResult[] = [];
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        async function processOne(pos: number): Promise<OcrPageResult> {
          const fi = order[pos];
          const f = files[fi];
          const mime = f.mimetype || "application/octet-stream";
          const name = f.originalname || `page_${pos + 1}`;
          if (/^image\//i.test(mime) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(name)) {
            return provider.extractPage({
              index: pos,
              buffer: f.buffer,
              mimeType: mime.startsWith("image/") ? mime : "image/jpeg",
              fileName: name,
            });
          }
          const text = await extractPlainDoc(f.buffer, mime, name);
          return {
            index: pos,
            fileName: name,
            text: text || "",
            confidence: text ? "high" : "none",
            warnings: text ? [] : ["No text extracted from document"],
            isBlank: !text,
          };
        }

        // Sequential with short gap — parallel bursts trigger Gemini 503 high-demand
        for (let pos = 0; pos < order.length; pos++) {
          if (pos > 0) await sleep(400);
          results.push(await processOne(pos));
        }

        // Second pass: retry blank image pages once after a pause
        const blankIdx = results
          .map((r, i) => (r.isBlank && !r.warnings.some((w) => /document/i.test(w)) ? i : -1))
          .filter((i) => i >= 0);
        if (blankIdx.length) {
          await sleep(1500);
          for (const i of blankIdx) {
            await sleep(500);
            const again = await processOne(i);
            if (!again.isBlank) results[i] = again;
          }
        }

        const combined = combinePageTexts(results);
        const allBlank = results.every((p) => p.isBlank);
        const apiHints = results.flatMap((p) => p.warnings).filter((w) => /404|NOT_FOUND|no longer available|OCR model|API key/i.test(w));
        res.json({
          success: !allBlank,
          provider: provider.id,
          pageCount: results.length,
          pages: results,
          document: combined,
          message: !allBlank
            ? `Extracted ${results.filter((p) => !p.isBlank).length} of ${results.length} pages`
            : apiHints[0]
              ? `OCR failed: ${apiHints[0]}`
              : "No text could be extracted from the uploaded pages",
          modelError: apiHints[0] || undefined,
        });
      } catch (e: any) {
        console.error("[digitize]", e);
        res.status(500).json({ message: e?.message || "Digitization failed" });
      }
    }
  );
}

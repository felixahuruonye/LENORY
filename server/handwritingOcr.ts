/**
 * Handwriting / document OCR abstraction for Write My Note → Scan notes.
 * Isolated from Live Session recording / transcription paths.
 */
export interface OcrPageInput {
  index: number;
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface OcrPageResult {
  index: number;
  fileName: string;
  text: string;
  confidence: "high" | "medium" | "low" | "none";
  warnings: string[];
  isBlank: boolean;
}

export interface OcrProvider {
  id: string;
  label: string;
  available(): boolean;
  extractPage(page: OcrPageInput): Promise<OcrPageResult>;
}

const HANDWRITING_PROMPT = `You are a handwriting and document transcription engine for student lecture notes.

Task: Transcribe ALL readable text from this page EXACTLY as written.
Rules:
- Do NOT summarize, shorten, rewrite, or improve the lecturer's wording.
- Preserve headings, subheadings, paragraphs, numbering, bullet points, definitions, examples.
- Keep mathematical expressions as close as possible (use Unicode or plain text math).
- Maintain reading order (top to bottom, left to right).
- If a word is illegible, write [[unclear]] instead of guessing.
- If the page is blank or has no readable text, reply with exactly: NO_TEXT_FOUND
- Output only the transcribed notes text, no commentary.`;

async function geminiExtract(buffer: Buffer, mimeType: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
  if (!key) throw new Error("Gemini API key not configured (GOOGLE_API_KEY or GEMINI_API_KEY)");

  // Prefer existing helpers when available
  try {
    const { extractTextFromImage } = await import("./gemini");
    const b64 = buffer.toString("base64");
    // extractTextFromImage uses a generic OCR prompt; for handwriting we call Vision API directly below if empty
    const quick = await extractTextFromImage(b64, mimeType);
    if (quick && quick !== "NO_TEXT_FOUND" && quick.length > 20) return quick;
  } catch {}

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: key });
  const model =
    process.env.GEMINI_OCR_MODEL ||
    process.env.GEMINI_VISION_MODEL ||
    "gemini-2.0-flash";

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("OCR_TIMEOUT")), 45_000)
  );
  const run = ai.models.generateContent({
    model,
    contents: [
      {
        inlineData: {
          mimeType: mimeType || "image/jpeg",
          data: buffer.toString("base64"),
        },
      },
      { text: HANDWRITING_PROMPT },
    ] as any,
    config: { thinkingConfig: { thinkingBudget: 0 } } as any,
  });
  const response = await Promise.race([run, timeout]);
  return String((response as any).text || "").trim();
}

function scoreConfidence(text: string): OcrPageResult["confidence"] {
  if (!text || text === "NO_TEXT_FOUND") return "none";
  const unclear = (text.match(/\[\[unclear\]\]/gi) || []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 3) return "low";
  if (unclear === 0 && words > 20) return "high";
  if (unclear / Math.max(words, 1) > 0.08) return "low";
  if (unclear > 0) return "medium";
  return "high";
}

export const geminiOcrProvider: OcrProvider = {
  id: "gemini",
  label: "Gemini Vision OCR",
  available: () => !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  async extractPage(page) {
    const warnings: string[] = [];
    let text = "";
    try {
      text = await geminiExtract(page.buffer, page.mimeType);
    } catch (e: any) {
      warnings.push(e?.message || "OCR failed");
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings,
        isBlank: true,
      };
    }
    if (!text || text === "NO_TEXT_FOUND") {
      return {
        index: page.index,
        fileName: page.fileName,
        text: "",
        confidence: "none",
        warnings: ["No readable text detected on this page"],
        isBlank: true,
      };
    }
    const confidence = scoreConfidence(text);
    if (confidence === "low") warnings.push("Low confidence — review against the original photo");
    if (/\[\[unclear\]\]/i.test(text)) warnings.push("Some words marked [[unclear]]");
    return {
      index: page.index,
      fileName: page.fileName,
      text,
      confidence,
      warnings,
      isBlank: false,
    };
  },
};

export function getOcrProvider(): OcrProvider {
  if (geminiOcrProvider.available()) return geminiOcrProvider;
  throw new Error(
    "No OCR provider configured. Set GOOGLE_API_KEY or GEMINI_API_KEY on the server."
  );
}

/** Combine page texts in order without summarizing. */
export function combinePageTexts(pages: OcrPageResult[]): string {
  const parts: string[] = [];
  for (const p of pages) {
    if (p.isBlank || !p.text.trim()) {
      parts.push(`\n\n--- Page ${p.index + 1} (no readable text) ---\n`);
      continue;
    }
    parts.push(`\n\n--- Page ${p.index + 1} ---\n\n${p.text.trim()}`);
  }
  return parts.join("").trim();
}
